import express from 'express';
import mongoose from 'mongoose';
import { Organization, OrganizationAuditLog, PlanPackage, Router as MikrotikRouter } from '../models/index.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { config } from '../config.js';
import { sanitizeBillingForClient } from '../services/orgBillingService.js';
import { logOrgAudit, formatOrgAuditCsv } from '../services/orgAuditService.js';
import { normalizeOrgModules } from '../services/orgModulesService.js';
import {
  getOrgUsageAndLimits,
  normalizeOrgLimits,
} from '../services/orgLimitsService.js';
import { routerDisplayName } from '../utils/routerLabel.js';
import { requireRoles } from '../middleware/requireRoles.js';
import { PORTAL_DESIGN_IDS, VOUCHER_DESIGN_IDS, clipPortalCopy } from '../utils/portalDesigns.js';
import { LOGIN_THEMES, SAMPLE_PLANS, renderLoginPage } from '../services/captiveTemplates.js';
import { loadPortalPlans } from '../services/portalContextService.js';
import {
  listOrgTeam,
  inviteOrgTeamMember,
  resendOrgTeamInvite,
  updateOrgTeamMember,
  removeOrgTeamMember,
} from '../services/orgTeamService.js';

export const organizationRouter = express.Router();

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
const STATUSES = new Set(['active', 'trial', 'past_due', 'suspended']);

function publicAppBase() {
  return String(config.publicAppUrl || '').replace(/\/$/, '') || 'http://localhost:5173';
}

/** Customer links use each router’s portalSlug (not Organisation.slug). */
async function portalSitesForOrg(organizationId) {
  const base = publicAppBase();
  const routers = await MikrotikRouter.find({
    organizationId,
    portalSlug: { $exists: true, $nin: [null, ''] },
  })
    .select('name comment portalSlug')
    .sort({ name: 1 })
    .lean();
  return routers.map((r) => {
    const slug = String(r.portalSlug || '').trim().toLowerCase();
    const enc = encodeURIComponent(slug);
    return {
      id: String(r._id),
      name: routerDisplayName(r),
      portalSlug: slug,
      renewUrl: `${base}/portal/renew?r=${enc}`,
      hotspotUrl: `${base}/portal/hotspot?r=${enc}`,
      loginUrl: `${base}/portal/login?r=${enc}`,
    };
  });
}

async function jsonWithPortal(doc) {
  const o = doc.toObject ? doc.toObject() : doc;
  const { billing, ...rest } = o;
  const oid = o._id;
  const [portalSites, usagePack] = await Promise.all([
    portalSitesForOrg(oid),
    getOrgUsageAndLimits(oid),
  ]);
  return {
    ...rest,
    walletBalanceCents: Number(o.walletBalanceCents) || 0,
    billing: await sanitizeBillingForClient(billing),
    modules: normalizeOrgModules(o.modules, o.slug),
    limits: normalizeOrgLimits(o.limits),
    usage: usagePack.usage,
    portalSites,
    portal: {
      baseUrl: publicAppBase(),
      note: 'Use portalSites[].renewUrl / hotspotUrl (router portal slug). Organisation slug is not a portal key.',
    },
  };
}

/**
 * Apply `body.billing` onto a Mongoose organisation document (mutates).
 * Omitted credential fields keep existing values so PATCH can update labels only.
 */
function applyBillingPatch(doc, billingBody, { isSuperAdmin = false } = {}) {
  if (!billingBody || typeof billingBody !== 'object') return;
  if (!doc.billing) doc.billing = {};
  const b = billingBody;

  if (b.merchantDisplayName !== undefined) {
    doc.billing.merchantDisplayName = String(b.merchantDisplayName || '').trim();
  }
  if (b.smsBrandName !== undefined) {
    doc.billing.smsBrandName = String(b.smsBrandName || '').trim();
  }
  if (b.logoUrl !== undefined) {
    const raw = String(b.logoUrl || '').trim();
    if (raw && !/^https:\/\//i.test(raw)) {
      const err = new Error('logoUrl must be an https:// URL');
      err.status = 400;
      throw err;
    }
    doc.billing.logoUrl = raw;
  }
  if (b.portalDesign !== undefined) {
    const id = String(b.portalDesign || '').trim();
    if (!PORTAL_DESIGN_IDS.includes(id)) {
      const err = new Error('Unknown portal design');
      err.status = 400;
      throw err;
    }
    doc.billing.portalDesign = id;
  }
  if (b.voucherDesign !== undefined) {
    const id = String(b.voucherDesign || '').trim();
    if (!VOUCHER_DESIGN_IDS.includes(id)) {
      const err = new Error('Unknown voucher design');
      err.status = 400;
      throw err;
    }
    doc.billing.voucherDesign = id;
  }
  for (const field of [
    'portalHeadline',
    'portalSubtitle',
    'portalButtonLabel',
    'portalBuyLabel',
    'portalFooter',
    'portalSupportPhone',
    'voucherTitle',
  ]) {
    if (b[field] !== undefined) {
      doc.billing[field] = clipPortalCopy(field, b[field]);
    }
  }
  if (b.portalShowPlans !== undefined) {
    doc.billing.portalShowPlans = Boolean(b.portalShowPlans);
  }
  if (b.payoutMomoNumber !== undefined) {
    doc.billing.payoutMomoNumber = String(b.payoutMomoNumber || '').trim();
  }
  if (b.payoutNote !== undefined) {
    doc.billing.payoutNote = String(b.payoutNote || '').trim();
  }
  /** Platform fee override — super admin only. */
  if (isSuperAdmin && b.platformFeeBps !== undefined) {
    if (b.platformFeeBps === null || b.platformFeeBps === '') {
      doc.billing.platformFeeBps = null;
    } else {
      const n = Math.round(Number(b.platformFeeBps));
      if (!Number.isFinite(n) || n < 0 || n > 10_000) {
        const err = new Error('platformFeeBps must be 0–10000 (basis points)');
        err.status = 400;
        throw err;
      }
      doc.billing.platformFeeBps = n;
    }
  }

  /** Hubtel always settles on platform — ignore legacy custom Hubtel patches. */
  doc.billing.useCustomHubtel = false;

  doc.markModified('billing');
}

organizationRouter.get(
  '/audit-log',
  asyncHandler(async (req, res) => {
    const oid = req.organizationId;
    if (!oid || !mongoose.isValidObjectId(String(oid))) {
      if (req.admin?.role === 'super_admin') {
        return res.json([]);
      }
      return res.status(503).json({ error: 'No organisation context for this session' });
    }
    const wantsCsv = String(req.query.format || '').toLowerCase() === 'csv';
    const cap = wantsCsv ? 500 : 100;
    const limit = Math.min(cap, Math.max(1, Number(req.query.limit) || (wantsCsv ? 200 : 40)));
    const rows = await OrganizationAuditLog.find({ organizationId: oid })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
    if (wantsCsv) {
      const slug = await Organization.findById(oid).select('slug').lean();
      const safeSlug = String(slug?.slug || 'org').replace(/[^\w-]+/g, '_');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="organization-audit-${safeSlug}.csv"`
      );
      res.send('\ufeff' + formatOrgAuditCsv(rows));
      return;
    }
    res.json(rows);
  })
);

organizationRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const oid = req.organizationId;
    if (!oid || !mongoose.isValidObjectId(String(oid))) {
      if (req.admin?.role === 'super_admin') {
        return res.json({
          platformScope: true,
          name: 'All organisations',
          modules: { tickets: true, remoteAccess: true },
          portalSites: [],
          portal: {
            baseUrl: publicAppBase(),
            note: 'Select an organisation in the header to manage tenant settings and portal links.',
          },
        });
      }
      return res.status(503).json({ error: 'No organisation context for this session' });
    }
    const doc = await Organization.findById(oid).lean();
    if (!doc) return res.status(404).json({ error: 'Organisation not found' });
    res.json(await jsonWithPortal(doc));
  })
);

/**
 * Every login template rendered with this organisation's branding, wording and plans.
 * Body overrides unsaved wording so the picker previews edits live.
 * POST /api/organization/portal-previews
 */
organizationRouter.post(
  '/portal-previews',
  asyncHandler(async (req, res) => {
    const oid = req.organizationId;
    const org =
      oid && mongoose.isValidObjectId(String(oid))
        ? await Organization.findById(oid).select('name billing').lean()
        : null;
    const saved = org?.billing || {};
    const b = { ...saved, ...(req.body && typeof req.body === 'object' ? req.body : {}) };
    const showPlans = b.portalShowPlans !== false;
    let plans = [];
    let samplePlans = false;
    if (showPlans) {
      plans = org ? await loadPortalPlans(org._id) : [];
      const hasAnyPlan =
        plans.length > 0 ||
        (org && (await PlanPackage.exists({ organizationId: org._id, kind: 'hotspot', isActive: true })));
      if (!hasAnyPlan) {
        plans = SAMPLE_PLANS;
        samplePlans = true;
      }
    }
    const brandName =
      String(saved.merchantDisplayName || '').trim() || String(org?.name || '').trim() || 'Wi-Fi';
    const designs = LOGIN_THEMES.map((t) => ({
      id: t.id,
      name: t.name,
      blurb: t.blurb,
      html: renderLoginPage({
        designId: t.id,
        mode: 'preview',
        brandName,
        logoUrl: String(saved.logoUrl || '').trim(),
        siteName: 'Main hall',
        headline: clipPortalCopy('portalHeadline', b.portalHeadline),
        subtitle: clipPortalCopy('portalSubtitle', b.portalSubtitle),
        buttonLabel: clipPortalCopy('portalButtonLabel', b.portalButtonLabel),
        buyLabel: clipPortalCopy('portalBuyLabel', b.portalBuyLabel),
        footerText: clipPortalCopy('portalFooter', b.portalFooter),
        supportPhone: clipPortalCopy('portalSupportPhone', b.portalSupportPhone),
        showPlans,
        plans,
        buyUrl: '#',
      }),
    }));
    res.json({ designs, samplePlans });
  })
);

organizationRouter.patch(
  '/',
  asyncHandler(async (req, res) => {
    const oid = req.organizationId;
    if (!oid || !mongoose.isValidObjectId(String(oid))) {
      return res.status(503).json({ error: 'No organisation context for this session' });
    }
    const role = req.admin?.role || 'super_admin';
    const doc = await Organization.findById(oid);
    if (!doc) return res.status(404).json({ error: 'Organisation not found' });

    const body = req.body || {};

    if (body.name != null) {
      const n = String(body.name).trim();
      if (!n) {
        return res.status(400).json({ error: 'name cannot be empty' });
      }
      doc.name = n;
    }

    if (role === 'super_admin') {
      if (body.status != null) {
        if (!STATUSES.has(String(body.status))) {
          return res.status(400).json({ error: 'Invalid status' });
        }
        doc.status = body.status;
      }
      if (body.slug != null) {
        const slug = String(body.slug)
          .trim()
          .toLowerCase()
          .replace(/\s+/g, '-');
        if (!slug || !SLUG_RE.test(slug)) {
          return res.status(400).json({
            error:
              'Invalid slug (1–40 chars: lowercase letters, numbers, hyphens; not at ends)',
          });
        }
        doc.slug = slug;
      }
    }

    if (body.billing != null) {
      try {
        applyBillingPatch(doc, body.billing, { isSuperAdmin: role === 'super_admin' });
      } catch (e) {
        return res.status(e.status || 400).json({ error: e.message || 'Invalid billing' });
      }
    }

    try {
      await doc.save();
    } catch (e) {
      if (e.code === 11000) {
        return res.status(400).json({ error: 'Slug already in use' });
      }
      throw e;
    }

    await logOrgAudit({
      organizationId: oid,
      actorEmail: req.admin?.email,
      action: 'organization.patch',
      meta: {
        keys: Object.keys(body).filter((k) => body[k] !== undefined),
        billing: Boolean(body.billing),
        billingKeys: body.billing && typeof body.billing === 'object'
          ? Object.keys(body.billing)
          : undefined,
      },
    });

    res.json(await jsonWithPortal(doc));
  })
);

/** Team (org_admin + super_admin acting in a tenant) */
organizationRouter.get(
  '/admins',
  requireRoles('super_admin', 'org_admin'),
  asyncHandler(async (req, res) => {
    const oid = req.organizationId;
    if (!oid || !mongoose.isValidObjectId(String(oid))) {
      return res.status(400).json({
        error: 'Select an organisation first to manage the team.',
        code: 'ORGANIZATION_REQUIRED',
      });
    }
    res.json(await listOrgTeam(oid));
  })
);

organizationRouter.post(
  '/admins',
  requireRoles('super_admin', 'org_admin'),
  asyncHandler(async (req, res) => {
    const oid = req.organizationId;
    if (!oid || !mongoose.isValidObjectId(String(oid))) {
      return res.status(400).json({
        error: 'Select an organisation first to invite team members.',
        code: 'ORGANIZATION_REQUIRED',
      });
    }
    try {
      const created = await inviteOrgTeamMember(oid, req.body, req.admin);
      res.status(201).json(created);
    } catch (e) {
      const status = e.status && Number(e.status) >= 400 ? e.status : 500;
      return res.status(status).json({ error: e.message || 'Invite failed' });
    }
  })
);

organizationRouter.post(
  '/admins/:adminId/resend-invite',
  requireRoles('super_admin', 'org_admin'),
  asyncHandler(async (req, res) => {
    const oid = req.organizationId;
    if (!oid || !mongoose.isValidObjectId(String(oid))) {
      return res.status(400).json({ error: 'No organisation context' });
    }
    try {
      res.json(await resendOrgTeamInvite(oid, req.params.adminId, req.admin));
    } catch (e) {
      const status = e.status && Number(e.status) >= 400 ? e.status : 500;
      return res.status(status).json({ error: e.message || 'Resend failed' });
    }
  })
);

organizationRouter.patch(
  '/admins/:adminId',
  requireRoles('super_admin', 'org_admin'),
  asyncHandler(async (req, res) => {
    const oid = req.organizationId;
    if (!oid || !mongoose.isValidObjectId(String(oid))) {
      return res.status(400).json({ error: 'No organisation context' });
    }
    try {
      res.json(await updateOrgTeamMember(oid, req.params.adminId, req.body));
    } catch (e) {
      const status = e.status && Number(e.status) >= 400 ? e.status : 500;
      return res.status(status).json({ error: e.message || 'Update failed' });
    }
  })
);

organizationRouter.delete(
  '/admins/:adminId',
  requireRoles('super_admin', 'org_admin'),
  asyncHandler(async (req, res) => {
    const oid = req.organizationId;
    if (!oid || !mongoose.isValidObjectId(String(oid))) {
      return res.status(400).json({ error: 'No organisation context' });
    }
    try {
      await removeOrgTeamMember(oid, req.params.adminId, req.admin?.id, req.admin?.email);
      res.status(204).end();
    } catch (e) {
      const status = e.status && Number(e.status) >= 400 ? e.status : 500;
      return res.status(status).json({ error: e.message || 'Delete failed' });
    }
  })
);
