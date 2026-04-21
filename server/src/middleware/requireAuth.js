import jwt from 'jsonwebtoken';
import { config } from '../config.js';

export function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  const token =
    header && header.startsWith('Bearer ') ? header.slice(7).trim() : null;
  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    req.admin = {
      id: payload.sub,
      email: payload.email,
      role: payload.role || 'super_admin',
    };
    req.jwtOrganizationId = payload.organizationId;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }
}
