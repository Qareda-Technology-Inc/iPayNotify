import { Organization, Router as MikrotikRouter } from '../models/index.js';
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

async function withOrgGate(routerDoc, match) {
  const organizationId = routerDoc.organizationId ? String(routerDoc.organizationId) : null;
  if (!organizationId) {
    return { resolved: false, reason: 'router_missing_org' };
  }
  const org = await Organization.findById(organizationId)
    .select('name slug status billing')
    .lean();
  if (!org) {
    return { resolved: false, reason: 'org_missing' };
  }
  if (org.status === 'suspended') {
    return { resolved: false, reason: 'org_suspended' };
  }
  const brandName =
    String(org.billing?.merchantDisplayName || '').trim() || String(org.name || '').trim();
  const logoUrl = String(org.billing?.logoUrl || '').trim();
  return {
    resolved: true,
    match,
    router: {
      id: String(routerDoc._id),
      name: routerDisplayName(routerDoc),
      organizationId,
    },
    organization: {
      id: organizationId,
      name: org.name,
      slug: org.slug,
      status: org.status,
    },
    branding: {
      displayName: brandName,
      logoUrl: /^https:\/\//i.test(logoUrl) ? logoUrl : '',
    },
  };
}

/**
 * Resolve venue from captive/QR `?r=slug` or client WAN IPv4.
 * Always returns organizationId when resolved so renew/hotspot stay tenant-scoped.
 * Same PPPoE usernames may exist in other orgs — callers must use this router id.
 */
export async function resolvePortalRouter(req, slugQuery) {
  const slug = slugQuery != null ? String(slugQuery).trim().toLowerCase() : '';

  if (slug) {
    if (!isValidPortalSlug(slug)) {
      return { resolved: false, reason: 'invalid_slug' };
    }
    const bySlug = await MikrotikRouter.findOne({ portalSlug: slug })
      .select('_id name comment organizationId')
      .lean();
    if (bySlug) return withOrgGate(bySlug, 'slug');
    return { resolved: false, reason: 'unknown_slug' };
  }

  const ip = getClientIp(req);
  if (!ip || !isValidSitePublicIp(ip)) {
    return { resolved: false, reason: 'no_ip_match' };
  }

  const byIp = await MikrotikRouter.findOne({ sitePublicIp: ip })
    .select('_id name comment organizationId')
    .lean();
  if (byIp) return withOrgGate(byIp, 'ip');

  return { resolved: false, reason: 'no_match' };
}

/** Shared portal-site resolution for public POST bodies (`portalSlug` or query `r`). */
export async function resolvePortalSiteFromRequest(req, portalSlugBody) {
  const slug =
    portalSlugBody != null && String(portalSlugBody).trim()
      ? String(portalSlugBody).trim()
      : req.query.r ?? req.query.router ?? req.query.site;
  return resolvePortalRouter(req, slug);
}
