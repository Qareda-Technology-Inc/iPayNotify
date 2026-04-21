import mongoose from 'mongoose';
import {
  User,
  PppoeAccount,
  RemoteAccessSubscription,
  Transaction,
} from '../models/index.js';
import { normalizeGhanaMsisdn } from '../utils/phoneGhana.js';

/** Coerce JSON / form values to real booleans so audience filters are reliable. */
export function normalizeAudienceFlags(audiences) {
  const a = audiences && typeof audiences === 'object' ? audiences : {};
  return {
    pppoe: a.pppoe === true || a.pppoe === 'true' || a.pppoe === 1 || a.pppoe === '1',
    remote: a.remote === true || a.remote === 'true' || a.remote === 1 || a.remote === '1',
    hotspot: a.hotspot === true || a.hotspot === 'true' || a.hotspot === 1 || a.hotspot === '1',
  };
}

export function audienceAny(flags) {
  return !!(flags && (flags.pppoe || flags.remote || flags.hotspot));
}

/**
 * Build deduplicated SMS recipients from billing registrations.
 * - PPPoE: users linked to at least one PPPoE account (User.phone).
 * - Remote: remote-access subscriptions (subscription.phone); excludes voucher-only buyers.
 * - Hotspot: users linked to a paid voucher transaction (userId on Transaction), not anonymous codes.
 * Anonymous hotspot buyers (voucher tx without userId) are never included.
 * Each row may include `userId` for filtering / intersection.
 * @param {{ routerId?: string, organizationId?: string }} [options] When `routerId` is a valid ObjectId, PPPoE and hotspot
 * segments are limited to that router; remote is omitted (not site-scoped). `organizationId` scopes all data to one tenant.
 */
export async function collectMessageRecipients(audiences, options = {}) {
  const { pppoe = false, remote = false, hotspot = false } = normalizeAudienceFlags(audiences);
  const orgRaw =
    options.organizationId != null && String(options.organizationId).trim()
      ? String(options.organizationId).trim()
      : '';
  const orgScoped = Boolean(orgRaw && mongoose.isValidObjectId(orgRaw));
  const orgOid = orgScoped ? new mongoose.Types.ObjectId(orgRaw) : null;

  const routerIdRaw =
    options.routerId != null && String(options.routerId).trim()
      ? String(options.routerId).trim()
      : '';
  const routerScoped = Boolean(routerIdRaw && mongoose.isValidObjectId(routerIdRaw));
  const routerOid = routerScoped ? new mongoose.Types.ObjectId(routerIdRaw) : null;

  const byPhone = new Map();

  function add(rawPhone, { name, sources, userId }) {
    const normalized = normalizeGhanaMsisdn(rawPhone);
    if (!normalized) return;
    const key = normalized;
    const prev = byPhone.get(key);
    const label = name && String(name).trim() ? String(name).trim() : 'Customer';
    const uid = userId != null && String(userId).trim() ? String(userId) : undefined;
    if (!prev) {
      byPhone.set(key, {
        phone: normalized,
        name: label,
        sources: [...sources],
        ...(uid ? { userId: uid } : {}),
      });
      return;
    }
    const merged = new Set([...(prev.sources || []), ...sources]);
    prev.sources = [...merged];
    if (prev.name === 'Customer' && label !== 'Customer') prev.name = label;
    if (uid && !prev.userId) prev.userId = uid;
  }

  if (pppoe) {
    const q = { userId: { $exists: true, $ne: null } };
    if (routerOid) q.routerId = routerOid;
    if (orgOid) q.organizationId = orgOid;
    const userIds = await PppoeAccount.distinct('userId', q);
    const users = await User.find({
      _id: { $in: userIds },
      phone: { $exists: true, $nin: [null, ''] },
      ...(orgOid ? { organizationId: orgOid } : {}),
    })
      .select('phone fullName email _id')
      .lean();
    for (const u of users) {
      add(u.phone, {
        name: u.fullName || u.email,
        sources: ['pppoe'],
        userId: String(u._id),
      });
    }
  }

  if (remote && !routerScoped) {
    const subs = await RemoteAccessSubscription.find({
      disabled: false,
      ...(orgOid ? { organizationId: orgOid } : {}),
    })
      .populate('userId', 'fullName email')
      .lean();
    for (const s of subs) {
      const name =
        s.displayName ||
        (s.userId && (s.userId.fullName || s.userId.email)) ||
        'Customer';
      const ru = s.userId;
      const rid =
        ru && typeof ru === 'object' && ru._id != null
          ? String(ru._id)
          : ru != null
            ? String(ru)
            : undefined;
      add(s.phone, {
        name,
        sources: ['remote_access'],
        userId: rid,
      });
    }
  }

  if (hotspot) {
    const txQ = {
      kind: 'voucher',
      status: 'paid',
      userId: { $exists: true, $ne: null },
    };
    if (orgOid) txQ.organizationId = orgOid;
    if (routerOid) {
      txQ.$or = [{ 'meta.routerId': routerOid }, { 'meta.routerId': routerIdRaw }];
    }
    const userIds = await Transaction.distinct('userId', txQ);
    const users = await User.find({
      _id: { $in: userIds },
      phone: { $exists: true, $nin: [null, ''] },
      ...(orgOid ? { organizationId: orgOid } : {}),
    })
      .select('phone fullName email _id')
      .lean();
    for (const u of users) {
      add(u.phone, {
        name: u.fullName || u.email,
        sources: ['hotspot'],
        userId: String(u._id),
      });
    }
  }

  return [...byPhone.values()];
}

/** User ids with a PPPoE account on this router or a paid voucher purchase for this router. */
export async function getUserIdsLinkedToRouter(routerId, organizationId) {
  const rid = String(routerId || '').trim();
  if (!mongoose.isValidObjectId(rid)) return new Set();
  const oid = new mongoose.Types.ObjectId(rid);
  const orgOid =
    organizationId != null &&
    String(organizationId).trim() &&
    mongoose.isValidObjectId(String(organizationId).trim())
      ? new mongoose.Types.ObjectId(String(organizationId).trim())
      : null;
  const [fromPppoe, fromVoucher] = await Promise.all([
    PppoeAccount.distinct('userId', {
      routerId: oid,
      userId: { $exists: true, $ne: null },
      ...(orgOid ? { organizationId: orgOid } : {}),
    }),
    Transaction.distinct('userId', {
      kind: 'voucher',
      status: 'paid',
      userId: { $exists: true, $ne: null },
      $or: [{ 'meta.routerId': oid }, { 'meta.routerId': rid }],
      ...(orgOid ? { organizationId: orgOid } : {}),
    }),
  ]);
  return new Set(
    [...fromPppoe, ...fromVoucher].filter(Boolean).map((id) => String(id))
  );
}

/** Recipients from explicit billing User ids (must have a normalizable phone). */
export async function collectRecipientsFromUserIds(userIds, { organizationId } = {}) {
  const ids = [...new Set((userIds || []).map(String))].filter((id) => mongoose.isValidObjectId(id));
  if (ids.length === 0) return [];
  const orgOid =
    organizationId != null &&
    String(organizationId).trim() &&
    mongoose.isValidObjectId(String(organizationId).trim())
      ? new mongoose.Types.ObjectId(String(organizationId).trim())
      : null;
  const users = await User.find({
    _id: { $in: ids },
    phone: { $exists: true, $nin: [null, ''] },
    ...(orgOid ? { organizationId: orgOid } : {}),
  })
    .select('phone fullName email _id')
    .lean();
  const byPhone = new Map();
  for (const u of users) {
    const normalized = normalizeGhanaMsisdn(u.phone);
    if (!normalized) continue;
    byPhone.set(normalized, {
      phone: normalized,
      name: u.fullName || u.email || 'Customer',
      sources: ['specific_user'],
      userId: String(u._id),
    });
  }
  return [...byPhone.values()];
}

function splitPhoneLines(input) {
  if (input == null) return [];
  if (Array.isArray(input)) return input.map((s) => String(s).trim()).filter(Boolean);
  return String(input)
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** One entry per valid normalized number (no userId). */
export async function collectRecipientsFromPhones(phonesInput) {
  const lines = splitPhoneLines(phonesInput);
  const byPhone = new Map();
  for (const raw of lines) {
    const normalized = normalizeGhanaMsisdn(raw);
    if (!normalized) continue;
    if (!byPhone.has(normalized)) {
      byPhone.set(normalized, {
        phone: normalized,
        name: 'Customer',
        sources: ['manual_phone'],
      });
    }
  }
  return [...byPhone.values()];
}

/** Keep recipients whose phone appears in the audience bucket (intersection by MSISDN). */
export function intersectRecipientsByAudiencePhones(recipients, audienceRecipients) {
  const allowed = new Set((audienceRecipients || []).map((r) => r.phone));
  return recipients.filter((r) => allowed.has(r.phone));
}
