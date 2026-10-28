import crypto from 'crypto';
import mongoose from 'mongoose';
import { Organization, Router, Transaction } from '../models/index.js';
import { WireGuardPeer } from '../models/WireGuardPeer.js';
import { config } from '../config.js';
import { buildHubtelCheckoutSession, resolveHubtelCallbackUrl } from '../integrations/hubtel.js';
import { normalizeGhanaMsisdn } from '../utils/phoneGhana.js';
import { sendSmtpMail } from '../integrations/mail.js';
import { sendArkeselSms } from '../integrations/arkesel.js';
import { wrapTransactionalHtml, escapeHtml } from '../templates/email/index.js';
import { setPeerAccess } from './wireguard/peerAccess.js';
import { alertRecipients } from './routerMonitorService.js';

const DAY_MS = 24 * 60 * 60 * 1000;
/** "Due soon" reminder this many days before paidUntil. */
const DUE_SOON_DAYS = 3;
export const MAX_MONTHS_PER_PAYMENT = 12;

function addMonths(date, months) {
  const d = new Date(date);
  const day = d.getUTCDate();
  d.setUTCMonth(d.getUTCMonth() + months);
  /* 31 Jan + 1 month → 28/29 Feb, not 2/3 Mar. */
  if (d.getUTCDate() < day) d.setUTCDate(0);
  return d;
}

function oid(id) {
  return id && mongoose.isValidObjectId(String(id)) ? String(id) : null;
}

export function formatCents(cents, currency = 'GHS') {
  return `${currency || 'GHS'} ${(Math.max(0, Number(cents) || 0) / 100).toFixed(2)}`;
}

/**
 * The bill: monthly price for this org (org fee + per-router fee × routers), how many whole months
 * are overdue, and what clearing the debt costs. Arrears count: paying 1 month while 3 behind
 * still leaves the organisation 2 months behind.
 */
export async function orgBillQuote(org, now = new Date()) {
  const pb = org.platformBilling || {};
  const routers = await Router.countDocuments({ organizationId: org._id });
  const monthlyCents = Math.round(Number(pb.orgFeeCents) || 0) + Math.round(Number(pb.routerFeeCents) || 0) * routers;
  const paidUntil = pb.paidUntil ? new Date(pb.paidUntil) : null;
  let monthsOwed = 0;
  if (!paidUntil || paidUntil <= now) {
    monthsOwed = 1;
    if (paidUntil) {
      let cursor = addMonths(paidUntil, 1);
      while (cursor <= now && monthsOwed < 120) {
        monthsOwed += 1;
        cursor = addMonths(cursor, 1);
      }
    }
  }
  return {
    routers,
    orgFeeCents: Math.round(Number(pb.orgFeeCents) || 0),
    routerFeeCents: Math.round(Number(pb.routerFeeCents) || 0),
    monthlyCents,
    currency: pb.currency || 'GHS',
    monthsOwed,
    amountDueCents: monthlyCents * monthsOwed,
  };
}

/** Status platform billing wants for this org right now, or null when billing is off. */
export function billingStatusFor(org, now = new Date()) {
  const pb = org.platformBilling || {};
  if (!pb.enabled) return null;
  const paidUntil = pb.paidUntil ? new Date(pb.paidUntil) : null;
  if (paidUntil && now <= paidUntil) return 'active';
  const graceDays = Math.max(0, Number(pb.graceDays ?? 7));
  const suspendAt = new Date((paidUntil || now).getTime() + graceDays * DAY_MS);
  return now <= suspendAt ? 'past_due' : 'suspended';
}

export function suspendAtFor(org) {
  const pb = org.platformBilling || {};
  if (!pb.paidUntil) return null;
  return new Date(new Date(pb.paidUntil).getTime() + Math.max(0, Number(pb.graceDays ?? 7)) * DAY_MS);
}

/**
 * The organisation's phone/laptop VPN profiles are its remote access: off while suspended for
 * non-payment, back on when paid. Router tunnels are never touched (billing needs them).
 */
async function setOrgVpnProfiles(organizationId, enabled) {
  const q = enabled
    ? { organizationId, kind: 'client', status: 'disabled', disabledReason: 'org_unpaid' }
    : { organizationId, kind: 'client', status: { $ne: 'disabled' } };
  const peers = await WireGuardPeer.find(q);
  let changed = 0;
  for (const peer of peers) {
    try {
      await setPeerAccess(peer, enabled ? { enabled: true } : { enabled: false, reason: 'org_unpaid' });
      changed += 1;
    } catch (e) {
      console.error('[org-billing] VPN profile update failed', String(peer._id), e?.message || e);
    }
  }
  return changed;
}

async function notifyAdmins(org, kind, quote) {
  const { emails, phones } = await alertRecipients(String(org._id));
  const brand = config.merchant.displayName;
  const due = formatCents(quote.amountDueCents, quote.currency);
  const paidUntil = org.platformBilling?.paidUntil ? new Date(org.platformBilling.paidUntil).toDateString() : 'now';
  const suspendAt = suspendAtFor(org);
  const appUrl = config.publicAppUrl ? `${String(config.publicAppUrl).replace(/\/$/, '')}/org/billing` : '';
  const lines = {
    due_soon: `${org.name}: your ${brand} bill of ${due} is due on ${paidUntil}. Pay in Billing to keep your account active.`,
    past_due: `${org.name}: your ${brand} bill of ${due} is overdue. Pay by ${suspendAt ? suspendAt.toDateString() : 'soon'} to avoid suspension.`,
    suspended: `${org.name}: your ${brand} account is suspended for an unpaid bill of ${due}. Remote access is off. Pay in Billing to restore it; customer sales continue.`,
  };
  const message = lines[kind];
  const subject = {
    due_soon: `Your ${brand} bill is due soon`,
    past_due: `⚠️ Your ${brand} bill is overdue`,
    suspended: `🔴 ${org.name} is suspended for an unpaid bill`,
  }[kind];
  const html = wrapTransactionalHtml({
    brand,
    title: subject.replace(/^[^\w]+/, ''),
    preheader: message,
    innerHtml: `<p style="margin:0 0 16px;">${escapeHtml(message)}</p>${
      appUrl ? `<p style="margin:0;"><a href="${escapeHtml(appUrl)}" style="color:#34d399;">Open Billing</a></p>` : ''
    }`,
    footerText: appUrl ? `Billing: ${appUrl}` : '',
  });
  await Promise.allSettled([
    ...emails.map((to) => sendSmtpMail({ to, subject, text: `${message}${appUrl ? `\n\n${appUrl}` : ''}`, html })),
    ...phones.map((to) => sendArkeselSms({ to, message })),
  ]);
}

/** Which reminder is due now for this org, if any (each goes out once per due date). */
function noticeDue(org, status, now) {
  const pb = org.platformBilling || {};
  const forPaidUntil = pb.paidUntil ? new Date(pb.paidUntil).getTime() : 0;
  const sent = pb.lastNotice?.forPaidUntil ? new Date(pb.lastNotice.forPaidUntil).getTime() : -1;
  const sentKind = sent === forPaidUntil ? pb.lastNotice?.kind || '' : '';
  const order = ['', 'due_soon', 'past_due', 'suspended'];
  let want = '';
  if (status === 'suspended') want = 'suspended';
  else if (status === 'past_due') want = 'past_due';
  else if (status === 'active' && pb.paidUntil && new Date(pb.paidUntil).getTime() - now.getTime() <= DUE_SOON_DAYS * DAY_MS) {
    want = 'due_soon';
  }
  return order.indexOf(want) > order.indexOf(sentKind) ? want : '';
}

/**
 * Bring one organisation's status (and VPN profiles) in line with its bill. Manual suspensions
 * by a super admin are left alone. Returns what changed.
 */
export async function applyOrgBillingStatus(orgOrId, { now = new Date(), notify = true } = {}) {
  const org =
    orgOrId instanceof Organization ? orgOrId : await Organization.findById(orgOrId?._id || orgOrId);
  if (!org) return { ok: false, reason: 'not_found' };
  const want = billingStatusFor(org, now);
  if (!want) return { ok: true, skipped: 'billing_off' };
  if (org.statusReason === 'manual' && org.status !== 'active') return { ok: true, skipped: 'manual_status' };

  const before = org.status;
  const out = { ok: true, organizationId: String(org._id), from: before, to: want, vpnProfiles: 0 };
  if (before !== want) {
    org.status = want;
    org.statusReason = want === 'active' ? '' : 'unpaid';
  }
  const notice = notify ? noticeDue(org, want, now) : '';
  if (notice) {
    org.platformBilling.lastNotice = { kind: notice, forPaidUntil: org.platformBilling.paidUntil, at: now };
  }
  await org.save();

  if (want === 'suspended') out.vpnProfiles = await setOrgVpnProfiles(org._id, false);
  else out.vpnProfiles = await setOrgVpnProfiles(org._id, true);

  if (notice) {
    try {
      await notifyAdmins(org, notice, await orgBillQuote(org, now));
      out.notice = notice;
    } catch (e) {
      console.error('[org-billing] notice failed', String(org._id), e?.message || e);
    }
  }
  if (before !== want) console.log('[org-billing] status', org.slug, before, '→', want);
  return out;
}

/** Cron: every organisation with platform billing on. */
export async function runOrgBillingJob({ now = new Date() } = {}) {
  const orgs = await Organization.find({ 'platformBilling.enabled': true });
  const summary = { checked: orgs.length, changed: 0, notices: 0 };
  for (const org of orgs) {
    try {
      const r = await applyOrgBillingStatus(org, { now });
      if (r.from && r.from !== r.to) summary.changed += 1;
      if (r.notice) summary.notices += 1;
    } catch (e) {
      console.error('[org-billing] apply failed', String(org._id), e?.message || e);
    }
  }
  return summary;
}

/** Org admin "Pay now": Hubtel checkout for `months` of the current monthly price. */
export async function createOrgBillCheckout({ organizationId, months, customerMsisdn }) {
  const org = await Organization.findById(oid(organizationId));
  if (!org) {
    const e = new Error('Organisation not found');
    e.status = 404;
    throw e;
  }
  if (!org.platformBilling?.enabled) {
    const e = new Error('Platform billing is not set up for this organisation');
    e.status = 400;
    throw e;
  }
  const quote = await orgBillQuote(org);
  const m = Math.min(MAX_MONTHS_PER_PAYMENT, Math.max(1, Math.round(Number(months) || quote.monthsOwed || 1)));
  if (quote.monthlyCents <= 0) {
    const e = new Error('This organisation has no monthly charge to pay');
    e.status = 400;
    throw e;
  }
  const phone = normalizeGhanaMsisdn(customerMsisdn);
  if (!phone) {
    const e = new Error('Enter a valid mobile money number (e.g. 024 123 4567).');
    e.status = 400;
    throw e;
  }
  const amountCents = quote.monthlyCents * m;
  const clientReference = `QF-${crypto.randomBytes(12).toString('hex')}`;
  /* organizationId stays empty: this is platform revenue, not a sale the org's wallet should see. */
  const tx = await Transaction.create({
    amountCents,
    currency: quote.currency,
    status: 'pending',
    kind: 'org_subscription',
    provider: 'hubtel',
    clientReference,
    customerPhone: phone,
    customerName: org.name,
    meta: {
      billedOrganizationId: String(org._id),
      months: m,
      monthlyCents: quote.monthlyCents,
      routers: quote.routers,
      fulfillment: 'pending',
    },
  });

  const session = buildHubtelCheckoutSession({
    amountGhs: amountCents / 100,
    description: `${config.merchant.displayName} - ${org.name} - ${m} month${m === 1 ? '' : 's'}`,
    customerMsisdn: phone,
    clientReference,
    hubtel: config.hubtel,
    publicAppBaseUrl: config.publicAppUrl,
  });
  if (!session.ok) {
    tx.status = 'failed';
    tx.meta = { ...tx.meta, hubtelError: session.error };
    await tx.save();
    const e = new Error(session.error || 'Could not start payment');
    e.status = session.status || 502;
    throw e;
  }
  tx.meta = {
    ...tx.meta,
    hubtelCheckout: true,
    hubtelCallbackUrl: session.config?.callbackUrl || resolveHubtelCallbackUrl(config.hubtel),
  };
  await tx.save();
  if (session.mock && session.checkoutUrl) {
    return { clientReference, checkoutUrl: session.checkoutUrl, amountCents, months: m };
  }
  return {
    mode: 'hubtel_checkout',
    clientReference,
    purchaseInfo: session.purchaseInfo,
    hubtelConfig: session.config,
    amountCents,
    months: m,
  };
}

/**
 * Paid org bill → move paidUntil forward by the months bought (from the old due date, so arrears
 * are settled first) and re-apply status. Exactly once per transaction.
 */
export async function applyOrgBillPayment(txDoc) {
  const tx = await Transaction.findOneAndUpdate(
    { _id: txDoc._id, status: 'paid', kind: 'org_subscription', 'meta.billAppliedAt': { $exists: false } },
    { $set: { 'meta.billAppliedAt': new Date().toISOString() } },
    { new: true }
  );
  if (!tx) return { ok: true, already: true };
  const org = await Organization.findById(oid(tx.meta?.billedOrganizationId));
  if (!org) {
    await Transaction.updateOne({ _id: tx._id }, { $set: { 'meta.fulfillment': 'failed', 'meta.reason': 'organization_missing' } });
    return { ok: false, reason: 'organization_missing' };
  }
  const months = Math.max(1, Math.round(Number(tx.meta?.months) || 1));
  const from = org.platformBilling?.paidUntil ? new Date(org.platformBilling.paidUntil) : new Date();
  org.platformBilling.paidUntil = addMonths(from, months);
  await org.save();
  await Transaction.updateOne(
    { _id: tx._id },
    { $set: { 'meta.fulfillment': 'done', 'meta.paidFrom': from.toISOString(), 'meta.paidUntil': org.platformBilling.paidUntil.toISOString() } }
  );
  const status = await applyOrgBillingStatus(org, { notify: false });
  return { ok: true, kind: 'org_subscription', paidUntil: org.platformBilling.paidUntil, status: status.to };
}

/** What the org admin's Billing page shows. */
export async function orgBillingSummary(organizationId, now = new Date()) {
  const org = await Organization.findById(oid(organizationId)).lean();
  if (!org) return null;
  const pb = org.platformBilling || {};
  const quote = await orgBillQuote(org, now);
  const payments = await Transaction.find({ kind: 'org_subscription', 'meta.billedOrganizationId': String(org._id) })
    .sort({ createdAt: -1 })
    .limit(20)
    .select('clientReference status amountCents currency createdAt meta.months meta.paidUntil')
    .lean();
  return {
    enabled: Boolean(pb.enabled),
    status: org.status,
    statusReason: org.statusReason || '',
    locked: org.status === 'suspended' && org.statusReason === 'unpaid',
    paidUntil: pb.paidUntil || null,
    graceDays: pb.graceDays ?? 7,
    suspendAt: suspendAtFor(org),
    quote,
    maxMonths: MAX_MONTHS_PER_PAYMENT,
    payments: payments.map((p) => ({
      clientReference: p.clientReference,
      status: p.status,
      amountCents: p.amountCents,
      currency: p.currency,
      createdAt: p.createdAt,
      months: p.meta?.months || 1,
      paidUntil: p.meta?.paidUntil || null,
    })),
  };
}
