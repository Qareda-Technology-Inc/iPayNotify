import express from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requireRoles } from '../middleware/requireRoles.js';
import { config } from '../config.js';
import { WireGuardPeer } from '../models/WireGuardPeer.js';
import { allocateNextTunnelIp, isValidTunnelIp, tunnelIpRangeHint, tunnelPoolSlices } from '../services/wireguard/allocateTunnelIp.js';
import { syncWireGuardPeerToVps, testWgVpsSshConnection } from '../services/wireguard/wgPeerSync.js';
import { buildWireGuardInstallScript } from '../services/wireguard/buildInstallScript.js';
import {
  generateWgVpsSshKey,
  getWgVpsSshKeyPublic,
  isWireGuardFullyConfigured,
} from '../services/wireguard/wgVpsSshKey.js';
import { createPhoneClientPeer } from '../services/wireguard/createPhoneClient.js';

export const wireguardAdminRouter = express.Router();

wireguardAdminRouter.use(requireRoles('super_admin'));

const WG_PUBKEY_RE = /^[A-Za-z0-9+/]{42,44}={0,2}$/;
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
      const result = await createPhoneClientPeer({
        label: req.body?.label,
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

    const { siteName, lanSubnet, status } = req.body || {};
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
    if (status != null) {
      const st = String(status).trim();
      if (!['active', 'disabled', 'error'].includes(st)) {
        return res.status(400).json({ error: 'Invalid status' });
      }
      peer.status = st;
    }

    await peer.save();
    res.json({ peer: mapPeer(peer) });
  })
);

/** POST /api/super-admin/wireguard/peers/:id/resync */
wireguardAdminRouter.post(
  '/peers/:id/resync',
  asyncHandler(async (req, res) => {
    const peer = await WireGuardPeer.findById(req.params.id);
    if (!peer) return res.status(404).json({ error: 'Peer not found' });
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

/** DELETE /api/super-admin/wireguard/peers/:id — DB only (does not remove live wg peer) */
wireguardAdminRouter.delete(
  '/peers/:id',
  asyncHandler(async (req, res) => {
    const peer = await WireGuardPeer.findByIdAndDelete(req.params.id);
    if (!peer) return res.status(404).json({ error: 'Peer not found' });
    res.json({
      ok: true,
      note: 'Removed from database. Remove the peer on the VPS manually if needed: wg set wg0 peer <key> remove',
    });
  })
);
