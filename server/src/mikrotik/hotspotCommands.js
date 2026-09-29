import { rosPairs, formatLimitUptime, formatRateLimit } from '../utils/rosParams.js';
import { cliEscapeValue, parseDetailPrintOutput } from './rosSsh.js';
import { normalizePrintRows } from './helpers.js';

function rowName(r) {
  return String(r?.name || r?.user || '').trim();
}

function pickHotspotUserRow(rows, want) {
  const name = String(want || '').trim();
  if (!name) return null;
  return rows.find((r) => rowName(r) === name) ?? null;
}

/**
 * Locate a hotspot user by login name.
 * Prefer filtered SSH lookups — full `print` parsing often misses rows on RouterOS 7.
 */
export async function findHotspotUserByName(api, name) {
  const want = String(name || '').trim();
  if (!want) return null;

  let rows = normalizePrintRows(await api.write('/ip/hotspot/user/print'));
  let hit = pickHotspotUserRow(rows, want);
  if (hit) return hit;

  if (typeof api?.execCli !== 'function') return null;

  const lit = cliEscapeValue(want);

  try {
    const cnt = await api.execCli(`/ip hotspot user print count-only where name=${lit}`);
    const n = parseInt(String(cnt).trim().split(/\s+/)[0] || '0', 10);
    if (!Number.isNaN(n) && n > 0) {
      try {
        const filtered = await api.execCli(
          `/ip hotspot user print detail without-paging where name=${lit}`
        );
        hit = pickHotspotUserRow(parseDetailPrintOutput(filtered), want);
        if (hit) return hit;
      } catch {
        /* filtered detail failed — still know the row exists */
      }
      return { name: want, '.id': undefined };
    }
  } catch {
    /* count-only / where unsupported on some builds */
  }

  try {
    const full = await api.execCli('/ip hotspot user print detail without-paging');
    const re = new RegExp(`(?:^|[\\s;])name=${want.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:[\\s;]|$)`);
    if (!re.test(String(full).replace(/\r/g, ''))) return null;
    hit = pickHotspotUserRow(parseDetailPrintOutput(full), want);
    return hit || { name: want };
  } catch {
    return null;
  }
}

export async function printHotspotServers(api) {
  return normalizePrintRows(await api.write('/ip/hotspot/print'));
}

export async function printHotspotUserProfiles(api) {
  return normalizePrintRows(await api.write('/ip/hotspot/user/profile/print'));
}

function nameAppearsInRosPrint(stdout, want) {
  const w = String(want || '').trim();
  if (!w || !stdout) return false;
  const escaped = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[\\s;])name=${escaped}(?:[\\s;"']|$)`, 'm').test(String(stdout));
}

async function hotspotProfileExists(api, name) {
  const want = String(name || '').trim();
  if (!want) return false;

  try {
    const rows = await printHotspotUserProfiles(api);
    if (rows.some((r) => String(r.name || '').trim() === want)) return true;
  } catch {
    /* continue with CLI probes */
  }

  if (typeof api?.execCli !== 'function') return false;
  const lit = cliEscapeValue(want);

  try {
    const detail = await api.execCli(
      `/ip hotspot user profile print detail without-paging where name=${lit}`
    );
    if (nameAppearsInRosPrint(detail, want)) return true;
    if (parseDetailPrintOutput(detail).some((r) => String(r.name || '').trim() === want)) {
      return true;
    }
  } catch {
    /* fall through */
  }

  try {
    const cnt = await api.execCli(
      `/ip hotspot user profile print count-only where name=${lit}`
    );
    const n = parseInt(String(cnt).trim().split(/\s+/)[0] || '0', 10);
    if (Number.isFinite(n) && n > 0) return true;
  } catch {
    /* fall through */
  }

  try {
    const full = await api.execCli('/ip hotspot user profile print detail without-paging');
    if (nameAppearsInRosPrint(full, want)) return true;
  } catch {
    /* ignore */
  }
  return false;
}

function assertCliOk(stdout, context) {
  const text = String(stdout || '');
  if (
    /failure:\s|syntax error|expected end of command|ambiguous command|script error|input does not match|no such item|invalid value|unknown parameter|already have|bad command/i.test(
      text
    )
  ) {
    const line =
      text
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .find((l) =>
          /failure:|syntax error|expected|input does not match|no such item|invalid|unknown|already have|bad command/i.test(
            l
          )
        ) || text.trim();
    const err = new Error(`${context}: ${line.slice(0, 400)}`);
    err.status = 502;
    throw err;
  }
}

/**
 * Create or update a hotspot user profile from a QareFi package.
 * Minimal add first (name only), then set rate-limit / shared-users — more reliable over SSH.
 */
export async function upsertHotspotUserProfile(api, profileName, opts = {}) {
  const name = String(profileName || 'default').trim() || 'default';
  const rateLimit = formatRateLimit(opts.speedDownMbps, opts.speedUpMbps);
  const shared =
    opts.sharedUsers != null && Number(opts.sharedUsers) > 0
      ? String(Math.floor(Number(opts.sharedUsers)))
      : undefined;
  /* Avoid ":" in unquoted comments — some ROS builds split on it */
  const comment = String(opts.comment || 'QareFi hotspot package')
    .trim()
    .replace(/:/g, '-');
  const nameLit = cliEscapeValue(name);
  const exists = await hotspotProfileExists(api, name);

  if (typeof api?.execCli === 'function') {
    if (!exists) {
      try {
        const out = await api.execCli(`/ip hotspot user profile add name=${nameLit}`);
        assertCliOk(out, 'Hotspot profile add');
      } catch (e) {
        const msg = String(e?.message || e);
        if (!/already have/i.test(msg)) throw e;
      }
    }

    let setLine = `/ip hotspot user profile set [find name=${nameLit}]`;
    if (rateLimit) setLine += ` rate-limit=${cliEscapeValue(rateLimit)}`;
    if (shared) setLine += ` shared-users=${cliEscapeValue(shared)}`;
    if (comment) setLine += ` comment=${cliEscapeValue(comment)}`;
    try {
      const out = await api.execCli(setLine);
      assertCliOk(out, 'Hotspot profile set');
    } catch (e) {
      /* set can fail if find matched nothing — try add+set once more */
      const msg = String(e?.message || e);
      if (/no such item|not found|empty/i.test(msg) || !exists) {
        const outAdd = await api.execCli(`/ip hotspot user profile add name=${nameLit}`);
        assertCliOk(outAdd, 'Hotspot profile add (retry)');
        const outSet = await api.execCli(setLine);
        assertCliOk(outSet, 'Hotspot profile set (retry)');
      } else {
        throw e;
      }
    }

    const ok = await hotspotProfileExists(api, name);
    if (!ok) {
      let sample = '';
      try {
        sample = String(
          await api.execCli('/ip hotspot user profile print without-paging')
        ).slice(0, 240);
      } catch {
        /* ignore */
      }
      const err = new Error(
        `Hotspot user profile “${name}” was not found after sync. ` +
          `Tried: /ip hotspot user profile add name=${nameLit}. ` +
          (sample ? `Router profiles sample: ${sample.replace(/\s+/g, ' ')}` : '')
      );
      err.status = 502;
      throw err;
    }
    return { name, created: !exists, updated: exists };
  }

  const rows = await printHotspotUserProfiles(api);
  if (exists) {
    const row = rows.find((r) => String(r.name || '').trim() === name);
    const id = row?.['.id'];
    if (id) {
      await api.write([
        '/ip/hotspot/user/profile/set',
        `=.id=${id}`,
        ...rosPairs({
          ...(rateLimit ? { 'rate-limit': rateLimit } : {}),
          ...(shared ? { 'shared-users': shared } : {}),
          ...(comment ? { comment } : {}),
        }),
      ]);
      return { name, created: false, updated: true };
    }
  }

  await api.write([
    '/ip/hotspot/user/profile/add',
    ...rosPairs({
      name,
      ...(rateLimit ? { 'rate-limit': rateLimit } : {}),
      ...(shared ? { 'shared-users': shared } : {}),
      comment,
    }),
  ]);
  return { name, created: true, updated: false };
}

/** @deprecated use upsertHotspotUserProfile */
export async function ensureHotspotUserProfile(api, profileName, opts = {}) {
  return upsertHotspotUserProfile(api, profileName, opts);
}

/**
 * Add hotspot user. Username-only login → empty password.
 * Profile is upserted first unless skipProfileUpsert. Verify unless skipVerify.
 */
export async function addHotspotUser(api, opts) {
  const {
    name,
    password,
    profile,
    comment,
    timeLimitSeconds,
    dataLimitBytes,
    sharedUsers,
    speedDownMbps,
    speedUpMbps,
    server,
    skipProfileUpsert = false,
    skipVerify = false,
  } = opts;
  let resolvedProfile = String(profile || 'default').trim() || 'default';

  if (!skipProfileUpsert) {
    const upserted = await upsertHotspotUserProfile(api, resolvedProfile, {
      speedDownMbps,
      speedUpMbps,
      sharedUsers,
    });
    resolvedProfile = upserted.name;
  }

  const limitUptime = formatLimitUptime(timeLimitSeconds);
  const pass = password == null ? '' : String(password);
  const serverName = String(server || '').trim();
  const nameLit = cliEscapeValue(name);
  const passLit = pass === '' ? '""' : cliEscapeValue(pass);
  const profileLit = cliEscapeValue(resolvedProfile);

  const buildCli = (includeServer) => {
    let line =
      `/ip hotspot user add name=${nameLit} ` +
      `password=${passLit} profile=${profileLit}`;
    if (includeServer && serverName) line += ` server=${cliEscapeValue(serverName)}`;
    if (comment) line += ` comment=${cliEscapeValue(comment)}`;
    if (limitUptime) line += ` limit-uptime=${cliEscapeValue(limitUptime)}`;
    if (dataLimitBytes != null && dataLimitBytes > 0) {
      line += ` limit-bytes-total=${cliEscapeValue(String(dataLimitBytes))}`;
    }
    return line;
  };

  const buildApiPayload = (includeServer) => ({
    name,
    password: pass,
    profile: resolvedProfile,
    ...(includeServer && serverName ? { server: serverName } : {}),
    ...(comment ? { comment } : {}),
    ...(limitUptime ? { 'limit-uptime': limitUptime } : {}),
    ...(dataLimitBytes != null && dataLimitBytes > 0
      ? { 'limit-bytes-total': String(dataLimitBytes) }
      : {}),
  });

  if (typeof api?.execCli === 'function') {
    try {
      const out = await api.execCli(buildCli(true));
      assertCliOk(out, 'Hotspot user add');
    } catch (e) {
      const msg = String(e?.message || e);
      if (serverName && /server|input does not match|invalid value/i.test(msg) && !/profile/i.test(msg)) {
        const out = await api.execCli(buildCli(false));
        assertCliOk(out, 'Hotspot user add (without server)');
      } else {
        throw e;
      }
    }
  } else {
    try {
      await api.write(['/ip/hotspot/user/add', ...rosPairs(buildApiPayload(true))]);
    } catch (e) {
      const msg = String(e?.message || e);
      if (
        serverName &&
        /server|input does not match|invalid value|no such item/i.test(msg) &&
        !/profile/i.test(msg)
      ) {
        await api.write(['/ip/hotspot/user/add', ...rosPairs(buildApiPayload(false))]);
      } else {
        throw e;
      }
    }
  }

  if (skipVerify) return { name, profile: resolvedProfile };

  const row = await findHotspotUserByName(api, name);
  if (!row) {
    const err = new Error(
      `Hotspot user “${name}” was not found on the router after add. Check Winbox → IP → Hotspot → Users.`
    );
    err.status = 502;
    throw err;
  }
  return row;
}

/**
 * Drop the live session and the hotspot user. Removing the user alone leaves
 * an already-open session online past the plan.
 */
export async function disconnectHotspotUser(api, username) {
  const name = String(username || '').trim();
  if (!name) return;
  const lit = cliEscapeValue(name);
  if (typeof api?.execCli === 'function') {
    await api.execCli(`/ip hotspot active remove [find user=${lit}]`).catch(() => {});
    await api.execCli(`/ip hotspot user remove [find name=${lit}]`).catch(() => {});
    return;
  }
  const active = normalizePrintRows(await api.write('/ip/hotspot/active/print'));
  for (const row of active) {
    const u = String(row.user || row.name || '').trim();
    if (u !== name || !row['.id']) continue;
    await api.write(['/ip/hotspot/active/remove', `=.id=${row['.id']}`]).catch(() => {});
  }
  const user = await findHotspotUserByName(api, name);
  if (user?.['.id']) await removeHotspotUser(api, user['.id']);
}

/** Absolute online cap. MikroTik compares this to the user's accumulated uptime. */
export async function setHotspotUserLimitUptime(api, username, seconds) {
  const limit = formatLimitUptime(seconds);
  if (!limit) return;
  const lit = cliEscapeValue(username);
  if (typeof api?.execCli === 'function') {
    const out = await api.execCli(
      `/ip hotspot user set [find name=${lit}] limit-uptime=${cliEscapeValue(limit)}`
    );
    assertCliOk(out, 'Hotspot limit-uptime');
    return;
  }
  const row = await findHotspotUserByName(api, username);
  if (!row?.['.id']) return;
  await api.write([
    '/ip/hotspot/user/set',
    `=.id=${row['.id']}`,
    `=limit-uptime=${limit}`,
  ]);
}

export async function removeHotspotUser(api, internalId) {
  if (internalId == null || String(internalId).trim() === '') {
    return null;
  }
  const id = String(internalId).trim();
  if (typeof api?.execCli === 'function') {
    try {
      return await api.execCli(`/ip hotspot user remove ${cliEscapeValue(id)}`);
    } catch {
      /* fall through to API-style */
    }
  }
  return api.write(['/ip/hotspot/user/remove', `=.id=${id}`]);
}

/** Update comment (used to stamp wall-clock expiry after first activation). */
export async function setHotspotUserComment(api, username, comment) {
  if (typeof api?.execCli === 'function') {
    return api.execCli(
      `/ip hotspot user set [find name=${cliEscapeValue(username)}] comment=${cliEscapeValue(comment)}`
    );
  }
  const row = await findHotspotUserByName(api, username);
  if (!row?.['.id']) return null;
  return api.write([
    '/ip/hotspot/user/set',
    `=.id=${row['.id']}`,
    `=comment=${comment}`,
  ]);
}

/**
 * Lock hotspot user to a MAC after the first login.
 * Sets mac-address + comment in one CLI call when possible.
 */
export async function setHotspotUserMacAndComment(api, username, mac, comment) {
  const nameLit = cliEscapeValue(username);
  const macLit = cliEscapeValue(mac);
  const commentLit = cliEscapeValue(comment);
  if (typeof api?.execCli === 'function') {
    const out = await api.execCli(
      `/ip hotspot user set [find name=${nameLit}] mac-address=${macLit} comment=${commentLit}`
    );
    assertCliOk(out, 'Hotspot user mac/comment set');
    return out;
  }
  const row = await findHotspotUserByName(api, username);
  if (!row?.['.id']) return null;
  return api.write([
    '/ip/hotspot/user/set',
    `=.id=${row['.id']}`,
    `=mac-address=${mac}`,
    `=comment=${comment}`,
  ]);
}

export async function printHotspotUsers(api) {
  return normalizePrintRows(await api.write('/ip/hotspot/user/print'));
}

/** Logged-in hotspot sessions (captive portal). */
export async function printHotspotActive(api) {
  return normalizePrintRows(await api.write('/ip/hotspot/active/print'));
}
