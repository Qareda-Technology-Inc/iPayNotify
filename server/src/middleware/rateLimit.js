import { getClientIp } from '../services/portalContextService.js';
import { normalizeGhanaMsisdn } from '../utils/phoneGhana.js';

/**
 * Small in-memory fixed-window limiter (one API instance). Limits for customer-facing routes are
 * generous per IP because every buyer on a hotspot site shares the site's public IP; the tight
 * limits are per phone number or per payment reference instead.
 */
const buckets = new Map();
let lastSweep = Date.now();

function sweep(now) {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
}

/** Counts one hit; returns seconds until the window resets when over the limit, else 0. */
export function hit(bucketKey, windowMs, max, now = Date.now()) {
  sweep(now);
  let b = buckets.get(bucketKey);
  if (!b || b.resetAt <= now) {
    b = { count: 0, resetAt: now + windowMs };
    buckets.set(bucketKey, b);
  }
  b.count += 1;
  return b.count > max ? Math.max(1, Math.ceil((b.resetAt - now) / 1000)) : 0;
}

export function resetRateLimits() {
  buckets.clear();
}

/**
 * @param {{ name: string, windowMs: number, max: number, key?: (req) => string, message?: string }} opts
 *   key — what to count by (default: client IP); return '' to skip counting this request.
 */
export function rateLimit({ name, windowMs, max, key = (req) => getClientIp(req), message }) {
  return (req, res, next) => {
    if (process.env.RATE_LIMIT_DISABLED === 'true') return next();
    const k = String(key(req) || '');
    if (!k) return next();
    const retryAfter = hit(`${name}:${k}`, windowMs, max);
    if (!retryAfter) return next();
    console.warn('[rate-limit]', name, k, `retry in ${retryAfter}s`);
    res.set('Retry-After', String(retryAfter));
    return res.status(429).json({
      error: message || 'Too many requests. Please wait a moment and try again.',
      retryAfterSeconds: retryAfter,
    });
  };
}

export const byIp = (req) => getClientIp(req);
export const byPhone = (req) =>
  normalizeGhanaMsisdn(String(req.body?.customerMsisdn || req.body?.phone || '').replace(/\s/g, '')) || '';
export const byEmail = (req) => String(req.body?.email || '').trim().toLowerCase();
export const byRef = (req) => String(req.params?.ref || '').trim();

const MIN = 60_000;

/** Ready-made limits for the public API. */
export const limits = {
  /** Catch-all for /api/public: a busy site's buyers share one IP. */
  publicApi: rateLimit({ name: 'public', windowMs: 10 * MIN, max: 3000 }),
  checkoutPerPhone: rateLimit({
    name: 'checkout-phone',
    windowMs: 10 * MIN,
    max: 6,
    key: byPhone,
    message: 'Too many payment attempts for this number. Please wait a few minutes and try again.',
  }),
  checkoutPerIp: rateLimit({ name: 'checkout-ip', windowMs: 10 * MIN, max: 120 }),
  /** Renewal quotes reveal whether an account exists: keep guessing slow. */
  renewQuote: rateLimit({ name: 'renew-quote', windowMs: 10 * MIN, max: 40 }),
  /** The pay-return page polls every couple of seconds while the customer approves on their phone. */
  statusPerRef: rateLimit({ name: 'status-ref', windowMs: MIN, max: 90, key: byRef }),
  clientEvent: rateLimit({ name: 'client-event', windowMs: 10 * MIN, max: 300 }),
  loginPerIp: rateLimit({
    name: 'login-ip',
    windowMs: 15 * MIN,
    max: 30,
    message: 'Too many sign-in attempts. Please wait 15 minutes and try again.',
  }),
  loginPerEmail: rateLimit({
    name: 'login-email',
    windowMs: 15 * MIN,
    max: 10,
    key: byEmail,
    message: 'Too many sign-in attempts for this account. Please wait 15 minutes and try again.',
  }),
  /** First-run setup and invite acceptance. */
  accountSetup: rateLimit({ name: 'account-setup', windowMs: 15 * MIN, max: 20 }),
  /** MikroTik self-registration and bootstrap fetches. */
  routerRegister: rateLimit({ name: 'router-register', windowMs: 10 * MIN, max: 60 }),
};
