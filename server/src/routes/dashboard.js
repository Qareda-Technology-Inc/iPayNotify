import express from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requireRoles } from '../middleware/requireRoles.js';
import { getDashboardSummary } from '../services/dashboardStatsService.js';

export const dashboardRouter = express.Router();

dashboardRouter.use(requireRoles('super_admin', 'org_admin', 'org_staff'));

dashboardRouter.get(
  '/summary',
  asyncHandler(async (req, res) => {
    res.json(await getDashboardSummary(req.organizationId));
  })
);
