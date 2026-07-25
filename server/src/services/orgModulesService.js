/** Feature modules super admins can enable per organisation. */
export const ORG_MODULE_KEYS = ['tickets', 'remoteAccess'];

/**
 * @param {unknown} raw
 * @returns {{ tickets: boolean, remoteAccess: boolean }}
 */
export function normalizeOrgModules(raw) {
  const m = raw && typeof raw === 'object' ? raw : {};
  return {
    tickets: Boolean(m.tickets),
    remoteAccess: Boolean(m.remoteAccess),
  };
}

/**
 * Apply a modules patch onto a Mongoose organisation document (mutates).
 * @param {import('mongoose').Document} doc
 * @param {unknown} body
 */
export function applyModulesPatch(doc, body) {
  if (!body || typeof body !== 'object') return;
  if (!doc.modules) doc.modules = {};
  for (const key of ORG_MODULE_KEYS) {
    if (body[key] !== undefined) {
      doc.modules[key] = Boolean(body[key]);
    }
  }
  doc.markModified('modules');
}
