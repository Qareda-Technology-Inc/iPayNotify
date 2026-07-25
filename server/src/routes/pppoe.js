import express from 'express';
import {
  listPppoeAccounts,
  getPppoeAccount,
  createPppoeAccount,
  updatePppoeAccount,
  deletePppoeAccount,
  syncPppoeAccountToRouter,
  adminRenewPppoeAccount,
} from '../services/pppoeService.js';
import { enforceExpiredPppoeAccounts } from '../services/renewalService.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requireRoles } from '../middleware/requireRoles.js';
import { logOrgAudit } from '../services/orgAuditService.js';

export const pppoeRouter = express.Router();

pppoeRouter.use(requireRoles('super_admin', 'org_admin', 'org_staff'));

pppoeRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    /* Do not await MikroTik expiry sync here — it runs sequentially per expired line and
       made this route 10×+ slower than DB-only lists (e.g. remote access). Expiry → router
       sync is handled by jobs/scheduler.js using PPPOE_EXPIRY_CRON from env (see config). */
    const accounts = await listPppoeAccounts({ organizationId: req.organizationId });
    res.json(accounts);
  })
);

pppoeRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const {
      userId,
      packageId,
      routerId,
      secretName,
      secretPassword,
      paidUntil,
      validityAmount,
      validityUnit,
      syncRouter,
      activeProfile,
      expiredProfile,
    } = req.body;
    if (!secretName) {
      return res.status(400).json({ error: 'secretName is required' });
    }
    try {
      const doc = await createPppoeAccount({
        userId: userId || undefined,
        packageId,
        routerId,
        secretName,
        secretPassword,
        paidUntil,
        validityAmount,
        validityUnit,
        activeProfile,
        expiredProfile,
        syncRouter: syncRouter !== false,
        organizationId: req.organizationId,
      });
      void logOrgAudit({
        organizationId: req.organizationId,
        actorEmail: req.admin?.email,
        action: 'pppoe.create',
        meta: {
          pppoeAccountId: String(doc._id),
          secretName: doc.secretName,
          routerId: doc.routerId != null ? String(doc.routerId) : undefined,
          packageId: doc.packageId != null ? String(doc.packageId) : undefined,
        },
      });
      res.status(201).json(doc);
    } catch (e) {
      const msg = String(e.message || e);
      if (
        /MikroTik rejected API login|SSH login failed|No password for SSH|No API password is stored|Router API user name is empty/i.test(
          msg
        )
      ) {
        e.status = e.status || 502;
        throw e;
      }
      let hint =
        'Confirm the API/SSH user can write /ppp/secret and /ppp/active (remove) so profile changes can kick live sessions, and that profile names exist under PPP → Profiles.';
      if (/username|password|invalid|login|denied|refused|authentication/i.test(msg)) {
        hint =
          'MikroTik login failed: Billing → Routers → fix credentials (not PPPoE). For RouterOS API, the user group needs api, read, write; for SSH, use a user allowed to log in over SSH. Then Test connection.';
      }
      const err = new Error(`Could not create/sync PPPoE on router: ${msg}. ${hint}`);
      err.status = e.status || 502;
      throw err;
    }
  })
);

/** Push expired profiles/comments to MikroTik for this org (same work the cron does; can take a while). */
pppoeRouter.post(
  '/enforce-expiry',
  asyncHandler(async (req, res) => {
    const summary = await enforceExpiredPppoeAccounts(req.organizationId);
    void logOrgAudit({
      organizationId: req.organizationId,
      actorEmail: req.admin?.email,
      action: 'pppoe.enforce_expiry',
      meta: summary && typeof summary === 'object' ? summary : {},
    });
    res.json(summary);
  })
);

pppoeRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const doc = await getPppoeAccount(req.params.id, { organizationId: req.organizationId });
    if (!doc) return res.status(404).json({ error: 'Not found' });
    res.json(doc);
  })
);

pppoeRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const { syncRouter, ...patch } = req.body;
    const doc = await updatePppoeAccount(req.params.id, patch, {
      syncRouter: syncRouter !== false,
      organizationId: req.organizationId,
    });
    if (!doc) return res.status(404).json({ error: 'Not found' });
    void logOrgAudit({
      organizationId: req.organizationId,
      actorEmail: req.admin?.email,
      action: 'pppoe.patch',
      meta: { pppoeAccountId: String(req.params.id), patchKeys: Object.keys(patch) },
    });
    res.json(doc);
  })
);

pppoeRouter.post(
  '/:id/renew',
  asyncHandler(async (req, res) => {
    const doc = await adminRenewPppoeAccount(req.params.id, {
      organizationId: req.organizationId,
      packageId: req.body?.packageId,
      chargeBalance: Boolean(req.body?.chargeBalance),
      adminEmail: req.admin?.email,
    });
    if (!doc) return res.status(404).json({ error: 'Not found' });
    void logOrgAudit({
      organizationId: req.organizationId,
      actorEmail: req.admin?.email,
      action: 'pppoe.admin_renew',
      meta: {
        pppoeAccountId: String(req.params.id),
        packageId: req.body?.packageId != null ? String(req.body.packageId) : undefined,
        chargeBalance: Boolean(req.body?.chargeBalance),
      },
    });
    res.json(doc);
  })
);

pppoeRouter.post(
  '/:id/sync',
  asyncHandler(async (req, res) => {
    const doc = await getPppoeAccount(req.params.id, { organizationId: req.organizationId });
    if (!doc) return res.status(404).json({ error: 'Not found' });
    await syncPppoeAccountToRouter(doc);
    void logOrgAudit({
      organizationId: req.organizationId,
      actorEmail: req.admin?.email,
      action: 'pppoe.router_sync',
      meta: { pppoeAccountId: String(req.params.id) },
    });
    res.json(doc);
  })
);

pppoeRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const ok = await deletePppoeAccount(req.params.id, { organizationId: req.organizationId });
    if (!ok) return res.status(404).json({ error: 'Not found' });
    void logOrgAudit({
      organizationId: req.organizationId,
      actorEmail: req.admin?.email,
      action: 'pppoe.delete',
      meta: { pppoeAccountId: String(req.params.id) },
    });
    res.status(204).end();
  })
);
