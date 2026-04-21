import { withRouterMikrotik } from '../mikrotik/routeros.js';
import * as ppp from '../mikrotik/pppoeCommands.js';
import * as hs from '../mikrotik/hotspotCommands.js';
import { normalizePrintRows } from '../mikrotik/helpers.js';
import mongoose from 'mongoose';
import { Router } from '../models/index.js';
import { routerDisplayName } from '../utils/routerLabel.js';

async function loadRouter(routerId, organizationId) {
  const q = { _id: routerId };
  if (
    organizationId != null &&
    String(organizationId).trim() &&
    mongoose.isValidObjectId(String(organizationId).trim())
  ) {
    q.organizationId = String(organizationId).trim();
  }
  const r = await Router.findOne(q);
  if (!r) {
    const err = new Error('Router not found');
    err.status = 404;
    throw err;
  }
  return r;
}

/** PPP profile names as they exist on the router (for dropdowns / validation). */
export async function getRouterPppProfiles(routerId, organizationId) {
  const router = await loadRouter(routerId, organizationId);
  return withRouterMikrotik(router, async (api) => {
    const raw = await api.write('/ppp/profile/print');
    return normalizePrintRows(raw).map((p) => ({
      id: p['.id'],
      name: p.name,
      localAddress: p['local-address'],
    }));
  });
}

/** PPP secrets on the router (read-only; passwords omitted). */
export async function getRouterPppSecrets(routerId, organizationId) {
  const router = await loadRouter(routerId, organizationId);
  return withRouterMikrotik(router, async (api) => {
    const rows = await ppp.printPppSecrets(api);
    return rows.map((r) => ({
      id: r['.id'],
      name: r.name,
      profile: r.profile,
      service: r.service,
      disabled: r.disabled === 'true' || r.disabled === true,
      comment: r.comment,
    }));
  });
}

export async function pingRouterApi(routerId, organizationId) {
  const router = await loadRouter(routerId, organizationId);
  return withRouterMikrotik(router, async (api) => {
    const raw = await api.write('/system/identity/print');
    const rows = normalizePrintRows(raw);
    const identity = rows[0]?.name || 'MikroTik';
    return { identity };
  });
}

/** Case-insensitive key lookup (RouterOS API uses lowercase; SSH parsers may vary). */
function rosRowGet(r, key) {
  if (!r || typeof r !== 'object') return undefined;
  if (Object.prototype.hasOwnProperty.call(r, key)) return r[key];
  const lower = String(key).toLowerCase();
  for (const k of Object.keys(r)) {
    if (String(k).toLowerCase() === lower) return r[k];
  }
  return undefined;
}

function rosFirstStr(r, keys) {
  for (const k of keys) {
    const v = rosRowGet(r, k);
    if (v != null && String(v).trim() !== '') return String(v).trim();
  }
  return '';
}

function rosFirstNumber(r, keys) {
  for (const k of keys) {
    const v = rosRowGet(r, k);
    if (v == null || v === '') continue;
    const n = Number(v);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return NaN;
}

function formatTrafficStats(bytesInRaw, bytesOutRaw) {
  const bi = Number(bytesInRaw);
  const bo = Number(bytesOutRaw);
  const hasIn = Number.isFinite(bi) && bi >= 0;
  const hasOut = Number.isFinite(bo) && bo >= 0;
  if (!hasIn && !hasOut) return '—';
  const fmt = (n) => {
    if (!Number.isFinite(n) || n <= 0) return '0 B';
    if (n < 1024) return `${n} B`;
    if (n < 1048576) return `${(n / 1024).toFixed(1)} KiB`;
    if (n < 1073741824) return `${(n / 1048576).toFixed(1)} MiB`;
    return `${(n / 1073741824).toFixed(2)} GiB`;
  };
  return `↓ ${fmt(hasIn ? bi : 0)} · ↑ ${fmt(hasOut ? bo : 0)}`;
}

/**
 * Hotspot active: only user, uptime, traffic (bytes in/out). Drops empty placeholder rows.
 */
function mapHotspotActiveRow(r) {
  const user = rosFirstStr(r, [
    'user',
    'user-name',
    'username',
    'name',
    'mac-address',
    'caller-id',
  ]);
  if (!user) return null;
  const bi = rosFirstNumber(r, ['bytes-in', 'bytes_in', 'rx-byte']);
  const bo = rosFirstNumber(r, ['bytes-out', 'bytes_out', 'tx-byte']);
  return {
    id: r['.id'] ?? r.numbers ?? null,
    user,
    uptime: rosFirstStr(r, ['uptime', 'session-time']) || '—',
    statistics: formatTrafficStats(bi, bo),
  };
}

/**
 * PPP active: prefer `user` (PPPoE login); avoid dropping rows when only `caller-id` or
 * interface `name` is present. `name` on /ppp/active is often the dynamic interface id, not the secret.
 */
function mapPppActiveRow(r) {
  let secret = rosFirstStr(r, [
    'user',
    'login',
    'caller-id',
    'caller-id-value',
    'name',
    'interface',
  ]);
  const id = r['.id'] ?? r.numbers ?? null;
  if (!secret) {
    if (id != null && String(id).trim() !== '') {
      secret = `(session ${String(id).trim()})`;
    } else {
      return null;
    }
  }
  const address = rosFirstStr(r, ['address', 'remote-address', 'local-address']);
  const uptime = rosFirstStr(r, ['uptime', 'session-time', 'last-link-up-time']);
  return {
    id,
    secret,
    address: address || '—',
    uptime: uptime || '—',
  };
}

export async function getRouterHotspotActive(routerId, organizationId) {
  const router = await loadRouter(routerId, organizationId);
  return withRouterMikrotik(router, async (api) => {
    const rows = await hs.printHotspotActive(api);
    return rows.map(mapHotspotActiveRow).filter(Boolean);
  });
}

export async function getRouterPppActive(routerId, organizationId) {
  const router = await loadRouter(routerId, organizationId);
  return withRouterMikrotik(router, async (api) => {
    const rows = await ppp.printPppActive(api);
    return rows.map(mapPppActiveRow).filter(Boolean);
  });
}

/**
 * Hotspot + PPP active sessions for every router (best-effort; errors per router).
 * Routers are queried in parallel for faster dashboard refresh.
 */
export async function listActiveSessionsAllRouters(organizationId) {
  const q =
    organizationId != null &&
    String(organizationId).trim() &&
    mongoose.isValidObjectId(String(organizationId).trim())
      ? { organizationId: String(organizationId).trim() }
      : {};
  const routers = await Router.find(q).sort({ createdAt: 1 }).lean();
  const at = new Date().toISOString();

  const rows = await Promise.all(
    routers.map(async (r) => {
      const id = String(r._id);
      const label = routerDisplayName(r) || r.name || r.host || id;
      let hotspotActive = [];
      let pppActive = [];
      const errs = [];
      try {
        hotspotActive = await getRouterHotspotActive(id, organizationId);
      } catch (e) {
        errs.push(`Hotspot: ${String(e.message || e)}`);
      }
      try {
        pppActive = await getRouterPppActive(id, organizationId);
      } catch (e) {
        errs.push(`PPP: ${String(e.message || e)}`);
      }
      return {
        routerId: id,
        routerName: label,
        host: r.host,
        hotspotActive,
        pppActive,
        error: errs.length ? errs.join(' ') : null,
      };
    })
  );

  let totalHotspot = 0;
  let totalPpp = 0;
  for (const row of rows) {
    totalHotspot += row.hotspotActive.length;
    totalPpp += row.pppActive.length;
  }

  return {
    at,
    totals: {
      hotspot: totalHotspot,
      ppp: totalPpp,
      all: totalHotspot + totalPpp,
    },
    routers: rows,
  };
}
