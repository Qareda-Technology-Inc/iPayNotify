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

function looksLikeMac(s) {
  return /^([0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/i.test(String(s || '').trim());
}

function formatBytes(n) {
  if (!Number.isFinite(n) || n < 0) return '';
  if (n < 1024) return `${Math.round(n)} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KiB`;
  if (n < 1073741824) return `${(n / 1048576).toFixed(1)} MiB`;
  return `${(n / 1073741824).toFixed(2)} GiB`;
}

function formatQuota(bytesIn, bytesOut, limitTotal) {
  const bi = Number(bytesIn);
  const bo = Number(bytesOut);
  const used =
    (Number.isFinite(bi) ? bi : 0) + (Number.isFinite(bo) ? bo : 0);
  const limit = Number(limitTotal);
  const hasUsed = Number.isFinite(bi) || Number.isFinite(bo);
  const hasLimit = Number.isFinite(limit) && limit > 0;
  if (!hasUsed && !hasLimit) return '—';
  if (hasLimit) return `${formatBytes(used)} / ${formatBytes(limit)}`;
  return formatBytes(used);
}

/**
 * Hotspot active: real username only (never use MAC as the name).
 */
function mapHotspotActiveRow(r) {
  let user = '';
  for (const k of ['user', 'user-name', 'username', 'name']) {
    const v = rosFirstStr(r, [k]);
    if (v && !looksLikeMac(v)) {
      user = v;
      break;
    }
  }

  const mac = rosFirstStr(r, ['mac-address', 'mac']);
  const address = rosFirstStr(r, ['address']);
  const bi = rosFirstNumber(r, ['bytes-in', 'bytes_in', 'rx-byte']);
  const bo = rosFirstNumber(r, ['bytes-out', 'bytes_out', 'tx-byte']);
  const limitTotal = rosFirstNumber(r, ['limit-bytes-total', 'limit-bytes']);

  if (!user && !address && !mac) return null;

  const timeLeft = rosFirstStr(r, ['session-time-left', 'limit-uptime']);

  return {
    id: r['.id'] ?? r.id ?? r.numbers ?? null,
    user: user || '—',
    address: address || '—',
    macAddress: mac && looksLikeMac(mac) ? mac : mac || '—',
    uptime: rosFirstStr(r, ['uptime', 'session-time']) || '—',
    timeLeft: timeLeft || '',
    quota: formatQuota(bi, bo, limitTotal),
    statistics: formatTrafficStats(bi, bo),
  };
}

/** Fill blank hotspot logins and total quota from /ip hotspot user (matched by name or MAC). */
function mapHotspotActiveList(activeRows, userRows) {
  const byName = new Map();
  const byMac = new Map();
  for (const u of userRows || []) {
    const name = String(u?.name || u?.user || '').trim();
    const mac = String(u?.['mac-address'] || u?.mac || '').trim().toLowerCase();
    if (name) byName.set(name.toLowerCase(), u);
    if (looksLikeMac(mac)) byMac.set(mac, u);
  }
  return (activeRows || [])
    .map((raw) => {
      const row = mapHotspotActiveRow(raw);
      if (!row) return null;
      const named = row.user && row.user !== '—' && !looksLikeMac(row.user) ? row.user : '';
      const mac = String(raw?.['mac-address'] || raw?.mac || row.macAddress || '')
        .trim()
        .toLowerCase();
      const account =
        (named && byName.get(named.toLowerCase())) || (looksLikeMac(mac) ? byMac.get(mac) : null) || null;
      if (account) {
        const name = String(account.name || account.user || '').trim();
        if (name && !looksLikeMac(name)) row.user = name;
        const bi = rosFirstNumber(account, ['bytes-in', 'bytes_in']);
        const bo = rosFirstNumber(account, ['bytes-out', 'bytes_out']);
        const limit = rosFirstNumber(account, ['limit-bytes-total', 'limit-bytes-in', 'limit-bytes']);
        const sbi = rosFirstNumber(raw, ['bytes-in', 'bytes_in', 'rx-byte']);
        const sbo = rosFirstNumber(raw, ['bytes-out', 'bytes_out', 'tx-byte']);
        const usedBi = Number.isFinite(bi) && bi > 0 ? bi : sbi;
        const usedBo = Number.isFinite(bo) && bo > 0 ? bo : sbo;
        const hasLimit = Number.isFinite(limit) && limit > 0;
        const hasUsed =
          (Number.isFinite(usedBi) && usedBi > 0) || (Number.isFinite(usedBo) && usedBo > 0);
        if (hasLimit || hasUsed) row.quota = formatQuota(usedBi, usedBo, limit);
      }
      return row;
    })
    .filter(Boolean);
}

function pppoeLoginFromName(iface) {
  const s = String(iface || '').trim().replace(/^"|"$/g, '');
  const wrapped = /^<pppoe-(.+)>$/i.exec(s);
  if (wrapped) return wrapped[1];
  const open = /^<pppoe-([^>]+)>?$/i.exec(s);
  if (open) return open[1];
  return '';
}

/**
 * PPPoE active only. Login is `user`, or the `<pppoe-login>` interface name.
 * Caller-id is a MAC and is not the username.
 */
function mapPppActiveRow(r) {
  const service = rosFirstStr(r, ['service']).toLowerCase();
  if (service && !service.startsWith('pppoe')) return null;
  const iface = rosFirstStr(r, ['name', 'interface']);
  if (/^<(?:pptp|l2tp|sstp|ovpn)-/i.test(iface)) return null;

  let secret = rosFirstStr(r, ['user', 'login', 'account']);
  if (looksLikeMac(secret) || /^</.test(secret)) secret = '';
  if (!secret) secret = pppoeLoginFromName(iface);
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
    identity: rosFirstStr(id, ['name']) || '—',
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
      const [activeRows, userRows] = await Promise.all([
        hs.printHotspotActive(api),
        hs.printHotspotUsers(api).catch(() => []),
      ]);
      hotspotActive = mapHotspotActiveList(activeRows, userRows);
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
    let hotspotUsersRaw = [];
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
      hotspotUsersRaw = await hs.printHotspotUsers(api);
      hotspotUsers = hotspotUsersRaw.map(mapHotspotUserRow).filter(Boolean);
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
      hotspotActive = mapHotspotActiveList(rows, hotspotUsersRaw);
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
