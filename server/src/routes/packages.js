import express from 'express';
import { PlanPackage } from '../models/index.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requireRoles } from '../middleware/requireRoles.js';
import { logOrgAudit } from '../services/orgAuditService.js';

export const packagesRouter = express.Router();

packagesRouter.use(requireRoles('super_admin', 'org_admin', 'org_staff'));

packagesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { kind: kindRaw, all } = req.query;
    const q = { organizationId: req.organizationId };
    if (all !== '1') q.isActive = true;
    const kind = Array.isArray(kindRaw) ? kindRaw[0] : kindRaw;
    if (kind != null && String(kind).trim() !== '') {
      q.kind = String(kind).trim();
    }
    const list = await PlanPackage.find(q).sort({ name: 1 }).lean();
    res.json(list);
  })
);

packagesRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const payload = { ...req.body, organizationId: req.organizationId };
    const doc = await PlanPackage.create(payload);
    void logOrgAudit({
      organizationId: req.organizationId,
      actorEmail: req.admin?.email,
      action: 'package.create',
      meta: {
        packageId: String(doc._id),
        name: doc.name,
        kind: doc.kind,
      },
    });
    res.status(201).json(doc);
  })
);

packagesRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const patch = { ...req.body };
    delete patch.organizationId;
    const doc = await PlanPackage.findOneAndUpdate(
      { _id: req.params.id, organizationId: req.organizationId },
      patch,
      {
        new: true,
        runValidators: true,
      }
    );
    if (!doc) return res.status(404).json({ error: 'Package not found' });
    void logOrgAudit({
      organizationId: req.organizationId,
      actorEmail: req.admin?.email,
      action: 'package.patch',
      meta: { packageId: String(req.params.id), patchKeys: Object.keys(patch) },
    });
    res.json(doc);
  })
);
