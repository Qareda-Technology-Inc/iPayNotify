import { createRequire } from 'module';
import { parseRouterConnectString } from '../utils/routerConnect.js';
import { withRouterSsh } from './rosSshAdapter.js';

const require = createRequire(import.meta.url);
const { RouterOSAPI } = require('node-routeros');

function routerTransport(router) {
  const src =
    router && typeof router.toObject === 'function'
      ? router.toObject({ getters: false, virtuals: false })
      : router;
  return String(src?.transport ?? 'ssh').toLowerCase();
}

/** API (8728) or SSH (22) — same RouterOS commands, different transport. */
export async function withRouterMikrotik(router, fn) {
  if (routerTransport(router) === 'ssh') {
    return withRouterSsh(router, fn);
  }
  return withRouterApi(router, fn);
}

/** @param {import('mongoose').Document | Record<string, unknown>} router */
export function normalizeRouterForApi(router) {
  const src =
    router && typeof router.toObject === 'function'
      ? router.toObject({ getters: false, virtuals: false })
      : router;
  const rawHost = String(src?.host ?? '').trim();
  const storedApiPort = Number(src?.apiPort) || 8728;
  const parsed = parseRouterConnectString(rawHost, storedApiPort);
  const host = parsed.host;
  const apiUser = String(src?.apiUser ?? '').trim();
  const apiPassword = src?.apiPassword;
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
  /* 502 = upstream MikroTik; never use 401 here or the SPA clears the admin JWT. */
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
