import { createRequire } from 'module';
import { parseRouterConnectString } from '../utils/routerConnect.js';
import { withRouterSsh } from './rosSshAdapter.js';
import { canUseWgJump, isWgTunnelHost, wgMikrotikJumpMode } from './wgJump.js';

const require = createRequire(import.meta.url);
const { RouterOSAPI } = require('node-routeros');

function routerPlain(router) {
  return router && typeof router.toObject === 'function'
    ? router.toObject({ getters: false, virtuals: false })
    : router;
}

function routerTransport(router) {
  return String(routerPlain(router)?.transport ?? 'ssh').toLowerCase();
}

function routerHost(router) {
  const raw = String(routerPlain(router)?.host ?? '').trim();
  return parseRouterConnectString(raw, 22).host;
}

/** SSH handshake hang / dead port — worth trying the other transport once. */
function isTransportConnectFailure(err) {
  const m = String(err?.message ?? err);
  /* RouterOS command/config errors mean we already reached the device */
  if (
    /already have|entry already exists|no such item|invalid value|input does not match|failure:|expected end of command/i.test(
      m
    )
  ) {
    return false;
  }
  return /handshake|Timed out while waiting|not speaking SSH|ECONNREFUSED|ETIMEDOUT|EHOSTUNREACH|ENOTFOUND|Cannot connect|connect ECONN|socket hang up|timeout|Cannot reach|WireGuard jump:/i.test(
    m
  );
}

function withForcedTransport(router, transport) {
  const src = routerPlain(router) || {};
  return {
    ...src,
    transport,
    apiUser: src.apiUser || src.sshUser,
    apiPassword: src.apiPassword || src.sshPassword,
    sshUser: src.sshUser || src.apiUser,
    sshPassword: src.sshPassword || src.apiPassword,
  };
}

async function runPreferred(router, fn, { useWgJump = false } = {}) {
  const preferred = routerTransport(router) === 'api' ? 'api' : 'ssh';
  /* Jump path only supports SSH (forwarded TCP + RouterOS SSH). */
  if (useWgJump) {
    return withRouterSsh(withForcedTransport(router, 'ssh'), fn, { useWgJump: true });
  }
  if (preferred === 'ssh') return withRouterSsh(withForcedTransport(router, 'ssh'), fn);
  return withRouterApi(withForcedTransport(router, 'api'), fn);
}

async function runWithTransportFallback(router, fn, { useWgJump = false } = {}) {
  const preferred = useWgJump ? 'ssh' : routerTransport(router) === 'api' ? 'api' : 'ssh';
  const fallback = preferred === 'ssh' ? 'api' : 'ssh';
  try {
    return await runPreferred(router, fn, { useWgJump });
  } catch (e) {
    if (useWgJump || !isTransportConnectFailure(e)) throw e;
    try {
      if (fallback === 'api') {
        return await withRouterApi(withForcedTransport(router, 'api'), fn);
      }
      return await withRouterSsh(withForcedTransport(router, 'ssh'), fn);
    } catch (e2) {
      const host = routerHost(router);
      const err = new Error(
        `${preferred.toUpperCase()} failed (${String(e.message || e).slice(0, 160)}). ` +
          `Fallback ${fallback.toUpperCase()} also failed (${String(e2.message || e2).slice(0, 160)}). ` +
          (isWgTunnelHost(host)
            ? `Host ${host} is a WireGuard tunnel IP — the Node API must reach it via the WG VPS. ` +
              `Set WG_MIKROTIK_JUMP=auto (default) with WG_VPS_* + VPS SSH key, or run the API on the WireGuard VPS.`
            : `From the API host check TCP 22/8728 to ${host}.`)
      );
      err.status = 502;
      err.cause = e2;
      throw err;
    }
  }
}

/**
 * API (8728) or SSH (22).
 * Tunnel hosts (10.66.54.x): prefer SSH jump through WG_VPS so production APIs
 * that are not on the WireGuard VPS can still manage routers.
 */
export async function withRouterMikrotik(router, fn) {
  const host = routerHost(router);
  const jumpMode = wgMikrotikJumpMode();
  const jumpOk = isWgTunnelHost(host) && jumpMode !== 'never' && (await canUseWgJump());

  if (jumpOk && (jumpMode === 'always' || jumpMode === 'auto')) {
    /* Prefer jump for tunnel IPs — direct from Render/etc. always times out. */
    try {
      return await runPreferred(router, fn, { useWgJump: true });
    } catch (jumpErr) {
      if (jumpMode === 'always') throw jumpErr;
      /* Command ran on the router — do not mask as unreachable / retry direct */
      if (!isTransportConnectFailure(jumpErr)) throw jumpErr;
      /* auto: fall back to direct (API co-located on VPS, or jump misconfigured) */
      try {
        return await runWithTransportFallback(router, fn, { useWgJump: false });
      } catch (directErr) {
        const err = new Error(
          `WireGuard jump failed (${String(jumpErr.message || jumpErr).slice(0, 200)}). ` +
            `Direct also failed (${String(directErr.message || directErr).slice(0, 160)}). ` +
            `On the VPS: ping ${host}; sudo wg show; ensure ssh/api are enabled on the router.`
        );
        err.status = 502;
        throw err;
      }
    }
  }

  return runWithTransportFallback(router, fn, { useWgJump: false });
}

/** @param {import('mongoose').Document | Record<string, unknown>} router */
export function normalizeRouterForApi(router) {
  const src = routerPlain(router);
  const rawHost = String(src?.host ?? '').trim();
  const storedApiPort = Number(src?.apiPort) || 8728;
  const parsed = parseRouterConnectString(rawHost, storedApiPort);
  const host = parsed.host;
  const apiUser = String(src?.apiUser ?? src?.sshUser ?? '').trim();
  const apiPassword =
    src?.apiPassword != null && String(src.apiPassword).length > 0
      ? src.apiPassword
      : src?.sshPassword;
  const apiPort = parsed.port;

  if (!host) {
    const e = new Error('Router host is empty. Edit the router and set the IP or hostname.');
    e.status = 400;
    throw e;
  }
  if (!apiUser) {
    const e = new Error('Router API user name is empty.');
    e.status = 400;
    throw e;
  }
  if (apiPassword == null || String(apiPassword).length === 0) {
    const e = new Error(
      'No API password is stored for this router. In Billing → Routers, set "New API password" to match System → Users on the MikroTik, Save changes, then Test connection.'
    );
    e.status = 400;
    throw e;
  }

  return {
    host,
    apiUser,
    apiPassword: String(apiPassword),
    apiPort,
  };
}

export function createRouterConnection(router) {
  const n = normalizeRouterForApi(router);
  return new RouterOSAPI({
    host: n.host,
    port: n.apiPort,
    user: n.apiUser,
    password: n.apiPassword,
    timeout: 30,
  });
}

function isLoginFailure(err) {
  const m = String(err?.message ?? err);
  return /username or password is invalid|cannot log in|invalid user name or password|CANTLOGIN/i.test(
    m
  );
}

function loginRejectedError(n) {
  const err = new Error(
    `MikroTik rejected API login for "${n.apiUser}" at ${n.host}:${n.apiPort}. ` +
      `Use the account from RouterOS System → Users (the management user for API), not a PPPoE or hotspot username. ` +
      `That user’s group must allow API: User Groups → Policies → enable api, read, and write (the built-in full group works for testing). ` +
      `On the router, IP → Services → api must be enabled (often 8728 on the device). ` +
      `If ${n.apiPort} is a relay/public forward, it must map TCP to that API service. ` +
      `If the password was changed on the router, enter it in New API password below, Save changes, then Test connection again.`
  );
  err.status = 502;
  return err;
}

/** @param {object} router Mongoose `Router` document (host, apiUser, apiPassword, apiPort) */
export async function withRouterApi(router, fn) {
  const api = createRouterConnection(router);
  try {
    await api.connect();
  } catch (e) {
    if (isLoginFailure(e)) {
      throw loginRejectedError(normalizeRouterForApi(router));
    }
    throw e;
  }
  try {
    return await fn(api);
  } finally {
    await api.close();
  }
}
