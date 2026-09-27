import crypto from 'crypto';
import mongoose from 'mongoose';
import { HotspotVoucher, PlanPackage, Router } from '../models/index.js';
import { withRouterMikrotik } from '../mikrotik/routeros.js';
import * as hs from '../mikrotik/hotspotCommands.js';
import { formatExpiryComment } from '../utils/expiryComment.js';
import { resolveRouter } from './routerResolver.js';
import { cliEscapeValue } from '../mikrotik/rosSsh.js';
import { organizationIdForRouter } from '../db/defaultOrganizationId.js';

function randomNumericCode(length = 6) {
  const n = Math.min(10, Math.max(4, Math.floor(Number(length) || 6)));
  /* Avoid leading zeros for consistent 6-digit look when n=6 → 100000–999999 */
  if (n === 6) {
    const num = 100000 + (crypto.randomBytes(3).readUIntBE(0, 3) % 900000);
    return String(num);
  }
  let out = '';
  const bytes = crypto.randomBytes(n);
  for (let i = 0; i < n; i++) out += String(bytes[i] % 10);
  if (out[0] === '0') out = `1${out.slice(1)}`;
  return out;
}

async function uniqueNumericCode(routerId, length = 6) {
  for (let i = 0; i < 40; i++) {
    const code = randomNumericCode(length);
    const exists = await HotspotVoucher.findOne({ routerId, code });
    if (!exists) return code;
  }
  throw new Error('Could not allocate unique voucher code');
}

function packageSummary(pkg) {
  return {
    id: String(pkg._id),
    name: pkg.name,
    priceCents: pkg.priceCents,
    currency: pkg.currency || 'GHS',
    ticketDurationType: pkg.ticketDurationType || 'elapsed',
    elapsedSeconds: pkg.elapsedSeconds,
    pausedSeconds: pkg.pausedSeconds ?? pkg.timeLimitSeconds,
    dataLimitBytes: pkg.dataLimitBytes,
    usersPerTicket: pkg.usersPerTicket ?? 1,
    speedUpMbps: pkg.speedUpMbps,
    speedDownMbps: pkg.speedDownMbps,
    activeProfile: hotspotProfileNameForPackage(pkg),
  };
}

/**
 * MikroTik hotspot user-profile name for a QareFi package (= package name).
 * Spaces → hyphens; no pkg- prefix. Digit-leading names are CLI-quoted.
 */
export function hotspotProfileNameForPackage(pkg) {
  const raw = String(pkg?.name || pkg?.activeProfile || 'hotspot').trim();
  const fromName = raw
    .replace(/^pkg-/i, '')
    .replace(/\s+/g, '-')
    .replace(/[^A-Za-z0-9._@-]/g, '')
    .slice(0, 48);
  return fromName || 'hotspot';
}

/**
 * Push / update the hotspot user profile that represents this package on the router.
 */
export async function pushHotspotPackageProfile(pkg, router) {
  const profileName = hotspotProfileNameForPackage(pkg);
  return withRouterMikrotik(router, async (api) => {
    const result = await hs.upsertHotspotUserProfile(api, profileName, {
      speedDownMbps: pkg.speedDownMbps,
      speedUpMbps: pkg.speedUpMbps,
      sharedUsers: pkg.usersPerTicket,
      comment: `QareFi:${pkg.name || profileName}`,
    });
    return { ...result, profileName };
  });
}

/**
 * Save package profile name and sync hotspot user profile to a router.
 */
export async function syncHotspotPackageToRouter(packageId, routerId, organizationId) {
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
    const err = new Error('Only hotspot packages can sync as user profiles');
    err.status = 400;
    throw err;
  }
  const router = await resolveRouter(routerId, {
    organizationId:
      organizationId && mongoose.isValidObjectId(String(organizationId).trim())
        ? String(organizationId).trim()
        : undefined,
  });
  const profileName = hotspotProfileNameForPackage(pkg);
  if (pkg.activeProfile !== profileName) {
    pkg.activeProfile = profileName;
    await pkg.save();
  }
  const result = await pushHotspotPackageProfile(pkg, router);
  return {
    packageId: String(pkg._id),
    packageName: pkg.name,
    routerId: String(router._id),
    routerName: router.name || router.host,
    profileName: result.profileName,
    created: result.created,
    updated: result.updated,
  };
}

export async function listHotspotServersForRouter(routerId, organizationId) {
  const router = await resolveRouter(routerId, {
    organizationId:
      organizationId && mongoose.isValidObjectId(String(organizationId).trim())
        ? String(organizationId).trim()
        : undefined,
  });
  const servers = await withRouterMikrotik(router, async (api) => {
    const rows = await hs.printHotspotServers(api);
    return rows
      .map((r) => ({
        name: String(r.name || '').trim(),
        disabled: r.disabled === 'true' || r.disabled === true,
      }))
      .filter((s) => s.name);
  });
  return {
    routerId: String(router._id),
    routerName: router.name || router.host,
    servers,
  };
}

/**
 * Preview unique 6-digit codes without writing to DB / router.
 */
export async function previewVouchers({
  count,
  packageId,
  routerId,
  hotspotServer,
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
  const n = Math.min(100, Math.max(1, Number(count) || 1));
  const existing = await HotspotVoucher.find({ routerId: router._id }).select('code').lean();
  const taken = new Set(existing.map((r) => String(r.code)));
  const codes = [];
  const used = new Set();
  let guard = 0;
  while (codes.length < n && guard < n * 50) {
    guard++;
    const code = randomNumericCode(6);
    if (used.has(code) || taken.has(code)) continue;
    used.add(code);
    codes.push(code);
  }
  if (codes.length < n) throw new Error('Could not allocate unique voucher codes for preview');
  return {
    codes,
    quantity: codes.length,
    hotspotServer: String(hotspotServer || '').trim(),
    package: packageSummary(pkg),
    router: {
      id: String(router._id),
      name: router.name || router.host,
    },
  };
}

function pausedSecondsFromPackage(pkg) {
  const type = pkg.ticketDurationType || 'elapsed';
  if (type === 'elapsed') return undefined;
  const paused = Number(pkg.pausedSeconds);
  if (Number.isFinite(paused) && paused > 0) return paused;
  const legacy = Number(pkg.timeLimitSeconds);
  if (Number.isFinite(legacy) && legacy > 0) return legacy;
  return undefined;
}

function elapsedSecondsFromPackage(pkg) {
  const type = pkg.ticketDurationType || 'elapsed';
  if (type === 'paused') return undefined;
  const elapsed = Number(pkg.elapsedSeconds);
  if (Number.isFinite(elapsed) && elapsed > 0) return elapsed;
  return undefined;
}

export async function syncVoucherToRouter(voucher) {
  const router = await resolveRouter(voucher.routerId);
  const comment = voucher.validUntil
    ? formatExpiryComment(voucher.validUntil)
    : 'QareFi hotspot voucher';

  await withRouterMikrotik(router, async (api) => {
    if (typeof api.execCli === 'function') {
      await api
        .execCli(`/ip hotspot user remove [find name=${cliEscapeValue(voucher.code)}]`)
        .catch(() => {});
    } else {
      const existing = await hs.findHotspotUserByName(api, voucher.code);
      if (existing?.['.id']) await hs.removeHotspotUser(api, existing['.id']);
    }

    const row = await hs.addHotspotUser(api, {
      name: voucher.code,
      password: '',
      profile: voucher.profileName || 'default',
      server: voucher.hotspotServer || undefined,
      comment,
      timeLimitSeconds: voucher.timeLimitSeconds,
      dataLimitBytes: voucher.dataLimitBytes,
      sharedUsers: voucher.usersPerTicket,
      speedDownMbps: voucher.speedDownMbps,
      speedUpMbps: voucher.speedUpMbps,
    });
    voucher.password = '';
    voucher.mikrotikInternalId = row?.['.id'] || row?.id || undefined;
    await voucher.save();
  });
  return voucher;
}

/**
 * One SSH session: ensure profile once, then add all voucher users (fast path).
 */
async function pushVoucherBatchToRouter(vouchers, router, pkg) {
  if (!vouchers.length) return;
  const profileName = hotspotProfileNameForPackage(pkg);
  const comment = 'QareFi hotspot voucher';

  await withRouterMikrotik(router, async (api) => {
    await hs.upsertHotspotUserProfile(api, profileName, {
      speedDownMbps: pkg.speedDownMbps,
      speedUpMbps: pkg.speedUpMbps,
      sharedUsers: pkg.usersPerTicket,
      comment: `QareFi-${pkg.name || profileName}`,
    });

    for (const voucher of vouchers) {
      if (typeof api.execCli === 'function') {
        await api
          .execCli(`/ip hotspot user remove [find name=${cliEscapeValue(voucher.code)}]`)
          .catch(() => {});
      }
      await hs.addHotspotUser(api, {
        name: voucher.code,
        password: '',
        profile: profileName,
        server: voucher.hotspotServer || undefined,
        comment,
        timeLimitSeconds: voucher.timeLimitSeconds,
        dataLimitBytes: voucher.dataLimitBytes,
        sharedUsers: voucher.usersPerTicket,
        speedDownMbps: voucher.speedDownMbps,
        speedUpMbps: voucher.speedUpMbps,
        skipProfileUpsert: true,
        skipVerify: true,
      });
      voucher.password = '';
      voucher.mikrotikInternalId = undefined;
    }
  });

  await HotspotVoucher.bulkWrite(
    vouchers.map((v) => ({
      updateOne: {
        filter: { _id: v._id },
        update: { $set: { password: '' } },
      },
    }))
  );
}

export async function removeVoucherFromRouter(voucher) {
  const router = await resolveRouter(voucher.routerId);
  await withRouterMikrotik(router, async (api) => {
    if (typeof api.execCli === 'function') {
      await api
        .execCli(`/ip hotspot user remove [find name=${cliEscapeValue(voucher.code)}]`)
        .catch(() => {});
      voucher.mikrotikInternalId = undefined;
      await voucher.save();
      return;
    }
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
 * Codes are unique 6-digit numbers. Pass `codes` from preview to create the same set.
 */
export async function generateVouchers({
  count,
  packageId,
  routerId,
  hotspotServer,
  codes: previewCodes,
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

  const serverName = String(hotspotServer || '').trim();
  const fromPreview = Array.isArray(previewCodes)
    ? previewCodes
        .map((c) => String(c || '').trim())
        .filter((c) => /^\d{6}$/.test(c))
    : [];
  const n =
    fromPreview.length > 0
      ? Math.min(100, fromPreview.length)
      : Math.min(100, Math.max(1, Number(count) || 1));

  const paused = pausedSecondsFromPackage(pkg);
  const elapsed = elapsedSecondsFromPackage(pkg);
  const profileName = hotspotProfileNameForPackage(pkg);
  const orgId = await organizationIdForRouter(router);

  /* Allocate all codes first (one DB read for collisions) */
  const existing = await HotspotVoucher.find({ routerId: router._id }).select('code').lean();
  const taken = new Set(existing.map((r) => String(r.code)));
  const codes = [];
  const usedInBatch = new Set();

  if (fromPreview.length > 0) {
    for (let i = 0; i < n; i++) {
      const code = fromPreview[i];
      if (usedInBatch.has(code) || taken.has(code)) {
        const err = new Error(
          taken.has(code)
            ? `Code ${code} was already created — preview again`
            : `Duplicate preview code ${code}`
        );
        err.status = taken.has(code) ? 409 : 400;
        throw err;
      }
      usedInBatch.add(code);
      codes.push(code);
    }
  } else {
    let guard = 0;
    while (codes.length < n && guard < n * 50) {
      guard++;
      const code = randomNumericCode(6);
      if (usedInBatch.has(code) || taken.has(code)) continue;
      usedInBatch.add(code);
      codes.push(code);
    }
    if (codes.length < n) throw new Error('Could not allocate unique voucher codes');
  }

  if (pkg.activeProfile !== profileName) {
    pkg.activeProfile = profileName;
    await pkg.save().catch(() => {});
  }

  const docs = codes.map((code) => ({
    organizationId: orgId,
    packageId: pkg._id,
    routerId: router._id,
    code,
    password: '',
    codeType: 'pin',
    hotspotServer: serverName,
    profileName,
    dataLimitBytes: pkg.dataLimitBytes,
    timeLimitSeconds: paused,
    elapsedSeconds: elapsed,
    usersPerTicket: Math.max(1, Number(pkg.usersPerTicket) || 1),
    speedUpMbps: pkg.speedUpMbps,
    speedDownMbps: pkg.speedDownMbps,
  }));

  const vouchers = await HotspotVoucher.insertMany(docs, { ordered: true });

  if (pushToRouter) {
    await pushVoucherBatchToRouter(vouchers, router, pkg);
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
          let justActivated = false;
          if (!v.usedAt) {
            v.usedAt = now;
            summary.markedUsed++;
            justActivated = true;
            const elapsed = Number(v.elapsedSeconds);
            if (Number.isFinite(elapsed) && elapsed > 0 && !v.validUntil) {
              v.validUntil = new Date(now.getTime() + elapsed * 1000);
            }
          }
          v.lastSeenAt = now;
          await v.save();
          if (justActivated && v.validUntil) {
            try {
              await hs.setHotspotUserComment(api, v.code, formatExpiryComment(v.validUntil));
            } catch (e) {
              summary.errors.push({
                id: String(v._id),
                message: `stamp comment: ${e.message}`,
              });
            }
          }
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
