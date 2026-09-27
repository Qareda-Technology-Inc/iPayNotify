import express from 'express';
import { HotspotVoucher } from '../models/index.js';
import {
  generateVouchers,
  listHotspotServersForRouter,
  listVouchers,
  previewVouchers,
  reconcileHotspotVoucherUsage,
  removeVoucherFromRouter,
  syncVoucherToRouter,
} from '../services/hotspotService.js';
import { syncHotspotExpiryScheduler } from '../services/hotspotExpirySchedulerService.js';
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
hotspotRouter.get(
  '/vouchers',
  asyncHandler(async (req, res) => {
    const { routerId, status } = req.query;
    const q = { ...orgQuery(req.organizationId) };
    if (routerId) q.routerId = routerId;
    const now = new Date();
    if (status === 'unused') {
      q.usedAt = null;
      q.$or = [{ validUntil: null }, { validUntil: { $gte: now } }];
    } else if (status === 'used') {
      q.usedAt = { $ne: null };
    } else if (status === 'expired') {
      q.validUntil = { $lt: now };
    }
    res.json(await listVouchers(q));
  })
);

hotspotRouter.get(
  '/vouchers/stats',
  asyncHandler(async (req, res) => {
    const base = { ...orgQuery(req.organizationId) };
    const now = new Date();
    const [total, unused, used, expired] = await Promise.all([
      HotspotVoucher.countDocuments(base),
      HotspotVoucher.countDocuments({
        ...base,
        usedAt: null,
        $or: [{ validUntil: null }, { validUntil: { $gte: now } }],
      }),
      HotspotVoucher.countDocuments({ ...base, usedAt: { $ne: null } }),
      HotspotVoucher.countDocuments({ ...base, validUntil: { $lt: now } }),
    ]);
    res.json({ total, unused, used, expired });
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
