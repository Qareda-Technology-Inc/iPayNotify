import crypto from 'crypto';
import mongoose from 'mongoose';
import { PppoeAccount, PlanPackage, User, Transaction } from '../models/index.js';
import { withRouterMikrotik } from '../mikrotik/routeros.js';
import * as ppp from '../mikrotik/pppoeCommands.js';
import { formatExpiryComment } from '../utils/expiryComment.js';
import {
  addPaidDuration,
  extendPaidUntilByPackage,
  getPackageDuration,
  normalizeDurationUnit,
} from '../utils/duration.js';
import { resolveRouter } from './routerResolver.js';
import { organizationIdForRouter } from '../db/defaultOrganizationId.js';
import { notifyTransactionPaidSms } from './paymentSmsService.js';

function randomSecret(len = 12) {
  return crypto.randomBytes(len).toString('base64url').slice(0, len);
}

function secretRowDisabled(row) {
  return (
    row?.disabled === true ||
    row?.disabled === 'true' ||
    row?.disabled === 'yes'
  );
}

function desiredRouterState(account) {
  const now = new Date();
  const expired = account.paidUntil < now;
  const comment = formatExpiryComment(account.paidUntil);
  const profile =
    account.disabled || expired ? account.expiredProfile : account.activeProfile;
  /** Expired users stay enabled on the router so the expired profile (e.g. nonpayment) can show renewal info. */
  const disabled = account.disabled && !expired;
  return { comment, profile, disabled };
}

export async function syncPppoeAccountToRouter(account) {
  const router = await resolveRouter(account.routerId);
  const { comment, profile, disabled } = desiredRouterState(account);

  await withRouterMikrotik(router, async (api) => {
    const existing = await ppp.findPppSecretByName(api, account.secretName);
    if (existing) {
      const rowId = existing['.id'] ?? existing.numbers;
      const prevProfile = String(existing.profile ?? '').trim();
      const nextProfile = String(profile ?? '').trim();
      const prevDisabled = secretRowDisabled(existing);
      const needsSessionReset =
        prevProfile !== nextProfile || prevDisabled !== disabled;

      await ppp.setPppSecret(
        api,
        rowId,
        {
          password: account.secretPassword,
          profile,
          comment,
          disabled,
        },
        account.secretName
      );
      if (needsSessionReset) {
        await ppp.disconnectPppSessionsBySecretName(api, account.secretName, {
          service: account.service || 'pppoe',
        });
      }
      account.mikrotikInternalId =
        rowId != null && String(rowId).trim() !== ''
          ? String(rowId)
          : account.mikrotikInternalId;
    } else {
      try {
        await ppp.addPppSecret(api, {
          name: account.secretName,
          password: account.secretPassword,
          service: account.service || 'pppoe',
          profile,
          comment,
          disabled,
        });
      } catch (e) {
        const msg = String(e?.message ?? e);
        if (!/already exists|duplicate/i.test(msg)) throw e;
        /* find missed the row (e.g. SSH print parsing); update instead of add */
      }
      const created = await ppp.findPppSecretByName(api, account.secretName);
      if (!created) {
        const err = new Error(
          `PPPoE sync: secret "${account.secretName}" not found on router after add. Check /ppp secret print (SSH/API).`
        );
        err.status = 502;
        throw err;
      }
      const rowId = created['.id'] ?? created.numbers;
      const prevProfile = String(created.profile ?? '').trim();
      const nextProfile = String(profile ?? '').trim();
      const prevDisabled = secretRowDisabled(created);
      const needsSessionReset =
        prevProfile !== nextProfile || prevDisabled !== disabled;
      await ppp.setPppSecret(
        api,
        rowId,
        {
          password: account.secretPassword,
          profile,
          comment,
          disabled,
        },
        account.secretName
      );
      if (needsSessionReset) {
        await ppp.disconnectPppSessionsBySecretName(api, account.secretName, {
          service: account.service || 'pppoe',
        });
      }
      account.mikrotikInternalId =
        rowId != null && String(rowId).trim() !== ''
          ? String(rowId)
          : account.mikrotikInternalId;
    }
    account.lastSyncedAt = new Date();
    await account.save();
  });

  if (process.env.PPPOE_SYNC_LOG === '1') {
    const r =
      router && typeof router.toObject === 'function'
        ? router.toObject({ getters: false, virtuals: false })
        : router;
    const host = String(r?.host ?? '').trim() || String(r?._id ?? '');
    console.log('[pppoe] synced', account.secretName, `profile=${profile}`, '→', host);
  }

  return account;
}

export async function removePppoeFromRouter(account) {
  const router = await resolveRouter(account.routerId);
  await withRouterMikrotik(router, async (api) => {
    let id = account.mikrotikInternalId;
    if (!id) {
      const row = await ppp.findPppSecretByName(api, account.secretName);
      id = row?.['.id'] ?? row?.numbers;
    }
    const canRemoveByName = typeof api?.execCli === 'function';
    if (id || canRemoveByName) {
      await ppp.removePppSecret(api, id, account.secretName);
    }
  });
  account.mikrotikInternalId = undefined;
  await account.save();
}

export async function listPppoeAccounts(filter = {}) {
  return PppoeAccount.find({ ...filter })
    .populate('userId', 'email phone fullName')
    .populate('packageId', 'name kind')
    .sort({ updatedAt: -1 })
    .lean();
}

export async function getPppoeAccount(id, { organizationId } = {}) {
  const q = { _id: id };
  if (
    organizationId != null &&
    String(organizationId).trim() &&
    mongoose.isValidObjectId(String(organizationId).trim())
  ) {
    q.organizationId = String(organizationId).trim();
  }
  return PppoeAccount.findOne(q)
    .populate('userId')
    .populate('packageId')
    .populate('routerId');
}

export async function createPppoeAccount({
  userId,
  packageId,
  routerId,
  secretName,
  secretPassword,
  paidUntil,
  validityAmount,
  validityUnit,
  activeProfile: activeProfileOverride,
  expiredProfile: expiredProfileOverride,
  syncRouter = true,
  organizationId,
}) {
  const orgOpts = { organizationId };
  const pkg = packageId
    ? await PlanPackage.findOne({
        _id: packageId,
        ...(organizationId && mongoose.isValidObjectId(organizationId)
          ? { organizationId }
          : {}),
      })
    : null;
  if (packageId && !pkg) {
    const e = new Error('Package not found');
    e.status = 404;
    throw e;
  }
  const router = await resolveRouter(routerId, orgOpts);

  const activeProfile =
    activeProfileOverride ||
    pkg?.activeProfile ||
    router.defaultPppProfile;
  const expiredProfile =
    expiredProfileOverride ||
    pkg?.expiredProfile ||
    router.expiredPppProfile;

  const now = new Date();
  let until;
  if (paidUntil != null && String(paidUntil).trim() !== '') {
    until = new Date(paidUntil);
  } else if (
    validityAmount != null &&
    String(validityAmount).trim() !== '' &&
    validityUnit
  ) {
    until = addPaidDuration(now, Number(validityAmount), normalizeDurationUnit(validityUnit));
  } else if (pkg) {
    const { amount, unit } = getPackageDuration(pkg);
    until = addPaidDuration(now, amount, unit);
  } else {
    until = addPaidDuration(now, 30, 'day');
  }

  if (Number.isNaN(until.getTime())) {
    const e = new Error('Invalid paid-until date');
    e.status = 400;
    throw e;
  }

  const doc = await PppoeAccount.create({
    organizationId: await organizationIdForRouter(router),
    ...(userId ? { userId } : {}),
    packageId: pkg?._id,
    routerId: router._id,
    secretName,
    secretPassword: secretPassword || randomSecret(14),
    service: 'pppoe',
    activeProfile,
    expiredProfile,
    paidUntil: until,
    disabled: false,
  });

  if (syncRouter) await syncPppoeAccountToRouter(doc);
  return doc;
}

export async function updatePppoeAccount(id, patch, { syncRouter = true, organizationId } = {}) {
  const accQ = { _id: id };
  if (
    organizationId != null &&
    String(organizationId).trim() &&
    mongoose.isValidObjectId(String(organizationId).trim())
  ) {
    accQ.organizationId = String(organizationId).trim();
  }
  const allowed = [
    'secretPassword',
    'activeProfile',
    'expiredProfile',
    'paidUntil',
    'disabled',
    'packageId',
    'userId',
  ];
  const account = await PppoeAccount.findOne(accQ);
  if (!account) return null;
  for (const k of allowed) {
    if (patch[k] === undefined) continue;
    if (k === 'paidUntil') {
      account[k] = new Date(patch[k]);
    } else if (k === 'userId') {
      const v = patch[k];
      if (v === '' || v === null) {
        account.userId = null;
      } else if (mongoose.isValidObjectId(v)) {
        account.userId = v;
      } else {
        const e = new Error('Invalid userId');
        e.status = 400;
        throw e;
      }
    } else if (k === 'packageId') {
      const v = patch[k];
      account.packageId =
        v === '' || v === null || v === undefined ? null : v;
    } else {
      account[k] = patch[k];
    }
  }
  await account.save();
  if (syncRouter) await syncPppoeAccountToRouter(account);
  return account;
}

/**
 * Extend `paidUntil` by one billing period from the linked (or chosen) PPPoE package, re-enable, sync MikroTik.
 * @param {string} id Account _id
 * @param {{ organizationId?: string, packageId?: string, chargeBalance?: boolean, adminEmail?: string }} opts
 */
export async function adminRenewPppoeAccount(id, opts = {}) {
  const {
    organizationId,
    packageId: pkgOverride,
    chargeBalance = false,
    adminEmail = '',
  } = opts;
  const accQ = { _id: id };
  if (
    organizationId != null &&
    String(organizationId).trim() &&
    mongoose.isValidObjectId(String(organizationId).trim())
  ) {
    accQ.organizationId = String(organizationId).trim();
  }
  const account = await PppoeAccount.findOne(accQ);
  if (!account) {
    const e = new Error('PPPoE account not found');
    e.status = 404;
    throw e;
  }

  const pkgIdRaw =
    pkgOverride && mongoose.isValidObjectId(String(pkgOverride).trim())
      ? String(pkgOverride).trim()
      : account.packageId
        ? String(account.packageId)
        : null;
  if (!pkgIdRaw) {
    const e = new Error('Link a PPPoE package on this line (or choose one) to renew.');
    e.status = 400;
    throw e;
  }

  const pkgQ = { _id: pkgIdRaw, kind: 'pppoe' };
  if (account.organizationId) {
    pkgQ.organizationId = account.organizationId;
  }
  const pkg = await PlanPackage.findOne(pkgQ);
  if (!pkg) {
    const e = new Error('Package not found for this organisation or not a PPPoE package.');
    e.status = 400;
    throw e;
  }

  const price = Math.max(0, Number(pkg.priceCents) || 0);
  let chargedUser = null;
  let chargedAmount = 0;
  if (chargeBalance) {
    if (!account.userId) {
      const e = new Error('Cannot charge wallet: no billing customer linked to this PPPoE line.');
      e.status = 400;
      throw e;
    }
    if (price <= 0) {
      const e = new Error('Cannot charge wallet: package price is zero.');
      e.status = 400;
      throw e;
    }
    const user = await User.findOne({ _id: account.userId, organizationId: account.organizationId });
    if (!user) {
      const e = new Error('Billing customer not found.');
      e.status = 400;
      throw e;
    }
    const bal = Number(user.balanceCents) || 0;
    if (bal < price) {
      const e = new Error(
        `Insufficient wallet balance (need ${(price / 100).toFixed(2)} ${pkg.currency || 'GHS'}, have ${(bal / 100).toFixed(2)}).`
      );
      e.status = 400;
      throw e;
    }
    user.balanceCents = bal - price;
    await user.save();
    chargedUser = user;
    chargedAmount = price;
  }

  const now = new Date();
  const base = account.paidUntil > now ? account.paidUntil : now;
  account.paidUntil = extendPaidUntilByPackage(base, pkg);
  account.disabled = false;
  if (String(pkg._id) !== String(account.packageId || '')) {
    account.packageId = pkg._id;
  }

  try {
    await syncPppoeAccountToRouter(account);
  } catch (syncErr) {
    if (chargedUser && chargedAmount > 0) {
      chargedUser.balanceCents = (Number(chargedUser.balanceCents) || 0) + chargedAmount;
      await chargedUser.save();
    }
    throw syncErr;
  }

  let customerPhone;
  let customerName;
  if (chargedUser) {
    customerPhone = chargedUser.phone?.trim() || undefined;
    customerName = chargedUser.fullName || undefined;
  } else if (account.userId) {
    const u = await User.findById(account.userId).select('phone fullName').lean();
    if (u) {
      customerPhone = u.phone?.trim() || undefined;
      customerName = u.fullName || undefined;
    }
  }

  const orgId = account.organizationId ? String(account.organizationId) : undefined;
  const tx = await Transaction.create({
    ...(orgId ? { organizationId: orgId } : {}),
    ...(account.userId ? { userId: account.userId } : {}),
    packageId: pkg._id,
    pppoeAccountId: account._id,
    amountCents: chargeBalance ? price : 0,
    currency: pkg.currency || 'GHS',
    status: 'paid',
    kind: 'renewal',
    provider: 'admin_dashboard',
    providerReference: chargeBalance ? 'admin_renew_balance' : 'admin_renew_waive',
    customerPhone,
    customerName,
    meta: {
      adminRenewal: true,
      adminEmail: String(adminEmail || '').trim(),
      chargeMode: chargeBalance ? 'balance' : 'waive',
      newPaidUntil: account.paidUntil.toISOString(),
      packagePriceCents: price,
    },
  });

  await notifyTransactionPaidSms(tx, {
    kind: 'renewal',
    renewalType: 'pppoe',
    paidUntil: account.paidUntil,
    secretName: account.secretName,
    routerId: account.routerId,
    packageDoc: typeof pkg.toObject === 'function' ? pkg.toObject() : pkg,
    packageName: pkg.name,
  });
  await tx.save();

  return getPppoeAccount(account._id, { organizationId });
}

export async function deletePppoeAccount(id, { organizationId } = {}) {
  const accQ = { _id: id };
  if (
    organizationId != null &&
    String(organizationId).trim() &&
    mongoose.isValidObjectId(String(organizationId).trim())
  ) {
    accQ.organizationId = String(organizationId).trim();
  }
  const account = await PppoeAccount.findOne(accQ);
  if (!account) return false;
  await removePppoeFromRouter(account);
  await account.deleteOne();
  return true;
}
