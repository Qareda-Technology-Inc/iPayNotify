import { rosPairs, formatLimitUptime } from '../utils/rosParams.js';
import { normalizePrintRows } from './helpers.js';

export async function findHotspotUserByName(api, name) {
  const rows = normalizePrintRows(await api.write('/ip/hotspot/user/print'));
  return rows.find((r) => r.name === name) ?? null;
}

export async function addHotspotUser(api, opts) {
  const {
    name,
    password,
    profile,
    comment,
    timeLimitSeconds,
    dataLimitBytes,
  } = opts;
  const limitUptime = formatLimitUptime(timeLimitSeconds);
  const payload = {
    name,
    password: password ?? name,
    profile,
    ...(comment && { comment }),
    ...(limitUptime && { 'limit-uptime': limitUptime }),
    ...(dataLimitBytes != null &&
      dataLimitBytes > 0 && { 'limit-bytes-total': String(dataLimitBytes) }),
  };
  return api.write(['/ip/hotspot/user/add', ...rosPairs(payload)]);
}

export async function removeHotspotUser(api, internalId) {
  return api.write(['/ip/hotspot/user/remove', `=.id=${internalId}`]);
}

export async function printHotspotUsers(api) {
  return normalizePrintRows(await api.write('/ip/hotspot/user/print'));
}

/** Logged-in hotspot sessions (captive portal). */
export async function printHotspotActive(api) {
  return normalizePrintRows(await api.write('/ip/hotspot/active/print'));
}
