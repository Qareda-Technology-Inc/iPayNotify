import express from 'express';
import { PlanPackage } from '../models/index.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requireRoles } from '../middleware/requireRoles.js';
import { logOrgAudit } from '../services/orgAuditService.js';
import { normalizeOrgModules } from '../services/orgModulesService.js';
import { orgQuery } from '../utils/tenantScope.js';
import { syncHotspotPackageToRouter } from '../services/hotspotService.js';

export const packagesRouter = express.Router();

packagesRouter.use(requireRoles('super_admin', 'org_admin', 'org_staff', 'ticket_manager'));

function canManageRemoteAccessPackages(req) {
  if (req.admin?.role === 'super_admin') return true;
  return normalizeOrgModules(req.organizationModules).remoteAccess;
}

function stripSyncFields(body) {
  const payload = { ...(body || {}) };
  delete payload.syncRouterId;
  delete payload.routerId;
  delete payload.organizationId;
  return payload;
}

packagesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { kind: kindRaw, all } = req.query;
    const q = { ...orgQuery(req.organizationId) };
    if (all !== '1') q.isActive = true;
    const kind = Array.isArray(kindRaw) ? kindRaw[0] : kindRaw;
    if (kind != null && String(kind).trim() !== '') {
      q.kind = String(kind).trim();
    }
    if (!canManageRemoteAccessPackages(req) && (kind == null || String(kind).trim() === '')) {
      q.kind = { $in: ['hotspot', 'pppoe'] };
    } else if (!canManageRemoteAccessPackages(req) && String(kind).trim() === 'remote_access') {
      return res.status(403).json({
        error: 'Remote access packages are not enabled for this organisation',
      });
    }
    const list = await PlanPackage.find(q).sort({ name: 1 }).lean();
    res.json(list);
  })
);

packagesRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    if (!canManageRemoteAccessPackages(req) && String(req.body?.kind || '') === 'remote_access') {
      return res.status(403).json({
        error: 'Remote access packages are not enabled for this organisation',
      });
    }
    const syncRouterId = req.body?.syncRouterId || req.body?.routerId;
    const payload = { ...stripSyncFields(req.body), organizationId: req.organizationId };
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

    let sync = null;
    if (doc.kind === 'hotspot' && syncRouterId) {
      sync = await syncHotspotPackageToRouter(doc._id, syncRouterId, req.organizationId);
    }

    res.status(201).json({
      ...(typeof doc.toObject === 'function' ? doc.toObject() : doc),
      sync,
    });
  })
);

packagesRouter.post(
  '/:id/sync-to-router',
  asyncHandler(async (req, res) => {
    const routerId = req.body?.routerId || req.body?.syncRouterId;
    if (!routerId) {
      return res.status(400).json({ error: 'routerId is required' });
    }
    const scope = { _id: req.params.id, ...orgQuery(req.organizationId) };
    const pkg = await PlanPackage.findOne(scope);
    if (!pkg) return res.status(404).json({ error: 'Package not found' });
    if (pkg.kind !== 'hotspot') {
      return res.status(400).json({ error: 'Only hotspot packages sync to router user profiles' });
    }
    const sync = await syncHotspotPackageToRouter(pkg._id, routerId, req.organizationId);
    void logOrgAudit({
      organizationId: req.organizationId,
      actorEmail: req.admin?.email,
      action: 'package.sync_hotspot_profile',
      meta: sync,
    });
    res.json(sync);
  })
);

packagesRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const syncRouterId = req.body?.syncRouterId || req.body?.routerId;
    const patch = stripSyncFields(req.body);
    if (!canManageRemoteAccessPackages(req) && String(patch.kind || '') === 'remote_access') {
      return res.status(403).json({
        error: 'Remote access packages are not enabled for this organisation',
      });
    }
    const scope = { _id: req.params.id, organizationId: req.organizationId };
    if (!canManageRemoteAccessPackages(req)) {
      scope.kind = { $in: ['hotspot', 'pppoe'] };
    }

    const unset = {};
    for (const key of [
      'elapsedSeconds',
      'pausedSeconds',
      'timeLimitSeconds',
      'dataLimitBytes',
      'speedUpMbps',
      'speedDownMbps',
      'expiredProfile',
      'description',
    ]) {
      if (Object.prototype.hasOwnProperty.call(patch, key) && patch[key] == null) {
        unset[key] = 1;
        delete patch[key];
      }
    }

    const update = Object.keys(unset).length ? { $set: patch, $unset: unset } : patch;
    const doc = await PlanPackage.findOneAndUpdate(scope, update, {
      new: true,
      runValidators: true,
    });
    if (!doc) return res.status(404).json({ error: 'Package not found' });
    void logOrgAudit({
      organizationId: req.organizationId,
      actorEmail: req.admin?.email,
      action: 'package.patch',
      meta: { packageId: String(req.params.id), patchKeys: Object.keys(req.body || {}) },
    });

    let sync = null;
    if (doc.kind === 'hotspot' && syncRouterId) {
      sync = await syncHotspotPackageToRouter(doc._id, syncRouterId, req.organizationId);
    }

    res.json({
      ...(typeof doc.toObject === 'function' ? doc.toObject() : doc),
      sync,
    });
  })
);

packagesRouter.delete(
  '/:id',
  requireRoles('super_admin', 'org_admin', 'org_staff'),
  asyncHandler(async (req, res) => {
    const scope = { _id: req.params.id, organizationId: req.organizationId };
    if (!canManageRemoteAccessPackages(req)) {
      scope.kind = { $in: ['hotspot', 'pppoe'] };
    }
    const doc = await PlanPackage.findOneAndDelete(scope);
    if (!doc) return res.status(404).json({ error: 'Package not found' });
    void logOrgAudit({
      organizationId: req.organizationId,
      actorEmail: req.admin?.email,
      action: 'package.delete',
      meta: {
        packageId: String(req.params.id),
        name: doc.name,
        kind: doc.kind,
      },
    });
    res.json({ ok: true, id: String(doc._id) });
  })
);
