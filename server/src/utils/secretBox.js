import crypto from 'crypto';
import { config } from '../config.js';

/**
 * AES-256-GCM for secrets stored in Mongo (router API/SSH passwords).
 * Stored form: `enc:v1:<iv b64>:<tag b64>:<ciphertext b64>`.
 * Values without the prefix are treated as legacy plaintext, so reads keep working
 * before `npm run db:encrypt-router-secrets` has run.
 */
const PREFIX = 'enc:v1:';

let cachedKey;

/** 32-byte key from ROUTER_SECRET_KEY (64 hex chars or base64). Null when unset. */
function secretKey() {
  if (cachedKey !== undefined) return cachedKey;
  const raw = String(config.routerSecretKey || '').trim();
  if (!raw) {
    cachedKey = null;
    return cachedKey;
  }
  const buf = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  if (buf.length !== 32) {
    throw new Error('ROUTER_SECRET_KEY must be 32 bytes (64 hex chars or base64).');
  }
  cachedKey = buf;
  return cachedKey;
}

export function secretEncryptionEnabled() {
  return Boolean(secretKey());
}

export function isEncryptedSecret(value) {
  return typeof value === 'string' && value.startsWith(PREFIX);
}

/** Encrypt for storage. Empty, already-encrypted, or no-key values pass through unchanged. */
export function encryptSecret(value) {
  if (value == null || value === '') return value;
  const plain = String(value);
  if (isEncryptedSecret(plain)) return plain;
  const key = secretKey();
  if (!key) return plain;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${ct.toString('base64')}`;
}

/** Decrypt a stored value. Plaintext (legacy) values are returned as-is. */
export function decryptSecret(value) {
  if (!isEncryptedSecret(value)) return value;
  const key = secretKey();
  if (!key) {
    const e = new Error(
      'Router password is encrypted but ROUTER_SECRET_KEY is not set on this server.'
    );
    e.status = 500;
    throw e;
  }
  const [ivB64, tagB64, ctB64] = value.slice(PREFIX.length).split(':');
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(ctB64, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    const e = new Error(
      'Could not decrypt router password — ROUTER_SECRET_KEY differs from the key it was saved with.'
    );
    e.status = 500;
    throw e;
  }
}
