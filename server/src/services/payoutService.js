import mongoose from 'mongoose';
import { Organization, WithdrawalRequest } from '../models/index.js';
import {
  createMomoRecipient,
  initiateTransfer,
  momoProviderForMsisdn,
  paystackConfigured,
  verifyTransfer,
} from '../integrations/paystack.js';
import { getPayoutSettings } from './platformSettingsService.js';
import {
  RESERVED_WITHDRAWAL_STATUSES,
  appendLedgerEntry,
  getOrgAvailableBalanceCents,
} from './orgWalletService.js';

/*
 * Vendor withdrawals paid straight to the organisation's payout MoMo number through Paystack
 * Transfers, within limits a platform admin sets. Anything outside the limits waits for approval.
 * The wallet is debited only once Paystack confirms the transfer.
 */

/** A transfer Paystack has never heard of after this long was not sent; let an admin decide. */
const UNKNOWN_TRANSFER_GIVE_UP_MS = 30 * 60 * 1000;

const ghs = (cents) => `GHS ${((Number(cents) || 0) / 100).toFixed(2)}`;

function err(message, status = 400) {
  const e = new Error(message);
  e.status = status;
  return e;
}

/** Total sent automatically for this organisation in the last 24 hours (sent or on its way). */
async function autoSentLast24hCents(organizationId, excludeId) {
  const agg = await WithdrawalRequest.aggregate([
    {
      $match: {
        organizationId: new mongoose.Types.ObjectId(String(organizationId)),
        payoutMethod: 'auto',
        status: { $in: ['processing', 'paid'] },
        createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        ...(excludeId ? { _id: { $ne: excludeId } } : {}),
      },
    },
    { $group: { _id: null, cents: { $sum: '$amountCents' } } },
  ]);
  return agg[0]?.cents || 0;
}

/** Why this withdrawal cannot go out automatically, or '' when it can. */
export async function payoutHoldReason(withdrawal, org, settings) {
  const s = settings || (await getPayoutSettings());
  if (!s.autoEnabled) return 'Automatic payouts are turned off';
  if (!paystackConfigured()) return 'Paystack is not set up on the server';
  const msisdn = String(org?.billing?.payoutMomoNumber || '').trim();
  if (!msisdn) return 'No payout MoMo number set';
  if (!momoProviderForMsisdn(msisdn)) return 'Payout number is not a Ghana MoMo number';
  if (s.maxAutoCents > 0 && withdrawal.amountCents > s.maxAutoCents) {
    return `Above the automatic limit of ${ghs(s.maxAutoCents)}`;
  }
  if (s.dailyAutoCents > 0) {
    const sent = await autoSentLast24hCents(org._id, withdrawal._id);
    if (sent + withdrawal.amountCents > s.dailyAutoCents) {
      return `Over the daily automatic limit of ${ghs(s.dailyAutoCents)} (${ghs(sent)} already sent today)`;
    }
  }
  const changedAt = org?.billing?.payoutMomoChangedAt ? new Date(org.billing.payoutMomoChangedAt) : null;
  if (s.newNumberHoldHours > 0 && changedAt && Date.now() - changedAt.getTime() < s.newNumberHoldHours * 3600_000) {
    return `Payout number changed ${changedAt.toISOString().slice(0, 16).replace('T', ' ')} UTC (automatic payouts wait ${s.newNumberHoldHours} h after a change)`;
  }
  if (s.firstNeedsApproval) {
    const paidBefore = await WithdrawalRequest.exists({ organizationId: org._id, status: 'paid' });
    if (!paidBefore) return 'First withdrawal for this organisation';
  }
  return '';
}

async function recipientFor(org) {
  const msisdn = String(org.billing?.payoutMomoNumber || '').trim();
  if (org.billing?.payoutRecipientCode && org.billing?.payoutRecipientFor === msisdn) {
    return { msisdn, recipientCode: org.billing.payoutRecipientCode };
  }
  const recipientCode = await createMomoRecipient({ name: org.name, msisdn });
  await Organization.updateOne(
    { _id: org._id },
    { $set: { 'billing.payoutRecipientCode': recipientCode, 'billing.payoutRecipientFor': msisdn } }
  );
  return { msisdn, recipientCode };
}

async function backToApproval(id, fromStatus, reason) {
  return WithdrawalRequest.findOneAndUpdate(
    { _id: id, status: fromStatus },
    { $set: { status: 'pending', holdReason: reason, failureReason: reason } },
    { new: true }
  );
}

async function completePaid(id) {
  const doc = await WithdrawalRequest.findOneAndUpdate(
    { _id: id, status: 'processing' },
    { $set: { status: 'paid', processedAt: new Date(), holdReason: '', failureReason: '' } },
    { new: true }
  );
  if (!doc) return null;
  await appendLedgerEntry({
    organizationId: doc.organizationId,
    type: 'withdrawal',
    amountCents: -doc.amountCents,
    withdrawalId: doc._id,
    note: `Paid to MoMo ${doc.payoutMsisdn}`,
  });
  return doc;
}

/**
 * Send a pending withdrawal to the organisation's payout MoMo number.
 * method 'auto' (within the limits) or 'manual' (a platform admin approved it).
 */
export async function sendWithdrawalToMomo(withdrawalId, { method = 'manual', adminId } = {}) {
  const doc = await WithdrawalRequest.findById(withdrawalId);
  if (!doc) throw err('Withdrawal not found', 404);
  if (!['pending', 'approved'].includes(doc.status)) {
    throw err(`This withdrawal is already ${doc.status}`);
  }
  if (!paystackConfigured()) throw err('Paystack is not set up on the server', 503);
  const org = await Organization.findById(doc.organizationId);
  if (!org) throw err('Organisation not found', 404);
  const msisdn = String(org.billing?.payoutMomoNumber || '').trim();
  if (!msisdn || !momoProviderForMsisdn(msisdn)) {
    throw err('This organisation has no Ghana MoMo payout number set');
  }

  /* Other withdrawals already on their way still hold their money. */
  const others = await WithdrawalRequest.aggregate([
    {
      $match: {
        organizationId: doc.organizationId,
        status: 'processing',
        _id: { $ne: doc._id },
      },
    },
    { $group: { _id: null, cents: { $sum: '$amountCents' } } },
  ]);
  const balance = await getOrgAvailableBalanceCents(doc.organizationId);
  if (doc.amountCents > balance - (others[0]?.cents || 0)) {
    throw err('The wallet balance is lower than this withdrawal');
  }

  const { recipientCode } = await recipientFor(org);
  const attempt = (doc.transferAttempts || 0) + 1;
  const reference = `wd_${doc._id}_${attempt}`;
  const claimed = await WithdrawalRequest.findOneAndUpdate(
    { _id: doc._id, status: doc.status, transferAttempts: doc.transferAttempts || 0 },
    {
      $set: {
        status: 'processing',
        payoutMethod: method,
        payoutMsisdn: msisdn,
        transferReference: reference,
        transferAttempts: attempt,
        holdReason: '',
        failureReason: '',
        ...(adminId ? { processedByAdminId: adminId } : {}),
      },
    },
    { new: true }
  );
  if (!claimed) throw err('This withdrawal changed meanwhile. Refresh and try again.', 409);

  let out;
  try {
    out = await initiateTransfer({
      reference,
      amountCents: claimed.amountCents,
      recipientCode,
      reason: `${org.name} withdrawal`,
    });
  } catch (e) {
    /* No answer: it may or may not have gone out. Stay processing; the check job asks Paystack. */
    console.error('[payout] transfer call failed', reference, e?.message || e);
    return { status: 'processing', withdrawal: claimed };
  }

  if (out.state === 'paid') {
    return { status: 'paid', withdrawal: (await completePaid(claimed._id)) || claimed };
  }
  if (out.state === 'failed') {
    const reason = `Paystack did not send it: ${out.message || 'transfer failed'}`;
    return { status: 'pending', withdrawal: (await backToApproval(claimed._id, 'processing', reason)) || claimed };
  }
  if (out.state === 'otp') {
    await WithdrawalRequest.updateOne(
      { _id: claimed._id },
      { $set: { failureReason: 'Paystack is waiting for an OTP. Approve it in Paystack, or turn off transfer OTP.' } }
    );
  }
  return { status: 'processing', withdrawal: claimed };
}

/** Right after a vendor asks: pay straight away when within the limits, otherwise record why it waits. */
export async function processNewWithdrawal(withdrawal) {
  const org = await Organization.findById(withdrawal.organizationId).lean();
  const reason = await payoutHoldReason(withdrawal, org);
  if (reason) {
    await WithdrawalRequest.updateOne({ _id: withdrawal._id }, { $set: { holdReason: reason } });
    return { status: 'pending', holdReason: reason };
  }
  try {
    const out = await sendWithdrawalToMomo(withdrawal._id, { method: 'auto' });
    return { status: out.status, holdReason: out.withdrawal?.holdReason || '' };
  } catch (e) {
    const why = `Automatic payout failed: ${e.message || 'unknown error'}`;
    await WithdrawalRequest.updateOne({ _id: withdrawal._id, status: 'pending' }, { $set: { holdReason: why } });
    return { status: 'pending', holdReason: why };
  }
}

/** Ask Paystack how a transfer ended and settle the withdrawal (webhook, check job, admin). */
export async function reconcileWithdrawalTransfer(reference) {
  const doc = await WithdrawalRequest.findOne({ transferReference: reference });
  if (!doc) return { ok: false, reason: 'unknown_reference' };
  if (!['processing', 'paid'].includes(doc.status)) return { ok: true, status: doc.status };

  const v = await verifyTransfer(reference);
  if (v.state === 'paid') {
    if (doc.status === 'processing') await completePaid(doc._id);
    return { ok: true, status: 'paid' };
  }
  if (v.state === 'failed') {
    const reason = `Paystack ${v.rawStatus === 'reversed' ? 'reversed' : 'failed'} the transfer${v.message ? `: ${v.message}` : ''}`;
    if (doc.status === 'processing') {
      await backToApproval(doc._id, 'processing', reason);
      return { ok: true, status: 'pending' };
    }
    /* Reversed after it was paid: put the money back in the wallet. */
    const back = await backToApproval(doc._id, 'paid', reason);
    if (back) {
      await appendLedgerEntry({
        organizationId: back.organizationId,
        type: 'withdrawal_reversal',
        amountCents: back.amountCents,
        withdrawalId: back._id,
        note: 'Payout reversed by Paystack',
      });
    }
    return { ok: true, status: 'pending' };
  }
  if (
    v.state === 'unknown' &&
    doc.status === 'processing' &&
    Date.now() - new Date(doc.updatedAt).getTime() > UNKNOWN_TRANSFER_GIVE_UP_MS
  ) {
    await backToApproval(doc._id, 'processing', 'Paystack has no record of this transfer');
    return { ok: true, status: 'pending' };
  }
  return { ok: true, status: doc.status };
}

/** Check job: payouts still on their way after a couple of minutes. */
export async function reconcileProcessingWithdrawals({ olderThanMs = 2 * 60 * 1000, limit = 50 } = {}) {
  if (!paystackConfigured()) return { checked: 0 };
  const rows = await WithdrawalRequest.find({
    status: 'processing',
    transferReference: { $ne: '' },
    updatedAt: { $lte: new Date(Date.now() - olderThanMs) },
  })
    .select('transferReference')
    .limit(limit)
    .lean();
  const summary = { checked: rows.length, paid: 0, pending: 0, processing: 0, errors: 0 };
  for (const r of rows) {
    try {
      const out = await reconcileWithdrawalTransfer(r.transferReference);
      if (summary[out.status] != null) summary[out.status] += 1;
    } catch (e) {
      summary.errors += 1;
      console.error('[payout] reconcile failed', r.transferReference, e?.message || e);
    }
  }
  return summary;
}

export { RESERVED_WITHDRAWAL_STATUSES };
