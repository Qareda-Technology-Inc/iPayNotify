import { config } from '../../config.js';
import { WireGuardPeer } from '../../models/WireGuardPeer.js';
import { allocateNextTunnelIp, isValidTunnelIp } from './allocateTunnelIp.js';
import { syncWireGuardPeerToVps } from './wgPeerSync.js';
import { isWireGuardFullyConfigured } from './wgVpsSshKey.js';

const WG_PUBKEY_RE = /^[A-Za-z0-9+/]{42,44}={0,2}$/;
const IPV4_CIDR_RE =
  /^(?:(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\/(?:3[0-2]|[12]?\d)$/;

/**
 * Idempotent WireGuard peer registration (DB + VPS sync).
 * @param {{ publicKey: string, siteName: string, lanSubnet?: string, preferredTunnelIp?: string }} input
 */
export async function registerWireGuardPeer(input) {
  const wg = config.wireguard;
  if (!wg?.serverPublicKey || !wg?.endpoint) {
    const err = new Error('WireGuard registration is not configured on the server');
    err.status = 503;
    throw err;
  }
  if (!(await isWireGuardFullyConfigured())) {
    const err = new Error(
      'WireGuard VPS sync is not ready. Set WG_VPS_HOST / WG_SERVER_PUBLIC_KEY / WG_ENDPOINT and generate an SSH key in WireGuard admin.'
    );
    err.status = 503;
    throw err;
  }

  const publicKey = String(input.publicKey || '').trim();
  const siteName = String(input.siteName || '').trim();
  const lanSubnet = String(input.lanSubnet || '').trim();
  const preferredTunnelIp = String(input.preferredTunnelIp || '').trim();

  if (!publicKey || !WG_PUBKEY_RE.test(publicKey)) {
    const err = new Error('Valid WireGuard publicKey required');
    err.status = 400;
    throw err;
  }
  if (!siteName || siteName.length < 2 || siteName.length > 80) {
    const err = new Error('siteName is required (2–80 characters)');
    err.status = 400;
    throw err;
  }
  if (lanSubnet && !IPV4_CIDR_RE.test(lanSubnet)) {
    const err = new Error('lanSubnet must be IPv4 CIDR e.g. 192.168.88.0/24');
    err.status = 400;
    throw err;
  }

  let peer = await WireGuardPeer.findOne({ publicKey });
  let existing = false;
  if (peer) {
    existing = true;
    peer.lastSeen = new Date();
    if (siteName && siteName !== peer.siteName) peer.siteName = siteName;
    if (lanSubnet !== peer.lanSubnet) peer.lanSubnet = lanSubnet;
  } else {
    /* Re-link: keep the tunnel IP we are already connected through when free */
    let tunnelIp = '';
    if (preferredTunnelIp && isValidTunnelIp(preferredTunnelIp, 'router')) {
      const taken = await WireGuardPeer.findOne({ tunnelIp: preferredTunnelIp }).lean();
      if (!taken) tunnelIp = preferredTunnelIp;
    }
    if (!tunnelIp) tunnelIp = await allocateNextTunnelIp({ kind: 'router' });
    try {
      peer = await WireGuardPeer.create({
        siteName,
        publicKey,
        tunnelIp,
        lanSubnet: lanSubnet || '',
        kind: 'router',
        status: 'active',
        lastSeen: new Date(),
      });
    } catch (e) {
      if (e?.code === 11000) {
        peer = await WireGuardPeer.findOne({ publicKey });
        if (!peer) {
          peer = await WireGuardPeer.findOne({ tunnelIp });
          if (peer && peer.publicKey !== publicKey) {
            const err = new Error(
              `Tunnel IP ${tunnelIp} is already registered to another peer. Use a different address or remove the old peer first.`
            );
            err.status = 409;
            throw err;
          }
        }
        if (!peer) throw e;
        existing = true;
        peer.lastSeen = new Date();
        if (siteName) peer.siteName = siteName;
        if (lanSubnet !== peer.lanSubnet) peer.lanSubnet = lanSubnet;
      } else {
        throw e;
      }
    }
  }

  try {
    await syncWireGuardPeerToVps({
      publicKey: peer.publicKey,
      tunnelIp: peer.tunnelIp,
      lanSubnet: peer.lanSubnet,
    });
    peer.lastSyncError = '';
    peer.status = 'active';
    await peer.save();
  } catch (e) {
    peer.status = 'error';
    peer.lastSyncError = e?.message || 'sync_failed';
    await peer.save();
    const err = new Error(e?.message || 'Failed to push peer to VPS');
    err.status = 502;
    err.peer = peer;
    throw err;
  }

  return {
    peer,
    existing,
    serverPublicKey: wg.serverPublicKey,
    endpoint: wg.endpoint,
    clientAllowedIps: wg.clientAllowedIps || wg.tunnelPool || '10.66.54.0/24',
  };
}
