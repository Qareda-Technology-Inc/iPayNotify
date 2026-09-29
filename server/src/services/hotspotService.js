import crypto from 'crypto';
import mongoose from 'mongoose';
import { HotspotVoucher, PlanPackage, Router } from '../models/index.js';
import { withRouterMikrotik } from '../mikrotik/routeros.js';
import * as hs from '../mikrotik/hotspotCommands.js';
import {
  formatMikroTicketComment,
  normalizeMacAddress,
} from '../utils/mikroTicketComment.js';
import { resolveRouter } from './routerResolver.js';
import { cliEscapeValue } from '../mikrotik/rosSsh.js';
import { organizationIdForRouter } from '../db/defaultOrganizationId.js';
import { syncHotspotExpiryScheduler } from './hotspotExpirySchedulerService.js';

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
  const comment = formatMikroTicketComment({
    createdAt: voucher.createdAt || new Date(),
    voucherId: voucher._id,
    usersPerTicket: voucher.usersPerTicket,
    activatedAt: voucher.usedAt,
    mac: voucher.lockedMac,
    validUntil: voucher.validUntil,
  });

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
    /* Re-apply MAC lock if already activated */
    if (voucher.lockedMac) {
      await hs.setHotspotUserMacAndComment(api, voucher.code, voucher.lockedMac, comment).catch(
        () => {}
      );
    }
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

  await withRouterMikrotik(router, async (api) => {
    await hs.upsertHotspotUserProfile(api, profileName, {
      speedDownMbps: pkg.speedDownMbps,
      speedUpMbps: pkg.speedUpMbps,
      sharedUsers: pkg.usersPerTicket,
      comment: `QareFi-${pkg.name || profileName}`,
    });

    for (const voucher of vouchers) {
      const comment = formatMikroTicketComment({
        createdAt: voucher.createdAt || new Date(),
        voucherId: voucher._id,
        usersPerTicket: voucher.usersPerTicket ?? pkg.usersPerTicket,
        validUntil: voucher.validUntil,
      });
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
    await hs.disconnectHotspotUser(api, voucher.code);
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
  /* Both clocks are also a MikroTik limit-uptime, so a session cannot run past the plan. */
  const onlineLimit = paused || elapsed;
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
    timeLimitSeconds: onlineLimit,
    elapsedSeconds: elapsed,
    usersPerTicket: Math.max(1, Number(pkg.usersPerTicket) || 1),
    speedUpMbps: pkg.speedUpMbps,
    speedDownMbps: pkg.speedDownMbps,
  }));

  const vouchers = await HotspotVoucher.insertMany(docs, { ordered: true });

  if (pushToRouter) {
    await pushVoucherBatchToRouter(vouchers, router, pkg);
    try {
      await syncHotspotExpiryScheduler(router._id, orgId);
    } catch (e) {
      console.error('[hotspot] expiry scheduler sync failed', e?.message || e);
    }
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

/** RouterOS `5h2m`, `1d3h`, or `hh:mm:ss` → seconds. */
export function parseRosDurationSeconds(value) {
  const str = String(value || '').trim();
  if (!str || str === '0' || str === '0s') return 0;
  const hms = /^(\d+):(\d+):(\d+)$/.exec(str);
  if (hms) return Number(hms[1]) * 3600 + Number(hms[2]) * 60 + Number(hms[3]);
  let total = 0;
  let any = false;
  const re = /(\d+)([wdhms])/gi;
  let m;
  while ((m = re.exec(str))) {
    any = true;
    const n = Number(m[1]);
    const u = m[2].toLowerCase();
    if (u === 'w') total += n * 604800;
    else if (u === 'd') total += n * 86400;
    else if (u === 'h') total += n * 3600;
    else if (u === 'm') total += n * 60;
    else total += n;
  }
  return any ? total : 0;
}

/**
 * Decide whether a voucher is past its plan.
 * Elapsed time is wall-clock from first use. Online time (limit-uptime) caps both modes.
 */
export function assessVoucherUsage({
  now,
  uptimeSec,
  elapsedSeconds,
  timeLimitSeconds,
  usedAt,
  validUntil,
  active = false,
}) {
  const nowMs = now.getTime();
  const online = Math.max(0, Math.floor(Number(uptimeSec) || 0));
  const elapsed = Number(elapsedSeconds);
  const paused = Number(timeLimitSeconds);
  const hasElapsed = Number.isFinite(elapsed) && elapsed > 0;
  const hasPaused = Number.isFinite(paused) && paused > 0;
  let nextUsedAt = usedAt ? new Date(usedAt) : null;
  let nextValid = validUntil ? new Date(validUntil) : null;
  if (nextUsedAt && Number.isNaN(nextUsedAt.getTime())) nextUsedAt = null;
  if (nextValid && Number.isNaN(nextValid.getTime())) nextValid = null;

  if (!nextUsedAt && (online > 0 || active)) {
    nextUsedAt = new Date(nowMs - online * 1000);
  }
  if (hasElapsed && nextUsedAt && !nextValid) {
    nextValid = new Date(nextUsedAt.getTime() + elapsed * 1000);
  }

  let kick = false;
  let reason = '';
  if (nextValid && nextValid.getTime() <= nowMs) {
    kick = true;
    reason = 'elapsed';
  }
  const cap = hasPaused ? paused : hasElapsed ? elapsed : 0;
  if (cap > 0 && online >= cap) {
    kick = true;
    if (!reason) reason = 'uptime';
  }
  return {
    kick,
    reason,
    usedAt: nextUsedAt,
    validUntil: nextValid,
    limitUptimeSeconds: cap > 0 ? cap : undefined,
  };
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
    macLocked: 0,
    updatedBytes: 0,
    exhausted: 0,
    kicked: 0,
    limitsSet: 0,
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

      await withRouterMikrotik(router, async (api) => {
        const [activeRows, userRows] = await Promise.all([
          hs.printHotspotActive(api),
          hs.printHotspotUsers(api),
        ]);

        const activeByUser = new Map();
        for (const row of activeRows) {
          const user = String(row.user || row['user-name'] || row.name || '')
            .trim()
            .toUpperCase();
          if (user) activeByUser.set(user, row);
        }
        const userByName = new Map();
        for (const row of userRows) {
          const name = String(row.name || '')
            .trim()
            .toUpperCase();
          if (name) userByName.set(name, row);
        }

        for (const v of vouchers) {
          const key = String(v.code).toUpperCase();
          const active = activeByUser.get(key);
          const userRow = userByName.get(key);
          if (!active && !userRow) continue;

          const uptimeSec = Math.max(
            parseRosDurationSeconds(active?.uptime || active?.['session-time']),
            parseRosDurationSeconds(userRow?.uptime)
          );
          const decision = assessVoucherUsage({
            now,
            uptimeSec,
            elapsedSeconds: v.elapsedSeconds,
            timeLimitSeconds: v.timeLimitSeconds,
            usedAt: v.usedAt,
            validUntil: v.validUntil,
            active: Boolean(active),
          });

          let justActivated = false;
          if (!v.usedAt && decision.usedAt) {
            v.usedAt = decision.usedAt;
            summary.markedUsed++;
            justActivated = true;
          }
          if (!v.validUntil && decision.validUntil) {
            v.validUntil = decision.validUntil;
            justActivated = true;
          }
          const mac = active
            ? normalizeMacAddress(active['mac-address'] || active.mac || '')
            : '';
          if (mac && !v.lockedMac) {
            v.lockedMac = mac;
            summary.macLocked++;
            justActivated = true;
          }
          if (active) v.lastSeenAt = now;

          let overData = false;
          if (userRow) {
            const bi = rosBytes(userRow, ['bytes-in', 'bytes_in']);
            const bo = rosBytes(userRow, ['bytes-out', 'bytes_out']);
            if (bi !== (v.bytesIn || 0) || bo !== (v.bytesOut || 0)) {
              v.bytesIn = bi;
              v.bytesOut = bo;
              summary.updatedBytes++;
            }
            const dataLimit = Number(v.dataLimitBytes);
            if (Number.isFinite(dataLimit) && dataLimit > 0 && bi + bo >= dataLimit) {
              overData = true;
            }
          }

          if (decision.kick || overData) {
            try {
              await hs.disconnectHotspotUser(api, v.code);
              v.mikrotikInternalId = undefined;
              if (!v.validUntil || v.validUntil > now) v.validUntil = now;
              if (!v.usedAt) {
                v.usedAt = now;
                summary.markedUsed++;
              }
              if (overData) summary.exhausted++;
              else summary.kicked++;
            } catch (e) {
              summary.errors.push({ id: String(v._id), message: e.message });
            }
            await v.save();
            continue;
          }

          await v.save();

          const routerComment = String(userRow?.comment || active?.comment || '');
          const renameComment = /mikroticket/i.test(routerComment);
          if (renameComment || (justActivated && (v.lockedMac || v.validUntil))) {
            try {
              const comment = formatMikroTicketComment({
                createdAt: v.createdAt,
                voucherId: v._id,
                usersPerTicket: v.usersPerTicket,
                activatedAt: v.usedAt,
                mac: v.lockedMac,
                validUntil: v.validUntil,
              });
              if (v.lockedMac) {
                await hs.setHotspotUserMacAndComment(api, v.code, v.lockedMac, comment);
              } else {
                await hs.setHotspotUserComment(api, v.code, comment);
              }
            } catch (e) {
              summary.errors.push({
                id: String(v._id),
                message: `activate lock: ${e.message}`,
              });
            }
          }

          if (userRow && decision.limitUptimeSeconds) {
            const have = parseRosDurationSeconds(userRow['limit-uptime']);
            if (have + 60 < decision.limitUptimeSeconds) {
              try {
                await hs.setHotspotUserLimitUptime(api, v.code, decision.limitUptimeSeconds);
                summary.limitsSet++;
              } catch (e) {
                summary.errors.push({
                  id: String(v._id),
                  message: `limit-uptime: ${e.message}`,
                });
              }
            }
          }
        }
      });
    } catch (e) {
      summary.errors.push({ routerId: String(rid), message: e.message });
    }
  }

  return summary;
}

let hotspotJob = null;

/** Reconcile usage and drop sessions that are past the package. Safe to call on a short interval. */
export function enforceHotspotPlans(organizationId) {
  if (hotspotJob) return hotspotJob;
  hotspotJob = (async () => {
    try {
      const usage = await reconcileHotspotVoucherUsage(organizationId);
      const purge = await purgeExpiredHotspotOnRouter();
      return { usage, purge };
    } finally {
      hotspotJob = null;
    }
  })();
  return hotspotJob;
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
