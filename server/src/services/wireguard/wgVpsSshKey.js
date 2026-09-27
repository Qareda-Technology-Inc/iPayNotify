import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { PlatformSettings } from '../../models/index.js';
import { config } from '../../config.js';

const require = createRequire(import.meta.url);
const { utils: ssh2Utils } = require('ssh2');

/**
 * Public info for admin UI (never includes private key).
 */
export async function getWgVpsSshKeyPublic() {
  const doc = await PlatformSettings.findOne({ key: 'default' });
  const envHasKey = Boolean(
    config.wireguard?.vpsSshKeyPath || config.wireguard?.vpsSshPrivateKey
  );
  const dbPub = String(doc?.wgVpsSshPublicKey || '').trim();
  let parseOk = null;
  if (doc) {
    const full = await PlatformSettings.findOne({ key: 'default' }).select('+wgVpsSshPrivateKey');
    if (full?.wgVpsSshPrivateKey) {
      parseOk = assertSsh2PrivateKey(full.wgVpsSshPrivateKey) === null;
    }
  }
  return {
    hasKey: Boolean(dbPub) || envHasKey,
    source: dbPub ? 'database' : envHasKey ? 'env' : 'none',
    publicKey: dbPub,
    comment: doc?.wgVpsSshKeyComment || '',
    createdAt: doc?.wgVpsSshKeyCreatedAt || null,
    authorizedKeysLine: dbPub,
    privateKeyParseOk: parseOk,
  };
}

/** @returns {Error|null} */
function assertSsh2PrivateKey(pem) {
  const key = String(pem || '').replace(/\\n/g, '\n').trim();
  if (!key) return new Error('empty private key');
  const parsed = ssh2Utils.parseKey(key);
  if (parsed instanceof Error) return parsed;
  return null;
}

function makeComment() {
  const hostHint = String(config.publicApiUrl || 'api')
    .replace(/^https?:\/\//, '')
    .split('/')[0]
    .replace(/[^a-zA-Z0-9.-]/g, '') || 'api';
  return `qarefi-billing@${hostHint}`;
}

/**
 * Prefer ssh-keygen OpenSSH keys (best ssh2 + panel compatibility).
 * Order: Ed25519 → RSA 2048 → Node RSA PKCS#1 fallback.
 * VPS panels typically accept: RSA 2048–8192, ECDSA P-256/384/521, Ed25519.
 */
function generateKeyMaterial(comment) {
  const viaKeygen = (algArgs) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qarefi-wg-ssh-'));
    try {
      const keyPath = path.join(dir, 'id');
      execFileSync('ssh-keygen', [...algArgs, '-f', keyPath, '-N', '', '-C', comment, '-q'], {
        stdio: 'pipe',
      });
      const privateKey = fs.readFileSync(keyPath, 'utf8');
      const publicKey = fs.readFileSync(`${keyPath}.pub`, 'utf8').trim();
      const err = assertSsh2PrivateKey(privateKey);
      if (err) throw err;
      return { privateKey, publicKey };
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };

  try {
    const ed = viaKeygen(['-t', 'ed25519']);
    return { ...ed, method: 'ssh-keygen-ed25519' };
  } catch (e1) {
    console.warn('[wireguard] ssh-keygen ed25519 failed, trying rsa:', e1?.message || e1);
  }

  try {
    const rsa = viaKeygen(['-t', 'rsa', '-b', '2048']);
    return { ...rsa, method: 'ssh-keygen-rsa' };
  } catch (e2) {
    console.warn('[wireguard] ssh-keygen rsa failed, using node pkcs1:', e2?.message || e2);
  }

  const { publicKey: spkiPem, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
  });
  const err = assertSsh2PrivateKey(privateKey);
  if (err) {
    const e = new Error(`Generated SSH key is not usable by ssh2: ${err.message}`);
    e.status = 500;
    throw e;
  }
  return {
    privateKey,
    publicKey: pemSpkiToOpenSshRsa(spkiPem, comment),
    method: 'node-pkcs1-rsa',
  };
}

/**
 * Generate / replace VPS SSH keypair and store in PlatformSettings.
 * @param {{ rotate?: boolean }} [opts]
 */
export async function generateWgVpsSshKey(opts = {}) {
  const rotate = Boolean(opts.rotate);
  const existing = await PlatformSettings.findOne({ key: 'default' }).select(
    '+wgVpsSshPrivateKey wgVpsSshPublicKey'
  );
  if (existing?.wgVpsSshPrivateKey && !rotate) {
    const err = new Error(
      'SSH key already exists. Pass rotate=true to replace it (then update authorized_keys on the VPS).'
    );
    err.status = 409;
    throw err;
  }

  const comment = makeComment();
  const { privateKey, publicKey, method } = generateKeyMaterial(comment);

  const doc = await PlatformSettings.findOneAndUpdate(
    { key: 'default' },
    {
      $set: {
        wgVpsSshPublicKey: publicKey,
        wgVpsSshPrivateKey: privateKey,
        wgVpsSshKeyCreatedAt: new Date(),
        wgVpsSshKeyComment: comment,
      },
      $setOnInsert: { defaultPlatformFeeBps: 500 },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  return {
    publicKey,
    comment,
    createdAt: doc.wgVpsSshKeyCreatedAt,
    rotated: rotate || Boolean(existing?.wgVpsSshPrivateKey),
    source: 'database',
    method,
  };
}

function encodeSshString(buf) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(b.length, 0);
  return Buffer.concat([len, b]);
}

function encodeSshMpInt(buf) {
  let b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  if (b.length && b[0] & 0x80) {
    b = Buffer.concat([Buffer.from([0]), b]);
  }
  return encodeSshString(b);
}

function pemSpkiToOpenSshRsa(spkiPem, comment) {
  const keyObj = crypto.createPublicKey(spkiPem);
  const jwk = keyObj.export({ format: 'jwk' });
  const e = Buffer.from(jwk.e, 'base64url');
  const n = Buffer.from(jwk.n, 'base64url');
  const keyType = Buffer.from('ssh-rsa');
  const blob = Buffer.concat([encodeSshString(keyType), encodeSshMpInt(e), encodeSshMpInt(n)]);
  const line = `ssh-rsa ${blob.toString('base64')}`;
  return comment ? `${line} ${comment}` : line;
}

/**
 * If DB key is unusable by ssh2 (old ed25519 PKCS8), auto-rotate and return the new public key.
 * @returns {Promise<{ rotated: boolean, publicKey?: string }>}
 */
export async function repairWgVpsSshKeyIfNeeded() {
  const doc = await PlatformSettings.findOne({ key: 'default' }).select('+wgVpsSshPrivateKey');
  if (!doc?.wgVpsSshPrivateKey) {
    const created = await generateWgVpsSshKey({ rotate: false });
    return { rotated: true, publicKey: created.publicKey, created: true };
  }
  const bad = assertSsh2PrivateKey(doc.wgVpsSshPrivateKey);
  if (!bad) return { rotated: false };

  console.warn('[wireguard] Repairing unusable VPS SSH private key:', bad.message);
  const created = await generateWgVpsSshKey({ rotate: true });
  return { rotated: true, publicKey: created.publicKey, reason: bad.message };
}

/**
 * Resolve SSH auth for VPS: env file/path first, else DB-generated key.
 * Auto-repairs invalid DB keys (forces caller to update authorized_keys when rotated).
 */
export async function resolveWgVpsSshAuth() {
  const wg = config.wireguard;
  if (wg?.vpsSshKeyPath) {
    return {
      privateKeyPath: wg.vpsSshKeyPath,
      passphrase: wg.vpsSshPassphrase || undefined,
      source: 'env_path',
    };
  }
  if (wg?.vpsSshPrivateKey) {
    const pem = wg.vpsSshPrivateKey.replace(/\\n/g, '\n');
    const bad = assertSsh2PrivateKey(pem);
    if (bad) {
      const err = new Error(
        `WG_VPS_SSH_PRIVATE_KEY is not usable by ssh2 (${bad.message}). Remove it and use WireGuard VPN → Rotate key instead.`
      );
      err.status = 503;
      throw err;
    }
    return {
      privateKey: pem,
      passphrase: wg.vpsSshPassphrase || undefined,
      source: 'env_pem',
    };
  }

  const repair = await repairWgVpsSshKeyIfNeeded();
  if (repair.rotated) {
    const err = new Error(
      `VPS SSH key was regenerated (previous format unsupported). Copy this public key to the VPS authorized_keys, then retry:\n${repair.publicKey}`
    );
    err.status = 503;
    err.publicKey = repair.publicKey;
    err.code = 'WG_VPS_SSH_KEY_ROTATED';
    throw err;
  }

  const doc = await PlatformSettings.findOne({ key: 'default' }).select('+wgVpsSshPrivateKey');
  if (doc?.wgVpsSshPrivateKey) {
    return {
      privateKey: doc.wgVpsSshPrivateKey,
      source: 'database',
    };
  }
  return null;
}

export async function isWgVpsSshReady() {
  try {
    const auth = await resolveWgVpsSshAuth();
    return Boolean(auth);
  } catch (e) {
    if (e?.code === 'WG_VPS_SSH_KEY_ROTATED') return true; /* key exists, VPS just needs update */
    return false;
  }
}

/** Host/endpoint/pubkey set AND an SSH key available (env or DB). */
export async function isWireGuardFullyConfigured() {
  const wg = config.wireguard;
  if (!wg?.vpsHost || !wg?.serverPublicKey || !wg?.endpoint) return false;
  if (wg.vpsSshKeyPath || wg.vpsSshPrivateKey) return true;
  const doc = await PlatformSettings.findOne({ key: 'default' }).select('wgVpsSshPublicKey');
  return Boolean(doc?.wgVpsSshPublicKey);
}
