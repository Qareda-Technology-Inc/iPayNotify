import mongoose from 'mongoose';
import {
  Organization,
  Router,
  PlanPackage,
  HotspotVoucher,
  Transaction,
  User,
  PppoeAccount,
  RemoteAccessSubscription,
  Admin,
  WithdrawalRequest,
} from '../models/index.js';

function orgMatch(organizationId) {
  if (
    organizationId == null ||
    !String(organizationId).trim() ||
    !mongoose.isValidObjectId(String(organizationId).trim())
  ) {
    return {};
  }
  return { organizationId: new mongoose.Types.ObjectId(String(organizationId).trim()) };
}

function sumPaidCentsSince(since, organizationId) {
  return Transaction.aggregate([
    { $match: { status: 'paid', createdAt: { $gte: since }, ...orgMatch(organizationId) } },
    { $group: { _id: null, total: { $sum: '$amountCents' } } },
  ]).then((r) => (r[0]?.total ?? 0));
}

async function getPlatformOverview() {
  const [orgCount, statusRows, walletAgg, pendingWithdrawals, pendingInvites] = await Promise.all([
    Organization.countDocuments({}),
    Organization.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
    Organization.aggregate([
      { $group: { _id: null, total: { $sum: { $ifNull: ['$walletBalanceCents', 0] } } } },
    ]),
    WithdrawalRequest.countDocuments({ status: 'pending' }),
    Admin.countDocuments({
      status: 'invited',
      role: { $in: ['org_admin', 'org_staff', 'ticket_manager'] },
    }),
  ]);

  const organizationsByStatus = {
    active: 0,
    trial: 0,
    past_due: 0,
    suspended: 0,
  };
  for (const row of statusRows) {
    const key = String(row._id || '');
    if (key in organizationsByStatus) organizationsByStatus[key] = Number(row.n) || 0;
  }

  return {
    organizations: orgCount,
    organizationsByStatus,
    totalWalletBalanceCents: Number(walletAgg[0]?.total) || 0,
    pendingWithdrawals,
    pendingInvites,
  };
}

export async function getDashboardSummary(organizationId) {
  const om = orgMatch(organizationId);
  const scoped =
    organizationId != null &&
    String(organizationId).trim() &&
    mongoose.isValidObjectId(String(organizationId).trim());

  let organization = null;
  if (scoped) {
    organization = await Organization.findById(String(organizationId).trim())
      .select('name slug status walletBalanceCents')
      .lean();
  }
  const now = new Date();
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const weekStart = new Date(now);
  weekStart.setUTCDate(weekStart.getUTCDate() - 7);
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  const [
    routers,
    packages,
    vouchers,
    customers,
    pppoeAccounts,
    remoteAccessSubscriptions,
    paymentsPending,
    revenueTodayCents,
    revenueWeekCents,
    revenueMonthCents,
    platform,
  ] = await Promise.all([
    Router.countDocuments(om),
    PlanPackage.countDocuments(om),
    HotspotVoucher.countDocuments(om),
    User.countDocuments(om),
    PppoeAccount.countDocuments(om),
    RemoteAccessSubscription.countDocuments(om),
    Transaction.countDocuments({ status: 'pending', ...om }),
    sumPaidCentsSince(dayStart, organizationId),
    sumPaidCentsSince(weekStart, organizationId),
    sumPaidCentsSince(monthStart, organizationId),
    scoped ? Promise.resolve(null) : getPlatformOverview(),
  ]);

  return {
    organization: organization
      ? {
          ...organization,
          walletBalanceCents: Number(organization.walletBalanceCents) || 0,
        }
      : null,
    platformScope: !scoped,
    platform,
    counts: {
      routers,
      packages,
      vouchers,
      customers,
      pppoeAccounts,
      remoteAccessSubscriptions,
      paymentsPending,
    },
    revenueCents: {
      today: revenueTodayCents,
      week: revenueWeekCents,
      month: revenueMonthCents,
    },
    walletBalanceCents: Number(organization?.walletBalanceCents) || 0,
    currency: 'GHS',
  };
}
