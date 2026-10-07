import mongoose from 'mongoose';
import { Admin, Router } from '../models/index.js';
import { WireGuardPeer } from '../models/WireGuardPeer.js';
import { withRouterMikrotik } from '../mikrotik/routeros.js';
import { isWgTunnelHost } from '../mikrotik/wgJump.js';
import { readWgLatestHandshakes } from './wireguard/wgPeerSync.js';
import { describeRouterError } from '../utils/routerErrors.js';
import { routerDisplayName } from '../utils/routerLabel.js';
import { sendSmtpMail } from '../integrations/mail.js';
import { sendArkeselSms } from '../integrations/arkesel.js';
import { normalizeGhanaMsisdn } from '../utils/phoneGhana.js';
import { resolveSmsBranding } from './smsRouterBranding.js';
import { buildRouterStatusAlertEmail } from '../templates/email/transactional.js';
import { config } from '../config.js';

/** MikroTik keepalive is 25s, so 3 minutes without a handshake means the tunnel is down. */
const HANDSHAKE_STALE_SEC = 180;
/** WireGuard: stale on two checks in a row (cron runs every minute) before the login probe. */
const WG_FAILS_BEFORE_PROBE = 2;
/** Routers without a tunnel: three failed logins a minute apart (~3 minutes). */
const LOGIN_FAILS_BEFORE_OFFLINE = 3;
const REMIND_EVERY_MS = 60 * 60 * 1000;
const PROBE_TIMEOUT_MS = 25_000;
const PROBE_CONCURRENCY = 4;
/** Router answered (refused / rejected login / slow): it is up, the app just cannot manage it. */
const REACHABLE_CODES = new Set(['login', 'refused', 'slow']);
const ALERT_ROLES = ['org_admin', 'org_staff', 'ticket_manager'];
/** Accounts created before `status` existed have no stored value; only pending invites are excluded. */
const NOT_INVITED = { $ne: 'invited' };
const TZ = 'Africa/Accra';

let running = false;
let lastVpsWarnAt = 0;

export function formatDuration(ms) {
  const mins = Math.max(1, Math.round(ms / 60000));
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h < 24) return m ? `${h}h ${m}m` : `${h}h`;
  const d = Math.floor(h / 24);
  const rh = h % 24;
  return rh ? `${d}d ${rh}h` : `${d}d`;
}

function formatTime(d) {
  return new Date(d).toLocaleString('en-GB', {
    timeZone: TZ,
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Login probe: resolves { ok } or { ok: false, d } with the friendly error description. */
async function probeRouter(routerId) {
  const router = await Router.findById(routerId);
  if (!router) return { ok: false, d: { code: 'error', message: 'Router not found', hint: '' } };
  let timer;
  try {
    await Promise.race([
      withRouterMikrotik(router, (api) => api.write('/system/identity/print')),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('connect timed out (monitor probe)')), PROBE_TIMEOUT_MS);
      }),
    ]);
    return { ok: true };
  } catch (e) {
    return { ok: false, d: describeRouterError(e) };
  } finally {
    clearTimeout(timer);
  }
}

async function alertRecipients(organizationId) {
  const q =
    organizationId && mongoose.isValidObjectId(String(organizationId))
      ? { organizationId, role: { $in: ALERT_ROLES }, status: NOT_INVITED }
      : null;
  let admins = q ? await Admin.find(q).select('email phone').lean() : [];
  let fallback = false;
  if (!admins.length) {
    fallback = true;
    admins = await Admin.find({ role: 'super_admin', status: NOT_INVITED }).select('email phone').lean();
  }
  const emails = new Set();
  const phones = new Set();
  for (const a of admins) {
    const e = String(a.email || '').trim().toLowerCase();
    if (e) emails.add(e);
    const p = normalizeGhanaMsisdn(a.phone);
    if (p) phones.add(p);
  }
  return { emails: [...emails], phones: [...phones], people: admins.length, fallback };
}

function smsText(brand, kind, name, info) {
  if (kind === 'online') {
    return `${brand}: Router "${name}" is back ONLINE.${info.durationLabel ? ` Down ${info.durationLabel}.` : ''}`;
  }
  if (kind === 'test') return `${brand}: Test alert for router "${name}". Offline alerts will arrive like this.`;
  if (kind === 'reminder') {
    return `${brand} ALERT: Router "${name}" still OFFLINE (${info.durationLabel}, since ${info.sinceLabel}).`;
  }
  return `${brand} ALERT: Router "${name}" is OFFLINE since ${info.sinceLabel}.${info.reason ? ` ${info.reason}.` : ''}`;
}

/** Email + SMS all org admins. Returns a short result string for the router record. */
export async function sendRouterAlert(router, kind, info = {}) {
  const name = routerDisplayName(router) || router.name || router.host;
  const orgId = router.organizationId ? String(router.organizationId) : null;
  const { emails, phones, people, fallback } = await alertRecipients(orgId);
  const branding = await resolveSmsBranding(String(router._id), orgId);
  const { subject, text, html } = buildRouterStatusAlertEmail({
    brand: branding.brandName,
    kind,
    routerName: name,
    host: router.host,
    sinceLabel: info.sinceLabel,
    durationLabel: info.durationLabel,
    reason: info.reason,
    hint: info.hint,
    appUrl: config.publicAppUrl ? `${String(config.publicAppUrl).replace(/\/$/, '')}/devices/routers` : '',
  });
  const message = smsText(branding.brandName, kind, name, info);
  const [mailResults, smsResults] = await Promise.all([
    Promise.allSettled(emails.map((to) => sendSmtpMail({ to, subject, text, html }))),
    Promise.allSettled(phones.map((to) => sendArkeselSms({ to, message, senderId: branding.senderId || undefined }))),
  ]);
  const okCount = (rs) => rs.filter((r) => r.status === 'fulfilled' && r.value?.ok).length;
  const result = `email ${okCount(mailResults)}/${emails.length}, sms ${okCount(smsResults)}/${phones.length}`;
  console.log('[router.monitor] alert', kind, name, result, { orgId, people, fallback });
  return {
    result,
    emails: emails.length,
    phones: phones.length,
    people,
    fallback,
    organizationId: orgId,
    emailErrors: mailResults
      .map((r) => (r.status === 'rejected' ? r.reason?.message : r.value?.ok ? null : r.value?.error))
      .filter(Boolean)
      .slice(0, 3),
  };
}

/**
 * Decide the next monitor state for one router.
 * @returns {Promise<{ monitor: object, alert?: 'offline'|'reminder'|'online', info?: object }>}
 */
export async function nextMonitorState(r, observation, now) {
  const prev = { state: 'unknown', failCount: 0, alertsEnabled: true, ...(r.monitor || {}) };
  const next = { ...prev, checkedAt: now, method: observation.method };
  if (observation.lastSeenAt) next.lastSeenAt = observation.lastSeenAt;

  let healthy = observation.healthy;
  let warning = '';
  let warningHint = '';
  let down = null;

  if (!healthy) {
    const fails = (prev.state === 'offline' ? 0 : prev.failCount || 0) + 1;
    const threshold = observation.method === 'wireguard' ? WG_FAILS_BEFORE_PROBE : LOGIN_FAILS_BEFORE_OFFLINE;
    if (prev.state === 'offline') {
      down = observation.d || { message: prev.reason, hint: prev.hint };
    } else if (fails < threshold) {
      next.failCount = fails;
      return { monitor: next };
    } else {
      const probe = observation.method === 'wireguard' ? await probeRouter(r._id) : { ok: false, d: observation.d };
      if (probe.ok) {
        healthy = true;
        warning = 'VPN tunnel looks idle, but the router answered';
        warningHint = 'Check the WireGuard persistent-keepalive (25s) on the router.';
      } else if (REACHABLE_CODES.has(probe.d?.code)) {
        healthy = true;
        warning = probe.d.message;
        warningHint = probe.d.hint || '';
      } else {
        down = probe.d || { message: 'Router offline', hint: '' };
        if (observation.method === 'wireguard') {
          down = {
            message: observation.lastSeenAt
              ? `No VPN contact since ${formatTime(observation.lastSeenAt)}`
              : 'Router has never connected to the VPN',
            hint: 'Check that the router has power and internet, and that its WireGuard tunnel is up.',
          };
        }
      }
    }
  } else if (observation.warning) {
    warning = observation.warning;
    warningHint = observation.hint || '';
  }

  if (healthy) {
    const wasOffline = prev.state === 'offline';
    Object.assign(next, { state: 'online', failCount: 0, reason: warning, hint: warningHint });
    if (!wasOffline && prev.state === 'online') return { monitor: next };
    next.since = now;
    if (wasOffline && prev.alertedOffline) {
      const downSince = prev.since ? new Date(prev.since) : null;
      next.alertedOffline = false;
      return {
        monitor: next,
        alert: 'online',
        info: {
          sinceLabel: downSince ? formatTime(downSince) : '',
          durationLabel: downSince ? formatDuration(now - downSince) : '',
        },
      };
    }
    next.alertedOffline = false;
    return { monitor: next };
  }

  /* Offline */
  next.failCount = 0;
  next.reason = down?.message || 'Router offline';
  next.hint = down?.hint || '';
  if (prev.state !== 'offline') {
    next.state = 'offline';
    next.since = observation.lastSeenAt || r.monitor?.lastSeenAt || now;
    next.alertedOffline = false;
  }
  const since = new Date(next.since || now);
  const info = {
    sinceLabel: formatTime(since),
    durationLabel: formatDuration(now - since),
    reason: next.reason,
    hint: next.hint,
  };
  if (!next.alertsEnabled) return { monitor: next };
  if (!next.alertedOffline) return { monitor: next, alert: 'offline', info };
  const lastAlert = prev.lastAlertAt ? new Date(prev.lastAlertAt).getTime() : 0;
  if (now - lastAlert >= REMIND_EVERY_MS) return { monitor: next, alert: 'reminder', info };
  return { monitor: next };
}

async function mapLimit(items, limit, fn) {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: Math.min(limit, queue.length) }, async () => {
      while (queue.length) await fn(queue.shift());
    })
  );
}

/** One monitor pass over every router (cron: every minute). */
export async function runRouterMonitor() {
  if (running) return { skipped: true };
  running = true;
  const summary = { checked: 0, online: 0, offline: 0, alerts: 0, blind: 0 };
  try {
    const routers = await Router.find({}).select('name comment host organizationId monitor').lean();
    if (!routers.length) return summary;

    const peers = await WireGuardPeer.find({ kind: 'router' })
      .select('publicKey tunnelIp claimedRouterId status')
      .lean();
    const peerByRouter = new Map(peers.filter((p) => p.claimedRouterId).map((p) => [String(p.claimedRouterId), p]));
    const peerByIp = new Map(peers.map((p) => [p.tunnelIp, p]));

    let handshakes = null;
    let vpsError = null;
    if (routers.some((r) => isWgTunnelHost(r.host))) {
      try {
        handshakes = await readWgLatestHandshakes();
      } catch (e) {
        vpsError = e;
        if (Date.now() - lastVpsWarnAt > 15 * 60 * 1000) {
          lastVpsWarnAt = Date.now();
          console.warn('[router.monitor] VPS handshake read failed; tunnel routers not judged this pass:', e?.message || e);
        }
      }
    }

    const nowSec = Math.floor(Date.now() / 1000);
    const peerSeen = [];
    await mapLimit(routers, PROBE_CONCURRENCY, async (r) => {
      const host = String(r.host || '').trim();
      const peer = peerByRouter.get(String(r._id)) || peerByIp.get(host);
      let observation;
      if (isWgTunnelHost(host) && peer) {
        if (!handshakes) {
          summary.blind += 1;
          return;
        }
        const ts = handshakes.get(peer.publicKey) || 0;
        const lastSeenAt = ts ? new Date(ts * 1000) : null;
        if (ts) peerSeen.push({ id: peer._id, at: lastSeenAt });
        observation = { method: 'wireguard', healthy: ts > 0 && nowSec - ts <= HANDSHAKE_STALE_SEC, lastSeenAt };
      } else {
        if (isWgTunnelHost(host) && vpsError) {
          summary.blind += 1;
          return;
        }
        const probe = await probeRouter(r._id);
        if (!probe.ok && probe.d?.code === 'vpn_server') {
          summary.blind += 1;
          return;
        }
        const reachable = probe.ok || REACHABLE_CODES.has(probe.d?.code);
        observation = {
          method: 'login',
          healthy: reachable,
          lastSeenAt: reachable ? new Date() : null,
          warning: probe.ok ? '' : reachable ? probe.d.message : '',
          hint: probe.ok ? '' : probe.d?.hint || '',
          d: probe.ok ? null : probe.d,
        };
      }

      summary.checked += 1;
      const now = new Date();
      const { monitor, alert, info } = await nextMonitorState(r, observation, now);
      if (alert) {
        try {
          const sent = await sendRouterAlert(r, alert, info);
          monitor.lastAlertAt = now;
          monitor.lastAlertKind = alert;
          monitor.lastAlertResult = sent.result;
          if (alert === 'offline' || alert === 'reminder') monitor.alertedOffline = true;
          summary.alerts += 1;
        } catch (e) {
          console.error('[router.monitor] alert failed', r._id, e?.message || e);
          monitor.lastAlertResult = `failed: ${e?.message || e}`;
        }
      }
      if (monitor.state === 'online') summary.online += 1;
      if (monitor.state === 'offline') summary.offline += 1;
      /* alertsEnabled is owned by the admin toggle, never by the monitor pass. */
      const set = {};
      for (const [k, v] of Object.entries(monitor)) {
        if (k !== 'alertsEnabled') set[`monitor.${k}`] = v;
      }
      await Router.updateOne({ _id: r._id }, { $set: set });
    });

    if (peerSeen.length) {
      await WireGuardPeer.bulkWrite(
        peerSeen.map((p) => ({ updateOne: { filter: { _id: p.id }, update: { $set: { lastSeen: p.at } } } }))
      );
    }
    return summary;
  } finally {
    running = false;
  }
}
