import { NodeSSH } from 'node-ssh';
import { config } from '../../config.js';

function shellQuote(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

/**
 * Build allowed-ips for the VPS peer entry: tunnel /32 + optional LAN CIDR.
 * @param {string} tunnelIp
 * @param {string} [lanSubnet]
 */
export function buildPeerAllowedIps(tunnelIp, lanSubnet) {
  const parts = [`${String(tunnelIp).trim()}/32`];
  const lan = String(lanSubnet || '').trim();
  if (lan) parts.push(lan);
  return parts.join(',');
}

/**
 * Push (or update) a WireGuard peer on the VPS via SSH, then persist with wg-quick save.
 * @param {{ publicKey: string, tunnelIp: string, lanSubnet?: string }} peer
 */
export async function syncWireGuardPeerToVps(peer) {
  const wg = config.wireguard;
  if (!wg?.enabled) {
    const err = new Error(
      'WireGuard VPS sync is not configured. Set WG_VPS_HOST, WG_VPS_SSH_KEY_PATH, WG_SERVER_PUBLIC_KEY, WG_ENDPOINT.'
    );
    err.status = 503;
    throw err;
  }

  const publicKey = String(peer.publicKey || '').trim();
  const tunnelIp = String(peer.tunnelIp || '').trim();
  if (!publicKey || !tunnelIp) {
    const err = new Error('publicKey and tunnelIp are required to sync WireGuard peer');
    err.status = 400;
    throw err;
  }

  const iface = String(wg.interfaceName || 'wg0').trim();
  if (!/^[a-zA-Z0-9_.-]+$/.test(iface)) {
    const err = new Error('Invalid WG_INTERFACE name');
    err.status = 500;
    throw err;
  }

  const allowedIps = buildPeerAllowedIps(tunnelIp, peer.lanSubnet);
  const commands = [
    `sudo -n wg set ${iface} peer ${shellQuote(publicKey)} allowed-ips ${shellQuote(allowedIps)}`,
    `sudo -n wg-quick save ${iface}`,
  ];

  const ssh = new NodeSSH();
  try {
    const connectOpts = {
      host: wg.vpsHost,
      port: wg.vpsSshPort || 22,
      username: wg.vpsSshUser || 'root',
      readyTimeout: 20000,
    };
    if (wg.vpsSshKeyPath) {
      connectOpts.privateKeyPath = wg.vpsSshKeyPath;
    } else if (wg.vpsSshPrivateKey) {
      connectOpts.privateKey = wg.vpsSshPrivateKey;
    } else {
      const err = new Error('Set WG_VPS_SSH_KEY_PATH (or WG_VPS_SSH_PRIVATE_KEY) for VPS access');
      err.status = 503;
      throw err;
    }
    if (wg.vpsSshPassphrase) {
      connectOpts.passphrase = wg.vpsSshPassphrase;
    }

    await ssh.connect(connectOpts);

    for (const cmd of commands) {
      const result = await ssh.execCommand(cmd);
      if (result.code !== 0 && result.code != null) {
        const detail = (result.stderr || result.stdout || `exit ${result.code}`).trim().slice(0, 500);
        const err = new Error(`VPS WireGuard command failed: ${detail}`);
        err.status = 502;
        throw err;
      }
    }

    console.log('[wireguard] peer synced', {
      tunnelIp,
      allowedIps,
      publicKeyPrefix: `${publicKey.slice(0, 12)}…`,
    });
    return { ok: true, allowedIps };
  } finally {
    try {
      ssh.dispose();
    } catch {
      /* ignore */
    }
  }
}
