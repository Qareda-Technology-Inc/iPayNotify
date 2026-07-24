import mongoose from 'mongoose';
import { sendSmtpMail } from '../integrations/mail.js';
import { Admin, Organization, PlanPackage, PppoeAccount, User } from '../models/index.js';
import { config } from '../config.js';
import { buildPaymentSuccessAdminEmail } from '../templates/email/transactional.js';
import { resolveOrgBilling } from './orgBillingService.js';

function patchTxMeta(tx, patch) {
  const prev = tx.meta && typeof tx.meta === 'object' ? { ...tx.meta } : {};
  tx.meta = { ...prev, ...patch };
}

function moneyLabel(amountCents, currency = 'GHS') {
  const n = Number(amountCents || 0) / 100;
  const cur = String(currency || 'GHS').trim() || 'GHS';
  return `${cur} ${n.toFixed(2)}`;
}

function parseExtraNotifyEmails() {
  return String(config.paymentAdminNotifyEmails || '')
    .split(/[,;\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Org admins for the transaction tenant, plus optional PAYMENT_ADMIN_NOTIFY_EMAIL list,
 * plus DEFAULT_ADMIN_EMAIL as last-resort fallback.
 */
async function resolveAdminNotifyEmails(organizationId) {
  const emails = new Set(parseExtraNotifyEmails());

  if (organizationId != null && mongoose.isValidObjectId(String(organizationId))) {
    const orgAdmins = await Admin.find({
      organizationId: String(organizationId),
      role: { $in: ['org_admin', 'org_staff', 'super_admin'] },
    })
      .select('email')
      .lean();
    for (const a of orgAdmins) {
      const e = String(a.email || '').trim().toLowerCase();
      if (e) emails.add(e);
    }
  }

  if (emails.size === 0) {
    const supers = await Admin.find({ role: 'super_admin' }).select('email').lean();
    for (const a of supers) {
      const e = String(a.email || '').trim().toLowerCase();
      if (e) emails.add(e);
    }
  }

  if (emails.size === 0) {
    const fallback = String(config.defaultAdmin?.email || '').trim().toLowerCase();
    if (fallback) emails.add(fallback);
  }

  return [...emails];
}

/**
 * Email org/platform admins after a payment is fulfilled.
 * Idempotent via meta.adminEmailNotification.status === 'sent'.
 */
export async function notifyTransactionPaidAdminEmail(tx, context = {}) {
  if (tx.meta?.adminEmailNotification?.status === 'sent') {
    return { skipped: true, reason: 'already_sent' };
  }

  const recipients = await resolveAdminNotifyEmails(tx.organizationId);
  if (recipients.length === 0) {
    patchTxMeta(tx, {
      adminEmailNotification: { status: 'skipped', reason: 'no_recipients' },
    });
    return { skipped: true, reason: 'no_recipients' };
  }

  let packageName = context.packageName || '';
  let secretName = context.secretName || '';
  let paidUntil = context.paidUntil || null;
  let voucherCode = context.voucherCode || tx.meta?.voucherCode || '';
  let customerName = String(tx.customerName || context.customerName || '').trim();

  if (!packageName && tx.packageId) {
    const pkg = await PlanPackage.findById(tx.packageId).select('name').lean();
    packageName = pkg?.name || '';
  }
  if (!secretName && tx.pppoeAccountId) {
    const acc = await PppoeAccount.findById(tx.pppoeAccountId).select('secretName paidUntil').lean();
    secretName = acc?.secretName || '';
    if (!paidUntil && acc?.paidUntil) paidUntil = acc.paidUntil;
  }
  if (!customerName && tx.userId) {
    const u = await User.findById(tx.userId).select('fullName').lean();
    customerName = String(u?.fullName || '').trim();
  }

  const billing = await resolveOrgBilling(tx.organizationId);
  let orgName = '';
  if (tx.organizationId && mongoose.isValidObjectId(String(tx.organizationId))) {
    const org = await Organization.findById(tx.organizationId).select('name').lean();
    orgName = String(org?.name || '').trim();
  }
  const brand =
    String(billing.merchantDisplayName || '').trim() ||
    orgName ||
    config.merchant.displayName ||
    'QareFi Billing';

  const paidUntilLabel = paidUntil
    ? new Date(paidUntil).toLocaleString('en-GB', { timeZone: 'Africa/Accra' })
    : '';

  const { subject, text, html } = buildPaymentSuccessAdminEmail({
    brand,
    kind: context.kind || tx.kind || 'payment',
    amountLabel: moneyLabel(tx.amountCents, tx.currency),
    customerPhone: tx.customerPhone,
    customerName,
    packageName,
    secretName,
    voucherCode,
    paidUntilLabel,
    clientReference: tx.clientReference,
    providerReference: tx.providerReference,
    appUrl: config.publicAppUrl,
  });

  const results = await Promise.allSettled(
    recipients.map((to) => sendSmtpMail({ to, subject, text, html }))
  );

  const sentTo = [];
  const errors = [];
  results.forEach((r, i) => {
    const to = recipients[i];
    if (r.status === 'fulfilled' && r.value?.ok) {
      sentTo.push(to);
    } else {
      const err =
        r.status === 'rejected'
          ? r.reason?.message || 'rejected'
          : r.value?.error || r.value?.reason || 'send_failed';
      errors.push({ to, error: err });
    }
  });

  if (sentTo.length === 0) {
    patchTxMeta(tx, {
      adminEmailNotification: {
        status: errors.some((e) => String(e.error).includes('smtp')) ? 'skipped' : 'failed',
        reason: errors[0]?.error || 'send_failed',
        at: new Date().toISOString(),
        errors,
      },
    });
    return { ok: false, errors };
  }

  patchTxMeta(tx, {
    adminEmailNotification: {
      status: 'sent',
      at: new Date().toISOString(),
      to: sentTo,
      partialErrors: errors.length ? errors : undefined,
    },
  });
  return { ok: true, to: sentTo, errors };
}
