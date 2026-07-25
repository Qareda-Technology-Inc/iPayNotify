import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { Admin, Organization } from '../models/index.js';
import { config } from '../config.js';
import { sendSmtpMail, smtpReadyForSend } from '../integrations/mail.js';
import { buildAdminInviteEmail } from '../templates/email/index.js';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SALT = 10;

export function hashInviteToken(raw) {
  return crypto.createHash('sha256').update(String(raw || '')).digest('hex');
}

export function newInviteToken() {
  return crypto.randomBytes(32).toString('hex');
}

export function inviteAcceptUrl(rawToken) {
  const base = String(config.publicAppUrl || '').replace(/\/$/, '') || 'http://localhost:5173';
  return `${base}/accept-invite?token=${encodeURIComponent(rawToken)}`;
}

/**
 * Issue (or re-issue) an invite token on an admin doc and email the link.
 * @returns {{ admin: import('mongoose').Document, rawToken: string, emailSent: boolean }}
 */
export async function issueAdminInvite(adminDoc, { orgName } = {}) {
  const rawToken = newInviteToken();
  adminDoc.status = 'invited';
  adminDoc.passwordHash = '';
  adminDoc.inviteTokenHash = hashInviteToken(rawToken);
  adminDoc.inviteExpiresAt = new Date(Date.now() + INVITE_TTL_MS);
  await adminDoc.save();

  let emailSent = false;
  const brand = String(config.merchant?.displayName || 'QareFi Billing').trim();
  const acceptUrl = inviteAcceptUrl(rawToken);
  const mail = buildAdminInviteEmail({
    brand,
    inviteeName: adminDoc.fullName || adminDoc.email,
    orgName: orgName || 'your organisation',
    acceptUrl,
    expiresDays: 7,
    appUrl: String(config.publicAppUrl || '').replace(/\/$/, ''),
  });

  if (smtpReadyForSend()) {
    const result = await sendSmtpMail({
      to: adminDoc.email,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    });
    emailSent = Boolean(result?.ok || result?.mock);
  }

  return { admin: adminDoc, rawToken, emailSent };
}

export async function findAdminByInviteToken(rawToken) {
  const hash = hashInviteToken(rawToken);
  if (!hash) return null;
  const admin = await Admin.findOne({
    status: 'invited',
    inviteTokenHash: hash,
    inviteExpiresAt: { $gt: new Date() },
  });
  return admin;
}

export async function acceptAdminInvite({ token, password }) {
  const admin = await findAdminByInviteToken(token);
  if (!admin) {
    const e = new Error('Invite link is invalid or has expired');
    e.status = 400;
    throw e;
  }
  if (!password || String(password).length < 8) {
    const e = new Error('Password must be at least 8 characters');
    e.status = 400;
    throw e;
  }
  admin.passwordHash = await bcrypt.hash(String(password), SALT);
  admin.status = 'active';
  admin.inviteTokenHash = '';
  admin.inviteExpiresAt = null;
  await admin.save();
  return admin;
}

export async function getInvitePreview(rawToken) {
  const admin = await findAdminByInviteToken(rawToken);
  if (!admin) return null;
  let orgName = '';
  if (admin.organizationId) {
    const org = await Organization.findById(admin.organizationId).select('name').lean();
    orgName = org?.name || '';
  }
  return {
    email: admin.email,
    fullName: admin.fullName || '',
    role: admin.role,
    organizationName: orgName,
    expiresAt: admin.inviteExpiresAt,
  };
}
