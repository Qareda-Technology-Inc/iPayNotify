import { renderLoginPage } from './captiveTemplates.js';

/**
 * Hotspot login.html served by the router. MikroTik replaces $(...) before the guest sees it.
 * Username is the ticket code. Password stays empty (username-only hotspot users).
 * @param {Parameters<typeof renderLoginPage>[0]} opts
 */
export function buildCaptiveLoginHtml(opts = {}) {
  return renderLoginPage({ ...opts, mode: opts.mode || 'router' });
}
