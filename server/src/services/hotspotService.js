import crypto from 'crypto';
import mongoose from 'mongoose';
import { HotspotVoucher, PlanPackage } from '../models/index.js';
import { withRouterMikrotik } from '../mikrotik/routeros.js';
import * as hs from '../mikrotik/hotspotCommands.js';
import { formatExpiryComment } from '../utils/expiryComment.js';
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
  const validUntil =
    pkg.durationDays != null
      ? new Date(now.getTime() + pkg.durationDays * 86400000)
      : undefined;

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
