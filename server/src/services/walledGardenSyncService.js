import mongoose from 'mongoose';
import { config } from '../config.js';
import { Router } from '../models/index.js';
import { withRouterMikrotik } from '../mikrotik/routeros.js';
import { normalizePrintRows } from '../mikrotik/helpers.js';
import { rosPairs } from '../utils/rosParams.js';

const QAREFI_PREFIX = 'QareFi:';

function isIpv4(s) {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(String(s).trim());
}

/** Hostnames and IPs customers must reach before hotspot login (payment pages + provider). */
export function buildPaymentWalledGardenTargets() {
  const hosts = [];
  const ips = [];

  const skipHost = (t) => {
    const l = String(t).trim().toLowerCase();
    return l === 'localhost' || l === '127.0.0.1' || l === '::1';
  };

  const addHost = (h) => {
    const t = String(h).trim();
    if (!t || skipHost(t)) return;
    if (isIpv4(t)) ips.push(t);
    else hosts.push(t);
  };

  try {
    const u = new URL(config.publicAppUrl);
    if (u.hostname) addHost(u.hostname);
  } catch {
    /* ignore invalid PUBLIC_APP_URL */
  }

  try {
    const u = new URL(config.mtnMomo.baseUrl);
    if (u.hostname) addHost(u.hostname);
  } catch {
    /* ignore */
  }

  for (const h of config.walledGarden.extraDstHosts) {
    addHost(h);
  }

  return {
    hosts: [...new Set(hosts)],
    ips: [...new Set(ips)],
  };
}

async function removeMarked(api, printCmd, removeBase) {
  const raw = await api.write(printCmd);
  const rows = normalizePrintRows(raw);
  const marked = rows.filter((r) => String(r.comment ?? '').startsWith(QAREFI_PREFIX));
  for (const r of marked) {
    const id = r['.id'];
    if (id) await api.write([`${removeBase}/remove`, `=.id=${id}`]);
  }
  return marked.length;
}

/**
 * Sync Hotspot walled garden so unauthenticated users can open billing before hotspot login.
 * Removes previous rows tagged with QareFi: then re-adds from config.
 */
export async function syncPaymentWalledGarden(routerId, organizationId) {
  const q = { _id: routerId };
  if (
    organizationId != null &&
    String(organizationId).trim() &&
    mongoose.isValidObjectId(String(organizationId).trim())
  ) {
    q.organizationId = String(organizationId).trim();
  }
  const router = await Router.findOne(q);
  if (!router) {
    const e = new Error('Router not found');
    e.status = 404;
    throw e;
  }

  const { hosts, ips } = buildPaymentWalledGardenTargets();
  if (hosts.length === 0 && ips.length === 0) {
    const e = new Error(
      'No walled-garden targets: set PUBLIC_APP_URL (or CLIENT_ORIGIN) to your customer-facing billing HTTPS URL.'
    );
    e.status = 400;
    throw e;
  }

  return withRouterMikrotik(router, async (api) => {
    let removed = 0;
    removed += await removeMarked(api, '/ip/hotspot/walled-garden/print', '/ip/hotspot/walled-garden');
    try {
      removed += await removeMarked(
        api,
        '/ip/hotspot/walled-garden/ip/print',
        '/ip/hotspot/walled-garden/ip'
      );
    } catch {
      /* older ROS without ip submenu — host-only sync */
    }

    for (const dst of hosts) {
      await api.write([
        '/ip/hotspot/walled-garden/add',
        ...rosPairs({
          'dst-host': dst,
          comment: `${QAREFI_PREFIX}${dst}`,
        }),
      ]);
    }
    for (const address of ips) {
      await api.write([
        '/ip/hotspot/walled-garden/ip/add',
        ...rosPairs({
          address,
          comment: `${QAREFI_PREFIX}${address}`,
        }),
      ]);
    }

    return {
      ok: true,
      removed,
      addedHosts: hosts,
      addedIps: ips,
    };
  });
}
