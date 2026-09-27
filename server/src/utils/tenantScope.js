import mongoose from 'mongoose';

export function isValidOrgId(id) {
  return (
    id != null &&
    String(id).trim() !== '' &&
    mongoose.isValidObjectId(String(id).trim())
  );
}

/**
 * Mongo filter fragment for tenant-scoped reads.
 * Empty object = platform scope (super_admin, no acting org) → all organisations.
 */
export function orgQuery(organizationId) {
  if (!isValidOrgId(organizationId)) return {};
  return { organizationId: String(organizationId).trim() };
}

/**
 * Block tenant mutations when super_admin has no acting organisation.
 * Mount after attachOrganization on protected tenant APIs.
 */
export function requireTenantForMutation(req, res, next) {
  if (req.admin?.role !== 'super_admin') return next();
  if (isValidOrgId(req.organizationId)) return next();
  const method = String(req.method || '').toUpperCase();
  if (method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE') {
    return res.status(400).json({
      error:
        'Select an organisation first to make changes. Use the organisation switcher in the header.',
      code: 'ORGANIZATION_REQUIRED',
    });
  }
  return next();
}
