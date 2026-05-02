import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { AdminLoginChallenge } from '../models/AdminLoginChallenge.js';
import { sendSmtpMail, smtpReadyForSend } from '../integrations/mail.js';
import { buildAdminSignInOtpEmail } from '../templates/email/index.js';
import { sendArkeselSms } from '../integrations/arkesel.js';
import { normalizeGhanaMsisdn } from '../utils/phoneGhana.js';
import { config } from '../config.js';

const OTP_ROUNDS = 4;
const CHALLENGE_TTL_MIN = 10;

function randomSixDigit() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

function smsChannelAvailable() {
  const { apiKey, senderId, mock } = config.arkesel;
  return mock || (Boolean(apiKey) && Boolean(senderId));
}

function withTimeout(promise, ms, label) {
  let id;
  const t = new Promise((_, reject) => {
    id = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, t]).finally(() => clearTimeout(id));
}

/**
 * @param {import('mongoose').Document & { email: string, phone?: string }} admin
 */
export async function createAndDispatchLoginChallenge(admin) {
  const brand = config.merchant.displayName || 'QareFi Billing';
  const emailOk = smtpReadyForSend();
  const phone = normalizeGhanaMsisdn(admin.phone);
  const smsOk = Boolean(phone) && smsChannelAvailable();

  if (!emailOk && !smsOk) {
    const e = new Error(
      'Neither email nor SMS verification is available. Configure SMTP (SMTP_HOST, SMTP_FROM, …) ' +
        'and/or add a valid phone on this account with Arkesel (ARKESEL_API_KEY, ARKESEL_SENDER_ID or ARKESEL_MOCK=true).'
    );
    e.status = 503;
    throw e;
  }

  const otp = randomSixDigit();
  const codeHash = await bcrypt.hash(otp, OTP_ROUNDS);
  const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MIN * 60 * 1000);

  /** Create row first so we never return 200 after SMS without a persisted challenge the client can verify. */
  const challengeDoc = await AdminLoginChallenge.create({
    adminId: admin._id,
    codeHash,
    sentEmail: false,
    sentSms: false,
    consumed: false,
    expiresAt,
  });
  const challengeId = String(challengeDoc._id);

  const smsTimeoutMs = Math.min(120_000, Math.max(5_000, Number(process.env.LOGIN_OTP_SMS_TIMEOUT_MS) || 20_000));
  const emailTimeoutMs = Math.min(120_000, Math.max(5_000, Number(process.env.LOGIN_OTP_EMAIL_TIMEOUT_MS) || 28_000));

  const smsMsg = `${brand}: Your sign-in code is ${otp}. Expires in ${CHALLENGE_TTL_MIN} minutes.`;

  const smsPromise = (async () => {
    if (!smsOk) return { attempted: false, sent: false };
    try {
      const r = await withTimeout(sendArkeselSms({ to: phone, message: smsMsg }), smsTimeoutMs, 'SMS verification');
      if (r.ok || r.mock) return { attempted: true, sent: true };
      if (r.skipped) return { attempted: true, sent: false, detail: r.reason || 'sms_skipped' };
      return { attempted: true, sent: false, detail: r.error || 'sms_failed' };
    } catch (e) {
      return { attempted: true, sent: false, detail: e.message || 'sms_failed' };
    }
  })();

  const emailPromise = (async () => {
    if (!emailOk) return { attempted: false, sent: false };
    try {
      const mail = buildAdminSignInOtpEmail({
        brand,
        code: otp,
        expiresMinutes: CHALLENGE_TTL_MIN,
        appUrl: config.publicAppUrl,
      });
      const r = await withTimeout(
        sendSmtpMail({
          to: admin.email,
          subject: mail.subject,
          text: mail.text,
          html: mail.html,
        }),
        emailTimeoutMs,
        'Email verification'
      );
      if (r.ok || r.mock) return { attempted: true, sent: true };
      if (r.skipped) return { attempted: true, sent: false, detail: r.reason || 'email_skipped' };
      return { attempted: true, sent: false, detail: r.error || r.reason || 'email_failed' };
    } catch (e) {
      return { attempted: true, sent: false, detail: e.message || 'email_failed' };
    }
  })();

  const [smsOutcome, emailOutcome] = await Promise.all([smsPromise, emailPromise]);

  const sentSms = Boolean(smsOutcome.sent);
  const sentEmail = Boolean(emailOutcome.sent);

  if (!sentSms && !sentEmail) {
    await AdminLoginChallenge.deleteOne({ _id: challengeDoc._id });
    const parts = [];
    if (smsOutcome.attempted) parts.push(`SMS: ${smsOutcome.detail || 'failed'}`);
    if (emailOutcome.attempted) parts.push(`Email: ${emailOutcome.detail || 'failed'}`);
    const e = new Error(
      parts.length
        ? `Could not deliver verification code (${parts.join(' · ')}).`
        : 'Could not deliver verification code.'
    );
    e.status = 503;
    throw e;
  }

  await AdminLoginChallenge.updateOne(
    { _id: challengeDoc._id },
    { $set: { sentEmail, sentSms } }
  );

  return {
    challengeId,
    sentEmail,
    sentSms,
    /** Same 6-digit code was sent to email and SMS when both are true. */
    sameCodeOnBothChannels: sentEmail && sentSms,
    expiresInSec: CHALLENGE_TTL_MIN * 60,
  };
}

export async function verifyLoginChallenge(input) {
  const challengeId = String(input.challengeId || '').trim();
  if (!challengeId || !/^[a-f0-9]{24}$/i.test(challengeId)) {
    const e = new Error('Invalid challenge');
    e.status = 400;
    throw e;
  }

  const doc = await AdminLoginChallenge.findOne({
    _id: challengeId,
    consumed: false,
    expiresAt: { $gt: new Date() },
  });
  if (!doc) {
    const e = new Error('Challenge expired or already used');
    e.status = 400;
    throw e;
  }

  const code = String(input.code ?? input.emailCode ?? input.smsCode ?? '').trim();
  if (!/^\d{6}$/.test(code) || !(await bcrypt.compare(code, doc.codeHash))) {
    const e = new Error('Invalid verification code');
    e.status = 401;
    throw e;
  }

  doc.consumed = true;
  await doc.save();
  return { adminId: doc.adminId };
}

export function smsOtpGloballyAvailable() {
  return smsChannelAvailable();
}
