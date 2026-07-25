import crypto from 'crypto';
import { PppoeAccount } from '../models/index.js';

/** Crockford-ish alphabet — no I/O/0/1 to reduce misreads when SMS'd. */
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Normalize customer input: strip spaces/dashes, uppercase. */
export function normalizeRenewCode(raw) {
  if (raw == null || raw === '') return '';
  return String(raw)
    .trim()
    .toUpperCase()
    .replace(/[\s\-_]+/g, '');
}

export function looksLikeRenewCode(raw) {
  const c = normalizeRenewCode(raw);
  return /^[A-Z2-9]{6,12}$/.test(c);
}

function randomRenewCodeBody(length = 6) {
  let out = '';
  const bytes = crypto.randomBytes(length);
  for (let i = 0; i < length; i++) out += CODE_CHARS[bytes[i] % CODE_CHARS.length];
  return out;
}

/**
 * Platform-unique public renew ID (e.g. QF7K2M9P).
 * Prefix QF keeps SMS recognizable; body is random.
 */
export async function allocateUniqueRenewCode() {
  for (let i = 0; i < 30; i++) {
    const code = `QF${randomRenewCodeBody(6)}`;
    const exists = await PppoeAccount.exists({ renewCode: code });
    if (!exists) return code;
  }
  throw new Error('Could not allocate unique renew code');
}
