import crypto from 'crypto';
import mongoose from 'mongoose';
import { HotspotVoucher, PlanPackage, Router } from '../models/index.js';
import { withRouterMikrotik } from '../mikrotik/routeros.js';
import * as hs from '../mikrotik/hotspotCommands.js';
import { formatExpiryComment } from '../utils/expiryComment.js';
import { extendPaidUntilByPackage } from '../utils/duration.js';
import { resolveRouter } from './routerResolver.js';
import { organizationIdForRouter } from '../db/defaultOrganizationId.js';

function randomCode(length = 10) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  const bytes = crypto.randomBytes(length);
  for (let i = 0; i < length; i++) out += chars[bytes[i] % chars.length];
  return out;
}

async function uniqueCode(routerId) {
  for (let i = 0; i < 20; i++) {
    const code = randomCode(10);
    const exists = await HotspotVoucher.findOne({ routerId, code });
    if (!exists) return code;
  }
  throw new Error('Could not allocate unique voucher code');
}

export async function syncVoucherToRouter(voucher) {
  const router = await resolveRouter(voucher.routerId);
  const comment = voucher.validUntil
    ? formatExpiryComment(voucher.validUntil)
    : 'Hotspot voucher';

  await withRouterMikrotik(router, async (api) => {
    const existing = await hs.findHotspotUserByName(api, voucher.code);
    if (existing) {
      await hs.removeHotspotUser(api, existing['.id']);
    }
    await hs.addHotspotUser(api, {
      name: voucher.code,
      password: voucher.code,
      profile: voucher.profileName,
      comment,
      timeLimitSeconds: voucher.timeLimitSeconds,
      dataLimitBytes: voucher.dataLimitBytes,
    });
    const row = await hs.findHotspotUserByName(api, voucher.code);
    if (row) {
      voucher.mikrotikInternalId = row['.id'];
      await voucher.save();
    }
  });
  return voucher;
}

export async function removeVoucherFromRouter(voucher) {
  const router = await resolveRouter(voucher.routerId);
  await withRouterMikrotik(router, async (api) => {
    let id = voucher.mikrotikInternalId;
    if (!id) {
      const row = await hs.findHotspotUserByName(api, voucher.code);
      id = row?.['.id'];
    }
    if (id) await hs.removeHotspotUser(api, id);
  });
  voucher.mikrotikInternalId = undefined;
  await voucher.save();
}

/**
 * Generate vouchers from a hotspot package; DB is source of truth, then push to router.
 */
export async function generateVouchers({
  count,
  packageId,
  routerId,
  pushToRouter = true,
  organizationId,
}) {
  const pkgQ = { _id: packageId };
  if (
    organizationId != null &&
    String(organizationId).trim() &&
    mongoose.isValidObjectId(String(organizationId).trim())
  ) {
    pkgQ.organizationId = String(organizationId).trim();
  }
  const pkg = await PlanPackage.findOne(pkgQ);
  if (!pkg || pkg.kind !== 'hotspot') {
    const err = new Error('packageId must reference a hotspot package');
    err.status = 400;
    throw err;
  }
  const router = await resolveRouter(routerId, {
    organizationId:
      organizationId && mongoose.isValidObjectId(String(organizationId).trim())
        ? String(organizationId).trim()
        : undefined,
  });

  const vouchers = [];
  const now = new Date();
  let validUntil;
  try {
    validUntil = extendPaidUntilByPackage(now, pkg);
  } catch {
    validUntil = undefined;
  }

  for (let i = 0; i < count; i++) {
    const code = await uniqueCode(router._id);
    const v = await HotspotVoucher.create({
      organizationId: await organizationIdForRouter(router),
      packageId: pkg._id,
      routerId: router._id,
      code,
      profileName: pkg.activeProfile,
      dataLimitBytes: pkg.dataLimitBytes,
      timeLimitSeconds: pkg.timeLimitSeconds,
      validUntil,
    });
    if (pushToRouter) await syncVoucherToRouter(v);
    vouchers.push(v);
  }
  return vouchers;
}

export async function listVouchers(query = {}) {
  return HotspotVoucher.find(query)
    .populate('packageId', 'name')
    .sort({ createdAt: -1 })
    .limit(500)
    .lean();
}

function rosBytes(row, keys) {
  for (const k of keys) {
    const raw = row?.[k];
    if (raw == null || raw === '') continue;
    const n = Number(String(raw).replace(/,/g, ''));
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return 0;
}

/**
 * Mark vouchers as used when they appear in hotspot active sessions,
 * and snapshot byte counters from MikroTik user rows.
 */
export async function reconcileHotspotVoucherUsage(organizationId) {
  const orgFilter =
    organizationId != null &&
    String(organizationId).trim() &&
    mongoose.isValidObjectId(String(organizationId).trim())
      ? { organizationId: String(organizationId).trim() }
      : { organizationId: { $exists: true, $ne: null } };

  const routerIds = await HotspotVoucher.distinct('routerId', orgFilter);
  const summary = {
    routers: routerIds.length,
    markedUsed: 0,
    updatedBytes: 0,
    exhausted: 0,
    errors: [],
  };
  const now = new Date();

  for (const rid of routerIds) {
    try {
      const router = await Router.findById(rid);
      if (!router) continue;
      const vouchers = await HotspotVoucher.find({
        ...orgFilter,
        routerId: rid,
        $or: [{ validUntil: null }, { validUntil: { $gte: now } }],
      });
      if (!vouchers.length) continue;

      const byCode = new Map(vouchers.map((v) => [String(v.code).toUpperCase(), v]));

      await withRouterMikrotik(router, async (api) => {
        const [activeRows, userRows] = await Promise.all([
          hs.printHotspotActive(api),
          hs.printHotspotUsers(api),
        ]);

        for (const row of activeRows) {
          const user = String(row.user || row['user-name'] || row.name || '')
            .trim()
            .toUpperCase();
          if (!user) continue;
          const v = byCode.get(user);
          if (!v) continue;
          if (!v.usedAt) {
            v.usedAt = now;
            summary.markedUsed++;
          }
          v.lastSeenAt = now;
          await v.save();
        }

        for (const row of userRows) {
          const name = String(row.name || '')
            .trim()
            .toUpperCase();
          if (!name) continue;
          const v = byCode.get(name);
          if (!v) continue;
          const bi = rosBytes(row, ['bytes-in', 'bytes_in']);
          const bo = rosBytes(row, ['bytes-out', 'bytes_out']);
          let dirty = false;
          if (bi !== (v.bytesIn || 0) || bo !== (v.bytesOut || 0)) {
            v.bytesIn = bi;
            v.bytesOut = bo;
            summary.updatedBytes++;
            dirty = true;
          }
          const limit = Number(v.dataLimitBytes);
          if (Number.isFinite(limit) && limit > 0 && bi + bo >= limit) {
            if (!v.usedAt) {
              v.usedAt = now;
              summary.markedUsed++;
              dirty = true;
            }
            try {
              const id = row['.id'] || v.mikrotikInternalId;
              if (id) await hs.removeHotspotUser(api, id);
              v.mikrotikInternalId = undefined;
              dirty = true;
              summary.exhausted++;
            } catch (e) {
              summary.errors.push({ id: String(v._id), message: e.message });
            }
          }
          if (dirty) await v.save();
        }
      });
    } catch (e) {
      summary.errors.push({ routerId: String(rid), message: e.message });
    }
  }

  return summary;
}

/** Remove router users for vouchers past validUntil (saves router resources). */
export async function purgeExpiredHotspotOnRouter() {
  const now = new Date();
  const expired = await HotspotVoucher.find({
    validUntil: { $lt: now },
    organizationId: { $exists: true, $ne: null },
  });

  const summary = { checked: expired.length, removed: 0, errors: [] };
  for (const v of expired) {
    try {
      await removeVoucherFromRouter(v);
      summary.removed++;
    } catch (e) {
      summary.errors.push({ id: String(v._id), message: e.message });
    }
  }
  return summary;
}
