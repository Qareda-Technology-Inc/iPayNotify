import { Organization, PlanPackage, Router as MikrotikRouter } from '../models/index.js';
import { routerDisplayName } from '../utils/routerLabel.js';
import {
  clipPortalCopy,
  normalizePortalDesign,
  normalizeVoucherDesign,
} from '../utils/portalDesigns.js';

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

function slugBase(router) {
  const raw = String(router.comment || router.name || '').toLowerCase();
  const s = raw
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
    .replace(/-+$/g, '');
  return s && !/^\d+(-\d+)*$/.test(s) ? s : 'site';
}

/**
 * Give a router a portal slug (used in login/buy links) if it has none, derived from its name.
 * Returns the slug. Saves the router.
 */
export async function ensurePortalSlug(router) {
  const current = String(router.portalSlug || '').trim().toLowerCase();
  if (current) return current;
  const base = slugBase(router);
  for (let i = 0; i < 20; i += 1) {
    const candidate =
      i === 0 ? base : `${base}-${i < 10 ? i + 1 : Math.random().toString(36).slice(2, 6)}`;
    if (!isValidPortalSlug(candidate)) continue;
    if (await MikrotikRouter.exists({ portalSlug: candidate })) continue;
    try {
      router.portalSlug = candidate;
      await router.save();
      return candidate;
    } catch (e) {
      if (e?.code !== 11000) throw e;
      router.portalSlug = undefined;
    }
  }
  const e = new Error('Could not create a portal link name for this router. Try again.');
  e.status = 500;
  throw e;
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
    .select('name slug status statusReason billing')
    .lean();
  if (!org) {
    return { resolved: false, reason: 'org_missing' };
  }
  /* An unpaid platform bill locks the admin dashboard only; customers keep buying. */
  if (org.status === 'suspended' && org.statusReason !== 'unpaid') {
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
      portalDesign: normalizePortalDesign(org.billing?.portalDesign),
      voucherDesign: normalizeVoucherDesign(org.billing?.voucherDesign),
      portalHeadline: clipPortalCopy('portalHeadline', org.billing?.portalHeadline),
      portalSubtitle: clipPortalCopy('portalSubtitle', org.billing?.portalSubtitle),
      portalButtonLabel: clipPortalCopy('portalButtonLabel', org.billing?.portalButtonLabel),
      portalBuyLabel: clipPortalCopy('portalBuyLabel', org.billing?.portalBuyLabel),
      portalFooter: clipPortalCopy('portalFooter', org.billing?.portalFooter),
      portalSupportPhone: clipPortalCopy('portalSupportPhone', org.billing?.portalSupportPhone),
      portalShowPlans: org.billing?.portalShowPlans !== false,
      voucherTitle: clipPortalCopy('voucherTitle', org.billing?.voucherTitle),
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

/**
 * Query for the hotspot plans sold at one site: the router's chosen plans, or every active
 * hotspot plan of the organisation when none are chosen, so the login page, buy page and checkout
 * always offer the same plans. Which plans a site sells is decided per site only: the old
 * organisation-wide "show online" tick (`showOnPortal`) is ignored, because unticking it for one
 * site emptied every other site that sold that plan.
 */
export async function sitePlanQuery(organizationId, routerId) {
  const q = { organizationId, kind: 'hotspot', isActive: true };
  if (!routerId) return q;
  const router = await MikrotikRouter.findOne({ _id: routerId, organizationId })
    .select('portalPackageIds')
    .lean();
  const chosen = router?.portalPackageIds || [];
  if (chosen.length) q._id = { $in: chosen };
  return q;
}

/** packageId → this site's own price in pesewas (only plans the site prices differently). */
export async function sitePriceMap(routerId) {
  if (!routerId) return new Map();
  const router = await MikrotikRouter.findById(routerId).select('portalPrices').lean();
  return new Map((router?.portalPrices || []).map((x) => [String(x.packageId), x.priceCents]));
}

/** Plans with this site's prices applied, cheapest first. */
export function applySitePrices(plans, prices) {
  return plans
    .map((p) => (prices.has(String(p._id)) ? { ...p, priceCents: prices.get(String(p._id)) } : p))
    .sort((a, b) => (a.priceCents ?? 0) - (b.priceCents ?? 0) || String(a.name).localeCompare(String(b.name)));
}

/** Active hotspot plans shown on a site's login page, cheapest first, at this site's prices. */
export async function loadPortalPlans(organizationId, routerId) {
  if (!organizationId) return [];
  const q = await sitePlanQuery(organizationId, routerId);
  const plans = await PlanPackage.find(q)
    .select(
      'name priceCents currency dataLimitBytes timeLimitSeconds elapsedSeconds pausedSeconds ticketDurationType usersPerTicket speedDownMbps'
    )
    .lean();
  return applySitePrices(plans, await sitePriceMap(routerId)).slice(0, 12);
}

/** Shared portal-site resolution for public POST bodies (`portalSlug` or query `r`). */
export async function resolvePortalSiteFromRequest(req, portalSlugBody) {
  const slug =
    portalSlugBody != null && String(portalSlugBody).trim()
      ? String(portalSlugBody).trim()
      : req.query.r ?? req.query.router ?? req.query.site;
  return resolvePortalRouter(req, slug);
}
