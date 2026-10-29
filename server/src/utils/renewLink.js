import { config } from '../config.js';

/**
 * Public renew page. With a renew ID the page opens on that line's bill with the customer's
 * number filled in, so the SMS link is one tap to Pay.
 */
export function publicRenewUrl(renewCode) {
  const base = `${String(config.publicAppUrl || '').replace(/\/$/, '') || 'http://localhost:5173'}/portal/renew`;
  const code = String(renewCode || '').trim();
  return code ? `${base}?id=${encodeURIComponent(code)}` : base;
}
