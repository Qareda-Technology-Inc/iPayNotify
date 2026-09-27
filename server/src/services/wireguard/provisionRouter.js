import { Router as MikrotikRouter } from '../../models/index.js';
import { config } from '../../config.js';
import { withRouterMikrotik } from '../../mikrotik/routeros.js';
import { parseRouterConnectString } from '../../utils/routerConnect.js';
import { isValidSitePublicIp } from '../portalContextService.js';
import { assertOrgLimit } from '../orgLimitsService.js';
import { registerWireGuardPeer } from './registerPeer.js';
import { isWireGuardFullyConfigured } from './wgVpsSshKey.js';

const WG_IFACE = 'wg-qarefi';
const WG_LISTEN_PORT = 51820;
const WG_MTU = 1420;
const VPN_MGMT_COMMENT = 'QareFi: VPN management';
const TUNNEL_ADDR_COMMENT = 'QareFi WG tunnel';
const IPV4_CIDR_RE =
  /^(?:(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\/(?:3[0-2]|[12]?\d)$/;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function asRows(raw) {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object') return [raw];
  return [];
}

function pick(row, ...keys) {
  if (!row || typeof row !== 'object') return '';
  for (const k of keys) {
    if (row[k] != null && String(row[k]).trim()) return String(row[k]).trim();
  }
  return '';
}

function isPrivateOrLocalIp(ip) {
  const t = String(ip || '').trim();
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(t)) return false;
  const [a, b] = t.split('.').map(Number);
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  // Common ISP/CGNAT or lab ranges often used on site LANs
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

function isConnectFailure(err) {
  const m = String(err?.message || err);
  return /handshake|timed out|ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|ETIMEDOUT|Cannot connect|connect ECONN|socket|API.*fail|not speaking SSH|network/i.test(
    m
  );
}

/**
 * @param {object} api withRouterMikrotik adapter (SSH or API)
 */
async function detectLanSubnet(api) {
  try {
    const rows = asRows(await api.write('/ip/dhcp-server/network/print'));
    for (const row of rows) {
      const addr = pick(row, 'address');
      if (IPV4_CIDR_RE.test(addr)) return addr;
    }
  } catch {
    /* fall through */
  }
  try {
    const rows = asRows(await api.write('/ip/address/print'));
    for (const row of rows) {
      const iface = pick(row, 'interface').toLowerCase();
      if (!iface.includes('bridge') && iface !== 'ether1') continue;
      const addr = pick(row, 'address');
      const slash = addr.indexOf('/');
      if (slash < 0) continue;
      const ip = addr.slice(0, slash);
      const parts = ip.split('.');
      if (parts.length !== 4) continue;
      return `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
    }
  } catch {
    /* ignore */
  }
  return '';
}

async function ensureWireGuardInterface(api) {
  let rows = asRows(await api.write('/interface/wireguard/print'));
  let existing = rows.find((r) => pick(r, 'name') === WG_IFACE);
  if (!existing) {
    await api.write([
      '/interface/wireguard/add',
      `=name=${WG_IFACE}`,
      `=listen-port=${WG_LISTEN_PORT}`,
      `=mtu=${WG_MTU}`,
      '=disabled=no',
      '=comment=QareFi auto VPN',
    ]);
    await sleep(2000);
  }

  const pub = await readWgPublicKey(api);
  if (!pub || pub.length < 40) {
    const err = new Error(
      'Could not read WireGuard public key from the router (interface may exist — retry add router, or check /interface wireguard print)'
    );
    err.status = 502;
    throw err;
  }
  return pub;
}

async function readWgPublicKey(api) {
  for (let attempt = 0; attempt < 6; attempt++) {
    if (attempt > 0) await sleep(1000 + attempt * 400);

    try {
      const rows = asRows(await api.write('/interface/wireguard/print'));
      const existing = rows.find((r) => pick(r, 'name') === WG_IFACE);
      const pub = pick(existing, 'public-key', 'publicKey', 'public_key');
      if (pub && pub.length >= 40) return pub.replace(/^"|"$/g, '');
    } catch {
      /* try CLI */
    }

    if (typeof api.execCli === 'function') {
      try {
        const out = await api.execCli(
          `/interface wireguard print as-value where name=${WG_IFACE}`
        );
        const m = String(out).match(/public-key=(?:"([^"]+)"|([A-Za-z0-9+/=]+))/);
        const v = (m?.[1] || m?.[2] || '').trim();
        if (v.length >= 40) return v;
      } catch {
        /* continue */
      }
      try {
        const out = await api.execCli(
          `/interface wireguard get [find where name=${WG_IFACE}] public-key`
        );
        const v = String(out || '')
          .trim()
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean)
          .pop();
        if (v && v.length >= 40 && !/failure|error|no such/i.test(v)) {
          return v.replace(/^"|"$/g, '');
        }
      } catch {
        /* continue */
      }
      try {
        const out = await api.execCli(
          `/interface wireguard print detail without-paging where name=${WG_IFACE}`
        );
        const m = String(out).match(/public-key="([^"]+)"/);
        if (m?.[1]?.length >= 40) return m[1];
      } catch {
        /* continue */
      }
    }
  }
  return '';
}

function isFatalProvisionError(err) {
  const m = String(err?.message || err);
  return (
    err?.code === 'WG_VPS_SSH_KEY_ROTATED' ||
    err?.code === 'WG_VPS_UNREACHABLE' ||
    /privateKey|Unsupported key format|VPS WireGuard|VPS SSH|authorized_keys|not configured|WG_VPS|WireGuard VPS sync|Generate SSH key|siteName is required|Valid WireGuard|qarefi\.qaretech|WG_ENDPOINT/i.test(
      m
    ) ||
    Number(err?.status) === 503
  );
}

async function configureTunnelOnRouter(api, { tunnelIp, serverPublicKey, endpoint, allowedIps }) {
  const colon = String(endpoint).lastIndexOf(':');
  if (colon < 0) {
    const err = new Error('Invalid WG_ENDPOINT (expected host:port)');
    err.status = 500;
    throw err;
  }
  const epHost = endpoint.slice(0, colon);
  const epPort = endpoint.slice(colon + 1);
  const addr = `${tunnelIp}/24`;

  const addrRows = asRows(await api.write('/ip/address/print'));
  const existingAddr = addrRows.find(
    (r) =>
      pick(r, 'interface') === WG_IFACE &&
      (pick(r, 'comment') === TUNNEL_ADDR_COMMENT || pick(r, 'address').startsWith(`${tunnelIp}/`))
  );
  if (!existingAddr) {
    await api.write([
      '/ip/address/add',
      `=address=${addr}`,
      `=interface=${WG_IFACE}`,
      `=comment=${TUNNEL_ADDR_COMMENT}`,
    ]);
  } else {
    const id = pick(existingAddr, '.id', 'numbers');
    if (id) {
      await api.write(['/ip/address/set', `=.id=${id}`, `=address=${addr}`]);
    }
  }

  const peerRows = asRows(await api.write('/interface/wireguard/peers/print'));
  const existingPeer = peerRows.find(
    (r) =>
      pick(r, 'interface') === WG_IFACE &&
      pick(r, 'public-key', 'publicKey') === serverPublicKey
  );
  const peerFields = [
    `=interface=${WG_IFACE}`,
    `=public-key=${serverPublicKey}`,
    `=endpoint-address=${epHost}`,
    `=endpoint-port=${epPort}`,
    `=allowed-address=${allowedIps}`,
    '=persistent-keepalive=25s',
    '=comment=QareFi VPS',
  ];
  if (!existingPeer) {
    await api.write(['/interface/wireguard/peers/add', ...peerFields]);
  } else {
    const id = pick(existingPeer, '.id', 'numbers');
    if (id) {
      await api.write([
        '/interface/wireguard/peers/set',
        `=.id=${id}`,
        `=endpoint-address=${epHost}`,
        `=endpoint-port=${epPort}`,
        `=allowed-address=${allowedIps}`,
        '=persistent-keepalive=25s',
      ]);
    }
  }
}

async function ensureVpnManagementAccess(api) {
  const rows = asRows(await api.write('/ip/firewall/filter/print'));
  if (rows.some((r) => pick(r, 'comment') === VPN_MGMT_COMMENT)) return;

  /** Accept all management from the platform VPN (Winbox 8291, SSH, API, etc.). */
  const addRule = async (extra = []) => {
    await api.write([
      '/ip/firewall/filter/add',
      '=chain=input',
      '=action=accept',
      '=src-address=' + (config.wireguard?.tunnelPool || '10.66.54.0/24'),
      `=comment=${VPN_MGMT_COMMENT}`,
      ...extra,
    ]);
  };

  try {
    await addRule(['=place-before=0']);
  } catch {
    await addRule();
  }

  /** Ensure services are enabled (best-effort). */
  try {
    const services = asRows(await api.write('/ip/service/print'));
    for (const name of ['winbox', 'ssh', 'api']) {
      const row = services.find((s) => pick(s, 'name') === name);
      const id = pick(row, '.id', 'numbers');
      if (id && /true|yes/i.test(pick(row, 'disabled'))) {
        await api.write(['/ip/service/set', `=.id=${id}`, '=disabled=no']);
      }
    }
  } catch (e) {
    console.warn('[provision] could not enable winbox/ssh/api services:', e?.message || e);
  }
}

function buildEphemeralRouter({ host, transport, username, password, sshPort, apiPort }) {
  return {
    host,
    transport,
    sshPort: sshPort || 22,
    apiPort: apiPort || 8728,
    sshUser: username,
    sshPassword: password,
    apiUser: username,
    apiPassword: password,
  };
}

/**
 * Try SSH and/or RouterOS API until one works.
 */
async function withProvisionTransport(opts, fn) {
  const transportPref = String(opts.transport || 'auto').toLowerCase();
  const host = opts.host;
  const username = opts.username;
  const password = opts.password;
  let sshPort = opts.sshPort || 22;
  let apiPort = opts.apiPort || 8728;

  /** If user put :8728 on the address, prefer API. */
  const parsedHint = parseRouterConnectString(opts.hostRaw || host, 22);
  if (parsedHint.port === 8728 || parsedHint.port === 8729) {
    apiPort = parsedHint.port;
  } else if (opts.hostRaw && parsedHint.port && parsedHint.port !== 22) {
    /* custom port — apply to preferred transport */
    if (transportPref === 'api') apiPort = parsedHint.port;
    else sshPort = parsedHint.port;
  }

  const order = [];
  if (transportPref === 'ssh') order.push('ssh');
  else if (transportPref === 'api') order.push('api');
  else if (apiPort === 8728 || apiPort === 8729 || parsedHint.port === 8728 || parsedHint.port === 8729) {
    order.push('api', 'ssh');
  } else {
    order.push('ssh', 'api');
  }

  const errors = [];
  for (const transport of order) {
    const ephemeral = buildEphemeralRouter({
      host,
      transport,
      username,
      password,
      sshPort: transport === 'ssh' ? sshPort : 22,
      apiPort: transport === 'api' ? apiPort : 8728,
    });
    try {
      const result = await withRouterMikrotik(ephemeral, (api) => fn(api, transport));
      return { result, transport, sshPort, apiPort };
    } catch (e) {
      errors.push({ transport, message: e?.message || String(e) });
      /* Router was reached but VPS key / register failed — do not try the other transport. */
      if (isFatalProvisionError(e)) throw e;
      if (transportPref !== 'auto' && transportPref === transport) throw e;
      if (!isConnectFailure(e) && !/login|password|auth|rejected|CANTLOGIN|public key/i.test(String(e?.message))) {
        if (transportPref !== 'auto') throw e;
      }
    }
  }

  const detail = errors.map((x) => `${x.transport}: ${x.message}`).join(' | ');
  const err = new Error(
    `Could not reach the router at ${host}. Tried ${order.join(' then ')}. ${detail}`
  );
  err.status = 502;
  throw err;
}

/**
 * Wizard provision: reach router (local or remote) via SSH and/or API → WireGuard → save on tunnel IP.
 */
export async function provisionMikrotikRouter({
  organizationId,
  siteName,
  host,
  username,
  password,
  transport = 'auto',
  allowRemoteAccess = true,
  allowLanAccess = true,
  lanSubnet = '',
  sitePublicIp = '',
}) {
  const name = String(siteName || '').trim();
  const user = String(username || '').trim();
  const pass = password != null ? String(password) : '';
  const hRaw = String(host || '').trim();
  const transportPref = String(transport || 'auto').toLowerCase();

  if (!name || name.length < 2) {
    const err = new Error('Site name is required');
    err.status = 400;
    throw err;
  }
  if (!hRaw || !user || !pass) {
    const err = new Error('Router address, username, and password are required');
    err.status = 400;
    throw err;
  }
  if (!['auto', 'ssh', 'api'].includes(transportPref)) {
    const err = new Error('transport must be auto, ssh, or api');
    err.status = 400;
    throw err;
  }
  if (!config.wireguard?.vpsHost || !config.wireguard?.serverPublicKey || !config.wireguard?.endpoint) {
    const err = new Error(
      'WireGuard is not configured on the server. Set WG_VPS_HOST, WG_SERVER_PUBLIC_KEY, and WG_ENDPOINT.'
    );
    err.status = 503;
    throw err;
  }
  if (!(await isWireGuardFullyConfigured())) {
    const err = new Error(
      'VPS SSH key missing. Open WireGuard VPN → Generate SSH key, then add the public key to your VPS authorized_keys.'
    );
    err.status = 503;
    throw err;
  }

  await assertOrgLimit(organizationId, 'routers');

  const defPort = transportPref === 'api' ? 8728 : 22;
  const parsed = parseRouterConnectString(hRaw, defPort);
  if (!parsed.host) {
    const err = new Error('Invalid router IP / connect address');
    err.status = 400;
    throw err;
  }

  const connectHost = parsed.host;
  let lan = String(lanSubnet || '').trim();
  if (lan && !IPV4_CIDR_RE.test(lan)) {
    const err = new Error('LAN subnet must be IPv4 CIDR e.g. 192.168.88.0/24');
    err.status = 400;
    throw err;
  }

  let wanHint = String(sitePublicIp || '').trim();
  if (wanHint && !isValidSitePublicIp(wanHint)) {
    const err = new Error('sitePublicIp must be a valid IPv4 address');
    err.status = 400;
    throw err;
  }

  const { result: work, transport: usedTransport } = await withProvisionTransport(
    {
      host: connectHost,
      hostRaw: hRaw,
      username: user,
      password: pass,
      transport: transportPref,
      sshPort: transportPref === 'api' ? 22 : parsed.port || 22,
      apiPort: transportPref === 'ssh' ? 8728 : parsed.port === 22 ? 8728 : parsed.port || 8728,
    },
    async (api) => {
      let identity = name;
      try {
        const idRows = asRows(await api.write('/system/identity/print'));
        identity = pick(idRows[0], 'name') || name;
      } catch {
        /* keep site name */
      }

      const publicKey = await ensureWireGuardInterface(api);

      let detectedLan = '';
      if (allowLanAccess) {
        if (!lan) {
          lan = await detectLanSubnet(api);
          detectedLan = lan;
        }
      } else {
        lan = '';
      }

      const registered = await registerWireGuardPeer({
        publicKey,
        siteName: name,
        lanSubnet: lan,
      });

      await configureTunnelOnRouter(api, {
        tunnelIp: registered.peer.tunnelIp,
        serverPublicKey: registered.serverPublicKey,
        endpoint: registered.endpoint,
        allowedIps: registered.clientAllowedIps,
      });

      if (allowRemoteAccess) {
        try {
          await ensureVpnManagementAccess(api);
        } catch (e) {
          console.warn('[provision] VPN management firewall rule skipped:', e?.message || e);
        }
      }

      return {
        identity,
        tunnelIp: registered.peer.tunnelIp,
        peerId: String(registered.peer._id),
        lanSubnet: lan || '',
        detectedLan,
      };
    }
  );

  /** Prefer explicit WAN; else store connect host only if it looks like a public IP. */
  let siteIp = null;
  if (wanHint && isValidSitePublicIp(wanHint) && !isPrivateOrLocalIp(wanHint)) {
    siteIp = wanHint;
  } else if (isValidSitePublicIp(connectHost) && !isPrivateOrLocalIp(connectHost)) {
    siteIp = connectHost;
  }

  const doc = await MikrotikRouter.create({
    organizationId,
    name,
    comment: name,
    host: work.tunnelIp,
    transport: usedTransport === 'api' ? 'api' : 'ssh',
    apiPort: 8728,
    sshPort: 22,
    sshUser: user,
    sshPassword: pass,
    apiUser: user,
    apiPassword: pass,
    defaultPppProfile: 'default',
    expiredPppProfile: 'nonpayment',
    ...(siteIp ? { sitePublicIp: siteIp } : {}),
  });

  return {
    ok: true,
    router: {
      id: String(doc._id),
      name: doc.name,
      comment: doc.comment,
      host: doc.host,
      transport: doc.transport,
      sitePublicIp: doc.sitePublicIp || '',
    },
    wireguard: {
      peerId: work.peerId,
      tunnelIp: work.tunnelIp,
      lanSubnet: work.lanSubnet,
      detectedLan: work.detectedLan || '',
      identity: work.identity,
      allowRemoteAccess: Boolean(allowRemoteAccess),
      allowLanAccess: Boolean(allowLanAccess),
      connectedVia: usedTransport,
      connectHost,
    },
  };
}
