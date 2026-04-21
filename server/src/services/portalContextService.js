import { Router as MikrotikRouter } from '../models/index.js';
import { routerDisplayName } from '../utils/routerLabel.js';

/** Normalize IPv4 from Express / proxies (::ffff:1.2.3.4, IPv6-mapped). */
export function normalizeClientIp(raw) {
  if (raw == null || raw === '') return '';
  let s = String(raw).trim();
  if (s.startsWith('::ffff:')) s = s.slice(7);
  if (s.includes('%')) s = s.split('%')[0];
  return s;
}

/**
 * Best IP to identify "which site" the user is browsing from (first X-Forwarded-For hop or socket).
 * Requires `app.set('trust proxy', ...)` when behind nginx/Cloudflare.
 */
export function getClientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) {
    const first = String(xff).split(',')[0].trim();
    if (first) return normalizeClientIp(first);
  }
  const fromExpress = req.ip;
  if (fromExpress) return normalizeClientIp(fromExpress);
  return normalizeClientIp(req.socket?.remoteAddress);
}

const SLUG_RE = /^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$/;
const IPV4_RE = /^(?:\d{1,3}\.){3}\d{1,3}$/;

export function isValidPortalSlug(s) {
  if (!s || typeof s !== 'string') return false;
  return SLUG_RE.test(s.trim().toLowerCase());
}

export function isValidSitePublicIp(s) {
  if (!s || typeof s !== 'string') return false;
  const t = s.trim();
  if (!IPV4_RE.test(t)) return false;
  return t.split('.').every((oct) => {
    const n = Number(oct);
    return n >= 0 && n <= 255;
  });
}

/**
 * Nettportal-style: resolve router from ?r=slug (captive link) or from client WAN IPv4.
 */
export async function resolvePortalRouter(req, slugQuery) {
  const slug = slugQuery != null ? String(slugQuery).trim().toLowerCase() : '';

  if (slug) {
    if (!isValidPortalSlug(slug)) {
      return { resolved: false, reason: 'invalid_slug' };
    }
    const bySlug = await MikrotikRouter.findOne({ portalSlug: slug })
      .select('_id name comment')
      .lean();
    if (bySlug) {
      return {
        resolved: true,
        match: 'slug',
        router: { id: String(bySlug._id), name: routerDisplayName(bySlug) },
      };
    }
    return { resolved: false, reason: 'unknown_slug' };
  }

  const ip = getClientIp(req);
  if (!ip || !isValidSitePublicIp(ip)) {
    return { resolved: false, reason: 'no_ip_match' };
  }

  const byIp = await MikrotikRouter.findOne({ sitePublicIp: ip })
    .select('_id name comment')
    .lean();
  if (byIp) {
    return {
      resolved: true,
      match: 'ip',
      router: { id: String(byIp._id), name: routerDisplayName(byIp) },
    };
  }

  return { resolved: false, reason: 'no_match' };
}
