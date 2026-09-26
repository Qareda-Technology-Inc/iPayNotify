import { WireGuardPeer } from '../../models/WireGuardPeer.js';

const TUNNEL_PREFIX = '10.10.10.';
const FIRST_HOST = 2; // .1 is the VPS
const LAST_HOST = 254;

/**
 * Next unused WireGuard tunnel IP in 10.10.10.0/24 (starts at .2).
 * @returns {Promise<string>} e.g. "10.10.10.5"
 */
export async function allocateNextTunnelIp() {
  const peers = await WireGuardPeer.find({}).select('tunnelIp').lean();
  const used = new Set(
    peers
      .map((p) => String(p.tunnelIp || '').trim())
      .filter((ip) => ip.startsWith(TUNNEL_PREFIX))
  );

  for (let host = FIRST_HOST; host <= LAST_HOST; host++) {
    const candidate = `${TUNNEL_PREFIX}${host}`;
    if (!used.has(candidate)) return candidate;
  }

  const err = new Error('WireGuard tunnel IP pool exhausted (10.10.10.2–10.10.10.254)');
  err.status = 507;
  throw err;
}
