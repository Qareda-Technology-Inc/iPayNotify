import crypto from 'node:crypto';
import QRCode from 'qrcode';
import { config } from '../../config.js';
import { WireGuardPeer } from '../../models/WireGuardPeer.js';
import { allocateNextTunnelIp } from './allocateTunnelIp.js';
import { syncWireGuardPeerToVps } from './wgPeerSync.js';
import { isWireGuardFullyConfigured } from './wgVpsSshKey.js';

/**
 * WireGuard Curve25519 keypair as standard base64 (32-byte keys).
 */
export function generateWireGuardKeyPair() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('x25519');
  const privJwk = privateKey.export({ format: 'jwk' });
  const pubJwk = publicKey.export({ format: 'jwk' });
  const priv = Buffer.from(privJwk.d, 'base64url');
  const pub = Buffer.from(pubJwk.x, 'base64url');
  if (priv.length !== 32 || pub.length !== 32) {
    throw new Error('Unexpected WireGuard key length from crypto');
  }
  return {
    privateKey: priv.toString('base64'),
    publicKey: pub.toString('base64'),
  };
}

/**
 * AllowedIPs for a phone/laptop client: tunnel mesh + optional site LANs.
 * @param {{ includeLan?: boolean }} opts
 */
export async function buildClientAllowedIps({ includeLan = true } = {}) {
  const parts = new Set([config.wireguard?.tunnelPool || '10.66.54.0/24']);
  const fromEnv = String(config.wireguard?.clientAllowedIps || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  for (const p of fromEnv) parts.add(p);

  if (includeLan) {
    const routers = await WireGuardPeer.find({
      kind: { $ne: 'client' },
      lanSubnet: { $exists: true, $nin: [null, ''] },
      status: { $ne: 'disabled' },
    })
      .select('lanSubnet')
      .lean();
    for (const r of routers) {
      const lan = String(r.lanSubnet || '').trim();
      if (lan) parts.add(lan);
    }
  }
  return [...parts].join(', ');
}

/**
 * Build a WireGuard .conf for mobile / desktop clients.
 */
export function buildPhoneClientConfig({
  privateKey,
  tunnelIp,
  serverPublicKey,
  endpoint,
  allowedIps,
  dns,
  label,
}) {
  const lines = [
    '# QareFi site VPN — import in WireGuard app (QR or .conf)',
    label ? `# ${label}` : null,
    '[Interface]',
    `PrivateKey = ${privateKey}`,
    `Address = ${tunnelIp}/32`,
    dns ? `DNS = ${dns}` : null,
    '',
    '[Peer]',
    `PublicKey = ${serverPublicKey}`,
    `Endpoint = ${endpoint}`,
    `AllowedIPs = ${allowedIps}`,
    'PersistentKeepalive = 25',
  ].filter((l) => l != null);
  return `${lines.join('\n')}\n`;
}

function safeFilename(label) {
  const base = String(label || 'phone')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return `qarefi-wg-${base || 'phone'}.conf`;
}

/**
 * Create a phone/laptop WireGuard peer, sync to VPS, return config + QR once.
 * Private key is never stored.
 *
 * @param {{ label?: string, includeLan?: boolean }} input
 */
export async function createPhoneClientPeer(input = {}) {
  const wg = config.wireguard;
  if (!wg?.serverPublicKey || !wg?.endpoint) {
    const err = new Error('WireGuard is not configured (WG_SERVER_PUBLIC_KEY / WG_ENDPOINT).');
    err.status = 503;
    throw err;
  }
  if (!(await isWireGuardFullyConfigured())) {
    const err = new Error(
      'WireGuard VPS sync is not ready. Finish VPS SSH key setup on the WireGuard page first.'
    );
    err.status = 503;
    throw err;
  }

  const label = String(input.label || '').trim() || `Phone ${new Date().toISOString().slice(0, 10)}`;
  if (label.length < 2 || label.length > 80) {
    const err = new Error('Label must be 2–80 characters');
    err.status = 400;
    throw err;
  }

  const includeLan = input.includeLan !== false;
  const { privateKey, publicKey } = generateWireGuardKeyPair();
  const tunnelIp = await allocateNextTunnelIp({ kind: 'client' });
  const allowedIps = await buildClientAllowedIps({ includeLan });

  const peer = await WireGuardPeer.create({
    siteName: label,
    publicKey,
    tunnelIp,
    lanSubnet: '',
    kind: 'client',
    status: 'active',
    lastSeen: new Date(),
  });

  try {
    await syncWireGuardPeerToVps({
      publicKey: peer.publicKey,
      tunnelIp: peer.tunnelIp,
      lanSubnet: '',
    });
    peer.lastSyncError = '';
    await peer.save();
  } catch (e) {
    peer.status = 'error';
    peer.lastSyncError = e?.message || 'sync_failed';
    await peer.save();
    const err = new Error(e?.message || 'Peer saved but VPS sync failed');
    err.status = 502;
    err.peer = peer;
    throw err;
  }

  const configText = buildPhoneClientConfig({
    privateKey,
    tunnelIp: peer.tunnelIp,
    serverPublicKey: wg.serverPublicKey,
    endpoint: wg.endpoint,
    allowedIps,
    label,
  });

  const qrDataUrl = await QRCode.toDataURL(configText, {
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 320,
    color: { dark: '#000000', light: '#ffffff' },
  });

  return {
    peer,
    configText,
    qrDataUrl,
    filename: safeFilename(label),
    allowedIps,
    privateKeyShownOnce: true,
  };
}
