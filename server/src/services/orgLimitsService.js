import mongoose from 'mongoose';
import { Admin, Organization, Router as MikrotikRouter, MessageBroadcastLog } from '../models/index.js';

const ORG_SCOPED_ROLES = ['org_admin', 'org_staff', 'ticket_manager'];

/**
 * @param {unknown} raw
 * @returns {{ maxRouters: number|null, maxAdmins: number|null, maxSmsPerMonth: number|null }}
 */
export function normalizeOrgLimits(raw) {
  const m = raw && typeof raw === 'object' ? raw : {};
  const n = (v) => {
    if (v == null || v === '') return null;
    const x = Math.round(Number(v));
    if (!Number.isFinite(x) || x < 0) return null;
    return x;
  };
  return {
    maxRouters: n(m.maxRouters),
    maxAdmins: n(m.maxAdmins),
    maxSmsPerMonth: n(m.maxSmsPerMonth),
  };
}

/**
 * @param {import('mongoose').Document} doc
 * @param {unknown} body
 */
export function applyLimitsPatch(doc, body) {
  if (!body || typeof body !== 'object') return;
  if (!doc.limits) doc.limits = {};
  for (const key of ['maxRouters', 'maxAdmins', 'maxSmsPerMonth']) {
    if (body[key] === undefined) continue;
    if (body[key] === null || body[key] === '') {
      doc.limits[key] = null;
      continue;
    }
    const x = Math.round(Number(body[key]));
    if (!Number.isFinite(x) || x < 0) {
      const err = new Error(`${key} must be a non-negative number or blank for unlimited`);
      err.status = 400;
      throw err;
    }
    doc.limits[key] = x;
  }
  doc.markModified('limits');
}

function monthRangeUtc(d = new Date()) {
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1, 0, 0, 0, 0));
  return { start, end };
}

/**
 * Current usage vs limits for an organisation.
 * @param {string|import('mongoose').Types.ObjectId} organizationId
 */
export async function getOrgUsageAndLimits(organizationId) {
  const oid = String(organizationId || '').trim();
  if (!oid || !mongoose.isValidObjectId(oid)) {
    return {
      limits: normalizeOrgLimits(null),
      usage: { routers: 0, admins: 0, smsThisMonth: 0 },
    };
  }
  const org = await Organization.findById(oid).select('limits').lean();
  const limits = normalizeOrgLimits(org?.limits);
  const { start, end } = monthRangeUtc();
  const [routers, admins, smsAgg] = await Promise.all([
    MikrotikRouter.countDocuments({ organizationId: oid }),
    Admin.countDocuments({ organizationId: oid, role: { $in: ORG_SCOPED_ROLES } }),
    MessageBroadcastLog.aggregate([
      {
        $match: {
          organizationId: new mongoose.Types.ObjectId(oid),
          dryRun: { $ne: true },
          createdAt: { $gte: start, $lt: end },
        },
      },
      { $group: { _id: null, n: { $sum: '$sent' } } },
    ]),
  ]);
  return {
    limits,
    usage: {
      routers,
      admins,
      smsThisMonth: Number(smsAgg[0]?.n) || 0,
    },
  };
}

/**
 * @param {string} organizationId
 * @param {'routers'|'admins'|'sms'} kind
 * @param {{ additionalSms?: number }} [opts]
 * @throws {{ status: number, message: string }}
 */
export async function assertOrgLimit(organizationId, kind, opts = {}) {
  const { limits, usage } = await getOrgUsageAndLimits(organizationId);
  if (kind === 'routers' && limits.maxRouters != null && usage.routers >= limits.maxRouters) {
    const err = new Error(
      `Router limit reached (${usage.routers}/${limits.maxRouters}). Contact the platform administrator.`
    );
    err.status = 403;
    throw err;
  }
  if (kind === 'admins' && limits.maxAdmins != null && usage.admins >= limits.maxAdmins) {
    const err = new Error(
      `Team limit reached (${usage.admins}/${limits.maxAdmins}). Contact the platform administrator.`
    );
    err.status = 403;
    throw err;
  }
  if (kind === 'sms' && limits.maxSmsPerMonth != null) {
    const add = Math.max(0, Number(opts.additionalSms) || 0);
    if (usage.smsThisMonth + add > limits.maxSmsPerMonth) {
      const err = new Error(
        `Monthly SMS limit would be exceeded (${usage.smsThisMonth}+${add}/${limits.maxSmsPerMonth}). Contact the platform administrator.`
      );
      err.status = 403;
      throw err;
    }
  }
}
