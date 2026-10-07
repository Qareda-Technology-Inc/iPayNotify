import { NodeSSH } from 'node-ssh';
import { config } from '../../config.js';
import { isWireGuardFullyConfigured, resolveWgVpsSshAuth } from './wgVpsSshKey.js';

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

function vpsSshConnectOptions(auth) {
  const wg = config.wireguard;
  const connectOpts = {
    host: wg.vpsHost,
    port: wg.vpsSshPort || 22,
    username: wg.vpsSshUser || 'root',
    readyTimeout: 45000,
    tryKeyboard: false,
    algorithms: {
      kex: [
        'curve25519-sha256',
        'ecdh-sha2-nistp256',
        'ecdh-sha2-nistp384',
        'ecdh-sha2-nistp521',
        'diffie-hellman-group14-sha256',
        'diffie-hellman-group-exchange-sha256',
        'diffie-hellman-group14-sha1',
      ],
      serverHostKey: [
        'ssh-ed25519',
        'ecdsa-sha2-nistp256',
        'ecdsa-sha2-nistp384',
        'ecdsa-sha2-nistp521',
        'rsa-sha2-512',
        'rsa-sha2-256',
        'ssh-rsa',
      ],
      cipher: [
        'aes128-gcm@openssh.com',
        'aes256-gcm@openssh.com',
        'aes128-ctr',
        'aes192-ctr',
        'aes256-ctr',
        'aes256-cbc',
      ],
      hmac: ['hmac-sha2-256', 'hmac-sha2-512', 'hmac-sha1'],
    },
  };
  if (auth.privateKeyPath) {
    connectOpts.privateKeyPath = auth.privateKeyPath;
  } else {
    connectOpts.privateKey = auth.privateKey;
  }
  if (auth.passphrase) {
    connectOpts.passphrase = auth.passphrase;
  }
  return connectOpts;
}

function mapVpsSshError(e) {
  const wg = config.wireguard;
  const endpoint = `${wg.vpsHost}:${wg.vpsSshPort || 22}`;
  const msg = String(e?.message || e);

  if (e?.code === 'WG_VPS_SSH_KEY_ROTATED' && e.publicKey) {
    return e;
  }
  if (/Unsupported key format|Cannot parse privateKey/i.test(msg)) {
    const err = new Error(
      'VPS SSH private key format is not supported. In WireGuard VPN → Rotate key, then paste the new public key into the VPS authorized_keys.'
    );
    err.status = 503;
    return err;
  }
  if (/All configured authentication methods failed|Permission denied|Authentication failure/i.test(msg)) {
    const err = new Error(
      `VPS SSH login failed for ${wg.vpsSshUser || 'root'}@${endpoint}. ` +
        `TCP works but the key was rejected — copy the CURRENT public key from WireGuard VPN into authorized_keys and remove old qarefi-billing lines.`
    );
    err.status = 502;
    err.code = 'WG_VPS_AUTH_FAILED';
    return err;
  }
  if (/ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EHOSTUNREACH|Timed out while waiting for handshake|Timed out/i.test(msg)) {
    const err = new Error(
      `Cannot SSH to the WireGuard VPS at ${endpoint} (${msg}). ` +
        `Open TCP ${wg.vpsSshPort || 22}, confirm WG_VPS_SSH_USER / WG_VPS_SSH_PORT, and that sshd is listening.`
    );
    err.status = 502;
    err.code = 'WG_VPS_UNREACHABLE';
    return err;
  }
  return e;
}

/**
 * Last handshake per peer from the VPS in one SSH call: Map<publicKey, unixSeconds> (0 = never).
 * Returns null when WireGuard VPS access is not configured.
 */
export async function readWgLatestHandshakes() {
  if (!(await isWireGuardFullyConfigured())) return null;
  const auth = await resolveWgVpsSshAuth();
  if (!auth) return null;
  const iface = String(config.wireguard.interfaceName || 'wg0').trim();
  if (!/^[a-zA-Z0-9_.-]+$/.test(iface)) {
    const err = new Error('Invalid WG_INTERFACE name');
    err.status = 500;
    throw err;
  }
  const ssh = new NodeSSH();
  try {
    await ssh.connect({ ...vpsSshConnectOptions(auth), readyTimeout: 20000 });
    const result = await ssh.execCommand(`sudo -n wg show ${iface} latest-handshakes`);
    if (result.code !== 0 && result.code != null) {
      const detail = (result.stderr || result.stdout || `exit ${result.code}`).trim().slice(0, 300);
      throw new Error(`wg show latest-handshakes failed: ${detail}`);
    }
    const map = new Map();
    for (const line of String(result.stdout || '').split('\n')) {
      const [key, ts] = line.trim().split(/\s+/);
      if (key && /^\d+$/.test(ts || '')) map.set(key, Number(ts));
    }
    return map;
  } catch (e) {
    throw mapVpsSshError(e);
  } finally {
    try {
      ssh.dispose();
    } catch {
      /* ignore */
    }
  }
}

/** Smoke-test VPS SSH with the stored admin key. */
export async function testWgVpsSshConnection() {
  if (!(await isWireGuardFullyConfigured())) {
    const err = new Error('WireGuard VPS is not configured (WG_VPS_HOST / WG_SERVER_PUBLIC_KEY / WG_ENDPOINT).');
    err.status = 503;
    throw err;
  }
  const auth = await resolveWgVpsSshAuth();
  if (!auth) {
    const err = new Error('No VPS SSH key. Generate one in WireGuard VPN admin.');
    err.status = 503;
    throw err;
  }

  const wg = config.wireguard;
  const endpoint = `${wg.vpsHost}:${wg.vpsSshPort || 22}`;
  const ssh = new NodeSSH();
  try {
    await ssh.connect(vpsSshConnectOptions(auth));
    const who = await ssh.execCommand('whoami; echo OK');
    const wgShow = await ssh.execCommand(
      `sudo -n wg show ${wg.interfaceName || 'wg0'} 2>/dev/null | head -8`
    );
    return {
      ok: true,
      endpoint,
      user: wg.vpsSshUser || 'root',
      whoami: (who.stdout || '').trim(),
      wireguardPreview: (wgShow.stdout || '').trim().slice(0, 500),
      sshSource: auth.source,
    };
  } catch (e) {
    if (/Unsupported key format|Cannot parse privateKey/i.test(String(e?.message || e))) {
      try {
        const { repairWgVpsSshKeyIfNeeded } = await import('./wgVpsSshKey.js');
        const repair = await repairWgVpsSshKeyIfNeeded();
        if (repair.rotated && repair.publicKey) {
          const err = new Error(
            `VPS SSH key was regenerated. Paste this into authorized_keys, then Test again:\n${repair.publicKey}`
          );
          err.status = 503;
          err.publicKey = repair.publicKey;
          err.code = 'WG_VPS_SSH_KEY_ROTATED';
          throw err;
        }
      } catch (inner) {
        if (inner?.code === 'WG_VPS_SSH_KEY_ROTATED') throw inner;
      }
    }
    throw mapVpsSshError(e);
  } finally {
    try {
      ssh.dispose();
    } catch {
      /* ignore */
    }
  }
}

/**
 * Drop a peer from the VPS interface (tunnel IP stops routing), then persist with wg-quick save.
 * @param {{ publicKey: string }} peer
 */
export async function removeWireGuardPeerFromVps(peer) {
  const wg = config.wireguard;
  if (!(await isWireGuardFullyConfigured())) {
    const err = new Error('WireGuard VPS sync is not configured.');
    err.status = 503;
    throw err;
  }
  const publicKey = String(peer?.publicKey || '').trim();
  if (!publicKey) {
    const err = new Error('publicKey is required to remove a WireGuard peer');
    err.status = 400;
    throw err;
  }
  const iface = String(wg.interfaceName || 'wg0').trim();
  if (!/^[a-zA-Z0-9_.-]+$/.test(iface)) {
    const err = new Error('Invalid WG_INTERFACE name');
    err.status = 500;
    throw err;
  }
  const auth = await resolveWgVpsSshAuth();
  if (!auth) {
    const err = new Error('No VPS SSH key. Generate one in WireGuard admin.');
    err.status = 503;
    throw err;
  }

  const commands = [
    `sudo -n wg set ${iface} peer ${shellQuote(publicKey)} remove`,
    `sudo -n wg-quick save ${iface}`,
  ];
  const ssh = new NodeSSH();
  try {
    await ssh.connect(vpsSshConnectOptions(auth));
    for (const cmd of commands) {
      const result = await ssh.execCommand(cmd);
      if (result.code !== 0 && result.code != null) {
        const detail = (result.stderr || result.stdout || `exit ${result.code}`).trim().slice(0, 500);
        const err = new Error(`VPS WireGuard command failed: ${detail}`);
        err.status = 502;
        throw err;
      }
    }
    console.log('[wireguard] peer removed from VPS', {
      publicKeyPrefix: `${publicKey.slice(0, 12)}…`,
    });
    return { ok: true };
  } catch (e) {
    throw mapVpsSshError(e);
  } finally {
    try {
      ssh.dispose();
    } catch {
      /* ignore */
    }
  }
}

/**
 * Push (or update) a WireGuard peer on the VPS via SSH, then persist with wg-quick save.
 * @param {{ publicKey: string, tunnelIp: string, lanSubnet?: string }} peer
 */
export async function syncWireGuardPeerToVps(peer) {
  const wg = config.wireguard;
  if (!(await isWireGuardFullyConfigured())) {
    const err = new Error(
      'WireGuard VPS sync is not configured. Set WG_VPS_HOST, WG_SERVER_PUBLIC_KEY, WG_ENDPOINT, and generate an SSH key in WireGuard admin (or set WG_VPS_SSH_KEY_PATH / WG_VPS_SSH_PRIVATE_KEY).'
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

  const auth = await resolveWgVpsSshAuth();
  if (!auth) {
    const err = new Error(
      'No VPS SSH key. Open WireGuard routers → Generate SSH key, then add the public key to the VPS.'
    );
    err.status = 503;
    throw err;
  }

  const allowedIps = buildPeerAllowedIps(tunnelIp, peer.lanSubnet);
  const commands = [
    `sudo -n wg set ${iface} peer ${shellQuote(publicKey)} allowed-ips ${shellQuote(allowedIps)}`,
    `sudo -n wg-quick save ${iface}`,
  ];

  const ssh = new NodeSSH();
  try {
    await ssh.connect(vpsSshConnectOptions(auth));

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
      sshSource: auth.source,
      publicKeyPrefix: `${publicKey.slice(0, 12)}…`,
    });
    return { ok: true, allowedIps };
  } catch (e) {
    if (e?.code === 'WG_VPS_SSH_KEY_ROTATED' && e.publicKey) {
      throw e;
    }
    if (/Unsupported key format|Cannot parse privateKey/i.test(String(e?.message || e))) {
      try {
        const { repairWgVpsSshKeyIfNeeded } = await import('./wgVpsSshKey.js');
        const repair = await repairWgVpsSshKeyIfNeeded();
        if (repair.rotated && repair.publicKey) {
          const err = new Error(
            `VPS SSH key was regenerated. Paste this into the VPS authorized_keys (replace the old line), then retry add router:\n${repair.publicKey}`
          );
          err.status = 503;
          err.publicKey = repair.publicKey;
          err.code = 'WG_VPS_SSH_KEY_ROTATED';
          throw err;
        }
      } catch (inner) {
        if (inner?.code === 'WG_VPS_SSH_KEY_ROTATED') throw inner;
      }
    }
    throw mapVpsSshError(e);
  } finally {
    try {
      ssh.dispose();
    } catch {
      /* ignore */
    }
  }
}
