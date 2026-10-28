import mongoose from 'mongoose';
import { PppoeAccount, Transaction } from '../models/index.js';
import { sendSmtpMail } from '../integrations/mail.js';
import { sendArkeselSms } from '../integrations/arkesel.js';
import { buildStuckPaymentsAlertEmail } from '../templates/email/transactional.js';
import { config } from '../config.js';
import { alertRecipients } from './routerMonitorService.js';
import { resolveSmsBranding } from './smsRouterBranding.js';
import {
  fulfillPaidTransaction,
  reconcilePaymentFromHubtelStatus,
  syncRenewalToRouter,
} from './paymentService.js';
import { settlePaidTransactionToWallet } from './orgWalletService.js';

/** A checkout counts as stuck this long after it started (customers usually pay within minutes). */
export const STUCK_AFTER_MS = 15 * 60 * 1000;
/** Alerts cover recent payments only; older ones stay on the Needs attention list. */
const ALERT_WINDOW_MS = 72 * 60 * 60 * 1000;
const LIST_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const STALE_RENEW_CLAIM_MS = 5 * 60 * 1000;

export const STUCK_REASONS = {
  payment_unconfirmed: 'Hubtel reported it paid, but Status Check has not confirmed it yet',
  voucher_not_delivered: 'Paid, but the voucher code has not reached the router',
  renewal_not_applied: 'Paid, but the renewal was not applied to the account',
  renewal_router_sync: 'Paid and renewed, but the router was not updated',
  wallet_not_credited: 'Paid, but the organisation wallet was not credited',
  org_bill_not_applied: 'Organisation bill paid, but the due date was not moved forward',
};

/** Short form for SMS. */
const STUCK_SHORT = {
  payment_unconfirmed: 'payment not confirmed',
  voucher_not_delivered: 'voucher not delivered',
  renewal_not_applied: 'renewal not applied',
  renewal_router_sync: 'router not updated',
  wallet_not_credited: 'wallet not credited',
  org_bill_not_applied: 'org bill not applied',
};

/**
 * Online (Hubtel) checkouts only: balance-paid auto-renewals and admin renewals have a different
 * shape and are never "stuck" in this sense.
 */
function stuckQuery({ organizationId, olderThan, newerThan }) {
  const q = {
    'meta.hubtelCheckout': true,
    createdAt: { $gte: newerThan, $lte: olderThan },
    $or: [
      { status: 'pending', 'meta.callbackUnverified': { $exists: true } },
      { status: 'paid', kind: 'voucher', 'meta.fulfillment': { $ne: 'done' } },
      { status: 'paid', kind: 'renewal', 'meta.renewedUntil': { $exists: false } },
      { status: 'paid', kind: 'renewal', 'meta.routerSyncPending': true },
      { status: 'paid', organizationId: { $ne: null }, 'meta.walletSettled': { $ne: true } },
      { status: 'paid', kind: 'org_subscription', 'meta.fulfillment': { $ne: 'done' } },
    ],
  };
  if (organizationId && mongoose.isValidObjectId(String(organizationId))) {
    q.organizationId = new mongoose.Types.ObjectId(String(organizationId));
  }
  return q;
}

/** Why a payment is stuck, or null. Order matters: the customer-facing problem comes first. */
export function stuckReason(tx) {
  if (!tx) return null;
  if (tx.status === 'pending' && tx.meta?.callbackUnverified) return 'payment_unconfirmed';
  if (tx.status !== 'paid') return null;
  if (tx.kind === 'org_subscription') return tx.meta?.fulfillment === 'done' ? null : 'org_bill_not_applied';
  if (tx.kind === 'voucher' && tx.meta?.fulfillment !== 'done') return 'voucher_not_delivered';
  if (tx.kind === 'renewal' && !tx.meta?.renewedUntil) return 'renewal_not_applied';
  if (tx.kind === 'renewal' && tx.meta?.routerSyncPending) return 'renewal_router_sync';
  if (tx.organizationId && !tx.meta?.walletSettled) return 'wallet_not_credited';
  return null;
}

/** Last error the system recorded while trying, for the admin list. */
function lastError(tx) {
  return (
    tx.meta?.routerPushError?.error ||
    tx.meta?.routerSyncError?.error ||
    tx.meta?.walletSettleFailed?.error ||
    tx.meta?.callbackUnverified?.reason ||
    tx.meta?.reason ||
    ''
  );
}

function describe(tx) {
  const reason = stuckReason(tx);
  return {
    id: String(tx._id),
    clientReference: tx.clientReference,
    createdAt: tx.createdAt,
    status: tx.status,
    kind: tx.kind,
    amountCents: tx.amountCents,
    currency: tx.currency,
    customerPhone: tx.customerPhone || '',
    customerName: tx.customerName || '',
    voucherCode: tx.meta?.voucherCode || '',
    reason,
    reasonLabel: STUCK_REASONS[reason] || '',
    lastError: String(lastError(tx)).slice(0, 300),
    alertedAt: tx.stuckAlertedAt || null,
  };
}

/** Stuck payments for the admin "Needs attention" list, newest first. */
export async function listStuckPayments({ organizationId, now = new Date(), limit = 100 } = {}) {
  const rows = await Transaction.find(
    stuckQuery({
      organizationId,
      olderThan: new Date(now.getTime() - STUCK_AFTER_MS),
      newerThan: new Date(now.getTime() - LIST_WINDOW_MS),
    })
  )
    .sort({ createdAt: -1 })
    .limit(Math.min(500, Math.max(1, Number(limit) || 100)))
    .select('-meta.callback -meta.statusCheck -meta.hubtelConfig')
    .lean();
  return rows.map(describe).filter((r) => r.reason);
}

function formatMoney(cents, currency) {
  return `${currency || 'GHS'} ${(Math.max(0, Number(cents) || 0) / 100).toFixed(2)}`;
}

const KIND_LABEL = { voucher: 'Wi-Fi ticket', renewal: 'PPPoE renewal', org_subscription: 'Organisation bill' };

/**
 * Cron: email + SMS each organisation's admins once about payments that became stuck.
 * Each payment is alerted once (stuckAlertedAt); it stays on the Needs attention list until fixed.
 */
export async function runStuckPaymentAlerts({ now = new Date() } = {}) {
  const rows = await Transaction.find({
    ...stuckQuery({
      olderThan: new Date(now.getTime() - STUCK_AFTER_MS),
      newerThan: new Date(now.getTime() - ALERT_WINDOW_MS),
    }),
    stuckAlertedAt: null,
  })
    .sort({ createdAt: 1 })
    .limit(200)
    .select('-meta.callback -meta.statusCheck')
    .lean();

  const byOrg = new Map();
  for (const tx of rows) {
    if (!stuckReason(tx)) continue;
    const key = tx.organizationId ? String(tx.organizationId) : '';
    if (!byOrg.has(key)) byOrg.set(key, []);
    byOrg.get(key).push(tx);
  }

  const summary = { stuck: 0, organizations: 0, emails: 0, sms: 0 };
  const appUrl = config.publicAppUrl ? `${String(config.publicAppUrl).replace(/\/$/, '')}/finance/payments` : '';
  for (const [orgId, txs] of byOrg) {
    const { emails, phones } = await alertRecipients(orgId || null);
    const branding = await resolveSmsBranding(null, orgId || null);
    const items = txs.map((tx) => ({
      when: new Date(tx.createdAt).toISOString().replace('T', ' ').slice(0, 16) + ' UTC',
      customer: tx.customerPhone || tx.customerName || '—',
      amount: formatMoney(tx.amountCents, tx.currency),
      what: KIND_LABEL[tx.kind] || tx.kind,
      problem: STUCK_REASONS[stuckReason(tx)],
      reference: tx.clientReference,
    }));
    const { subject, text, html } = buildStuckPaymentsAlertEmail({ brand: branding.brandName, items, appUrl });
    const first = STUCK_SHORT[stuckReason(txs[0])];
    const message =
      `${branding.brandName} ALERT: ${txs.length} paid payment${txs.length === 1 ? '' : 's'} need attention ` +
      `(e.g. ${first}). Open Payments > Needs attention.`;

    const [mail, sms] = await Promise.all([
      Promise.allSettled(emails.map((to) => sendSmtpMail({ to, subject, text, html }))),
      Promise.allSettled(phones.map((to) => sendArkeselSms({ to, message, senderId: branding.senderId || undefined }))),
    ]);
    const ok = (rs) => rs.filter((r) => r.status === 'fulfilled' && r.value?.ok).length;
    summary.emails += ok(mail);
    summary.sms += ok(sms);
    summary.stuck += txs.length;
    summary.organizations += 1;

    /* Mark even if delivery failed: the list in the app still shows them, and we must not spam. */
    await Transaction.updateMany({ _id: { $in: txs.map((t) => t._id) } }, { $set: { stuckAlertedAt: now } });
    console.warn('[payments.stuck] alerted', { organizationId: orgId || null, count: txs.length, email: `${ok(mail)}/${emails.length}`, sms: `${ok(sms)}/${phones.length}` });
  }
  return summary;
}

/**
 * Admin "Retry now": run whichever step is missing for this payment, then report what is left.
 * @returns {Promise<{ ok: boolean, status?: string, stillStuck?: string|null, reason?: string }>}
 */
export async function retryStuckPayment(txId, { organizationId } = {}) {
  const q = { _id: txId };
  if (organizationId && mongoose.isValidObjectId(String(organizationId))) q.organizationId = organizationId;
  let tx = await Transaction.findOne(q);
  if (!tx) return { ok: false, reason: 'not_found' };

  if (tx.status === 'pending') {
    await reconcilePaymentFromHubtelStatus(tx.clientReference);
  } else if (tx.status === 'paid') {
    if (tx.kind === 'renewal' && !tx.meta?.renewedUntil) {
      /* A crashed attempt leaves a claim that blocks fulfilment; take it over once it is stale. */
      await Transaction.updateOne(
        {
          _id: tx._id,
          'meta.renewedUntil': { $exists: false },
          'meta.renewClaimedAt': { $lte: new Date(Date.now() - STALE_RENEW_CLAIM_MS).toISOString() },
        },
        { $unset: { 'meta.renewClaimedAt': '' } }
      );
      await fulfillPaidTransaction({ _id: tx._id });
    } else if (tx.kind === 'renewal' && tx.meta?.routerSyncPending) {
      const acc = tx.pppoeAccountId ? await PppoeAccount.findById(tx.pppoeAccountId) : null;
      if (acc) {
        await syncRenewalToRouter(tx, acc);
        await tx.save();
      }
    } else {
      await fulfillPaidTransaction({ _id: tx._id });
    }
    tx = await Transaction.findById(tx._id);
    if (tx.status === 'paid' && !tx.meta?.walletSettled) {
      try {
        await settlePaidTransactionToWallet(tx);
      } catch (e) {
        console.error('[payments.stuck] wallet retry failed', tx.clientReference, e?.message || e);
      }
    }
  } else {
    return { ok: false, reason: 'not_retryable', status: tx.status };
  }

  const fresh = await Transaction.findById(tx._id).lean();
  const stillStuck = stuckReason(fresh);
  return { ok: !stillStuck, status: fresh.status, stillStuck, item: describe(fresh) };
}
