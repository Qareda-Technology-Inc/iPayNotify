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

export async function getDashboardSummary(organizationId) {
  const om = orgMatch(organizationId);
  let organization = null;
  if (
    organizationId != null &&
    String(organizationId).trim() &&
    mongoose.isValidObjectId(String(organizationId).trim())
  ) {
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
  ]);

  return {
    organization: organization
      ? {
          ...organization,
          walletBalanceCents: Number(organization.walletBalanceCents) || 0,
        }
      : null,
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
