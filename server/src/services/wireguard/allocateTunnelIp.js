import { WireGuardPeer } from '../../models/WireGuardPeer.js';
import { config } from '../../config.js';

/** .1 is the VPS. Routers: .2–.199. Phone/laptop clients: .200–.254. */
export const ROUTER_FIRST_HOST = 2;
export const ROUTER_LAST_HOST = 199;
export const CLIENT_FIRST_HOST = 200;
export const CLIENT_LAST_HOST = 254;

function tunnelPrefix() {
  return config.wireguard?.tunnelPrefix || '10.66.54.';
}

function tunnelPoolLabel() {
  return config.wireguard?.tunnelPool || '10.66.54.0/24';
}

function rangeForKind(kind) {
  const isClient = kind === 'client';
  return {
    first: isClient ? CLIENT_FIRST_HOST : ROUTER_FIRST_HOST,
    last: isClient ? CLIENT_LAST_HOST : ROUTER_LAST_HOST,
    label: isClient ? 'phone/laptop' : 'router',
  };
}

/**
 * Next unused WireGuard tunnel IP in the kind’s slice of the /24.
 * @param {{ kind?: 'router'|'client' }} [opts]
 * @returns {Promise<string>} e.g. "10.66.54.5" or "10.66.54.200"
 */
export async function allocateNextTunnelIp(opts = {}) {
  const kind = opts.kind === 'client' ? 'client' : 'router';
  const { first, last, label } = rangeForKind(kind);
  const prefix = tunnelPrefix();
  const peers = await WireGuardPeer.find({}).select('tunnelIp').lean();
  const used = new Set(
    peers
      .map((p) => String(p.tunnelIp || '').trim())
      .filter((ip) => ip.startsWith(prefix))
  );

  for (let host = first; host <= last; host++) {
    const candidate = `${prefix}${host}`;
    if (!used.has(candidate)) return candidate;
  }

  const pool = tunnelPoolLabel();
  const err = new Error(
    `WireGuard ${label} IP pool exhausted (${prefix}${first}–${prefix}${last}; pool ${pool})`
  );
  err.status = 507;
  throw err;
}

/** Validate optional manual tunnel IP for a peer kind. */
export function isValidTunnelIp(ip, kind = 'router') {
  const { first, last } = rangeForKind(kind === 'client' ? 'client' : 'router');
  const prefix = tunnelPrefix();
  const s = String(ip || '').trim();
  if (!s.startsWith(prefix)) return false;
  const host = Number(s.slice(prefix.length));
  return Number.isInteger(host) && host >= first && host <= last;
}

export function tunnelIpRangeHint(kind = 'router') {
  const prefix = tunnelPrefix();
  const { first, last, label } = rangeForKind(kind === 'client' ? 'client' : 'router');
  return `${label} ${prefix}${first}–${prefix}${last}`;
}

export function tunnelPoolSlices() {
  const prefix = tunnelPrefix();
  return {
    pool: tunnelPoolLabel(),
    vps: `${prefix}1`,
    routers: `${prefix}${ROUTER_FIRST_HOST}–${prefix}${ROUTER_LAST_HOST}`,
    clients: `${prefix}${CLIENT_FIRST_HOST}–${prefix}${CLIENT_LAST_HOST}`,
  };
}
