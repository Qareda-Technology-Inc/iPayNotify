/** After requireAuth: only users with role super_admin (JWT or legacy default). */
export function requireSuperAdmin(req, res, next) {
  const role = req.admin?.role || 'super_admin';
  if (role !== 'super_admin') {
    return res.status(403).json({ error: 'Super administrator access required' });
  }
  next();
}
