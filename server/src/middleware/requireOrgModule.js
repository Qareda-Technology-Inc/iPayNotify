import { normalizeOrgModules } from '../services/orgModulesService.js';

/**
 * Allow super_admin always; org-scoped roles only when the tenant has the module enabled.
 * Relies on `attachOrganization` having set `req.organizationModules`.
 * @param {'tickets' | 'remoteAccess'} moduleKey
 */
export function requireOrgModule(moduleKey) {
  return (req, res, next) => {
    const role = req.admin?.role || 'super_admin';
    if (role === 'super_admin') return next();

    const modules = normalizeOrgModules(req.organizationModules);
    if (modules[moduleKey]) return next();

    return res.status(403).json({
      error: `This organisation does not have the “${moduleKey}” module enabled. Ask a platform administrator.`,
    });
  };
}
