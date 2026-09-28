import { Router as MikrotikRouter } from '../../models/index.js';
import { WireGuardPeer } from '../../models/WireGuardPeer.js';
import { withRouterMikrotik } from '../../mikrotik/routeros.js';
import { assertOrgLimit } from '../orgLimitsService.js';
import { config } from '../../config.js';
import { syncWireGuardPeerToVps } from './wgPeerSync.js';

const VPN_MGMT_COMMENT = 'QareFi: VPN management';

/**
 * After .rsc self-register: attach SSH/API credentials and create billing Router on tunnel IP.
 * Cloud reaches the router via WireGuard jump — no LAN / localhost required.
 */
export async function claimWireGuardPeerAsRouter({
  organizationId,
  peerId,
  username,
  password,
  siteName,
  transport = 'ssh',
  allowRemoteAccess = true,
}) {
  const user = String(username || '').trim();
  const pass = password != null ? String(password) : '';
  if (!user || !pass) {
    const err = new Error('Username and password are required');
    err.status = 400;
    throw err;
  }

  const peer = await WireGuardPeer.findById(peerId);
  if (!peer || peer.kind === 'client') {
    const err = new Error('WireGuard peer not found');
    err.status = 404;
    throw err;
  }
  if (peer.status === 'disabled') {
    const err = new Error('This WireGuard peer is disabled');
    err.status = 400;
    throw err;
  }
  if (
    peer.organizationId &&
    organizationId &&
    String(peer.organizationId) !== String(organizationId)
  ) {
    const err = new Error('This peer belongs to another organization');
    err.status = 403;
    throw err;
  }

  await assertOrgLimit(organizationId, 'routers');

  const name = String(siteName || peer.siteName || '').trim() || peer.tunnelIp;
  const t = String(transport || 'ssh').toLowerCase() === 'api' ? 'api' : 'ssh';
  const host = peer.tunnelIp;

  try {
    await syncWireGuardPeerToVps({
      publicKey: peer.publicKey,
      tunnelIp: peer.tunnelIp,
      lanSubnet: peer.lanSubnet,
    });
  } catch (e) {
    const err = new Error(
      `Could not refresh the WireGuard peer for ${host} on the VPS: ${e?.message || e}`
    );
    err.status = Number(e?.status) || 502;
    throw err;
  }

  const ephemeral = {
    host,
    transport: t,
    apiPort: 8728,
    sshPort: 22,
    sshUser: user,
    sshPassword: pass,
    apiUser: user,
    apiPassword: pass,
  };

  let identity = name;
  try {
    await withRouterMikrotik(ephemeral, async (api) => {
      try {
        const rows = await api.write('/system/identity/print');
        const list = Array.isArray(rows) ? rows : rows ? [rows] : [];
        const n = list[0]?.name || list[0]?.['name'];
        if (n) identity = String(n).trim() || name;
      } catch {
        /* keep name */
      }

      if (allowRemoteAccess) {
        try {
          const filterRows = await api.write('/ip/firewall/filter/print');
          const fr = Array.isArray(filterRows) ? filterRows : filterRows ? [filterRows] : [];
          const has = fr.some((r) => String(r?.comment || '') === VPN_MGMT_COMMENT);
          if (!has) {
            const pool = config.wireguard?.tunnelPool || '10.66.54.0/24';
            try {
              await api.write([
                '/ip/firewall/filter/add',
                '=chain=input',
                '=action=accept',
                `=src-address=${pool}`,
                `=comment=${VPN_MGMT_COMMENT}`,
                '=place-before=0',
              ]);
            } catch {
              await api.write([
                '/ip/firewall/filter/add',
                '=chain=input',
                '=action=accept',
                `=src-address=${pool}`,
                `=comment=${VPN_MGMT_COMMENT}`,
              ]);
            }
          }
        } catch (e) {
          console.warn('[claim-peer] VPN firewall skipped:', e?.message || e);
        }
      }
    });
  } catch (e) {
    const raw = String(e?.message || e);
    const noRoute = /no route to host|channel open failure|EHOSTUNREACH/i.test(raw);
    const err = new Error(
      noRoute
        ? `Router ${host} is registered, but the VPS still has no path to it (${raw}). ` +
          `This is the WireGuard handshake, not the MikroTik password. ` +
          `On the router: /interface wireguard peers print detail — last-handshake must be recent, and the peer endpoint must be the VPS. ` +
          `On the VPS: sudo wg show (allowed-ips includes ${host}/32 and a recent handshake); ping ${host}. ` +
          `UDP 51820 from the router to the VPS must be open.`
        : `Reached the tunnel address ${host} but login failed: ${raw}. ` +
          `Confirm the MikroTik username/password and that IP → Services → ssh (or api) is enabled.`
    );
    err.status = 502;
    throw err;
  }

  let doc = null;
  if (peer.claimedRouterId) {
    doc = await MikrotikRouter.findOne({
      _id: peer.claimedRouterId,
      organizationId,
    });
  }
  if (!doc) {
    doc = await MikrotikRouter.findOne({ organizationId, host });
  }

  if (doc) {
    doc.name = name;
    doc.comment = name;
    doc.transport = t;
    doc.sshUser = user;
    doc.sshPassword = pass;
    doc.apiUser = user;
    doc.apiPassword = pass;
    doc.apiPort = 8728;
    doc.sshPort = 22;
    await doc.save();
  } else {
    doc = await MikrotikRouter.create({
      organizationId,
      name,
      comment: name,
      host,
      transport: t,
      apiPort: 8728,
      sshPort: 22,
      sshUser: user,
      sshPassword: pass,
      apiUser: user,
      apiPassword: pass,
      defaultPppProfile: 'default',
      expiredPppProfile: 'nonpayment',
    });
  }

  peer.claimedRouterId = doc._id;
  if (organizationId && !peer.organizationId) peer.organizationId = organizationId;
  if (name && name !== peer.siteName) peer.siteName = name;
  peer.lastSeen = new Date();
  await peer.save();

  return {
    ok: true,
    updated: Boolean(peer.claimedRouterId),
    router: {
      id: String(doc._id),
      name: doc.name,
      comment: doc.comment,
      host: doc.host,
      transport: doc.transport,
      sitePublicIp: doc.sitePublicIp || '',
    },
    wireguard: {
      peerId: String(peer._id),
      tunnelIp: peer.tunnelIp,
      lanSubnet: peer.lanSubnet || '',
      identity,
      connectedVia: t,
    },
  };
}
