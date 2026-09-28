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

function rosQuote(s) {
  return `"${String(s || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\$/g, '\\$')}"`;
}

/** Router imports this file. No key=value parsing (RouterOS often returns empty file contents). */
function applyScript(peer, wg) {
  const endpoint = String(wg.endpoint || '');
  const colon = endpoint.lastIndexOf(':');
  const epHost = colon > 0 ? endpoint.slice(0, colon) : endpoint;
  const epPort = colon > 0 ? endpoint.slice(colon + 1) : '51820';
  const allowed = wg.clientAllowedIps || wg.tunnelPool || '10.66.54.0/24';
  const tunnel = `${peer.tunnelIp}/24`;
  const key = rosQuote(wg.serverPublicKey);
  const host = rosQuote(epHost);
  const port = rosQuote(epPort);
  const allow = rosQuote(allowed);
  const addr = rosQuote(tunnel);
  return `{
:put "QAREFI: 9 apply"
:if ([:len [/ip address find where interface="wg-qarefi" comment="QareFi WG tunnel"]] = 0) do={
  /ip address add address=${addr} interface="wg-qarefi" comment="QareFi WG tunnel"
} else={
  /ip address set [find where interface="wg-qarefi" comment="QareFi WG tunnel"] address=${addr}
}
:if ([:len [/interface wireguard peers find where interface="wg-qarefi" comment="QareFi VPS"]] = 0) do={
  /interface wireguard peers add interface="wg-qarefi" public-key=${key} endpoint-address=${host} endpoint-port=${port} allowed-address=${allow} persistent-keepalive=25s comment="QareFi VPS"
} else={
  /interface wireguard peers set [find where interface="wg-qarefi" comment="QareFi VPS"] public-key=${key} endpoint-address=${host} endpoint-port=${port} allowed-address=${allow} persistent-keepalive=25s comment="QareFi VPS"
}
:if ([:len [/ip firewall filter find where comment="QareFi: VPN management"]] = 0) do={
  :do {
    /ip firewall filter add chain=input action=accept src-address=${allow} comment="QareFi: VPN management" place-before=0
  } on-error={
    /ip firewall filter add chain=input action=accept src-address=${allow} comment="QareFi: VPN management"
  }
}
:put "QAREFI: SUCCESS ${peer.tunnelIp}"
:log warning "QAREFI: SUCCESS ${peer.tunnelIp}"
}
`;
}

function sendRegister(req, res, status, lines, peer, wg) {
  const format = String(req.query?.format || req.body?.format || '').toLowerCase();
  if ((status === 200 || status === 201) && format === 'rsc' && peer && wg?.serverPublicKey && wg?.endpoint) {
    res.status(status).type('text/plain; charset=utf-8').send(applyScript(peer, wg));
    return;
  }
  return plainText(res, status, lines);
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
      const headerKey = String(req.get('x-wg-pubkey') || req.get('x-wg-key') || '').trim();
      const publicKey = normalizeWireGuardPublicKey(
        headerKey || input.publicKey || input.public_key,
        headerKey ? 'raw' : input.keyFormat || input.key_format
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

      /* Auth: valid bootstrap code OR WG_REGISTER_TOKEN (when configured) */
      let resolvedOrgId = organizationId;
      const boot = String(input.boot || input.bootCode || input.bootstrapCode || '').trim();
      let bootOk = false;
      if (boot) {
        try {
          const { InstallBootstrapCode } = await import('../models/InstallBootstrapCode.js');
          const row = await InstallBootstrapCode.findOne({ code: boot }).lean();
          bootOk = Boolean(row && (!row.expiresAt || new Date(row.expiresAt) >= new Date()));
          if (bootOk && row.organizationId) {
            if (organizationId && String(row.organizationId) !== String(organizationId)) {
              return plainText(res, 403, ['error=Bootstrap code org mismatch', 'ok=false']);
            }
            resolvedOrgId = row.organizationId;
          }
        } catch {
          bootOk = false;
        }
      }
      if (wg.registerToken) {
        if (!bootOk && (!token || token !== wg.registerToken)) {
          return plainText(res, 401, ['error=Invalid or missing registration token', 'ok=false']);
        }
      }

      if (!publicKey || !WG_PUBKEY_RE.test(publicKey)) {
        return plainText(res, 400, [
          'error=publicKey is required and must be a WireGuard public key',
          `debugKeyLen=${publicKey.length}`,
          `debugKeyPrefix=${publicKey.slice(0, 16)}`,
          'ok=false',
        ]);
      }
      /* Detect MikroTik [:find "/"] corruption (key becomes underscores) */
      if ((publicKey.match(/_/g) || []).length > 10) {
        return plainText(res, 400, [
          'error=publicKey looks corrupted (too many underscores) — update install script',
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

      const organizationIdFinal = resolvedOrgId;

      let peer = await WireGuardPeer.findOne({ publicKey });
      if (peer) {
        peer.lastSeen = new Date();
        if (siteName && siteName !== peer.siteName) peer.siteName = siteName;
        if (lanSubnet && lanSubnet !== peer.lanSubnet) peer.lanSubnet = lanSubnet;
        if (organizationIdFinal && !peer.organizationId) peer.organizationId = organizationIdFinal;
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
        return sendRegister(req, res, 200, [...successLines(peer, wg), 'ok=true', 'existing=true'], peer, wg);
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
          ...(organizationIdFinal ? { organizationId: organizationIdFinal } : {}),
        });
      } catch (e) {
        if (e?.code === 11000) {
          peer = await WireGuardPeer.findOne({ publicKey });
          if (peer) {
            if (organizationIdFinal && !peer.organizationId) {
              peer.organizationId = organizationIdFinal;
              await peer.save();
            }
            return sendRegister(req, res, 200, [...successLines(peer, wg), 'ok=true', 'existing=true'], peer, wg);
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
        organizationId: organizationIdFinal ? String(organizationIdFinal) : null,
        publicKeyPrefix: `${publicKey.slice(0, 12)}…`,
      });
      return sendRegister(req, res, 201, [...successLines(peer, wg), 'ok=true', 'existing=false'], peer, wg);
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

/**
 * Path-based key (MikroTik-safe — avoids query-string +/= mangling).
 * GET /api/routers/register/pk/:publicKey?siteName=&organizationId=&boot=&token=
 */
wireguardRegisterRouter.get(
  '/register/pk/:publicKey',
  asyncHandler(async (req, res) => {
    req.query = {
      ...(req.query || {}),
      publicKey: req.params.publicKey,
      keyFormat: req.query?.keyFormat || 'base64url',
    };
    return handleWireGuardRegister(req, res);
  })
);

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
      bootCode: code,
      ...(row.siteName ? { siteName: row.siteName } : {}),
      ...(row.lanSubnet ? { lanSubnet: row.lanSubnet } : {}),
    });
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', 'inline; filename="qarefi-install.rsc"');
    res.setHeader('Cache-Control', 'no-store');
    res.send(script);
  })
);
