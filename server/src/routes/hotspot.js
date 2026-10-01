import express from 'express';
import mongoose from 'mongoose';
import { HotspotVoucher } from '../models/index.js';
import {
  buildTicketFilter,
  deleteTickets,
  generateVouchers,
  listHotspotServersForRouter,
  listTicketBatches,
  listTickets,
  previewVouchers,
  ticketStats,
  reconcileHotspotVoucherUsage,
  removeVoucherFromRouter,
  syncVoucherToRouter,
} from '../services/hotspotService.js';
import { syncHotspotExpiryScheduler } from '../services/hotspotExpirySchedulerService.js';
import { pushCaptivePortalToRouter } from '../services/captivePortalPushService.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requireRoles } from '../middleware/requireRoles.js';
import { orgQuery } from '../utils/tenantScope.js';

export const hotspotRouter = express.Router();

hotspotRouter.use(requireRoles('super_admin', 'org_admin', 'org_staff', 'ticket_manager'));

hotspotRouter.get(
  '/routers/:id/servers',
  asyncHandler(async (req, res) => {
    res.json(await listHotspotServersForRouter(req.params.id, req.organizationId));
  })
);

hotspotRouter.post(
  '/routers/:id/sync-expiry-scheduler',
  requireRoles('super_admin', 'org_admin', 'org_staff'),
  asyncHandler(async (req, res) => {
    const result = await syncHotspotExpiryScheduler(req.params.id, req.organizationId);
    res.json(result);
  })
);

hotspotRouter.post(
  '/routers/:id/push-captive-portal',
  requireRoles('super_admin', 'org_admin', 'org_staff'),
  asyncHandler(async (req, res) => {
    res.json(await pushCaptivePortalToRouter(req.params.id, req.organizationId));
  })
);

hotspotRouter.post(
  '/vouchers/preview',
  asyncHandler(async (req, res) => {
    const { count = 1, packageId, routerId, hotspotServer } = req.body;
    if (!packageId) {
      return res.status(400).json({ error: 'packageId is required' });
    }
    if (!routerId) {
      return res.status(400).json({ error: 'routerId is required' });
    }
    const preview = await previewVouchers({
      count,
      packageId,
      routerId,
      hotspotServer,
      organizationId: req.organizationId,
    });
    res.json(preview);
  })
);
function ticketFilterFromQuery(req, { withStatus = true, defaultStatus = '' } = {}) {
  const src = { ...req.query, ...(req.method === 'POST' ? req.body : {}) };
  return buildTicketFilter({
    base: orgQuery(req.organizationId),
    status: withStatus ? String(src.status || defaultStatus || '') : '',
    routerId: src.routerId,
    packageId: src.packageId,
    batch: src.batch,
    q: src.q,
  });
}

/** GET /vouchers?status=unused|active|expired&routerId=&packageId=&batch=&q=&page=&limit= */
hotspotRouter.get(
  '/vouchers',
  asyncHandler(async (req, res) => {
    res.json(
      await listTickets(ticketFilterFromQuery(req), {
        page: req.query.page,
        limit: req.query.limit,
      })
    );
  })
);

hotspotRouter.get(
  '/vouchers/stats',
  asyncHandler(async (req, res) => {
    res.json(await ticketStats(ticketFilterFromQuery(req, { withStatus: false })));
  })
);

hotspotRouter.get(
  '/vouchers/batches',
  asyncHandler(async (req, res) => {
    res.json(await listTicketBatches(orgQuery(req.organizationId), { limit: req.query.limit }));
  })
);

/** Tickets for printing. Unused only unless `status` is given explicitly. */
hotspotRouter.get(
  '/vouchers/export',
  asyncHandler(async (req, res) => {
    const filter = ticketFilterFromQuery(req, { defaultStatus: 'unused' });
    const max = 3000;
    const items = await HotspotVoucher.find(filter)
      .populate('packageId', 'name priceCents currency')
      .populate('routerId', 'name comment host')
      .sort({ createdAt: -1, code: 1 })
      .limit(max + 1)
      .lean();
    res.json({ items: items.slice(0, max), truncated: items.length > max });
  })
);

/**
 * POST /vouchers/bulk-delete
 * Body: { ids: string[] } or { status: 'expired', routerId?, packageId?, batch? }.
 * Filter deletes are limited to expired tickets so live stock is never wiped by accident.
 */
hotspotRouter.post(
  '/vouchers/bulk-delete',
  requireRoles('super_admin', 'org_admin', 'org_staff'),
  asyncHandler(async (req, res) => {
    const ids = Array.isArray(req.body?.ids)
      ? req.body.ids.map(String).filter((id) => mongoose.isValidObjectId(id))
      : [];
    let filter;
    if (ids.length) {
      filter = { $and: [orgQuery(req.organizationId), { _id: { $in: ids.slice(0, 2000) } }] };
    } else if (req.body?.status === 'expired') {
      filter = ticketFilterFromQuery(req);
    } else {
      return res.status(400).json({ error: 'Pass ticket ids, or status "expired" to clear expired tickets.' });
    }
    const vouchers = await HotspotVoucher.find(filter).limit(5000);
    res.json(await deleteTickets(vouchers));
  })
);

hotspotRouter.post(
  '/vouchers/generate',
  asyncHandler(async (req, res) => {
    const { count = 1, packageId, routerId, hotspotServer, codes, pushToRouter } = req.body;
    if (!packageId) {
      return res.status(400).json({ error: 'packageId is required' });
    }
    if (!routerId) {
      return res.status(400).json({ error: 'routerId is required' });
    }
    const n = Math.min(100, Math.max(1, Number(count) || 1));
    const vouchers = await generateVouchers({
      count: n,
      packageId,
      routerId,
      hotspotServer,
      codes,
      pushToRouter: pushToRouter !== false,
      organizationId: req.organizationId,
    });
    const pushed = pushToRouter !== false;
    res.status(201).json(
      vouchers.map((v) => ({
        id: v._id,
        batchId: v.batchId,
        code: v.code,
        password: v.password && v.password !== v.code ? v.password : undefined,
        codeType: v.codeType,
        hotspotServer: v.hotspotServer || '',
        profileName: v.profileName,
        validUntil: v.validUntil,
        dataLimitBytes: v.dataLimitBytes,
        timeLimitSeconds: v.timeLimitSeconds,
        elapsedSeconds: v.elapsedSeconds,
        usersPerTicket: v.usersPerTicket,
        speedUpMbps: v.speedUpMbps,
        speedDownMbps: v.speedDownMbps,
        packageId: v.packageId,
        mikrotikInternalId: v.mikrotikInternalId || null,
        pushedToRouter: pushed,
      }))
    );
  })
);

hotspotRouter.post(
  '/vouchers/reconcile',
  requireRoles('super_admin', 'org_admin', 'org_staff'),
  asyncHandler(async (req, res) => {
    const summary = await reconcileHotspotVoucherUsage(req.organizationId);
    res.json(summary);
  })
);

hotspotRouter.post(
  '/vouchers/:id/sync',
  asyncHandler(async (req, res) => {
    const v = await HotspotVoucher.findOne({
      _id: req.params.id,
      ...orgQuery(req.organizationId),
    });
    if (!v) return res.status(404).json({ error: 'Not found' });
    await syncVoucherToRouter(v);
    res.json(v);
  })
);

hotspotRouter.delete(
  '/vouchers/:id',
  requireRoles('super_admin', 'org_admin', 'org_staff'),
  asyncHandler(async (req, res) => {
    const v = await HotspotVoucher.findOne({
      _id: req.params.id,
      ...orgQuery(req.organizationId),
    });
    if (!v) return res.status(404).json({ error: 'Not found' });
    try {
      await removeVoucherFromRouter(v);
    } catch {
      /* router may be offline — still delete DB row */
    }
    await HotspotVoucher.deleteOne({ _id: v._id });
    res.json({ ok: true });
  })
);
