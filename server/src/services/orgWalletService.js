import mongoose from 'mongoose';
import { Organization, OrgLedgerEntry, WithdrawalRequest, Transaction } from '../models/index.js';
import { resolvePlatformFeeBps } from './platformSettingsService.js';

export { resolvePlatformFeeBps } from './platformSettingsService.js';

export function computeFeeSplit(amountCents, feeBps) {
  const gross = Math.max(0, Math.round(Number(amountCents) || 0));
  const bps = Math.max(0, Math.min(10_000, Math.round(Number(feeBps) || 0)));
  const platformFeeCents = Math.min(gross, Math.round((gross * bps) / 10_000));
  const orgNetCents = Math.max(0, gross - platformFeeCents);
  return { feeBps: bps, platformFeeCents, orgNetCents };
}

export async function getOrgAvailableBalanceCents(organizationId) {
  const oid = String(organizationId || '').trim();
  if (!oid || !mongoose.isValidObjectId(oid)) return 0;
  const org = await Organization.findById(oid).select('walletBalanceCents').lean();
  return Number(org?.walletBalanceCents) || 0;
}

/**
 * Append a ledger row and update Organization.walletBalanceCents atomically.
 */
export async function appendLedgerEntry({
  organizationId,
  type,
  amountCents,
  transactionId,
  withdrawalId,
  note,
}) {
  const oid = String(organizationId || '').trim();
  if (!oid || !mongoose.isValidObjectId(oid)) {
    const e = new Error('Invalid organisation for wallet ledger');
    e.status = 400;
    throw e;
  }
  const delta = Math.round(Number(amountCents) || 0);
  if (!delta) {
    const e = new Error('Ledger amount cannot be zero');
    e.status = 400;
    throw e;
  }

  const org = await Organization.findByIdAndUpdate(
    oid,
    { $inc: { walletBalanceCents: delta } },
    { new: true }
  ).select('walletBalanceCents');
  if (!org) {
    const e = new Error('Organisation not found');
    e.status = 404;
    throw e;
  }

  try {
    const entry = await OrgLedgerEntry.create({
      organizationId: oid,
      type,
      amountCents: delta,
      balanceAfterCents: org.walletBalanceCents,
      ...(transactionId ? { transactionId } : {}),
      ...(withdrawalId ? { withdrawalId } : {}),
      note: note || '',
    });
    return entry;
  } catch (err) {
    await Organization.findByIdAndUpdate(oid, { $inc: { walletBalanceCents: -delta } });
    if (err?.code === 11000) return null;
    throw err;
  }
}

/**
 * Idempotent: credit org wallet with net of platform fee when a Hubtel sale is paid.
 * Fee is recorded on the Transaction; balance only increases by orgNetCents.
 */
export async function settlePaidTransactionToWallet(txDoc) {
  if (!txDoc || txDoc.status !== 'paid') {
    return { ok: false, reason: 'not_paid' };
  }
  const orgId = txDoc.organizationId ? String(txDoc.organizationId) : '';
  if (!orgId || !mongoose.isValidObjectId(orgId)) {
    return { ok: false, reason: 'no_organization' };
  }
  if (txDoc.meta?.walletSettled) {
    return { ok: true, duplicate: true };
  }

  const existing = await OrgLedgerEntry.findOne({
    organizationId: orgId,
    transactionId: txDoc._id,
    type: 'sale_credit',
  }).lean();
  if (existing) {
    const prev = txDoc.meta && typeof txDoc.meta === 'object' ? { ...txDoc.meta } : {};
    txDoc.meta = { ...prev, walletSettled: true };
    if (txDoc.orgNetCents == null) txDoc.orgNetCents = existing.amountCents;
    await txDoc.save();
    return { ok: true, duplicate: true };
  }

  const org = await Organization.findById(orgId).select('billing').lean();
  const feeBps = await resolvePlatformFeeBps(org?.billing);
  const { platformFeeCents, orgNetCents } = computeFeeSplit(txDoc.amountCents, feeBps);

  txDoc.feeBps = feeBps;
  txDoc.platformFeeCents = platformFeeCents;
  txDoc.orgNetCents = orgNetCents;

  if (orgNetCents > 0) {
    await appendLedgerEntry({
      organizationId: orgId,
      type: 'sale_credit',
      amountCents: orgNetCents,
      transactionId: txDoc._id,
      note: `Net sale after ${feeBps / 100}% platform fee`,
    });
  }

  const prev = txDoc.meta && typeof txDoc.meta === 'object' ? { ...txDoc.meta } : {};
  txDoc.meta = { ...prev, walletSettled: true, feeBps, platformFeeCents, orgNetCents };
  await txDoc.save();

  return { ok: true, feeBps, platformFeeCents, orgNetCents };
}

export async function getWalletSummary(organizationId) {
  const oid = String(organizationId || '').trim();
  const balanceCents = await getOrgAvailableBalanceCents(oid);
  const org = await Organization.findById(oid).select('billing name').lean();
  const feeBps = await resolvePlatformFeeBps(org?.billing);

  const [pendingWithdrawals, paidSalesAgg, ledger] = await Promise.all([
    WithdrawalRequest.aggregate([
      {
        $match: {
          organizationId: new mongoose.Types.ObjectId(oid),
          status: { $in: ['pending', 'approved'] },
        },
      },
      { $group: { _id: null, cents: { $sum: '$amountCents' }, count: { $sum: 1 } } },
    ]),
    Transaction.aggregate([
      {
        $match: {
          organizationId: new mongoose.Types.ObjectId(oid),
          status: 'paid',
        },
      },
      {
        $group: {
          _id: null,
          grossCents: { $sum: '$amountCents' },
          feeCents: { $sum: { $ifNull: ['$platformFeeCents', 0] } },
          netCents: { $sum: { $ifNull: ['$orgNetCents', 0] } },
          count: { $sum: 1 },
        },
      },
    ]),
    OrgLedgerEntry.find({ organizationId: oid }).sort({ createdAt: -1 }).limit(40).lean(),
  ]);

  const pending = pendingWithdrawals[0] || { cents: 0, count: 0 };
  const sales = paidSalesAgg[0] || { grossCents: 0, feeCents: 0, netCents: 0, count: 0 };

  return {
    organizationId: oid,
    organizationName: org?.name || '',
    balanceCents,
    feeBps,
    feePercent: feeBps / 100,
    payoutMomoNumber: String(org?.billing?.payoutMomoNumber || '').trim(),
    payoutNote: String(org?.billing?.payoutNote || '').trim(),
    pendingWithdrawals: {
      count: pending.count || 0,
      amountCents: pending.cents || 0,
    },
    sales: {
      paidCount: sales.count || 0,
      grossCents: sales.grossCents || 0,
      feeCents: sales.feeCents || 0,
      netCents: sales.netCents || 0,
    },
    ledger: ledger.map((e) => ({
      id: String(e._id),
      type: e.type,
      amountCents: e.amountCents,
      balanceAfterCents: e.balanceAfterCents,
      note: e.note || '',
      transactionId: e.transactionId ? String(e.transactionId) : null,
      withdrawalId: e.withdrawalId ? String(e.withdrawalId) : null,
      createdAt: e.createdAt,
    })),
  };
}

export async function requestWithdrawal({
  organizationId,
  amountCents,
  destinationNote,
  requestedByAdminId,
}) {
  const oid = String(organizationId || '').trim();
  const amount = Math.round(Number(amountCents) || 0);
  if (amount < 100) {
    const e = new Error('Minimum withdrawal is GHS 1.00');
    e.status = 400;
    throw e;
  }
  const balance = await getOrgAvailableBalanceCents(oid);
  const pendingAgg = await WithdrawalRequest.aggregate([
    {
      $match: {
        organizationId: new mongoose.Types.ObjectId(oid),
        status: { $in: ['pending', 'approved'] },
      },
    },
    { $group: { _id: null, cents: { $sum: '$amountCents' } } },
  ]);
  const pendingCents = pendingAgg[0]?.cents || 0;
  const available = balance - pendingCents;
  if (amount > available) {
    const e = new Error(
      `Insufficient available balance. Available: GHS ${(available / 100).toFixed(2)} (pending withdrawals reserved).`
    );
    e.status = 400;
    throw e;
  }

  return WithdrawalRequest.create({
    organizationId: oid,
    amountCents: amount,
    status: 'pending',
    destinationNote: String(destinationNote || '').trim(),
    requestedByAdminId: requestedByAdminId || undefined,
  });
}

export async function markWithdrawalPaid(withdrawalId, { processedByAdminId, processNote } = {}) {
  const doc = await WithdrawalRequest.findById(withdrawalId);
  if (!doc) {
    const e = new Error('Withdrawal not found');
    e.status = 404;
    throw e;
  }
  if (doc.status === 'paid') {
    return { ok: true, duplicate: true, withdrawal: doc };
  }
  if (!['pending', 'approved'].includes(doc.status)) {
    const e = new Error(`Cannot pay withdrawal in status ${doc.status}`);
    e.status = 400;
    throw e;
  }

  const balance = await getOrgAvailableBalanceCents(doc.organizationId);
  if (doc.amountCents > balance) {
    const e = new Error('Organisation balance is lower than this withdrawal');
    e.status = 400;
    throw e;
  }

  await appendLedgerEntry({
    organizationId: doc.organizationId,
    type: 'withdrawal',
    amountCents: -doc.amountCents,
    withdrawalId: doc._id,
    note: processNote || 'Payout',
  });

  doc.status = 'paid';
  doc.processedByAdminId = processedByAdminId || undefined;
  doc.processedAt = new Date();
  doc.processNote = String(processNote || '').trim();
  await doc.save();
  return { ok: true, withdrawal: doc };
}

export async function rejectWithdrawal(withdrawalId, { processedByAdminId, processNote } = {}) {
  const doc = await WithdrawalRequest.findById(withdrawalId);
  if (!doc) {
    const e = new Error('Withdrawal not found');
    e.status = 404;
    throw e;
  }
  if (doc.status === 'paid') {
    const e = new Error('Already paid');
    e.status = 400;
    throw e;
  }
  if (doc.status === 'rejected' || doc.status === 'cancelled') {
    return { ok: true, duplicate: true, withdrawal: doc };
  }
  doc.status = 'rejected';
  doc.processedByAdminId = processedByAdminId || undefined;
  doc.processedAt = new Date();
  doc.processNote = String(processNote || '').trim();
  await doc.save();
  return { ok: true, withdrawal: doc };
}
