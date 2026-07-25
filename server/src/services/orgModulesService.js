import { config } from '../config.js';

/** Feature modules — remoteAccess is toggled per org; tickets are fixed to one org. */
export const ORG_MODULE_KEYS = ['tickets', 'remoteAccess'];

/** Organisation slug that always has Ticket operations (all roles). */
export function ticketsOrganizationSlug() {
  return String(config.ticketsOrganizationSlug || 'qaretech-innovative')
    .trim()
    .toLowerCase();
}

export function isTicketsOrganizationSlug(slug) {
  return String(slug || '')
    .trim()
    .toLowerCase() === ticketsOrganizationSlug();
}

/**
 * @param {unknown} raw
 * @param {string|null|undefined} organizationSlug
 * @returns {{ tickets: boolean, remoteAccess: boolean }}
 */
export function normalizeOrgModules(raw, organizationSlug) {
  const m = raw && typeof raw === 'object' ? raw : {};
  return {
    /** Only Qaretech Innovative (configurable slug) — not a free module toggle. */
    tickets: isTicketsOrganizationSlug(organizationSlug),
    remoteAccess: Boolean(m.remoteAccess),
  };
}

/**
 * Apply a modules patch onto a Mongoose organisation document (mutates).
 * `tickets` cannot be set via API — it follows organisation slug.
 * @param {import('mongoose').Document} doc
 * @param {unknown} body
 */
export function applyModulesPatch(doc, body) {
  if (!body || typeof body !== 'object') return;
  if (!doc.modules) doc.modules = {};
  if (body.remoteAccess !== undefined) {
    doc.modules.remoteAccess = Boolean(body.remoteAccess);
  }
  // Keep stored tickets in sync with slug for clarity in DB reads.
  doc.modules.tickets = isTicketsOrganizationSlug(doc.slug);
  doc.markModified('modules');
}
