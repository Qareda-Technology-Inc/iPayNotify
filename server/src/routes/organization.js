import express from 'express';
import mongoose from 'mongoose';
import { Organization, OrganizationAuditLog } from '../models/index.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { config } from '../config.js';
import { sanitizeBillingForClient } from '../services/orgBillingService.js';
import { logOrgAudit, formatOrgAuditCsv } from '../services/orgAuditService.js';

export const organizationRouter = express.Router();

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
const STATUSES = new Set(['active', 'trial', 'past_due', 'suspended']);

function publicPortalLinks(slug) {
  const base = String(config.publicAppUrl || '').replace(/\/$/, '') || 'http://localhost:5173';
  const r = encodeURIComponent(String(slug || '').trim());
  return {
    baseUrl: base,
    renewUrl: `${base}/portal/renew?r=${r}`,
    hotspotUrl: `${base}/portal/hotspot?r=${r}`,
  };
}

function jsonWithPortal(doc) {
  const o = doc.toObject ? doc.toObject() : doc;
  const { billing, ...rest } = o;
  return {
    ...rest,
    billing: sanitizeBillingForClient(billing),
    portal: publicPortalLinks(o.slug),
  };
}

/**
 * Apply `body.billing` onto a Mongoose organisation document (mutates).
 * Omitted credential fields keep existing values so PATCH can update labels only.
 */
function applyBillingPatch(doc, billingBody) {
  if (!billingBody || typeof billingBody !== 'object') return;
  if (!doc.billing) doc.billing = {};
  const b = billingBody;

  if (b.merchantDisplayName !== undefined) {
    doc.billing.merchantDisplayName = String(b.merchantDisplayName || '').trim();
  }
  if (b.smsBrandName !== undefined) {
    doc.billing.smsBrandName = String(b.smsBrandName || '').trim();
  }
  if (b.useCustomHubtel !== undefined) {
    doc.billing.useCustomHubtel = Boolean(b.useCustomHubtel);
  }

  if (b.hubtelMerchantAccount !== undefined) {
    doc.billing.hubtelMerchantAccount = String(b.hubtelMerchantAccount || '').trim();
  }
  if (b.hubtelClientId !== undefined) {
    doc.billing.hubtelClientId = String(b.hubtelClientId || '').trim();
  }
  if (b.hubtelClientSecret !== undefined && String(b.hubtelClientSecret).trim() !== '') {
    doc.billing.hubtelClientSecret = String(b.hubtelClientSecret).trim();
  }
  if (b.hubtelCallbackUrl !== undefined) {
    doc.billing.hubtelCallbackUrl = String(b.hubtelCallbackUrl || '').trim();
  }

  doc.markModified('billing');

  if (doc.billing.useCustomHubtel) {
    const ma = String(doc.billing.hubtelMerchantAccount || '').trim();
    const cid = String(doc.billing.hubtelClientId || '').trim();
    const secret = String(doc.billing.hubtelClientSecret || '').trim();
    const cb =
      String(doc.billing.hubtelCallbackUrl || '').trim() ||
      String(config.hubtel.callbackUrl || '').trim();
    if (!ma || !cid || !secret) {
      const err = new Error(
        'Custom Hubtel requires merchant account, client ID, and client secret (callback URL can inherit from platform env).'
      );
      err.status = 400;
      throw err;
    }
    if (!cb) {
      const err = new Error(
        'Set HUBTEL_CALLBACK_URL on the server or enter a callback URL for this organisation.'
      );
      err.status = 400;
      throw err;
    }
  }
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
    const { billing, ...rest } = doc;
    res.json({
      ...rest,
      billing: sanitizeBillingForClient(billing),
      portal: publicPortalLinks(doc.slug),
    });
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
      applyBillingPatch(doc, body.billing);
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

    res.json(jsonWithPortal(doc));
  })
);
