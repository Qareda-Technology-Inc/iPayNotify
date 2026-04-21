import mongoose from 'mongoose';
import { config } from '../config.js';
import { Organization } from '../models/index.js';

/** From env `DEFAULT_ORGANIZATION_ID` if valid ObjectId. */
export function getDefaultOrganizationIdFromEnv() {
  const raw = (config.defaultOrganizationId || '').trim();
  if (!raw || !mongoose.isValidObjectId(raw)) return undefined;
  return raw;
}

/**
 * Prefer env; otherwise first active org by slug `qaretech-innovative` (backfill default).
 * Use on create paths so new rows get an org without always setting env.
 */
export async function resolveDefaultOrganizationId() {
  const fromEnv = getDefaultOrganizationIdFromEnv();
  if (fromEnv) return fromEnv;
  const org = await Organization.findOne({ slug: 'qaretech-innovative' })
    .select('_id')
    .lean();
  return org?._id ? String(org._id) : undefined;
}

/** Use router.organizationId when present, else default (env or slug fallback). */
export async function organizationIdForRouter(router) {
  if (router?.organizationId) return router.organizationId;
  return resolveDefaultOrganizationId();
}
