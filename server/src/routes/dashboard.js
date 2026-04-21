import express from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { getDashboardSummary } from '../services/dashboardStatsService.js';

export const dashboardRouter = express.Router();

dashboardRouter.get(
  '/summary',
  asyncHandler(async (req, res) => {
    res.json(await getDashboardSummary(req.organizationId));
  })
);
