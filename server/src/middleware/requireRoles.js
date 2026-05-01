export function requireRoles(...allowed) {
  const set = new Set((allowed || []).map((r) => String(r || '').trim()).filter(Boolean));
  return (req, res, next) => {
    const role = req.admin?.role || 'super_admin';
    if (set.size > 0 && !set.has(role)) {
      return res.status(403).json({ error: 'Access denied for this role' });
    }
    next();
  };
}
