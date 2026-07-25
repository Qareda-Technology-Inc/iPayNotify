import mongoose from 'mongoose';
import { Organization } from '../models/index.js';

/**
 * After attachOrganization: block suspended tenants (and optionally past_due).
 * Super admins acting in a tenant still see the block so support cannot operate a killed org by accident
 * unless they use a future override — for now suspended means hard stop.
 */
export async function requireActiveOrganization(req, res, next) {
  try {
    const oid = req.organizationId;
    if (!oid || !mongoose.isValidObjectId(String(oid))) {
      return next();
    }
    const org = await Organization.findById(String(oid)).select('status name').lean();
    if (!org) {
      return res.status(404).json({ error: 'Organisation not found' });
    }
    if (org.status === 'suspended') {
      return res.status(403).json({
        error: 'This organisation is suspended. Contact the platform operator.',
        organizationStatus: org.status,
      });
    }
    req.organizationStatus = org.status;
    next();
  } catch (e) {
    next(e);
  }
}
