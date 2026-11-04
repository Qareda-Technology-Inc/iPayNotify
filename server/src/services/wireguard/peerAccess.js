import { WireGuardPeer } from '../../models/WireGuardPeer.js';
import { removeWireGuardPeerFromVps, syncWireGuardPeerToVps } from './wgPeerSync.js';

/**
 * Turn a peer's tunnel on or off on the VPS and record the state.
 * Disabling removes the peer from wg0, so its tunnel IP is unreachable for everyone
 * (including the billing app) until it is enabled again.
 * @param {import('mongoose').Document} peer WireGuardPeer document
 * @param {{ enabled: boolean, reason?: 'manual' | 'subscription_expired' | 'org_unpaid' }} opts
 */
export async function setPeerAccess(peer, { enabled, reason = 'manual' }) {
  try {
    if (enabled) {
      await syncWireGuardPeerToVps({
        publicKey: peer.publicKey,
        tunnelIp: peer.tunnelIp,
        lanSubnet: peer.lanSubnet,
      });
      peer.status = 'active';
      peer.disabledReason = '';
      peer.lastSeen = new Date();
    } else {
      await removeWireGuardPeerFromVps({ publicKey: peer.publicKey });
      peer.status = 'disabled';
      peer.disabledReason = reason;
    }
    peer.lastSyncError = '';
    await peer.save();
    return peer;
  } catch (e) {
    peer.lastSyncError = e?.message || 'vps_sync_failed';
    await peer.save();
    throw e;
  }
}

/**
 * WireGuard peer that carries a billing Router's tunnel (claimed link first, else tunnel IP = host).
 * @param {{ _id: unknown, host?: string }} router
 */
export async function findPeerForRouter(router) {
  if (!router) return null;
  const host = String(router.host || '').trim();
  return WireGuardPeer.findOne({
    kind: { $ne: 'client' },
    $or: [{ claimedRouterId: router._id }, ...(host ? [{ tunnelIp: host }] : [])],
  }).sort({ claimedRouterId: -1 });
}

/**
 * Line a phone/laptop profile up with its organisation: off while that organisation is suspended
 * for an unpaid bill, back on when it is not (only if it was switched off for that reason).
 * @param {import('mongoose').Document} peer WireGuardPeer document (kind client)
 */
export async function applyOrgStateToPeer(peer) {
  if (peer.kind !== 'client' || !peer.organizationId) return { changed: false };
  const { Organization } = await import('../../models/index.js');
  const org = await Organization.findById(peer.organizationId).select('status statusReason').lean();
  const locked = org?.status === 'suspended' && org?.statusReason === 'unpaid';
  if (locked && peer.status !== 'disabled') {
    await setPeerAccess(peer, { enabled: false, reason: 'org_unpaid' });
    return { changed: true, enabled: false };
  }
  if (!locked && peer.status === 'disabled' && peer.disabledReason === 'org_unpaid') {
    await setPeerAccess(peer, { enabled: true });
    return { changed: true, enabled: true };
  }
  return { changed: false };
}
