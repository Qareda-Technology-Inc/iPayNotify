import express from 'express';
import mongoose from 'mongoose';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { config } from '../config.js';
import { WireGuardPeer } from '../models/WireGuardPeer.js';
import { allocateNextTunnelIp } from '../services/wireguard/allocateTunnelIp.js';
import { syncWireGuardPeerToVps } from '../services/wireguard/wgPeerSync.js';

export const wireguardRegisterRouter = express.Router();

const WG_PUBKEY_RE = /^[A-Za-z0-9+/]{42,44}={0,2}$/;
const WG_PUBKEY_URL_RE = /^[A-Za-z0-9_-]{42,44}={0,2}$/;
const IPV4_CIDR_RE =
  /^(?:(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\/(?:3[0-2]|[12]?\d)$/;

function normalizeWireGuardPublicKey(raw, keyFormat) {
  let k = String(raw || '').trim();
  const fmt = String(keyFormat || '').trim().toLowerCase();
  if (fmt === 'base64url' || (/[-_]/.test(k) && !/[+/]/.test(k))) {
    k = k.replace(/-/g, '+').replace(/_/g, '/');
    while (k.length % 4 !== 0) k += '=';
  }
  return k;
}

function sanitizeSiteName(raw) {
  let s = String(raw || '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (s.length > 80) s = s.slice(0, 80);
  return s;
}

function mergeInput(req) {
  const q = req.query && typeof req.query === 'object' ? req.query : {};
  const b = req.body && typeof req.body === 'object' ? req.body : {};
  return { ...q, ...b };
}

function plainText(res, status, lines) {
  const body = Array.isArray(lines) ? `${lines.filter(Boolean).join('\n')}\n` : String(lines);
  res.status(status).type('text/plain').send(body);
}

function successLines(peer, wg) {
  return [
    `tunnelIp=${peer.tunnelIp}`,
    `serverPublicKey=${wg.serverPublicKey}`,
    `endpoint=${wg.endpoint}`,
    `allowedIps=${wg.clientAllowedIps || wg.tunnelPool || '10.66.54.0/24'}`,
    `siteName=${peer.siteName}`,
    `status=${peer.status || 'active'}`,
  ];
}

function sanitizeErr(msg) {
  return String(msg || 'error')
    .replace(/[\r\n]+/g, ' ')
    .slice(0, 200);
}

function parseOrgId(raw) {
  const s = String(raw || '').trim();
  if (!s || !mongoose.isValidObjectId(s)) return null;
  return new mongoose.Types.ObjectId(s);
}

/**
 * GET|POST /api/routers/register
 * Query/body: publicKey, siteName, lanSubnet?[, token][, organizationId]
 * Response: plain text key=value (RouterOS-friendly). GET preferred for MikroTik /tool fetch.
 */
async function handleWireGuardRegister(req, res) {
    try {
      const wg = config.wireguard;
      if (!wg?.serverPublicKey || !wg?.endpoint) {
        return plainText(res, 503, [
          'error=WireGuard registration is not configured on the server',
          'ok=false',
        ]);
      }

      const input = mergeInput(req);
      const publicKey = normalizeWireGuardPublicKey(
        input.publicKey || input.public_key,
        input.keyFormat || input.key_format
      );
      const siteName = sanitizeSiteName(input.siteName || input.site_name);
      const lanSubnet = String(input.lanSubnet || input.lan_subnet || '').trim();
      const tokenRaw = String(
        input.token || input.registerToken || req.get('x-wg-register-token') || ''
      ).trim();
      let token = tokenRaw;
      try {
        if (/%[0-9A-Fa-f]{2}/.test(tokenRaw)) token = decodeURIComponent(tokenRaw);
      } catch {
        token = tokenRaw;
      }
      const organizationId = parseOrgId(
        input.organizationId || input.organization_id || input.orgId
      );

      if (wg.registerToken) {
        if (!token || token !== wg.registerToken) {
          return plainText(res, 401, ['error=Invalid or missing registration token', 'ok=false']);
        }
      }

      if (!publicKey || !WG_PUBKEY_RE.test(publicKey)) {
        return plainText(res, 400, [
          'error=publicKey is required and must be a WireGuard public key',
          `debugKeyLen=${publicKey.length}`,
          'ok=false',
        ]);
      }
      if (!siteName || siteName.length < 2 || siteName.length > 80) {
        return plainText(res, 400, ['error=siteName is required (2–80 characters)', 'ok=false']);
      }
      if (lanSubnet && !IPV4_CIDR_RE.test(lanSubnet)) {
        return plainText(res, 400, [
          'error=lanSubnet must be IPv4 CIDR e.g. 192.168.88.0/24',
          'ok=false',
        ]);
      }

      let peer = await WireGuardPeer.findOne({ publicKey });
      if (peer) {
        peer.lastSeen = new Date();
        if (siteName && siteName !== peer.siteName) peer.siteName = siteName;
        if (lanSubnet && lanSubnet !== peer.lanSubnet) peer.lanSubnet = lanSubnet;
        if (organizationId && !peer.organizationId) peer.organizationId = organizationId;
        try {
          await syncWireGuardPeerToVps({
            publicKey: peer.publicKey,
            tunnelIp: peer.tunnelIp,
            lanSubnet: peer.lanSubnet,
          });
          peer.lastSyncError = '';
          peer.status = 'active';
        } catch (e) {
          peer.lastSyncError = e?.message || 'sync_failed';
          console.error('[wireguard] re-sync failed', peer.tunnelIp, e?.message || e);
        }
        await peer.save();
        return plainText(res, 200, [...successLines(peer, wg), 'ok=true', 'existing=true']);
      }

      const tunnelIp = await allocateNextTunnelIp({ kind: 'router' });
      try {
        peer = await WireGuardPeer.create({
          siteName,
          publicKey,
          tunnelIp,
          lanSubnet: lanSubnet || '',
          kind: 'router',
          status: 'active',
          lastSeen: new Date(),
          ...(organizationId ? { organizationId } : {}),
        });
      } catch (e) {
        if (e?.code === 11000) {
          peer = await WireGuardPeer.findOne({ publicKey });
          if (peer) {
            if (organizationId && !peer.organizationId) {
              peer.organizationId = organizationId;
              await peer.save();
            }
            return plainText(res, 200, [...successLines(peer, wg), 'ok=true', 'existing=true']);
          }
        }
        throw e;
      }

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
        console.error('[wireguard] register sync failed', tunnelIp, e?.message || e);
        return plainText(res, 502, [
          `error=${sanitizeErr(e?.message || 'Failed to push peer to VPS')}`,
          `tunnelIp=${peer.tunnelIp}`,
          'ok=false',
        ]);
      }

      console.log('[wireguard] registered', {
        siteName,
        tunnelIp,
        organizationId: organizationId ? String(organizationId) : null,
        publicKeyPrefix: `${publicKey.slice(0, 12)}…`,
      });
      return plainText(res, 201, [...successLines(peer, wg), 'ok=true', 'existing=false']);
    } catch (e) {
      console.error('[wireguard] register error', e?.message || e);
      return plainText(res, e?.status || 500, [
        `error=${sanitizeErr(e?.message || 'Internal error')}`,
        'ok=false',
      ]);
    }
}

wireguardRegisterRouter.post('/register', asyncHandler(handleWireGuardRegister));
wireguardRegisterRouter.get('/register', asyncHandler(handleWireGuardRegister));

wireguardRegisterRouter.get(
  '/register/ping',
  asyncHandler(async (_req, res) => {
    const wg = config.wireguard;
    plainText(res, 200, [
      `ok=${wg?.enabled ? 'true' : 'false'}`,
      `endpoint=${wg?.endpoint || ''}`,
      `pool=${config.wireguard?.tunnelPool || '10.66.54.0/24'}`,
    ]);
  })
);

/**
 * Public .rsc download for MikroTik /tool fetch (no JWT).
 * GET /api/routers/bootstrap.rsc?token=&organizationId=&siteName=
 * Prefer short codes: GET /api/routers/b/:code.rsc
 */
wireguardRegisterRouter.get(
  ['/bootstrap.rsc', '/bootstrap'],
  asyncHandler(async (req, res) => {
    const wg = config.wireguard;
    const token = String(req.query.token || req.get('x-wg-register-token') || '').trim();
    if (wg?.registerToken) {
      if (!token || token !== wg.registerToken) {
        return res.status(401).type('text/plain').send('error=Invalid or missing token\n');
      }
    }
    const organizationId = String(req.query.organizationId || req.query.orgId || '').trim();
    const siteName = String(req.query.siteName || '').trim();
    const lanSubnet = String(req.query.lanSubnet || '').trim();
    if (lanSubnet && !IPV4_CIDR_RE.test(lanSubnet)) {
      return res.status(400).type('text/plain').send('error=lanSubnet must be IPv4 CIDR\n');
    }
    const { buildWireGuardInstallScript } = await import(
      '../services/wireguard/buildInstallScript.js'
    );
    const script = buildWireGuardInstallScript({
      ...(organizationId ? { organizationId } : {}),
      ...(siteName ? { siteName } : {}),
      ...(lanSubnet ? { lanSubnet } : {}),
    });
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', 'inline; filename="wireguard-auto-register.rsc"');
    res.send(script);
  })
);

/**
 * Short-code bootstrap (no special characters — MikroTik-safe).
 * GET /api/routers/b/:code.rsc
 */
wireguardRegisterRouter.get(
  ['/b/:code.rsc', '/b/:code'],
  asyncHandler(async (req, res) => {
    const code = String(req.params.code || '')
      .replace(/\.rsc$/i, '')
      .trim();
    if (!code || code.length < 8) {
      return res.status(400).type('text/plain').send('error=Invalid code\n');
    }
    const { InstallBootstrapCode } = await import('../models/InstallBootstrapCode.js');
    const row = await InstallBootstrapCode.findOne({ code }).lean();
    if (!row || (row.expiresAt && new Date(row.expiresAt) < new Date())) {
      return res
        .status(404)
        .type('text/plain')
        .send('error=Code expired or unknown. Get a new command from QareFi Add router.\n');
    }
    const { buildWireGuardInstallScript } = await import(
      '../services/wireguard/buildInstallScript.js'
    );
    const script = buildWireGuardInstallScript({
      organizationId: String(row.organizationId),
      ...(row.siteName ? { siteName: row.siteName } : {}),
      ...(row.lanSubnet ? { lanSubnet: row.lanSubnet } : {}),
    });
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', 'inline; filename="qarefi-install.rsc"');
    res.setHeader('Cache-Control', 'no-store');
    res.send(script);
  })
);
