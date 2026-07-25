import express from 'express';
import {
  listRemoteAccessSubscriptions,
  getRemoteAccessSubscription,
  createRemoteAccessSubscription,
  updateRemoteAccessSubscription,
  deleteRemoteAccessSubscription,
  adminRenewRemoteAccessSubscription,
} from '../services/remoteAccessService.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requireRoles } from '../middleware/requireRoles.js';
import { logOrgAudit } from '../services/orgAuditService.js';

export const remoteAccessRouter = express.Router();

remoteAccessRouter.use(requireRoles('super_admin', 'org_admin', 'org_staff'));

remoteAccessRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json(await listRemoteAccessSubscriptions({}, req.organizationId));
  })
);

remoteAccessRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const {
      userId,
      displayName,
      phone,
      email,
      packageId,
      paidUntil,
      validityAmount,
      validityUnit,
      notes,
    } = req.body;
    const doc = await createRemoteAccessSubscription({
      userId: userId || undefined,
      displayName,
      phone,
      email,
      packageId,
      paidUntil,
      validityAmount,
      validityUnit,
      notes,
      organizationId: req.organizationId,
    });
    const populated = await getRemoteAccessSubscription(doc._id, {
      organizationId: req.organizationId,
    });
    void logOrgAudit({
      organizationId: req.organizationId,
      actorEmail: req.admin?.email,
      action: 'remote_access.create',
      meta: {
        subscriptionId: String(doc._id),
        displayName: populated?.displayName,
        packageId: populated?.packageId != null ? String(populated.packageId) : undefined,
      },
    });
    res.status(201).json(populated);
  })
);

remoteAccessRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const doc = await getRemoteAccessSubscription(req.params.id, {
      organizationId: req.organizationId,
    });
    if (!doc) return res.status(404).json({ error: 'Not found' });
    res.json(doc);
  })
);

remoteAccessRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const doc = await updateRemoteAccessSubscription(req.params.id, req.body, {
      organizationId: req.organizationId,
    });
    if (!doc) return res.status(404).json({ error: 'Not found' });
    void logOrgAudit({
      organizationId: req.organizationId,
      actorEmail: req.admin?.email,
      action: 'remote_access.patch',
      meta: {
        subscriptionId: String(req.params.id),
        patchKeys: Object.keys(req.body || {}),
      },
    });
    res.json(doc);
  })
);

remoteAccessRouter.post(
  '/:id/renew',
  asyncHandler(async (req, res) => {
    const doc = await adminRenewRemoteAccessSubscription(req.params.id, {
      organizationId: req.organizationId,
      packageId: req.body?.packageId,
      chargeBalance: Boolean(req.body?.chargeBalance),
      adminEmail: req.admin?.email,
    });
    if (!doc) return res.status(404).json({ error: 'Not found' });
    void logOrgAudit({
      organizationId: req.organizationId,
      actorEmail: req.admin?.email,
      action: 'remote_access.admin_renew',
      meta: {
        subscriptionId: String(req.params.id),
        packageId: req.body?.packageId != null ? String(req.body.packageId) : undefined,
        chargeBalance: Boolean(req.body?.chargeBalance),
      },
    });
    res.json(doc);
  })
);

remoteAccessRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const ok = await deleteRemoteAccessSubscription(req.params.id, {
      organizationId: req.organizationId,
    });
    if (!ok) return res.status(404).json({ error: 'Not found' });
    void logOrgAudit({
      organizationId: req.organizationId,
      actorEmail: req.admin?.email,
      action: 'remote_access.delete',
      meta: { subscriptionId: String(req.params.id) },
    });
    res.status(204).end();
  })
);
