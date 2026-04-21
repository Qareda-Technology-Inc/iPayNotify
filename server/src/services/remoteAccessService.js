import mongoose from 'mongoose';
import { RemoteAccessSubscription, PlanPackage, User, Transaction } from '../models/index.js';
import { resolveDefaultOrganizationId } from '../db/defaultOrganizationId.js';
import {
  addPaidDuration,
  extendPaidUntilByPackage,
  getPackageDuration,
  normalizeDurationUnit,
} from '../utils/duration.js';
import { notifyTransactionPaidSms } from './paymentSmsService.js';

function orgClause(organizationId) {
  if (
    organizationId == null ||
    !String(organizationId).trim() ||
    !mongoose.isValidObjectId(String(organizationId).trim())
  ) {
    return {};
  }
  return { organizationId: String(organizationId).trim() };
}

export async function listRemoteAccessSubscriptions(filter = {}, organizationId) {
  return RemoteAccessSubscription.find({ ...filter, ...orgClause(organizationId) })
    .populate('userId', 'email phone fullName')
    .populate('packageId', 'name kind')
    .sort({ updatedAt: -1 })
    .lean();
}

export async function getRemoteAccessSubscription(id, { organizationId } = {}) {
  return RemoteAccessSubscription.findOne({ _id: id, ...orgClause(organizationId) })
    .populate('userId')
    .populate('packageId')
    .lean();
}

export async function createRemoteAccessSubscription({
  userId,
  displayName,
  phone,
  email,
  packageId,
  paidUntil,
  validityAmount,
  validityUnit,
  notes,
  organizationId: tenantOrganizationId,
}) {
  const p = String(phone ?? '').trim();
  if (!p) {
    const e = new Error('Phone number is required for SMS notifications.');
    e.status = 400;
    throw e;
  }

  if (!userId && (!displayName || !String(displayName).trim())) {
    const e = new Error('Provide a display name or link a billing customer.');
    e.status = 400;
    throw e;
  }

  let linkedUser = null;
  if (userId) {
    linkedUser = await User.findOne({ _id: userId, ...orgClause(organizationId) });
    if (!linkedUser) {
      const e = new Error('Customer not found.');
      e.status = 400;
      throw e;
    }
  }

  let pkg = null;
  if (packageId) {
    pkg = await PlanPackage.findOne({ _id: packageId, ...orgClause(organizationId) });
    if (!pkg) {
      const e = new Error('Package not found.');
      e.status = 400;
      throw e;
    }
    if (pkg.kind !== 'remote_access') {
      const e = new Error('Package must be kind "remote_access" for this subscription.');
      e.status = 400;
      throw e;
    }
  }

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
    const e = new Error('Invalid paid-until date.');
    e.status = 400;
    throw e;
  }

  let organizationId =
    tenantOrganizationId != null &&
    String(tenantOrganizationId).trim() &&
    mongoose.isValidObjectId(String(tenantOrganizationId).trim())
      ? String(tenantOrganizationId).trim()
      : linkedUser?.organizationId || pkg?.organizationId;
  if (!organizationId) {
    organizationId = await resolveDefaultOrganizationId();
  }

  return RemoteAccessSubscription.create({
    organizationId,
    ...(userId ? { userId } : {}),
    displayName: displayName ? String(displayName).trim() : undefined,
    phone: p,
    email: email != null && String(email).trim() !== '' ? String(email).trim() : undefined,
    ...(pkg ? { packageId: pkg._id } : {}),
    paidUntil: until,
    notes: notes != null && String(notes).trim() !== '' ? String(notes).trim() : undefined,
    disabled: false,
  });
}

const PATCHABLE = new Set([
  'displayName',
  'phone',
  'email',
  'paidUntil',
  'disabled',
  'packageId',
  'notes',
  'userId',
]);

export async function updateRemoteAccessSubscription(id, patch, { organizationId } = {}) {
  const doc = await RemoteAccessSubscription.findOne({ _id: id, ...orgClause(organizationId) });
  if (!doc) return null;

  for (const k of PATCHABLE) {
    if (patch[k] === undefined) continue;
    if (k === 'paidUntil') {
      doc[k] = new Date(patch[k]);
    } else if (k === 'packageId') {
      if (!patch[k]) {
        doc.packageId = undefined;
      } else {
        const pkg = await PlanPackage.findOne({
          _id: patch[k],
          ...orgClause(organizationId),
        });
        if (!pkg || pkg.kind !== 'remote_access') {
          const e = new Error('Package must be kind remote_access.');
          e.status = 400;
          throw e;
        }
        doc.packageId = pkg._id;
      }
    } else if (k === 'userId') {
      doc.userId = patch[k] || undefined;
    } else if (k === 'phone') {
      const p = String(patch[k] ?? '').trim();
      if (!p) {
        const e = new Error('Phone cannot be empty.');
        e.status = 400;
        throw e;
      }
      doc.phone = p;
    } else {
      doc[k] = patch[k];
    }
  }

  await doc.save();
  return RemoteAccessSubscription.findOne({ _id: id, ...orgClause(organizationId) })
    .populate('userId', 'email phone fullName')
    .populate('packageId', 'name kind')
    .lean();
}

export async function deleteRemoteAccessSubscription(id, { organizationId } = {}) {
  const r = await RemoteAccessSubscription.findOneAndDelete({
    _id: id,
    ...orgClause(organizationId),
  });
  return Boolean(r);
}

/**
 * Extend paid period by one package cycle (same rules as PPPoE admin renew). No MikroTik sync.
 * @param {string} id Subscription _id
 * @param {{ organizationId?: string, packageId?: string, chargeBalance?: boolean, adminEmail?: string }} opts
 */
export async function adminRenewRemoteAccessSubscription(id, opts = {}) {
  const {
    organizationId,
    packageId: pkgOverride,
    chargeBalance = false,
    adminEmail = '',
  } = opts;
  const doc = await RemoteAccessSubscription.findOne({ _id: id, ...orgClause(organizationId) });
  if (!doc) {
    const e = new Error('Subscription not found');
    e.status = 404;
    throw e;
  }

  const pkgIdRaw =
    pkgOverride && mongoose.isValidObjectId(String(pkgOverride).trim())
      ? String(pkgOverride).trim()
      : doc.packageId
        ? String(doc.packageId)
        : null;
  if (!pkgIdRaw) {
    const e = new Error('Link a remote access package (or choose one) to renew.');
    e.status = 400;
    throw e;
  }

  const pkgQ = { _id: pkgIdRaw, kind: 'remote_access' };
  if (doc.organizationId) {
    pkgQ.organizationId = doc.organizationId;
  }
  const pkg = await PlanPackage.findOne(pkgQ);
  if (!pkg) {
    const e = new Error('Package not found for this organisation or not a remote access package.');
    e.status = 400;
    throw e;
  }

  const price = Math.max(0, Number(pkg.priceCents) || 0);
  let chargedUser = null;
  let chargedAmount = 0;
  if (chargeBalance) {
    if (!doc.userId) {
      const e = new Error('Cannot charge wallet: no billing customer linked.');
      e.status = 400;
      throw e;
    }
    if (price <= 0) {
      const e = new Error('Cannot charge wallet: package price is zero.');
      e.status = 400;
      throw e;
    }
    const user = await User.findOne({ _id: doc.userId, organizationId: doc.organizationId });
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
  const base = doc.paidUntil > now ? doc.paidUntil : now;
  doc.paidUntil = extendPaidUntilByPackage(base, pkg);
  doc.disabled = false;
  if (String(pkg._id) !== String(doc.packageId || '')) {
    doc.packageId = pkg._id;
  }

  let customerName = String(doc.displayName || '').trim();
  if (doc.userId) {
    const u = await User.findById(doc.userId).select('fullName').lean();
    if (u?.fullName?.trim()) customerName = u.fullName.trim();
  }
  const customerPhone = String(doc.phone || '').trim() || undefined;

  const orgId = doc.organizationId ? String(doc.organizationId) : undefined;
  try {
    await doc.save();
    const tx = await Transaction.create({
      ...(orgId ? { organizationId: orgId } : {}),
      ...(doc.userId ? { userId: doc.userId } : {}),
      packageId: pkg._id,
      amountCents: chargeBalance ? price : 0,
      currency: pkg.currency || 'GHS',
      status: 'paid',
      kind: 'renewal',
      provider: 'admin_dashboard',
      providerReference: chargeBalance ? 'admin_renew_balance' : 'admin_renew_waive',
      customerPhone,
      customerName: customerName || undefined,
      meta: {
        adminRenewal: true,
        adminEmail: String(adminEmail || '').trim(),
        chargeMode: chargeBalance ? 'balance' : 'waive',
        newPaidUntil: doc.paidUntil.toISOString(),
        packagePriceCents: price,
        remoteAccessSubscriptionId: String(doc._id),
      },
    });
    await notifyTransactionPaidSms(tx, {
      kind: 'renewal',
      renewalType: 'remote_access',
      paidUntil: doc.paidUntil,
      packageDoc: typeof pkg.toObject === 'function' ? pkg.toObject() : pkg,
      packageName: pkg.name,
      remoteAccessPhone: doc.phone,
    });
    await tx.save();
  } catch (err) {
    if (chargedUser && chargedAmount > 0) {
      chargedUser.balanceCents = (Number(chargedUser.balanceCents) || 0) + chargedAmount;
      await chargedUser.save();
    }
    throw err;
  }

  return getRemoteAccessSubscription(id, { organizationId });
}
