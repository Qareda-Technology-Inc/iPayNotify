import { rosPairs, formatLimitUptime, formatRateLimit } from '../utils/rosParams.js';
import { cliEscapeValue, parseDetailPrintOutput, rosFindLit, rosScriptLit } from './rosSsh.js';
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

  const lit = rosFindLit(want);

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
  const lit = rosFindLit(want);

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

/** The router answered; this is a config/command problem, not an unreachable host. */
function markRosCommandError(e) {
  const err = e instanceof Error ? e : new Error(String(e));
  err.rosCommandError = true;
  if (!err.status) err.status = 502;
  return err;
}

function normalizeRate(v) {
  return String(v || '')
    .replace(/^"|"$/g, '')
    .trim()
    .toUpperCase()
    .replace(/(\d)000K/g, '$1M');
}

function sameRateLimit(a, b) {
  return normalizeRate(a).split(' ')[0] === normalizeRate(b).split(' ')[0];
}

/** Current rate-limit on the profile, '' when unlimited, null when it cannot be read. */
async function readHotspotProfileRateLimit(api, findLit) {
  try {
    const out = String(
      await api.execCli(`/ip hotspot user profile print detail without-paging where name=${findLit}`)
    );
    if (!/name=/.test(out)) return null;
    const m = /rate-limit=("([^"]*)"|(\S+))/.exec(out);
    if (!m) return '';
    return m[2] ?? m[3] ?? '';
  } catch {
    return null;
  }
}

/**
 * Create or update a hotspot user profile from a QareFi package.
 * New profiles are added with rate-limit in the same command; existing ones are updated,
 * then the rate-limit is read back from the router.
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
  /* Always quote inside [find]: an unquoted `5-Hours` is read as an expression and matches nothing,
   * so `set` silently changes no profile and the speed never reaches the router. */
  const findLit = rosFindLit(name);
  const exists = await hotspotProfileExists(api, name);

  const onLogin = String(opts.onLogin || '').trim();

  if (typeof api?.execCli === 'function') {
    /* Profile first (quoted name — `10MIN` unquoted can be read as a number/time), then speed,
     * then the login script on its own so a script problem never blocks the profile. */
    const props = [];
    if (rateLimit) props.push(`rate-limit=${cliEscapeValue(rateLimit)}`);
    if (shared) props.push(`shared-users=${cliEscapeValue(shared)}`);
    if (comment) props.push(`comment=${cliEscapeValue(comment)}`);
    const propStr = props.join(' ');
    const outputs = [];
    const run = async (line, context) => {
      const out = await api.execCli(line);
      if (String(out || '').trim()) outputs.push(`${context}: ${String(out).trim().slice(0, 160)}`);
      assertCliOk(out, context);
      return out;
    };

    let present = exists;
    let propsApplied = false;
    if (!present) {
      try {
        await run(
          `/ip hotspot user profile add name=${findLit}${propStr ? ` ${propStr}` : ''}`,
          'Hotspot profile add'
        );
        propsApplied = true;
      } catch (e) {
        if (!/already have/i.test(String(e?.message || e))) throw markRosCommandError(e);
      }
      present = await hotspotProfileExists(api, name);
      if (!present) {
        try {
          await run(`/ip hotspot user profile add name=${findLit}`, 'Hotspot profile add (name only)');
        } catch (e) {
          if (!/already have/i.test(String(e?.message || e))) throw markRosCommandError(e);
        }
        propsApplied = false;
        present = await hotspotProfileExists(api, name);
      }
    }

    if (present && propStr && !propsApplied) {
      try {
        await run(`/ip hotspot user profile set [find where name=${findLit}] ${propStr}`, 'Hotspot profile set');
      } catch (e) {
        throw markRosCommandError(e);
      }
    }

    let onLoginOk = false;
    if (present && onLogin) {
      try {
        await run(
          `/ip hotspot user profile set [find where name=${findLit}] on-login=${rosScriptLit(onLogin)}`,
          'Hotspot profile on-login'
        );
        onLoginOk = true;
      } catch (e) {
        console.error('[hotspot] on-login script not installed', name, e?.message || e);
      }
    }

    const ok = present;
    let applied = null;
    if (ok && rateLimit) {
      applied = await readHotspotProfileRateLimit(api, findLit);
      if (applied != null && !sameRateLimit(applied, rateLimit)) {
        /* One more set on its own (some builds ignore rate-limit when combined with a long on-login) */
        try {
          await run(
            `/ip hotspot user profile set [find where name=${findLit}] rate-limit=${cliEscapeValue(rateLimit)}`,
            'Hotspot profile rate-limit'
          );
        } catch (e) {
          throw markRosCommandError(e);
        }
        applied = await readHotspotProfileRateLimit(api, findLit);
      }
      if (applied != null && !sameRateLimit(applied, rateLimit)) {
        throw markRosCommandError(
          new Error(
            `Hotspot profile “${name}” rate-limit is “${applied || 'unlimited'}” on the router, expected “${rateLimit}”.`
          )
        );
      }
    }
    if (!ok) {
      let sample = '';
      try {
        sample = String(
          await api.execCli('/ip hotspot user profile print terse without-paging')
        ).slice(0, 300);
      } catch {
        /* ignore */
      }
      throw markRosCommandError(
        new Error(
          `Hotspot user profile “${name}” could not be created on the router. ` +
            (outputs.length ? `Router said: ${outputs.join(' | ')}. ` : 'Router returned no message. ') +
            (sample ? `Existing profiles: ${sample.replace(/\s+/g, ' ')}` : '')
        )
      );
    }
    return {
      name,
      created: !exists,
      updated: exists,
      rateLimit: applied ?? rateLimit ?? '',
      onLogin: onLoginOk,
    };
  }

  const rows = await printHotspotUserProfiles(api);
  const props = {
    ...(rateLimit ? { 'rate-limit': rateLimit } : {}),
    ...(shared ? { 'shared-users': shared } : {}),
    ...(comment ? { comment } : {}),
    ...(onLogin ? { 'on-login': onLogin } : {}),
  };
  if (exists) {
    const row = rows.find((r) => String(r.name || '').trim() === name);
    const id = row?.['.id'];
    if (id) {
      await api.write(['/ip/hotspot/user/profile/set', `=.id=${id}`, ...rosPairs(props)]);
      return { name, created: false, updated: true, rateLimit: rateLimit || '', onLogin: Boolean(onLogin) };
    }
  }

  await api.write(['/ip/hotspot/user/profile/add', ...rosPairs({ name, ...props })]);
  return { name, created: true, updated: false, rateLimit: rateLimit || '', onLogin: Boolean(onLogin) };
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
  const lit = rosFindLit(name);
  if (typeof api?.execCli === 'function') {
    await api.execCli(`/ip hotspot active remove [find where user=${lit}]`).catch(() => {});
    await api.execCli(`/ip hotspot user remove [find where name=${lit}]`).catch(() => {});
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
  const lit = rosFindLit(username);
  if (typeof api?.execCli === 'function') {
    const out = await api.execCli(
      `/ip hotspot user set [find where name=${lit}] limit-uptime=${cliEscapeValue(limit)}`
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
      `/ip hotspot user set [find where name=${rosFindLit(username)}] comment=${cliEscapeValue(comment)}`
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
  const nameLit = rosFindLit(username);
  const macLit = cliEscapeValue(mac);
  const commentLit = cliEscapeValue(comment);
  if (typeof api?.execCli === 'function') {
    const out = await api.execCli(
      `/ip hotspot user set [find where name=${nameLit}] mac-address=${macLit} comment=${commentLit}`
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
