import express from 'express';
import {
  listMessageTemplates,
  getMessageTemplate,
  createMessageTemplate,
  updateMessageTemplate,
  deleteMessageTemplate,
} from '../services/messageTemplateService.js';
import { MESSAGE_TEMPLATE_CATEGORIES } from '../models/MessageTemplate.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

export const messageTemplatesRouter = express.Router();

messageTemplatesRouter.get(
  '/categories',
  asyncHandler(async (_req, res) => {
    res.json({
      categories: MESSAGE_TEMPLATE_CATEGORIES.map((id) => ({
        id,
        label: categoryLabel(id),
      })),
      placeholders: [
        '{{brand}}',
        '{{name}}',
        '{{date}}',
        '{{date_iso}}',
        '{{time_window}}',
        '{{note}}',
      ],
      templateVarsHelp:
        'When sending a broadcast, you can pass send-time fields (date, time window, short note). Use matching placeholders in your template body.',
      audienceHelp: {
        pppoe:
          'Billing customers who are linked to a PPPoE line (Network → PPPoE → link customer) and have a phone on the customer profile. A PPP secret alone is not messaged — link the line and save a phone under Customers.',
        remote: 'All active remote-access subscriptions (uses the phone on each subscription).',
        hotspot:
          'Customers who have a billing user account linked to a paid hotspot voucher purchase. Anonymous voucher buyers (no user account) are never messaged.',
      },
    });
  })
);

function categoryLabel(id) {
  const m = {
    custom: 'Custom',
    system_update: 'System update',
    maintenance: 'Maintenance',
    expiry_notice: 'Expiry / renewal (general)',
    expiry_reminder_3d: 'Expiry reminder (~3 days before)',
    expiry_expired: 'Expired (after due date)',
    welcome_new_user: 'New user welcome',
    emergency: 'Emergency',
    technical_issue: 'Technical issue',
  };
  return m[id] || id;
}

messageTemplatesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const q = {};
    if (req.query.active === '1') q.isActive = true;
    res.json(await listMessageTemplates(q, req.organizationId));
  })
);

messageTemplatesRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const doc = await getMessageTemplate(req.params.id, req.organizationId);
    if (!doc) return res.status(404).json({ error: 'Not found' });
    res.json(doc);
  })
);

messageTemplatesRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const { name, category, body, description, isActive } = req.body;
    if (!name || !category || !body) {
      return res.status(400).json({ error: 'name, category, and body are required' });
    }
    const doc = await createMessageTemplate({
      name: String(name).trim(),
      category,
      body: String(body),
      description: description != null ? String(description).trim() : undefined,
      isActive: isActive !== false,
      organizationId: req.organizationId,
    });
    res.status(201).json(doc);
  })
);

messageTemplatesRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const doc = await updateMessageTemplate(req.params.id, req.body, {
      organizationId: req.organizationId,
    });
    if (!doc) return res.status(404).json({ error: 'Not found' });
    res.json(doc);
  })
);

messageTemplatesRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const ok = await deleteMessageTemplate(req.params.id, {
      organizationId: req.organizationId,
    });
    if (!ok) return res.status(404).json({ error: 'Not found' });
    res.status(204).end();
  })
);
