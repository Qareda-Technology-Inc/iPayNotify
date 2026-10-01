import { createRequire } from 'module';
import { config } from '../config.js';
import { isWireGuardFullyConfigured, resolveWgVpsSshAuth } from '../services/wireguard/wgVpsSshKey.js';

const require = createRequire(import.meta.url);
const { Client } = require('ssh2');
const { NodeSSH } = require('node-ssh');

/**
 * Is this host in the WireGuard tunnel pool (e.g. 10.66.54.2)?
 * Those addresses only exist on the WG VPS — not on Render/Railway/etc.
 */
export function isWgTunnelHost(host) {
  const h = String(host || '').trim();
  const prefix = String(config.wireguard?.tunnelPrefix || '10.66.54.');
  return h.startsWith(prefix);
}

/**
 * auto (default) | always | never
 * When the Node API is not on the WireGuard VPS, tunnel IPs are unreachable
 * unless we SSH-jump through WG_VPS_HOST.
 */
export function wgMikrotikJumpMode() {
  const raw = String(process.env.WG_MIKROTIK_JUMP || 'auto').trim().toLowerCase();
  if (raw === 'always' || raw === '1' || raw === 'true' || raw === 'yes') return 'always';
  if (raw === 'never' || raw === '0' || raw === 'false' || raw === 'no') return 'never';
  return 'auto';
}

function forwardTimeoutMs() {
  const n = Number(process.env.WG_JUMP_FORWARD_TIMEOUT_MS);
  return Number.isFinite(n) && n >= 1000 ? n : 8000;
}

export async function canUseWgJump() {
  if (!(await isWireGuardFullyConfigured())) return false;
  const auth = await resolveWgVpsSshAuth();
  return Boolean(auth && config.wireguard?.vpsHost);
}

/**
 * Open SSH to the WireGuard VPS, then TCP-forward to mikrotikHost:mikrotikPort.
 * Returns { bastion, stream } — caller must bastion.end() when done.
 */
export async function openWgJumpStream(mikrotikHost, mikrotikPort) {
  const auth = await resolveWgVpsSshAuth();
  if (!auth) {
    const err = new Error(
      'Cannot jump to WireGuard tunnel routers: no VPS SSH key. Generate one in WireGuard VPN admin.'
    );
    err.status = 503;
    throw err;
  }

  const wg = config.wireguard;
  const bastion = new Client();
  const connectOpts = {
    host: wg.vpsHost,
    port: wg.vpsSshPort || 22,
    username: wg.vpsSshUser || 'root',
    readyTimeout: 20000,
    keepaliveInterval: 15000,
  };
  if (auth.privateKeyPath) connectOpts.privateKey = require('fs').readFileSync(auth.privateKeyPath);
  else connectOpts.privateKey = String(auth.privateKey || '').replace(/\\n/g, '\n');
  if (auth.passphrase) connectOpts.passphrase = auth.passphrase;

  await new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      try {
        bastion.end();
      } catch {
        /* ignore */
      }
      const e = new Error(
        `WireGuard jump: SSH to VPS ${wg.vpsHost}:${wg.vpsSshPort || 22} timed out. ` +
          `Confirm WG_VPS_* and that the API can reach the VPS.`
      );
      e.code = 'WG_VPS_UNREACHABLE';
      reject(e);
    }, 20000);
    bastion
      .on('ready', () => {
        clearTimeout(t);
        resolve();
      })
      .on('error', (e) => {
        clearTimeout(t);
        const err = new Error(
          `WireGuard jump: cannot SSH to VPS ${wg.vpsHost}: ${e.message}. ` +
            `Paste the current WireGuard admin public key into the VPS authorized_keys.`
        );
        err.code = 'WG_VPS_UNREACHABLE';
        reject(err);
      })
      .connect(connectOpts);
  });

  const stream = await new Promise((resolve, reject) => {
    let settled = false;
    const unreachable = (reason) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        bastion.end();
      } catch {
        /* ignore */
      }
      const e = new Error(`WireGuard jump: VPS cannot reach ${mikrotikHost}:${mikrotikPort} (${reason}).`);
      e.code = 'WG_ROUTER_UNREACHABLE';
      e.status = 502;
      reject(e);
    };
    /* A live tunnel peer answers in well under a second; the VPS kernel would otherwise wait ~2 minutes. */
    const timer = setTimeout(() => unreachable('no answer through the tunnel'), forwardTimeoutMs());
    bastion.forwardOut('127.0.0.1', 0, String(mikrotikHost), Number(mikrotikPort) || 22, (err, s) => {
      if (err) return unreachable(err.message);
      if (settled) {
        s.destroy?.();
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(s);
    });
  });

  stream.on('close', () => {
    try {
      bastion.end();
    } catch {
      /* ignore */
    }
  });

  return { bastion, stream };
}

/** Quick probe from VPS: can it ping / TCP the tunnel IP? (optional diagnostics) */
export async function probeTunnelFromVps(tunnelIp) {
  const auth = await resolveWgVpsSshAuth();
  if (!auth) return { ok: false, error: 'no_vps_key' };
  const ssh = new NodeSSH();
  const wg = config.wireguard;
  try {
    const opts = {
      host: wg.vpsHost,
      port: wg.vpsSshPort || 22,
      username: wg.vpsSshUser || 'root',
      readyTimeout: 20000,
    };
    if (auth.privateKeyPath) opts.privateKeyPath = auth.privateKeyPath;
    else opts.privateKey = String(auth.privateKey || '').replace(/\\n/g, '\n');
    if (auth.passphrase) opts.passphrase = auth.passphrase;
    await ssh.connect(opts);
    const ip = String(tunnelIp).replace(/[^0-9.]/g, '');
    const ping = await ssh.execCommand(`ping -c 1 -W 2 ${ip} 2>&1 | tail -2`);
    const tcp22 = await ssh.execCommand(`timeout 3 bash -c 'echo >/dev/tcp/${ip}/22' 2>&1; echo exit:$?`);
    const tcp8728 = await ssh.execCommand(`timeout 3 bash -c 'echo >/dev/tcp/${ip}/8728' 2>&1; echo exit:$?`);
    const wgShow = await ssh.execCommand(`sudo -n wg show ${wg.interfaceName || 'wg0'} 2>/dev/null | head -20`);
    return {
      ok: true,
      ping: (ping.stdout || ping.stderr || '').trim(),
      tcp22: (tcp22.stdout || '').trim(),
      tcp8728: (tcp8728.stdout || '').trim(),
      wireguard: (wgShow.stdout || '').trim().slice(0, 800),
    };
  } catch (e) {
    return { ok: false, error: e.message };
  } finally {
    try {
      ssh.dispose();
    } catch {
      /* ignore */
    }
  }
}
