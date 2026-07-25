/**
 * Gate APIs by organisation module.
 * - tickets: only the configured tickets org (Qaretech Innovative by default) — all roles there.
 * - remoteAccess: super_admin always, or org roles when module enabled.
 * Relies on `attachOrganization` having set `req.organizationModules` / `req.organizationSlug`.
 * @param {'tickets' | 'remoteAccess'} moduleKey
 */
export function requireOrgModule(moduleKey) {
  return (req, res, next) => {
    const modules = req.organizationModules || { tickets: false, remoteAccess: false };

    if (moduleKey === 'tickets') {
      if (modules.tickets) return next();
      return res.status(403).json({
        error:
          'Ticket operations are only available for the Qaretech Innovative organisation.',
      });
    }

    const role = req.admin?.role || 'super_admin';
    if (role === 'super_admin') return next();
    if (modules[moduleKey]) return next();

    return res.status(403).json({
      error: `This organisation does not have the “${moduleKey}” module enabled. Ask a platform administrator.`,
    });
  };
}
