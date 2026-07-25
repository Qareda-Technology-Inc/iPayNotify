import express from 'express';
import mongoose from 'mongoose';
import { Organization, OrganizationAuditLog, Router as MikrotikRouter } from '../models/index.js';
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
    modules: normalizeOrgModules(o.modules),
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
      return res.status(503).json({ error: 'No organisation context for this session' });
    }
    const doc = await Organization.findById(oid).lean();
    if (!doc) return res.status(404).json({ error: 'Organisation not found' });
    res.json(await jsonWithPortal(doc));
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
