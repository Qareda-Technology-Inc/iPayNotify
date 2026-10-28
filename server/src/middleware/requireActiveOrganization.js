import mongoose from 'mongoose';
import { Organization } from '../models/index.js';

/** Reachable while suspended for an unpaid bill, so the admin can see and pay it. */
const BILLING_PATHS = [
  ['GET', /^\/organization\/?$/],
  ['GET', /^\/organization\/platform-billing\/?$/],
  ['POST', /^\/organization\/platform-billing\/checkout\/?$/],
];

/**
 * After attachOrganization: block suspended tenants.
 * - Suspended by a super admin: hard stop for everyone.
 * - Suspended for an unpaid platform bill: only the billing endpoints stay open (super admins
 *   acting in the tenant are let through to help).
 */
export async function requireActiveOrganization(req, res, next) {
  try {
    const oid = req.organizationId;
    if (!oid || !mongoose.isValidObjectId(String(oid))) {
      return next();
    }
    const org = await Organization.findById(String(oid)).select('status statusReason name').lean();
    if (!org) {
      return res.status(404).json({ error: 'Organisation not found' });
    }
    if (org.status === 'suspended') {
      const unpaid = org.statusReason === 'unpaid';
      const billingPath = BILLING_PATHS.some(([m, rx]) => req.method === m && rx.test(req.path));
      if (unpaid && (billingPath || req.admin?.role === 'super_admin')) {
        req.organizationStatus = org.status;
        return next();
      }
      return res.status(403).json({
        error: unpaid
          ? 'This organisation is suspended for an unpaid bill. Pay it in Billing to restore access.'
          : 'This organisation is suspended. Contact the platform operator.',
        organizationStatus: org.status,
        billingLocked: unpaid,
      });
    }
    req.organizationStatus = org.status;
    next();
  } catch (e) {
    next(e);
  }
}
