import express from 'express';
import { Router as MikrotikRouter } from '../models/index.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requireRoles } from '../middleware/requireRoles.js';
import {
  getRouterPppProfiles,
  getRouterPppSecrets,
  getRouterLiveSnapshot,
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
import { assertOrgLimit } from '../services/orgLimitsService.js';
import { WireGuardPeer } from '../models/WireGuardPeer.js';
import { provisionMikrotikRouter } from '../services/wireguard/provisionRouter.js';
import { claimWireGuardPeerAsRouter } from '../services/wireguard/claimPeerAsRouter.js';
import { buildWireGuardInstallScript } from '../services/wireguard/buildInstallScript.js';
import { orgQuery } from '../utils/tenantScope.js';
import { isWgTunnelHost } from '../mikrotik/wgJump.js';

export const routersApi = express.Router();

routersApi.use(requireRoles('super_admin', 'org_admin', 'org_staff', 'ticket_manager'));

const IPV4_CIDR_RE =
  /^(?:(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\/(?:3[0-2]|[12]?\d)$/;

/**
 * Download MikroTik .rsc — router phones home (ZenFi-style). No cloud→LAN needed.
 * GET /api/routers/install-script?siteName=
 */
routersApi.get(
  '/install-script',
  asyncHandler(async (req, res) => {
    const siteName = String(req.query.siteName || '').trim();
    const lanSubnet = String(req.query.lanSubnet || '').trim();
    if (lanSubnet && !IPV4_CIDR_RE.test(lanSubnet)) {
      return res.status(400).json({ error: 'lanSubnet must be IPv4 CIDR' });
    }
    if (!config.publicApiUrl) {
      console.warn('[install-script] PUBLIC_API_URL is empty — script may point at wrong host');
    }
    const script = buildWireGuardInstallScript({
      organizationId: req.organizationId ? String(req.organizationId) : '',
      ...(siteName ? { siteName } : {}),
      ...(lanSubnet ? { lanSubnet } : {}),
    });
    const fname = siteName
      ? `qarefi-${siteName.replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 40)}.rsc`
      : 'wireguard-auto-register.rsc';
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${fname}"`);
    res.send(script);
  })
);

/**
 * Ready-to-paste MikroTik Terminal commands.
 * Uses a short bootstrap code (no special chars in URL) + check-certificate=no
 * because MikroTik TLS verify often hangs ("status: connecting" forever).
 * GET /api/routers/install-script/commands?siteName=
 */
routersApi.get(
  '/install-script/commands',
  asyncHandler(async (req, res) => {
    const siteName = String(req.query.siteName || '').trim();
    const lanSubnet = String(req.query.lanSubnet || '').trim();
    const apiBase = String(config.publicApiUrl || '')
      .trim()
      .replace(/\/$/, '');
    if (!apiBase) {
      return res.status(503).json({
        error:
          'PUBLIC_API_URL is not set on the server. Set it to your live API origin (e.g. https://ipaynotifyserver.onrender.com).',
      });
    }
    if (!req.organizationId) {
      return res.status(400).json({ error: 'Organization context required' });
    }

    const { InstallBootstrapCode, newBootstrapCode } = await import(
      '../models/InstallBootstrapCode.js'
    );
    const code = newBootstrapCode();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    await InstallBootstrapCode.create({
      code,
      organizationId: req.organizationId,
      siteName,
      lanSubnet,
      expiresAt,
    });

    const fileName = 'qarefi-install.rsc';
    const fetchUrl = `${apiBase}/api/routers/b/${code}.rsc`;
    const wakeUrl = `${apiBase}/api/health`;
    const wakeCmd = `/tool fetch url="${wakeUrl}" keep-result=no check-certificate=no`;
    const fetchCmd = `/tool fetch url="${fetchUrl}" dst-path=${fileName} check-certificate=no`;
    /* Run import alone so Terminal shows :put lines from the script */
    const importCmd = `/import ${fileName}`;
    const oneShot = `${fetchCmd}\n${importCmd}`;

    res.json({
      code,
      expiresAt,
      fetchUrl,
      fileName,
      wakeUrl,
      wakeCmd,
      fetchCmd,
      importCmd,
      oneShot,
      steps: [wakeCmd, fetchCmd, importCmd],
      hint:
        'Run THREE separate commands (not one long line). After /import you must see QAREFI: lines in Terminal. If you only see fetch status, import never ran.',
    });
  })
);

/**
 * Active WireGuard tunnel peers for this org (pending claim + claimed).
 * GET /api/routers/wireguard-peers?pending=1
 */
routersApi.get(
  '/wireguard-peers',
  asyncHandler(async (req, res) => {
    const pendingOnly = String(req.query.pending || '') === '1' || req.query.pending === 'true';
    const q = {
      status: { $ne: 'disabled' },
      kind: { $ne: 'client' },
    };
    if (pendingOnly) {
      q.$and = [
        {
          $or: [{ claimedRouterId: null }, { claimedRouterId: { $exists: false } }],
        },
        {
          $or: [
            { organizationId: req.organizationId },
            { organizationId: null },
            { organizationId: { $exists: false } },
          ],
        },
      ];
    } else if (req.organizationId) {
      q.$or = [
        { organizationId: req.organizationId },
        { organizationId: null },
        { organizationId: { $exists: false } },
      ];
    }
    const items = await WireGuardPeer.find(q)
      .sort({ updatedAt: -1 })
      .select('siteName tunnelIp lanSubnet status lastSeen organizationId claimedRouterId createdAt')
      .lean();
    res.json({
      items: items.map((p) => ({
        id: String(p._id),
        siteName: p.siteName,
        tunnelIp: p.tunnelIp,
        lanSubnet: p.lanSubnet || '',
        status: p.status,
        lastSeen: p.lastSeen,
        claimed: Boolean(p.claimedRouterId),
        organizationId: p.organizationId ? String(p.organizationId) : null,
        createdAt: p.createdAt,
      })),
    });
  })
);

/**
 * After .rsc: attach credentials → billing Router on tunnel IP.
 * POST /api/routers/from-peer
 */
routersApi.post(
  '/from-peer',
  asyncHandler(async (req, res) => {
    try {
      const result = await claimWireGuardPeerAsRouter({
        organizationId: req.organizationId,
        peerId: req.body?.peerId || req.body?.id,
        username: req.body?.username ?? req.body?.apiUser ?? req.body?.sshUser,
        password: req.body?.password ?? req.body?.apiPassword ?? req.body?.sshPassword,
        siteName: req.body?.siteName || req.body?.name,
        transport: req.body?.transport,
        allowRemoteAccess: req.body?.allowRemoteAccess !== false,
      });
      void logOrgAudit({
        organizationId: req.organizationId,
        actorEmail: req.admin?.email,
        action: 'router.from_peer',
        meta: {
          routerId: result.router.id,
          tunnelIp: result.wireguard.tunnelIp,
          peerId: result.wireguard.peerId,
        },
      });
      res.status(201).json(result);
    } catch (e) {
      const status = e.status && Number(e.status) >= 400 ? e.status : 500;
      return res.status(status).json({ error: e.message || 'Could not attach router' });
    }
  })
);

/**
 * Guided add: SSH to reachable host → create WireGuard → save router on tunnel IP.
 * Prefer install-script + from-peer for sites behind NAT (cloud cannot reach LAN).
 * POST /api/routers/provision
 */
routersApi.post(
  '/provision',
  asyncHandler(async (req, res) => {
    try {
      const result = await provisionMikrotikRouter({
        organizationId: req.organizationId,
        siteName: req.body?.siteName,
        host: req.body?.host,
        username: req.body?.username ?? req.body?.apiUser,
        password: req.body?.password ?? req.body?.apiPassword,
        transport: req.body?.transport,
        allowRemoteAccess: req.body?.allowRemoteAccess !== false,
        allowLanAccess: req.body?.allowLanAccess !== false,
        lanSubnet: req.body?.lanSubnet,
        sitePublicIp: req.body?.sitePublicIp,
      });
      void logOrgAudit({
        organizationId: req.organizationId,
        actorEmail: req.admin?.email,
        action: 'router.provision',
        meta: {
          routerId: result.router.id,
          tunnelIp: result.wireguard.tunnelIp,
          siteName: req.body?.siteName,
        },
      });
      res.status(201).json(result);
    } catch (e) {
      if (e?.code === 11000) {
        return res.status(400).json({
          error:
            'A router with this site public IP already exists. Clear sitePublicIp on the other router or use a different WAN IP.',
        });
      }
      const status = e.status && Number(e.status) >= 400 ? e.status : 500;
      return res.status(status).json({ error: e.message || 'Provision failed' });
    }
  })
);

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
    const list = await MikrotikRouter.find(orgQuery(req.organizationId))
      .select('-apiPassword -sshPassword')
      .sort({ createdAt: 1 })
      .lean();

    const tunnelHosts = [
      ...new Set(
        list.map((r) => String(r.host || '').trim()).filter((h) => isWgTunnelHost(h))
      ),
    ];
    let peersByIp = new Map();
    if (tunnelHosts.length) {
      const peers = await WireGuardPeer.find({ tunnelIp: { $in: tunnelHosts } })
        .select('siteName tunnelIp lanSubnet status lastSeen')
        .lean();
      peersByIp = new Map(peers.map((p) => [p.tunnelIp, p]));
    }

    res.json(
      list.map((r) => {
        const host = String(r.host || '').trim();
        const peer = peersByIp.get(host);
        const isTunnel = isWgTunnelHost(host);
        return {
          ...r,
          wireguard: isTunnel
            ? {
                tunnelIp: host,
                lanSubnet: peer?.lanSubnet || '',
                peerStatus: peer?.status || 'unknown',
                siteName: peer?.siteName || '',
                lastSeen: peer?.lastSeen || null,
                /** Endpoints for Winbox / SSH / API over the VPN */
                endpoints: {
                  winbox: `${host}:8291`,
                  ssh: `${host}:${Number(r.sshPort) || 22}`,
                  api: `${host}:${Number(r.apiPort) || 8728}`,
                },
              }
            : null,
        };
      })
    );
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
    try {
      await assertOrgLimit(req.organizationId, 'routers');
    } catch (e) {
      return res.status(e.status || 403).json({ error: e.message || 'Router limit reached' });
    }
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
    const out = { ok: true, message: `Connected to ${identity}`, identity };
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

/**
 * Live from site: identity/resource + PPP secrets + hotspot users + active sessions.
 */
routersApi.get(
  '/:id/mikrotik/live',
  asyncHandler(async (req, res) => {
    const snap = await getRouterLiveSnapshot(req.params.id, req.organizationId);
    res.json(snap);
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
