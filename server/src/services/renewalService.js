import mongoose from 'mongoose';
import { PppoeAccount, User, PlanPackage, Transaction, BillingJobRun } from '../models/index.js';
import { resolveDefaultOrganizationId } from '../db/defaultOrganizationId.js';
import { chargeForRenewal } from '../integrations/hubtel.js';
import { syncPppoeAccountToRouter } from './pppoeService.js';
import { notifyTransactionPaidSms } from './paymentSmsService.js';
import { formatExpiryComment } from '../utils/expiryComment.js';
import { purgeExpiredHotspotOnRouter } from './hotspotService.js';
import { extendPaidUntilByPackage } from '../utils/duration.js';

/**
 * Every past-due PPPoE line: re-sync to MikroTik (expired profile, secret stays enabled for captive/renewal flow).
 * Runs on `PPPOE_EXPIRY_CRON` (see `config.pppoeExpiryCron`). Not run on GET /api/pppoe
 * (that would block the list on one MikroTik round-trip per expired account).
 * @param {string|undefined} [organizationId] When set, only accounts in this organisation (faster dashboard loads).
 */
export async function enforceExpiredPppoeAccounts(organizationId) {
  const now = new Date();
  const q = {
    paidUntil: { $lt: now },
    organizationId: { $exists: true, $ne: null },
  };
  if (
    organizationId != null &&
    String(organizationId).trim() &&
    mongoose.isValidObjectId(String(organizationId).trim())
  ) {
    q.organizationId = String(organizationId).trim();
  }
  const accounts = await PppoeAccount.find(q);

  const summary = {
    checked: accounts.length,
    synced: 0,
    syncFailed: 0,
  };

  for (const acc of accounts) {
    try {
      await syncPppoeAccountToRouter(acc);
      summary.synced++;
    } catch (e) {
      summary.syncFailed++;
      console.error(
        `[pppoe] expired sync failed secret=${acc.secretName}:`,
        e?.message || e
      );
    }
  }

  return summary;
}

/**
 * For accounts still in paid period but marked disabled (e.g. after payment fix), re-enable on router.
 * Optional: re-sync all accounts expiring in next 24h to refresh comments.
 */
export async function refreshPppoeSyncNearExpiry() {
  const soon = new Date(Date.now() + 86400000);
  const accounts = await PppoeAccount.find({
    paidUntil: { $gte: new Date(), $lte: soon },
    organizationId: { $exists: true, $ne: null },
  });
  for (const acc of accounts) {
    await syncPppoeAccountToRouter(acc);
  }
  return { refreshed: accounts.length };
}

/**
 * Auto-renew: users with autoRenewalEnabled, active paid window ending within `withinMs`,
 * deduct in-app balance when sufficient (MTN MoMo request-to-pay is not used for auto-renewal); on success extend paidUntil and re-enable secret.
 */
export async function attemptAutoRenewals({ withinMs = 86400000, organizationId } = {}) {
  const now = new Date();
  const horizon = new Date(now.getTime() + withinMs);
  const accQ = {
    paidUntil: { $lte: horizon, $gte: new Date() },
    organizationId: { $exists: true, $ne: null },
  };
  if (
    organizationId != null &&
    String(organizationId).trim() &&
    mongoose.isValidObjectId(String(organizationId).trim())
  ) {
    accQ.organizationId = String(organizationId).trim();
  }
  const accounts = await PppoeAccount.find(accQ)
    .populate('userId')
    .populate('packageId');

  const summary = { attempted: 0, renewed: 0, skipped: 0, failed: 0 };

  for (const acc of accounts) {
    const user = acc.userId;
    if (!user?.autoRenewalEnabled) {
      summary.skipped++;
      continue;
    }

    const pkg =
      acc.packageId && typeof acc.packageId === 'object' && acc.packageId.priceCents != null
        ? acc.packageId
        : acc.packageId
          ? await PlanPackage.findById(acc.packageId)
          : null;
    const amount = pkg?.priceCents ?? 0;
    if (amount <= 0) {
      summary.skipped++;
      continue;
    }

    summary.attempted++;

    const txOrgId =
      acc.organizationId ||
      user.organizationId ||
      pkg?.organizationId ||
      (await resolveDefaultOrganizationId());

    let paid = false;
    let providerReference;

    if (user.balanceCents >= amount) {
      user.balanceCents -= amount;
      await user.save();
      paid = true;
      providerReference = 'balance';
    } else {
      const charge = await chargeForRenewal({
        user,
        amountCents: amount,
        currency: pkg?.currency ?? 'GHS',
      });
      paid = charge.success;
      providerReference = charge.providerReference;
    }

    if (!paid) {
      summary.failed++;
      await Transaction.create({
        ...(txOrgId ? { organizationId: txOrgId } : {}),
        userId: user._id,
        packageId: pkg?._id,
        pppoeAccountId: acc._id,
        amountCents: amount,
        currency: pkg?.currency ?? 'GHS',
        status: 'failed',
        kind: 'renewal',
        providerReference,
        meta: { step: 'auto_renewal' },
      });
      continue;
    }

    const base = acc.paidUntil > now ? acc.paidUntil : now;
    acc.paidUntil = extendPaidUntilByPackage(base, pkg);
    acc.disabled = false;
    await acc.save();

    const tx = await Transaction.create({
      ...(txOrgId ? { organizationId: txOrgId } : {}),
      userId: user._id,
      packageId: pkg?._id,
      pppoeAccountId: acc._id,
      amountCents: amount,
      currency: pkg?.currency ?? 'GHS',
      status: 'paid',
      kind: 'renewal',
      providerReference,
      customerPhone: user.phone?.trim() || undefined,
      customerName: user.fullName || undefined,
      meta: {
        newPaidUntil: acc.paidUntil.toISOString(),
        comment: formatExpiryComment(acc.paidUntil),
      },
    });

    await syncPppoeAccountToRouter(acc);
    const pkgObj =
      pkg && typeof pkg.toObject === 'function' ? pkg.toObject() : pkg;
    await notifyTransactionPaidSms(tx, {
      kind: 'renewal',
      renewalType: 'pppoe',
      paidUntil: acc.paidUntil,
      secretName: acc.secretName,
      routerId: acc.routerId,
      packageDoc: pkgObj,
      packageName: pkg?.name,
    });
    await tx.save();
    summary.renewed++;
  }

  return summary;
}

/** Full nightly job: hotspot cleanup, PPPoE expiry, renewals, comment refresh. */
export async function runMidnightBillingJob() {
  const jobOrgId = await resolveDefaultOrganizationId();
  const run = await BillingJobRun.create({
    jobName: 'midnight_billing',
    summary: {},
    ...(jobOrgId ? { organizationId: jobOrgId } : {}),
  });
  const summary = {};

  try {
    summary.autoRenew = await attemptAutoRenewals({ withinMs: 86400000 });
    summary.pppoeExpired = await enforceExpiredPppoeAccounts();
    summary.hotspotPurge = await purgeExpiredHotspotOnRouter();
    summary.syncNearExpiry = await refreshPppoeSyncNearExpiry();
  } catch (e) {
    summary.fatalError = e.message;
  } finally {
    run.finishedAt = new Date();
    run.summary = summary;
    await run.save();
  }

  return summary;
}
