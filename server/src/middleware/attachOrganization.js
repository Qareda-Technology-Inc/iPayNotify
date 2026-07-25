import mongoose from 'mongoose';
import { Organization, Admin } from '../models/index.js';
import { resolveDefaultOrganizationId } from '../db/defaultOrganizationId.js';
import { normalizeOrgModules } from '../services/orgModulesService.js';

async function attachOrganizationMeta(req) {
  if (req.organizationId && mongoose.isValidObjectId(String(req.organizationId))) {
    const o = await Organization.findById(req.organizationId).select('name slug modules').lean();
    req.organizationName = o?.name || null;
    req.organizationSlug = o?.slug || null;
    req.organizationModules = normalizeOrgModules(o?.modules);
  } else {
    req.organizationName = null;
    req.organizationSlug = null;
    req.organizationModules = normalizeOrgModules(null);
  }
}

/**
 * After `requireAuth`, sets `req.organizationId` for tenant-scoped APIs.
 * - **org_admin / ticket_manager / org_staff**: always the organisation from their admin record (JWT may mirror it).
 * - **super_admin**: optional `X-Organization-Id` header or `?organizationId=` to act in one tenant;
 *   otherwise falls back to the default organisation (slug / env) so the main dashboard still works.
 */
export async function attachOrganization(req, res, next) {
  if (!req.admin) {
    return res.status(500).json({ error: 'Server misconfiguration: attachOrganization without auth' });
  }
  try {
    const adminDoc = await Admin.findById(req.admin.id).select('role organizationId').lean();
    const role = adminDoc?.role || req.admin.role || 'super_admin';
    req.admin.role = role;
    req.admin.organizationId = adminDoc?.organizationId
      ? String(adminDoc.organizationId)
      : null;

    if (role === 'org_admin' || role === 'ticket_manager' || role === 'org_staff') {
      const fromJwt =
        req.jwtOrganizationId != null &&
        String(req.jwtOrganizationId).trim() &&
        mongoose.isValidObjectId(String(req.jwtOrganizationId).trim())
          ? String(req.jwtOrganizationId).trim()
          : null;
      const oid = req.admin.organizationId || fromJwt;
      if (!oid || !mongoose.isValidObjectId(oid)) {
        return res.status(403).json({
          error:
            'This organisation administrator account has no organisation assigned. Contact a super administrator.',
        });
      }
      req.organizationId = oid;
      await attachOrganizationMeta(req);
      next();
      return;
    }

    const headerRaw =
      req.get('x-organization-id') ||
      req.get('X-Organization-Id') ||
      (req.query.organizationId != null ? String(req.query.organizationId) : '');
    const headerTrim = String(headerRaw || '').trim();
    if (headerTrim && mongoose.isValidObjectId(headerTrim)) {
      const exists = await Organization.findById(headerTrim).select('_id').lean();
      if (!exists) {
        return res.status(400).json({ error: 'Invalid organisation id' });
      }
      req.organizationId = headerTrim;
      await attachOrganizationMeta(req);
      next();
      return;
    }

    req.organizationId = await resolveDefaultOrganizationId();
    if (!req.organizationId) {
      return res.status(503).json({
        error:
          'No organisation is configured. From the server folder run: npm run db:backfill-organization',
      });
    }
    await attachOrganizationMeta(req);
    next();
  } catch (e) {
    next(e);
  }
}
