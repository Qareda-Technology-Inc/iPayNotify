import express from 'express';
import { runMidnightBillingJob } from '../services/renewalService.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

export const jobsRouter = express.Router();

jobsRouter.post(
  '/billing/run',
  asyncHandler(async (req, res) => {
    const summary = await runMidnightBillingJob();
    res.json(summary);
  })
);
