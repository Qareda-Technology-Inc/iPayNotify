import mongoose from 'mongoose';
import { Router } from '../models/index.js';

/**
 * Router.findById input: ObjectId, hex string, or populated `{ _id }` / Mongoose subdoc.
 * Do not use `doc.toString()` on populated refs — it is not a valid ObjectId string.
 */
export function normalizeRouterId(routerId) {
  if (routerId == null || routerId === '') return null;
  if (typeof routerId === 'string') {
    const t = routerId.trim();
    return mongoose.isValidObjectId(t) ? t : null;
  }
  if (typeof routerId === 'number') {
    const t = String(routerId);
    return mongoose.isValidObjectId(t) ? t : null;
  }
  if (routerId instanceof mongoose.Types.ObjectId) {
    return routerId.toHexString();
  }
  if (typeof routerId === 'object') {
    if (routerId._id != null) {
      return normalizeRouterId(routerId._id);
    }
    if (typeof routerId.toHexString === 'function') {
      try {
        const h = routerId.toHexString();
        if (mongoose.isValidObjectId(h)) return h;
      } catch {
        /* ignore */
      }
    }
  }
  return null;
}

/**
 * @param {unknown} routerId
 * @param {{ organizationId?: string }} [opts] When set (dashboard / tenant APIs), router must belong to that org.
 */
export async function resolveRouter(routerId, { organizationId } = {}) {
  const id = normalizeRouterId(routerId);
  const orgQ =
    organizationId != null &&
    String(organizationId).trim() &&
    mongoose.isValidObjectId(String(organizationId).trim())
      ? { organizationId: String(organizationId).trim() }
      : {};
  if (id) {
    const r = await Router.findOne({ _id: id, ...orgQ });
    if (!r) {
      const err = new Error('Router not found');
      err.status = 404;
      throw err;
    }
    return r;
  }
  const first = await Router.findOne({ ...orgQ }).sort({ createdAt: 1 });
  if (!first) {
    const err = new Error('No router configured. POST /api/routers first.');
    err.status = 503;
    throw err;
  }
  return first;
}
