import mongoose from 'mongoose';
import {
  RemoteAccessSubscription,
  PlanPackage,
  User,
  Transaction,
  Router as MikrotikRouter,
} from '../models/index.js';
import { WireGuardPeer } from '../models/WireGuardPeer.js';
import { findPeerForRouter, setPeerAccess } from './wireguard/peerAccess.js';
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

function subscriptionIsPaid(sub, now = new Date()) {
  return !sub.disabled && sub.paidUntil instanceof Date && sub.paidUntil > now;
}

/** Adds `routerAccess` ('open' | 'blocked' | 'no_tunnel') to rows with a populated router. */
async function withRouterAccess(rows) {
  const list = Array.isArray(rows) ? rows : [rows];
  const routers = list.map((r) => r?.routerId).filter((r) => r && r._id);
  if (!routers.length) return rows;
  const hosts = routers.map((r) => String(r.host || '').trim()).filter(Boolean);
  const peers = await WireGuardPeer.find({
    kind: { $ne: 'client' },
    $or: [{ claimedRouterId: { $in: routers.map((r) => r._id) } }, { tunnelIp: { $in: hosts } }],
  })
    .select('claimedRouterId tunnelIp status disabledReason')
    .lean();
  for (const row of list) {
    const r = row?.routerId;
    if (!r || !r._id) continue;
    const peer =
      peers.find((p) => p.claimedRouterId && String(p.claimedRouterId) === String(r._id)) ||
      peers.find((p) => p.tunnelIp === String(r.host || '').trim());
    row.routerAccess = !peer ? 'no_tunnel' : peer.status === 'disabled' ? 'blocked' : 'open';
    row.routerBlockReason = peer?.status === 'disabled' ? peer.disabledReason || 'manual' : '';
  }
  return rows;
}

async function assertRouterInOrg(routerId, organizationId) {
  if (!mongoose.isValidObjectId(String(routerId))) {
    const e = new Error('Invalid router id.');
    e.status = 400;
    throw e;
  }
  const router = await MikrotikRouter.findOne({ _id: routerId, ...orgClause(organizationId) })
    .select('_id')
    .lean();
  if (!router) {
    const e = new Error('Router not found.');
    e.status = 400;
    throw e;
  }
  return router._id;
}

/**
 * Open or cut a router's WireGuard tunnel from its linked subscriptions:
 * open while any linked subscription is paid and not suspended, cut otherwise.
 * Peers disabled manually by an admin are never re-opened here.
 * @returns {Promise<{ routerId: string, action: string, error?: string }>}
 */
export async function enforceRemoteAccessRouter(routerId) {
  const out = { routerId: String(routerId), action: 'none' };
  const router = await MikrotikRouter.findById(routerId).select('_id host').lean();
  if (!router) return { ...out, action: 'router_missing' };
  const peer = await findPeerForRouter(router);
  if (!peer) return { ...out, action: 'no_tunnel' };

  const subs = await RemoteAccessSubscription.find({ routerId: router._id })
    .select('paidUntil disabled')
    .lean();
  const now = new Date();
  const allow = subs.length === 0 || subs.some((s) => subscriptionIsPaid(s, now));

  try {
    if (!allow && peer.status !== 'disabled') {
      await setPeerAccess(peer, { enabled: false, reason: 'subscription_expired' });
      return { ...out, action: 'blocked' };
    }
    if (allow && peer.status === 'disabled' && peer.disabledReason === 'subscription_expired') {
      await setPeerAccess(peer, { enabled: true });
      return { ...out, action: 'unblocked' };
    }
  } catch (e) {
    console.error('[remote-access] router tunnel update failed', out.routerId, e?.message || e);
    return { ...out, action: 'failed', error: e?.message || String(e) };
  }
  return out;
}

/** Cron: apply subscription state to every linked router's tunnel. */
export async function enforceRemoteAccessRouters() {
  const ids = await RemoteAccessSubscription.distinct('routerId', { routerId: { $ne: null } });
  const summary = { checked: ids.length, blocked: 0, unblocked: 0, failed: 0 };
  for (const id of ids) {
    const r = await enforceRemoteAccessRouter(id);
    if (r.action === 'blocked') summary.blocked += 1;
    else if (r.action === 'unblocked') summary.unblocked += 1;
    else if (r.action === 'failed') summary.failed += 1;
  }
  return summary;
}

export async function listRemoteAccessSubscriptions(filter = {}, organizationId) {
  const rows = await RemoteAccessSubscription.find({ ...filter, ...orgClause(organizationId) })
    .populate('userId', 'email phone fullName')
    .populate('packageId', 'name kind')
    .populate('routerId', 'name comment host')
    .sort({ updatedAt: -1 })
    .lean();
  return withRouterAccess(rows);
}

export async function getRemoteAccessSubscription(id, { organizationId } = {}) {
  const doc = await RemoteAccessSubscription.findOne({ _id: id, ...orgClause(organizationId) })
    .populate('userId')
    .populate('packageId')
    .populate('routerId', 'name comment host')
    .lean();
  return doc ? withRouterAccess(doc) : doc;
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
  routerId,
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

  for (const [label, id] of [
    ['customer', userId],
    ['package', packageId],
  ]) {
    if (id && !mongoose.isValidObjectId(String(id))) {
      const e = new Error(`Invalid ${label} id.`);
      e.status = 400;
      throw e;
    }
  }

  let linkedUser = null;
  if (userId) {
    linkedUser = await User.findOne({ _id: userId, ...orgClause(tenantOrganizationId) });
    if (!linkedUser) {
      const e = new Error('Customer not found.');
      e.status = 400;
      throw e;
    }
  }

  let pkg = null;
  if (packageId) {
    pkg = await PlanPackage.findOne({ _id: packageId, ...orgClause(tenantOrganizationId) });
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

  const linkedRouterId = routerId ? await assertRouterInOrg(routerId, organizationId) : null;

  const doc = await RemoteAccessSubscription.create({
    organizationId,
    ...(userId ? { userId } : {}),
    displayName: displayName ? String(displayName).trim() : undefined,
    phone: p,
    email: email != null && String(email).trim() !== '' ? String(email).trim() : undefined,
    ...(pkg ? { packageId: pkg._id } : {}),
    ...(linkedRouterId ? { routerId: linkedRouterId } : {}),
    paidUntil: until,
    notes: notes != null && String(notes).trim() !== '' ? String(notes).trim() : undefined,
    disabled: false,
  });
  if (linkedRouterId) await enforceRemoteAccessRouter(linkedRouterId);
  return doc;
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
  'routerId',
]);

export async function updateRemoteAccessSubscription(id, patch, { organizationId } = {}) {
  const doc = await RemoteAccessSubscription.findOne({ _id: id, ...orgClause(organizationId) });
  if (!doc) return null;
  const previousRouterId = doc.routerId ? String(doc.routerId) : null;

  for (const k of PATCHABLE) {
    if (patch[k] === undefined) continue;
    if (k === 'routerId') {
      doc.routerId = patch[k]
        ? await assertRouterInOrg(patch[k], doc.organizationId || organizationId)
        : null;
    } else if (k === 'paidUntil') {
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
  const currentRouterId = doc.routerId ? String(doc.routerId) : null;
  if (previousRouterId && previousRouterId !== currentRouterId) {
    await enforceRemoteAccessRouter(previousRouterId);
  }
  if (currentRouterId) await enforceRemoteAccessRouter(currentRouterId);

  const updated = await RemoteAccessSubscription.findOne({ _id: id, ...orgClause(organizationId) })
    .populate('userId', 'email phone fullName')
    .populate('packageId', 'name kind')
    .populate('routerId', 'name comment host')
    .lean();
  return updated ? withRouterAccess(updated) : updated;
}

export async function deleteRemoteAccessSubscription(id, { organizationId } = {}) {
  const r = await RemoteAccessSubscription.findOneAndDelete({
    _id: id,
    ...orgClause(organizationId),
  });
  if (r?.routerId) await enforceRemoteAccessRouter(r.routerId);
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

  if (doc.routerId) await enforceRemoteAccessRouter(doc.routerId);
  return getRemoteAccessSubscription(id, { organizationId });
}
