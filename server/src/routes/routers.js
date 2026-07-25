import express from 'express';
import { Router as MikrotikRouter } from '../models/index.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requireRoles } from '../middleware/requireRoles.js';
import {
  getRouterPppProfiles,
  getRouterPppSecrets,
  listActiveSessionsAllRouters,
  pingRouterApi,
} from '../services/mikrotikReadService.js';
import {
  buildPaymentWalledGardenTargets,
  syncPaymentWalledGarden,
} from '../services/walledGardenSyncService.js';
import { config } from '../config.js';
import {
  isValidPortalSlug,
  isValidSitePublicIp,
} from '../services/portalContextService.js';
import { parseRouterConnectString } from '../utils/routerConnect.js';
import { routerDisplayName } from '../utils/routerLabel.js';
import { logOrgAudit } from '../services/orgAuditService.js';

export const routersApi = express.Router();

routersApi.use(requireRoles('super_admin', 'org_admin', 'org_staff'));

/**
 * Hostnames (and any literal IPs) the billing app and MoMo flow need over HTTPS — for operators
 * configuring PPPoE expired-profile firewall / DNS. Hotspot walled garden uses the same set.
 */
routersApi.get(
  '/billing-access-checklist',
  asyncHandler(async (req, res) => {
    const { hosts, ips } = buildPaymentWalledGardenTargets();
    res.json({
      hosts,
      ips,
      tips: [
        'PPPoE expired profile does not use Hotspot walled garden. Allow TCP/443 (and DNS if you filter it) from those subscribers to every hostname below — e.g. Firewall → Filter Rules in the forward chain, above broad drop rules.',
        'RouterOS 7 can use address-list entries with FQDNs that resolve for dst-address / address-list match; older builds may need resolved IPs or layer7 — adjust to your ROS version.',
        'If the pay page is on one host and the browser calls the API on another (split Vercel + Render), put the API hostname in server env WALLED_GARDEN_EXTRA_HOSTS so it appears in this list.',
        'If renew still loads but styles/fonts fail, allow fonts.googleapis.com and fonts.gstatic.com for the same clients.',
      ],
    });
  })
);

routersApi.get(
  '/',
  asyncHandler(async (req, res) => {
    const list = await MikrotikRouter.find({ organizationId: req.organizationId })
      .select('-apiPassword -sshPassword')
      .sort({ createdAt: 1 })
      .lean();
    res.json(list);
  })
);

routersApi.get(
  '/active-sessions',
  asyncHandler(async (req, res) => {
    res.json(await listActiveSessionsAllRouters(req.organizationId));
  })
);

routersApi.post(
  '/',
  asyncHandler(async (req, res) => {
    const {
      name,
      comment,
      host,
      transport,
      apiPort,
      sshPort,
      sshUser,
      sshPassword,
      apiUser,
      apiPassword,
      defaultPppProfile,
      expiredPppProfile,
      sitePublicIp,
      portalSlug,
    } = req.body;
    const u = String(apiUser ?? '').trim();
    const p = apiPassword != null ? String(apiPassword) : '';
    const hRaw = String(host ?? '').trim();
    if (!hRaw || !u || !p) {
      return res
        .status(400)
        .json({ error: 'host (connect address), apiUser, and apiPassword are required' });
    }
    const t = String(transport ?? 'ssh').toLowerCase() === 'api' ? 'api' : 'ssh';
    const defPort = t === 'ssh' ? 22 : 8728;
    const parsedHost = parseRouterConnectString(hRaw, defPort);
    if (!parsedHost.host) {
      return res.status(400).json({ error: 'Invalid connect address' });
    }
    const h = parsedHost.host;
    let finalApiPort = 8728;
    let finalSshPort = 22;
    if (t === 'api') {
      finalApiPort =
        apiPort != null && apiPort !== '' ? Number(apiPort) : parsedHost.port;
    } else {
      finalSshPort =
        sshPort != null && sshPort !== '' ? Number(sshPort) : parsedHost.port;
    }
    let siteIp = null;
    if (sitePublicIp != null && String(sitePublicIp).trim()) {
      siteIp = String(sitePublicIp).trim();
      if (!isValidSitePublicIp(siteIp)) {
        return res.status(400).json({ error: 'sitePublicIp must be a valid IPv4 address' });
      }
    }
    let slug = null;
    if (portalSlug != null && String(portalSlug).trim()) {
      slug = String(portalSlug).trim().toLowerCase();
      if (!isValidPortalSlug(slug)) {
        return res.status(400).json({
          error:
            'portalSlug: 1–40 chars, lowercase letters, numbers, hyphens (not at ends after trim)',
        });
      }
    }
    const commentTrim =
      comment != null && String(comment).trim() ? String(comment).trim() : '';
    const displayName = commentTrim || String(name ?? '').trim() || h;
    let doc;
    try {
      doc = await MikrotikRouter.create({
        organizationId: req.organizationId,
        name: displayName || 'Router',
        ...(commentTrim ? { comment: commentTrim } : {}),
        host: h,
        transport: t,
        apiPort: finalApiPort,
        sshPort: finalSshPort,
        sshUser: sshUser != null ? String(sshUser).trim() : '',
        ...(sshPassword != null && String(sshPassword).length > 0
          ? { sshPassword: String(sshPassword) }
          : {}),
        apiUser: u,
        apiPassword: p,
        defaultPppProfile: defaultPppProfile ?? 'default',
        expiredPppProfile: expiredPppProfile ?? 'nonpayment',
        ...(siteIp ? { sitePublicIp: siteIp } : {}),
        ...(slug ? { portalSlug: slug } : {}),
      });
    } catch (e) {
      if (e?.code === 11000) {
        return res.status(400).json({
          error:
            'A router with this portal slug or site public IP already exists. Clear those fields or use unique values.',
        });
      }
      throw e;
    }
    void logOrgAudit({
      organizationId: req.organizationId,
      actorEmail: req.admin?.email,
      action: 'router.create',
      meta: {
        routerId: String(doc._id),
        host: doc.host,
        transport: doc.transport,
      },
    });
    res.status(201).json({
      id: doc._id,
      name: routerDisplayName(doc),
      comment: doc.comment,
      host: doc.host,
      transport: doc.transport,
      apiPort: doc.apiPort,
      sshPort: doc.sshPort,
    });
  })
);

routersApi.get(
  '/:id/mikrotik/ping',
  asyncHandler(async (req, res) => {
    const { identity } = await pingRouterApi(req.params.id, req.organizationId);
    const out = { ok: true, message: `Connected to ${identity}` };
    if (config.walledGarden.syncOnPing) {
      try {
        out.walledGarden = await syncPaymentWalledGarden(req.params.id, req.organizationId);
      } catch (e) {
        out.walledGarden = { ok: false, error: String(e.message || e) };
      }
    }
    res.json(out);
  })
);

routersApi.post(
  '/:id/mikrotik/walled-garden/sync',
  asyncHandler(async (req, res) => {
    const result = await syncPaymentWalledGarden(req.params.id, req.organizationId);
    res.json(result);
  })
);

routersApi.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const doc = await MikrotikRouter.findOne({
      _id: req.params.id,
      organizationId: req.organizationId,
    });
    if (!doc) return res.status(404).json({ error: 'Router not found' });
    const {
      name,
      comment,
      host,
      transport,
      apiPort,
      sshPort,
      sshUser,
      sshPassword,
      apiUser,
      apiPassword,
      defaultPppProfile,
      expiredPppProfile,
      sitePublicIp,
      portalSlug,
      smsBrandName,
      smsSenderId,
    } = req.body;
    if (comment !== undefined) {
      const c = String(comment).trim();
      doc.comment = c;
      doc.name = c || doc.host || doc.name;
    } else if (name !== undefined) {
      doc.name = String(name).trim() || doc.name;
    }
    if (transport !== undefined) {
      doc.transport = String(transport).toLowerCase() === 'ssh' ? 'ssh' : 'api';
    }
    if (host !== undefined) {
      const raw = String(host).trim();
      if (raw) {
        const def = doc.transport === 'ssh' ? 22 : 8728;
        const parsed = parseRouterConnectString(raw, def);
        if (!parsed.host) {
          return res.status(400).json({ error: 'Invalid connect address' });
        }
        doc.host = parsed.host;
        if (doc.transport === 'ssh') doc.sshPort = parsed.port;
        else doc.apiPort = parsed.port;
      }
    }
    if (apiPort !== undefined && host === undefined) {
      doc.apiPort = Number(apiPort) || doc.apiPort;
    }
    if (sshPort !== undefined && host === undefined) {
      doc.sshPort = Number(sshPort) || doc.sshPort;
    }
    if (sshUser !== undefined) doc.sshUser = String(sshUser).trim();
    if (apiUser !== undefined) doc.apiUser = String(apiUser).trim() || doc.apiUser;
    if (apiPassword !== undefined && String(apiPassword).length > 0) {
      doc.apiPassword = String(apiPassword);
    }
    if (sshPassword !== undefined && String(sshPassword).length > 0) {
      doc.sshPassword = String(sshPassword);
    }
    if (defaultPppProfile !== undefined) doc.defaultPppProfile = String(defaultPppProfile).trim();
    if (expiredPppProfile !== undefined) doc.expiredPppProfile = String(expiredPppProfile).trim();
    if (sitePublicIp !== undefined) {
      const t = String(sitePublicIp).trim();
      if (!t) doc.set('sitePublicIp', undefined);
      else if (isValidSitePublicIp(t)) doc.sitePublicIp = t;
      else return res.status(400).json({ error: 'sitePublicIp must be a valid IPv4 or empty' });
    }
    if (portalSlug !== undefined) {
      const t = String(portalSlug).trim().toLowerCase();
      if (!t) doc.set('portalSlug', undefined);
      else if (isValidPortalSlug(t)) doc.portalSlug = t;
      else {
        return res.status(400).json({
          error: 'portalSlug: lowercase letters, numbers, hyphens only (1–40 chars)',
        });
      }
    }
    if (smsBrandName !== undefined) {
      doc.smsBrandName = String(smsBrandName).trim();
    }
    if (smsSenderId !== undefined) {
      doc.smsSenderId = String(smsSenderId).trim();
    }
    await doc.save();
    void logOrgAudit({
      organizationId: req.organizationId,
      actorEmail: req.admin?.email,
      action: 'router.patch',
      meta: { routerId: String(req.params.id), patchKeys: Object.keys(req.body || {}) },
    });
    res.json({
      _id: doc._id,
      name: routerDisplayName(doc),
      comment: doc.comment,
      host: doc.host,
      transport: doc.transport,
      apiPort: doc.apiPort,
      sshPort: doc.sshPort,
      sshUser: doc.sshUser,
      apiUser: doc.apiUser,
      defaultPppProfile: doc.defaultPppProfile,
      expiredPppProfile: doc.expiredPppProfile,
      sitePublicIp: doc.sitePublicIp,
      portalSlug: doc.portalSlug,
      smsBrandName: doc.smsBrandName || '',
      smsSenderId: doc.smsSenderId || '',
    });
  })
);

routersApi.get(
  '/:id/mikrotik/ppp-profiles',
  asyncHandler(async (req, res) => {
    const list = await getRouterPppProfiles(req.params.id, req.organizationId);
    res.json(list);
  })
);

routersApi.get(
  '/:id/mikrotik/ppp-secrets',
  asyncHandler(async (req, res) => {
    const list = await getRouterPppSecrets(req.params.id, req.organizationId);
    res.json(list);
  })
);
