import mongoose from 'mongoose';
import express from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requireRoles } from '../middleware/requireRoles.js';
import { config } from '../config.js';
import { WireGuardPeer } from '../models/WireGuardPeer.js';
import { allocateNextTunnelIp, isValidTunnelIp, tunnelIpRangeHint, tunnelPoolSlices } from '../services/wireguard/allocateTunnelIp.js';
import {
  readVpsPeers,
  removeWireGuardPeerFromVps,
  syncWireGuardPeerToVps,
  testWgVpsSshConnection,
} from '../services/wireguard/wgPeerSync.js';
import { buildWireGuardInstallScript } from '../services/wireguard/buildInstallScript.js';
import {
  generateWgVpsSshKey,
  getWgVpsSshKeyPublic,
  isWireGuardFullyConfigured,
} from '../services/wireguard/wgVpsSshKey.js';
import { createPhoneClientPeer } from '../services/wireguard/createPhoneClient.js';
import { applyOrgStateToPeer, setPeerAccess } from '../services/wireguard/peerAccess.js';
import { Organization } from '../models/index.js';

export const wireguardAdminRouter = express.Router();

wireguardAdminRouter.use(requireRoles('super_admin'));

const WG_PUBKEY_RE = /^[A-Za-z0-9+/]{42,44}={0,2}$/;
/**
 * A phone/laptop profile must say whose it is: an organisation (switched off with it when its
 * bill is unpaid) or 'platform' for platform staff. Never left blank by accident.
 */
async function checkOrganizationId(raw) {
  const id = String(raw || '').trim();
  if (id === 'platform') return { id: null };
  if (!id) return { error: 'Choose the organisation this profile belongs to (or Platform staff)' };
  if (!mongoose.isValidObjectId(id)) return { error: 'Invalid organizationId' };
  if (!(await Organization.exists({ _id: id }))) return { error: 'Organisation not found' };
  return { id };
}

const IPV4_CIDR_RE =
  /^(?:(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\/(?:3[0-2]|[12]?\d)$/;

function mapPeer(p) {
  return {
    id: String(p._id),
    siteName: p.siteName,
    publicKey: p.publicKey,
    tunnelIp: p.tunnelIp,
    lanSubnet: p.lanSubnet || '',
    kind: p.kind === 'client' ? 'client' : 'router',
    status: p.status,
    disabledReason: p.disabledReason || '',
    organizationId: p.organizationId ? String(p.organizationId) : null,
    platformStaff: Boolean(p.platformStaff),
    lastSeen: p.lastSeen,
    lastSyncError: p.lastSyncError || '',
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

/**
 * Download ready-to-import RouterOS script (API URL + token filled; site/LAN auto on router).
 * GET /api/super-admin/wireguard/install-script?siteName=&lanSubnet=
 */
wireguardAdminRouter.get(
  '/install-script',
  asyncHandler(async (req, res) => {
    const siteName = String(req.query.siteName || '').trim();
    const lanSubnet = String(req.query.lanSubnet || '').trim();
    if (lanSubnet && !IPV4_CIDR_RE.test(lanSubnet)) {
      return res.status(400).json({ error: 'lanSubnet must be IPv4 CIDR' });
    }
    const script = buildWireGuardInstallScript({
      ...(siteName ? { siteName } : {}),
      ...(lanSubnet ? { lanSubnet } : {}),
    });
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="wireguard-auto-register.rsc"'
    );
    res.send(script);
  })
);

/** GET /api/super-admin/wireguard/vps-ssh-key */
wireguardAdminRouter.get(
  '/vps-ssh-key',
  asyncHandler(async (_req, res) => {
    res.json(await getWgVpsSshKeyPublic());
  })
);

/**
 * POST /api/super-admin/wireguard/vps-ssh-key
 * Body: { rotate?: boolean } — generate (or replace) ed25519 key for VPS SSH.
 */
wireguardAdminRouter.post(
  '/vps-ssh-key',
  asyncHandler(async (req, res) => {
    try {
      const created = await generateWgVpsSshKey({
        rotate: Boolean(req.body?.rotate) || Boolean(req.body?.force),
      });
      res.status(201).json({
        ok: true,
        ...created,
        instructions:
          'Add the publicKey line to ~/.ssh/authorized_keys on the VPS (user from WG_VPS_SSH_USER). Remove any old qarefi-billing@ line first. Do not share the private key.',
      });
    } catch (e) {
      const status = e.status && Number(e.status) >= 400 ? e.status : 500;
      return res.status(status).json({ error: e.message || 'Key generation failed' });
    }
  })
);

/** POST /api/super-admin/wireguard/vps-ssh-test */
wireguardAdminRouter.post(
  '/vps-ssh-test',
  asyncHandler(async (_req, res) => {
    try {
      res.json(await testWgVpsSshConnection());
    } catch (e) {
      const status = e.status && Number(e.status) >= 400 ? e.status : 502;
      return res.status(status).json({
        error: e.message || 'VPS SSH test failed',
        ...(e.publicKey ? { publicKey: e.publicKey } : {}),
        ...(e.code ? { code: e.code } : {}),
      });
    }
  })
);

/** GET /api/super-admin/wireguard/peers */
wireguardAdminRouter.get(
  '/peers',
  asyncHandler(async (_req, res) => {
    const items = await WireGuardPeer.find({}).sort({ createdAt: -1 }).lean();
    const ssh = await getWgVpsSshKeyPublic();
    const ready = await isWireGuardFullyConfigured();
    res.json({
      items: items.map(mapPeer),
      config: {
        enabled: ready,
        hasHost: Boolean(config.wireguard?.vpsHost),
        hasServerPublicKey: Boolean(config.wireguard?.serverPublicKey),
        endpoint: config.wireguard?.endpoint || '',
        pool: config.wireguard?.tunnelPool || '10.66.54.0/24',
        poolSlices: tunnelPoolSlices(),
        registerUrl: '/api/routers/register',
        hasRegisterToken: Boolean(config.wireguard?.registerToken),
        vpsSsh: ssh,
      },
    });
  })
);

/** POST /api/super-admin/wireguard/peers — manual add (when script already ran / known key) */
wireguardAdminRouter.post(
  '/peers',
  asyncHandler(async (req, res) => {
    const publicKey = String(req.body?.publicKey || '').trim();
    const siteName = String(req.body?.siteName || '').trim();
    const lanSubnet = String(req.body?.lanSubnet || '').trim();
    const tunnelIpOverride = String(req.body?.tunnelIp || '').trim();
    const kind = String(req.body?.kind || 'router').trim() === 'client' ? 'client' : 'router';

    if (!publicKey || !WG_PUBKEY_RE.test(publicKey)) {
      return res.status(400).json({ error: 'Valid WireGuard publicKey required' });
    }
    if (!siteName || siteName.length < 2) {
      return res.status(400).json({ error: 'siteName required' });
    }
    if (lanSubnet && !IPV4_CIDR_RE.test(lanSubnet)) {
      return res.status(400).json({ error: 'lanSubnet must be IPv4 CIDR' });
    }

    const existing = await WireGuardPeer.findOne({ publicKey });
    if (existing) {
      return res.status(409).json({ error: 'Peer with this public key already exists', peer: mapPeer(existing) });
    }
    let clientOrgId = null;
    if (kind === 'client') {
      const org = await checkOrganizationId(req.body?.organizationId);
      if (org.error) return res.status(400).json({ error: org.error });
      clientOrgId = org.id || 'platform';
    }

    let tunnelIp = tunnelIpOverride;
    if (tunnelIp) {
      if (!isValidTunnelIp(tunnelIp, kind)) {
        return res.status(400).json({
          error: `tunnelIp must be in ${tunnelIpRangeHint(kind)}`,
        });
      }
      const taken = await WireGuardPeer.findOne({ tunnelIp });
      if (taken) return res.status(409).json({ error: `tunnelIp ${tunnelIp} already in use` });
    } else {
      tunnelIp = await allocateNextTunnelIp({ kind });
    }

    const peer = await WireGuardPeer.create({
      siteName,
      publicKey,
      tunnelIp,
      lanSubnet: kind === 'client' ? '' : lanSubnet || '',
      kind,
      ...(clientOrgId === 'platform' ? { platformStaff: true } : clientOrgId ? { organizationId: clientOrgId } : {}),
      status: 'active',
      lastSeen: new Date(),
    });

    try {
      await syncWireGuardPeerToVps({
        publicKey: peer.publicKey,
        tunnelIp: peer.tunnelIp,
        lanSubnet: peer.lanSubnet,
      });
      peer.lastSyncError = '';
      await peer.save();
    } catch (e) {
      peer.status = 'error';
      peer.lastSyncError = e?.message || 'sync_failed';
      await peer.save();
      return res.status(502).json({
        error: e?.message || 'Peer saved but VPS sync failed',
        peer: mapPeer(peer),
      });
    }

    res.status(201).json({ peer: mapPeer(peer) });
  })
);

/**
 * Generate a phone/laptop WireGuard config + QR (private key shown once).
 * POST /api/super-admin/wireguard/phone-clients
 * Body: { label?: string, includeLan?: boolean }
 */
wireguardAdminRouter.post(
  '/phone-clients',
  asyncHandler(async (req, res) => {
    try {
      const org = await checkOrganizationId(req.body?.organizationId);
      if (org.error) return res.status(400).json({ error: org.error });
      const result = await createPhoneClientPeer({
        label: req.body?.label,
        organizationId: org.id,
        platformStaff: !org.id,
        includeLan: req.body?.includeLan !== false,
      });
      res.status(201).json({
        peer: mapPeer(result.peer),
        config: result.configText,
        qrDataUrl: result.qrDataUrl,
        filename: result.filename,
        allowedIps: result.allowedIps,
        note: 'Scan the QR in the WireGuard app, or download the .conf. The private key is not stored — generate a new client if you lose it.',
      });
    } catch (e) {
      const status = e.status && Number(e.status) >= 400 ? e.status : 500;
      return res.status(status).json({
        error: e.message || 'Could not create phone client',
        ...(e.peer ? { peer: mapPeer(e.peer) } : {}),
      });
    }
  })
);

/** PATCH /api/super-admin/wireguard/peers/:id */
wireguardAdminRouter.patch(
  '/peers/:id',
  asyncHandler(async (req, res) => {
    const peer = await WireGuardPeer.findById(req.params.id);
    if (!peer) return res.status(404).json({ error: 'Peer not found' });

    const { siteName, lanSubnet, status, organizationId } = req.body || {};
    let orgChanged = false;
    if (organizationId !== undefined) {
      if (peer.kind !== 'client') {
        return res.status(400).json({ error: 'Router tunnels belong to their router; only phone/laptop profiles take an organisation' });
      }
      const org = await checkOrganizationId(organizationId);
      if (org.error) return res.status(400).json({ error: org.error });
      orgChanged = String(peer.organizationId || '') !== String(org.id || '');
      peer.organizationId = org.id;
      peer.platformStaff = !org.id;
    }
    if (siteName != null) {
      const s = String(siteName).trim();
      if (s.length < 2) return res.status(400).json({ error: 'siteName too short' });
      peer.siteName = s;
    }
    if (lanSubnet != null) {
      const lan = String(lanSubnet).trim();
      if (lan && !IPV4_CIDR_RE.test(lan)) {
        return res.status(400).json({ error: 'lanSubnet must be IPv4 CIDR' });
      }
      peer.lanSubnet = lan;
    }
    let nextStatus = null;
    if (status != null) {
      const st = String(status).trim();
      if (!['active', 'disabled', 'error'].includes(st)) {
        return res.status(400).json({ error: 'Invalid status' });
      }
      nextStatus = st;
    }

    if (nextStatus === 'disabled' || (nextStatus === 'active' && peer.status === 'disabled')) {
      try {
        await setPeerAccess(peer, { enabled: nextStatus === 'active', reason: 'manual' });
      } catch (e) {
        return res.status(502).json({
          error: e?.message || 'VPS WireGuard update failed',
          peer: mapPeer(peer),
        });
      }
      return res.json({ peer: mapPeer(peer) });
    }
    if (nextStatus) peer.status = nextStatus;

    await peer.save();
    if (orgChanged) {
      /* Linked to an organisation that is suspended for an unpaid bill: off on the VPS now. */
      try {
        await applyOrgStateToPeer(peer);
      } catch (e) {
        return res.status(502).json({ error: e?.message || 'VPS WireGuard update failed', peer: mapPeer(peer) });
      }
    }
    res.json({ peer: mapPeer(peer) });
  })
);

/** POST /api/super-admin/wireguard/peers/:id/resync */
wireguardAdminRouter.post(
  '/peers/:id/resync',
  asyncHandler(async (req, res) => {
    const peer = await WireGuardPeer.findById(req.params.id);
    if (!peer) return res.status(404).json({ error: 'Peer not found' });
    if (peer.status === 'disabled') {
      return res.status(409).json({
        error:
          peer.disabledReason === 'subscription_expired'
            ? 'Peer is blocked because its remote access subscription expired. Renew the subscription or Enable it.'
            : 'Peer is disabled. Enable it instead of resyncing.',
        peer: mapPeer(peer),
      });
    }
    try {
      await syncWireGuardPeerToVps({
        publicKey: peer.publicKey,
        tunnelIp: peer.tunnelIp,
        lanSubnet: peer.lanSubnet,
      });
      peer.lastSyncError = '';
      peer.status = 'active';
      peer.lastSeen = new Date();
      await peer.save();
      res.json({ ok: true, peer: mapPeer(peer) });
    } catch (e) {
      peer.lastSyncError = e?.message || 'sync_failed';
      peer.status = 'error';
      await peer.save();
      res.status(502).json({ error: e?.message || 'VPS sync failed', peer: mapPeer(peer) });
    }
  })
);

/**
 * DELETE /api/super-admin/wireguard/peers/:id — removes the peer from the VPS first (and checks it
 * is gone), then from the database. If the VPS cannot be reached nothing is deleted, so a peer is
 * never left running on the VPS with no record of it here.
 */
wireguardAdminRouter.delete(
  '/peers/:id',
  asyncHandler(async (req, res) => {
    const peer = await WireGuardPeer.findById(req.params.id);
    if (!peer) return res.status(404).json({ error: 'Peer not found' });
    try {
      await removeWireGuardPeerFromVps({ publicKey: peer.publicKey });
    } catch (e) {
      return res.status(e.status && Number(e.status) >= 400 ? e.status : 502).json({
        error: `Not deleted: could not remove it from the VPS (${e?.message || 'VPS unreachable'})`,
      });
    }
    await WireGuardPeer.deleteOne({ _id: peer._id });
    res.json({ ok: true });
  })
);

/**
 * GET /api/super-admin/wireguard/vps-peers — what is really live on the VPS, matched to this
 * app's records. Unknown peers (added on the VPS by hand, or deleted here before deletes removed
 * them) still have access until removed or adopted.
 */
wireguardAdminRouter.get(
  '/vps-peers',
  asyncHandler(async (_req, res) => {
    let live;
    try {
      live = await readVpsPeers();
    } catch (e) {
      return res.status(e.status && Number(e.status) >= 400 ? e.status : 502).json({ error: e?.message || 'Could not read the VPS' });
    }
    if (live == null) return res.status(503).json({ error: 'WireGuard VPS access is not set up' });
    const known = await WireGuardPeer.find({}).lean();
    const byKey = new Map(known.map((p) => [p.publicKey, p]));
    const liveKeys = new Set(live.map((p) => p.publicKey));
    res.json({
      checkedAt: new Date(),
      peers: live.map((p) => {
        const rec = byKey.get(p.publicKey);
        return {
          ...p,
          tunnelIp: (p.allowedIps.find((a) => a.endsWith('/32')) || '').replace(/\/32$/, ''),
          record: rec ? mapPeer(rec) : null,
          /* Switched off here but still live on the VPS: removing it again fixes that. */
          shouldBeOff: Boolean(rec && rec.status === 'disabled'),
        };
      }),
      /* Switched on here but missing on the VPS (Resync puts them back). */
      missing: known.filter((p) => p.status === 'active' && !liveKeys.has(p.publicKey)).map(mapPeer),
    });
  })
);

/** POST /api/super-admin/wireguard/vps-peers/remove { publicKey } — cut a live peer on the VPS. */
wireguardAdminRouter.post(
  '/vps-peers/remove',
  asyncHandler(async (req, res) => {
    const publicKey = String(req.body?.publicKey || '').trim();
    if (!WG_PUBKEY_RE.test(publicKey)) return res.status(400).json({ error: 'Valid WireGuard publicKey required' });
    try {
      await removeWireGuardPeerFromVps({ publicKey });
    } catch (e) {
      return res.status(e.status && Number(e.status) >= 400 ? e.status : 502).json({ error: e?.message || 'VPS update failed' });
    }
    const rec = await WireGuardPeer.findOne({ publicKey });
    if (rec && rec.status !== 'disabled') {
      rec.status = 'disabled';
      rec.disabledReason = 'manual';
      rec.lastSyncError = '';
      await rec.save();
    }
    res.json({ ok: true, peer: rec ? mapPeer(rec) : null });
  })
);

/**
 * POST /api/super-admin/wireguard/vps-peers/adopt { publicKey, label, organizationId }
 * Record an unknown live peer as an organisation's phone/laptop profile, so it is switched off
 * with that organisation from now on.
 */
wireguardAdminRouter.post(
  '/vps-peers/adopt',
  asyncHandler(async (req, res) => {
    const publicKey = String(req.body?.publicKey || '').trim();
    const label = String(req.body?.label || '').trim();
    if (!WG_PUBKEY_RE.test(publicKey)) return res.status(400).json({ error: 'Valid WireGuard publicKey required' });
    if (label.length < 2 || label.length > 80) return res.status(400).json({ error: 'Name it (2–80 characters)' });
    const org = await checkOrganizationId(req.body?.organizationId);
    if (org.error) return res.status(400).json({ error: org.error });
    if (await WireGuardPeer.exists({ publicKey })) return res.status(409).json({ error: 'This peer is already recorded' });

    let live;
    try {
      live = await readVpsPeers();
    } catch (e) {
      return res.status(e.status && Number(e.status) >= 400 ? e.status : 502).json({ error: e?.message || 'Could not read the VPS' });
    }
    const onVps = (live || []).find((p) => p.publicKey === publicKey);
    if (!onVps) return res.status(404).json({ error: 'This peer is not on the VPS any more' });
    const tunnelIp = (onVps.allowedIps.find((a) => a.endsWith('/32')) || '').replace(/\/32$/, '');
    if (!tunnelIp) return res.status(400).json({ error: 'This peer has no single tunnel address on the VPS; remove it instead' });
    if (await WireGuardPeer.exists({ tunnelIp })) {
      return res.status(409).json({ error: `Tunnel address ${tunnelIp} is already used by another recorded peer` });
    }

    const peer = await WireGuardPeer.create({
      siteName: label,
      publicKey,
      tunnelIp,
      lanSubnet: '',
      organizationId: org.id,
      platformStaff: !org.id,
      kind: 'client',
      status: 'active',
      lastSeen: onVps.latestHandshake ? new Date(onVps.latestHandshake * 1000) : new Date(),
    });
    try {
      await applyOrgStateToPeer(peer);
    } catch (e) {
      return res.status(502).json({ error: e?.message || 'Saved, but switching it off on the VPS failed', peer: mapPeer(peer) });
    }
    res.status(201).json({ peer: mapPeer(peer) });
  })
);
