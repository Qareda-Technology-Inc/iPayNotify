import express from 'express';
import { config } from '../config.js';
import { sendArkeselSms, arkeselLiveReady } from '../integrations/arkesel.js';
import {
  runMessageBroadcast,
  listMessageBroadcastLogs,
} from '../services/messageBroadcastService.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requireRoles } from '../middleware/requireRoles.js';

export const messageBroadcastsRouter = express.Router();

messageBroadcastsRouter.use(requireRoles('super_admin', 'org_admin', 'org_staff'));

messageBroadcastsRouter.get(
  '/sms-status',
  asyncHandler(async (_req, res) => {
    const { apiKey, senderId, mock, sendConcurrency } = config.arkesel;
    res.json({
      mock,
      hasApiKey: Boolean(apiKey),
      hasSenderId: Boolean(senderId),
      live: arkeselLiveReady(),
      sendConcurrency: sendConcurrency || 5,
    });
  })
);

messageBroadcastsRouter.post(
  '/test',
  asyncHandler(async (req, res) => {
    const phone = String(req.body?.phone || '').trim();
    if (!phone) {
      return res.status(400).json({ error: 'phone is required' });
    }
    const brand = config.arkesel.brandName || 'QareFi';
    const result = await sendArkeselSms({
      to: phone,
      message: `${brand}: Test SMS from your billing dashboard. If you see this, Arkesel live sending works.`,
    });
    if (result.mock) {
      return res.json({
        ok: true,
        mock: true,
        message: 'ARKESEL_MOCK=true — logged only, no SMS sent.',
      });
    }
    if (result.skipped) {
      return res.status(400).json({
        ok: false,
        error: 'Set ARKESEL_API_KEY and ARKESEL_SENDER_ID (and ARKESEL_MOCK=false) for live SMS.',
      });
    }
    if (!result.ok) {
      return res.status(502).json({
        ok: false,
        error: result.error || 'send_failed',
        raw: result.raw,
      });
    }
    res.json({ ok: true, message: 'SMS accepted by Arkesel. Check the handset.' });
  })
);

messageBroadcastsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const limit = Number(req.query.limit) || 30;
    res.json(await listMessageBroadcastLogs(limit, req.organizationId));
  })
);

messageBroadcastsRouter.post(
  '/send',
  asyncHandler(async (req, res) => {
    const {
      templateId,
      body,
      audiences,
      dryRun,
      userIds,
      phones,
      intersectAudiences,
      routerId,
      templateVars,
    } = req.body;
    const result = await runMessageBroadcast({
      templateId,
      body,
      audiences: audiences || {},
      dryRun: Boolean(dryRun),
      userIds,
      phones,
      intersectAudiences,
      routerId,
      templateVars,
      organizationId: req.organizationId,
    });
    res.status(201).json(result);
  })
);
