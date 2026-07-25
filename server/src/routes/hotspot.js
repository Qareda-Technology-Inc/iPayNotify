import express from 'express';
import { HotspotVoucher } from '../models/index.js';
import {
  generateVouchers,
  listVouchers,
  syncVoucherToRouter,
} from '../services/hotspotService.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requireRoles } from '../middleware/requireRoles.js';

export const hotspotRouter = express.Router();

hotspotRouter.use(requireRoles('super_admin', 'org_admin', 'org_staff'));

hotspotRouter.get(
  '/vouchers',
  asyncHandler(async (req, res) => {
    const { routerId } = req.query;
    const q = { organizationId: req.organizationId };
    if (routerId) q.routerId = routerId;
    res.json(await listVouchers(q));
  })
);

hotspotRouter.post(
  '/vouchers/generate',
  asyncHandler(async (req, res) => {
    const { count = 1, packageId, routerId, pushToRouter } = req.body;
    if (!packageId) {
      return res.status(400).json({ error: 'packageId is required' });
    }
    const n = Math.min(100, Math.max(1, Number(count) || 1));
    const vouchers = await generateVouchers({
      count: n,
      packageId,
      routerId,
      pushToRouter: pushToRouter !== false,
      organizationId: req.organizationId,
    });
    res.status(201).json(
      vouchers.map((v) => ({
        id: v._id,
        code: v.code,
        profileName: v.profileName,
        validUntil: v.validUntil,
        dataLimitBytes: v.dataLimitBytes,
        timeLimitSeconds: v.timeLimitSeconds,
      }))
    );
  })
);

hotspotRouter.post(
  '/vouchers/:id/sync',
  asyncHandler(async (req, res) => {
    const v = await HotspotVoucher.findOne({
      _id: req.params.id,
      organizationId: req.organizationId,
    });
    if (!v) return res.status(404).json({ error: 'Not found' });
    await syncVoucherToRouter(v);
    res.json(v);
  })
);
