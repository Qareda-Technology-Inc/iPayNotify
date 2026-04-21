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

  let sentSms = false;
  let sentEmail = false;

  if (smsOk && phone) {
    const r = await sendArkeselSms({
      to: phone,
      message: `${brand}: Your sign-in code is ${otp}. Expires in ${CHALLENGE_TTL_MIN} minutes.`,
    });
    if (!r.ok && !r.skipped) {
      const e = new Error(r.error || 'Could not send verification SMS');
      e.status = 502;
      throw e;
    }
    if (r.skipped) {
      const e = new Error('SMS provider is not configured; cannot send verification SMS.');
      e.status = 503;
      throw e;
    }
    sentSms = true;
  }

  if (emailOk) {
    const mail = buildAdminSignInOtpEmail({
      brand,
      code: otp,
      expiresMinutes: CHALLENGE_TTL_MIN,
      appUrl: config.publicAppUrl,
    });
    const r = await sendSmtpMail({
      to: admin.email,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    });
    if (!r.ok) {
      const e = new Error(r.error || r.reason || 'Could not send verification email');
      e.status = 502;
      throw e;
    }
    sentEmail = true;
  }

  const doc = await AdminLoginChallenge.create({
    adminId: admin._id,
    codeHash,
    sentEmail,
    sentSms,
    consumed: false,
    expiresAt,
  });

  return {
    challengeId: String(doc._id),
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
