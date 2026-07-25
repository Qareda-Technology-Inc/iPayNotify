import express from 'express';
import { runMidnightBillingJob } from '../services/renewalService.js';
import { runExpiryReminderSmsJob } from '../services/expiryReminderSmsService.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requireRoles } from '../middleware/requireRoles.js';

export const jobsRouter = express.Router();

jobsRouter.post(
  '/billing/run',
  requireRoles('super_admin'),
  asyncHandler(async (req, res) => {
    const summary = await runMidnightBillingJob();
    res.json(summary);
  })
);

/** Manual run: sends 7d/3d/1d expiry reminder SMS (same logic as cron). Ignores enabled flag. */
jobsRouter.post(
  '/expiry-reminders/run',
  requireRoles('super_admin', 'org_admin'),
  asyncHandler(async (req, res) => {
    let organizationId;
    if (req.admin?.role === 'org_admin') {
      organizationId = req.organizationId;
    } else if (req.body?.organizationId != null && String(req.body.organizationId).trim()) {
      organizationId = String(req.body.organizationId).trim();
    }
    const summary = await runExpiryReminderSmsJob({
      respectEnabledFlag: false,
      ...(organizationId ? { organizationId } : {}),
    });
    res.json(summary);
  })
);
