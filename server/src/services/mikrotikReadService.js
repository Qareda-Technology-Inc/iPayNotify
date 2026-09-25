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
 * Hotspot active: user, address, MAC, uptime, traffic.
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
    address: rosFirstStr(r, ['address', 'login-by']) || '—',
    macAddress: rosFirstStr(r, ['mac-address', 'mac']) || '—',
    uptime: rosFirstStr(r, ['uptime', 'session-time']) || '—',
    statistics: formatTrafficStats(bi, bo),
  };
}

/**
 * PPP active: prefer `user` (PPPoE login); avoid dropping rows when only `caller-id` or
 * interface `name` is present. `name` on /ppp/active is often the dynamic interface id, not the secret.
 */
function mapPppActiveRow(r) {
  let secret = rosFirstStr(r, ['user', 'login', 'account']);
  if (!secret) {
    const iface = rosFirstStr(r, ['name', 'interface']);
    const fromIface = /^<pppoe-(.+)>$/i.exec(iface);
    if (fromIface) secret = fromIface[1];
    else if (iface && !/^</.test(iface)) secret = iface;
  }
  if (!secret) {
    secret = rosFirstStr(r, ['caller-id', 'caller-id-value']);
  }
  const id = r['.id'] ?? r.id ?? r.numbers ?? null;
  if (!secret) {
    if (id != null && String(id).trim() !== '') {
      secret = `(session ${String(id).trim()})`;
    } else {
      return null;
    }
  }
  const address = rosFirstStr(r, [
    'address',
    'remote-address',
    'client-address',
    'local-address',
  ]);
  const uptime = rosFirstStr(r, ['uptime', 'session-time', 'last-link-up-time']);
  return {
    id,
    secret,
    address: address || '—',
    uptime: uptime || '—',
    service: rosFirstStr(r, ['service']) || '—',
    callerId: rosFirstStr(r, ['caller-id', 'caller-id-value']) || '—',
  };
}

function mapHotspotUserRow(r) {
  const name = rosFirstStr(r, ['name', 'user']);
  if (!name) return null;
  return {
    id: r['.id'] ?? r.numbers ?? null,
    name,
    profile: rosFirstStr(r, ['profile']) || '—',
    disabled: r.disabled === 'true' || r.disabled === true,
    comment: rosFirstStr(r, ['comment']) || '',
    limitUptime: rosFirstStr(r, ['limit-uptime']) || '',
    bytesIn: rosFirstNumber(r, ['bytes-in']),
    bytesOut: rosFirstNumber(r, ['bytes-out']),
  };
}

function mapPppSecretRow(r) {
  const name = rosFirstStr(r, ['name']);
  if (!name) return null;
  return {
    id: r['.id'] ?? r.numbers ?? null,
    name,
    profile: rosFirstStr(r, ['profile']) || '—',
    service: rosFirstStr(r, ['service']) || '—',
    disabled: r.disabled === 'true' || r.disabled === true,
    comment: rosFirstStr(r, ['comment']) || '',
    remoteAddress: rosFirstStr(r, ['remote-address']) || '',
  };
}

function mapRouterDetails(identityRows, resourceRows, boardRows) {
  const id = identityRows?.[0] || {};
  const res = resourceRows?.[0] || {};
  const board = boardRows?.[0] || {};
  const freeMem = rosFirstNumber(res, ['free-memory', 'free_memory']);
  const totalMem = rosFirstNumber(res, ['total-memory', 'total_memory']);
  return {
    identity: rosFirstStr(id, ['name']) || 'MikroTik',
    version: rosFirstStr(res, ['version']) || '—',
    boardName: rosFirstStr(res, ['board-name']) || rosFirstStr(board, ['board-name', 'model']) || '—',
    architecture: rosFirstStr(res, ['architecture-name', 'cpu']) || '—',
    uptime: rosFirstStr(res, ['uptime']) || '—',
    cpuLoad: (() => {
      const n = rosFirstNumber(res, ['cpu-load', 'cpu']);
      return Number.isFinite(n) ? n : null;
    })(),
    freeMemoryBytes: Number.isFinite(freeMem) ? freeMem : null,
    totalMemoryBytes: Number.isFinite(totalMem) ? totalMem : null,
    platform: rosFirstStr(res, ['platform']) || '—',
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

/** Hotspot + PPP on one SSH/API session (avoids two handshakes per router). */
async function readActiveSessionsOnRouter(router) {
  return withRouterMikrotik(router, async (api) => {
    let hotspotActive = [];
    let pppActive = [];
    let details = null;
    const errs = [];
    try {
      const rawId = await api.write('/system/identity/print');
      let rawRes = [];
      try {
        rawRes = await api.write('/system/resource/print');
      } catch {
        /* optional */
      }
      details = mapRouterDetails(normalizePrintRows(rawId), normalizePrintRows(rawRes), []);
    } catch (e) {
      errs.push(`Details: ${String(e.message || e)}`);
    }
    try {
      const rows = await hs.printHotspotActive(api);
      hotspotActive = rows.map(mapHotspotActiveRow).filter(Boolean);
    } catch (e) {
      errs.push(`Hotspot: ${String(e.message || e)}`);
    }
    try {
      const rows = await ppp.printPppActive(api);
      pppActive = rows.map(mapPppActiveRow).filter(Boolean);
    } catch (e) {
      errs.push(`PPP: ${String(e.message || e)}`);
    }
    return {
      details,
      hotspotActive,
      pppActive,
      error: errs.length ? errs.join(' ') : null,
    };
  });
}

/**
 * Full live snapshot from one site: router details + registered users + active sessions.
 * One MikroTik session for everything.
 */
export async function getRouterLiveSnapshot(routerId, organizationId) {
  const router = await loadRouter(routerId, organizationId);
  const at = new Date().toISOString();
  const label = routerDisplayName(router) || router.name || router.host || String(router._id);

  return withRouterMikrotik(router, async (api) => {
    const errs = [];
    let details = {
      identity: '—',
      version: '—',
      boardName: '—',
      architecture: '—',
      uptime: '—',
      cpuLoad: null,
      freeMemoryBytes: null,
      totalMemoryBytes: null,
      platform: '—',
    };
    let pppSecrets = [];
    let hotspotUsers = [];
    let pppActive = [];
    let hotspotActive = [];

    try {
      const rawId = await api.write('/system/identity/print');
      let rawRes = [];
      let rawBoard = [];
      try {
        rawRes = await api.write('/system/resource/print');
      } catch (e) {
        errs.push(`Resource: ${String(e.message || e)}`);
      }
      try {
        rawBoard = await api.write('/system/routerboard/print');
      } catch {
        /* CHR / some boards lack routerboard */
      }
      details = mapRouterDetails(
        normalizePrintRows(rawId),
        normalizePrintRows(rawRes),
        normalizePrintRows(rawBoard)
      );
    } catch (e) {
      errs.push(`Identity: ${String(e.message || e)}`);
    }

    try {
      const rows = await ppp.printPppSecrets(api);
      pppSecrets = rows.map(mapPppSecretRow).filter(Boolean);
    } catch (e) {
      errs.push(`PPP secrets: ${String(e.message || e)}`);
    }

    try {
      const rows = await hs.printHotspotUsers(api);
      hotspotUsers = rows.map(mapHotspotUserRow).filter(Boolean);
    } catch (e) {
      errs.push(`Hotspot users: ${String(e.message || e)}`);
    }

    try {
      const rows = await ppp.printPppActive(api);
      pppActive = rows.map(mapPppActiveRow).filter(Boolean);
    } catch (e) {
      errs.push(`PPP active: ${String(e.message || e)}`);
    }

    try {
      const rows = await hs.printHotspotActive(api);
      hotspotActive = rows.map(mapHotspotActiveRow).filter(Boolean);
    } catch (e) {
      errs.push(`Hotspot active: ${String(e.message || e)}`);
    }

    return {
      at,
      routerId: String(router._id),
      routerName: label,
      host: router.host,
      transport: router.transport || 'ssh',
      reachable: !errs.length || Boolean(details.identity && details.identity !== '—'),
      details,
      counts: {
        pppSecrets: pppSecrets.length,
        hotspotUsers: hotspotUsers.length,
        pppActive: pppActive.length,
        hotspotActive: hotspotActive.length,
      },
      pppSecrets,
      hotspotUsers,
      pppActive,
      hotspotActive,
      error: errs.length ? errs.join(' · ') : null,
    };
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
  const routers = await Router.find(q).sort({ createdAt: 1 });
  const at = new Date().toISOString();

  const rows = await Promise.all(
    routers.map(async (r) => {
      const id = String(r._id);
      const label = routerDisplayName(r) || r.name || r.host || id;
      try {
        const session = await readActiveSessionsOnRouter(r);
        return {
          routerId: id,
          routerName: label,
          host: r.host,
          reachable: !session.error || session.hotspotActive.length > 0 || session.pppActive.length > 0,
          details: session.details,
          hotspotActive: session.hotspotActive,
          pppActive: session.pppActive,
          error: session.error,
        };
      } catch (e) {
        return {
          routerId: id,
          routerName: label,
          host: r.host,
          reachable: false,
          hotspotActive: [],
          pppActive: [],
          error: String(e.message || e),
        };
      }
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

/** @deprecated alias — kept for any older imports */
export const getRouterLiveDetails = getRouterLiveSnapshot;
