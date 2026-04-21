import { rosPairs } from '../utils/rosParams.js';
import { normalizePrintRows } from './helpers.js';
import {
  cliEscapeValue,
  parseDetailPrintOutput,
  rosApiWordsToCli,
} from './rosSsh.js';

/** PPP active: `user` is the PPP login (PPPoE username). `name` is the dynamic interface id — do not match disconnects on `name` or one bad find can drop unrelated sessions. */
function pppActiveRowMatchesLogin(row, login) {
  const u = String(login ?? '').trim();
  if (!u) return false;
  return String(row.user ?? '').trim() === u;
}

/** RouterOS `service` on /ppp/active may be `pppoe`, `l2tp-in`, etc. */
function pppActiveServiceMatches(rowService, expected) {
  const r = String(rowService ?? '').trim().toLowerCase();
  const e = String(expected ?? 'pppoe').trim().toLowerCase();
  if (!r) return true;
  if (r === e) return true;
  if (e === 'pppoe' && (r === 'pppoe' || r.startsWith('pppoe'))) return true;
  return r === e;
}

/** Double-quoted literal for `[find user=…]` so `*` and spaces never act as wildcards. */
function rosFindQuotedString(s) {
  return `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function isBenignPppActiveRemoveFailure(msg) {
  const m = String(msg ?? '').toLowerCase();
  return (
    /no such item|nothing to remove|no entries|does not match any|input does not match/.test(m) ||
    /failure:\s*no/.test(m)
  );
}

export async function printPppSecrets(api) {
  const raw = await api.write('/ppp/secret/print');
  return normalizePrintRows(raw);
}

export async function printPppActive(api) {
  const raw = await api.write('/ppp/active/print');
  return normalizePrintRows(raw);
}

/** Login name on `/ppp/secret` rows (API/SSH); trim for comparisons. */
export function pppSecretRowLoginName(row) {
  if (!row || typeof row !== 'object') return '';
  return String(row.name ?? row.user ?? '').trim();
}

/** Raw `print detail` text contains this secret login (when key=value parsing fails). */
export function detailStdoutMentionsPppSecretName(stdout, want) {
  const w = String(want ?? '').trim();
  if (!w || !stdout) return false;
  const q = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return (
    new RegExp(`(?:^|[\\s=])name="${q}"(?:\\s|$)`, 'm').test(stdout) ||
    new RegExp(`(?:^|[\\s=])name=${q}(?:\\s|$)`, 'm').test(stdout)
  );
}

function pickPppSecretRow(rows, want) {
  const exact = rows.find((r) => pppSecretRowLoginName(r) === want);
  if (exact) return exact;
  const lower = want.toLowerCase();
  const ci = rows.filter((r) => pppSecretRowLoginName(r).toLowerCase() === lower);
  return ci.length === 1 ? ci[0] : null;
}

export async function findPppSecretByName(api, name) {
  const want = String(name ?? '').trim();
  if (!want) return null;

  let rows = normalizePrintRows(await api.write('/ppp/secret/print'));
  let hit = pickPppSecretRow(rows, want);
  if (hit) return hit;

  /**
   * SSH: full `print detail` parsing often misses rows (RouterOS 7 table vs kv, wrapping, etc.).
   * Use `where name=` + count-only, then filtered detail; last resort full detail + substring check.
   */
  if (typeof api?.execCli !== 'function') return null;

  const lit = cliEscapeValue(want);

  try {
    const cnt = await api.execCli(`/ppp secret print count-only where name=${lit}`);
    const n = parseInt(String(cnt).trim().split(/\s+/)[0] || '0', 10);
    if (!Number.isNaN(n) && n > 0) {
      try {
        const filtered = await api.execCli(
          `/ppp secret print detail without-paging where name=${lit}`
        );
        hit = pickPppSecretRow(parseDetailPrintOutput(filtered), want);
        if (hit) return hit;
      } catch {
        /* filtered detail failed — still know the row exists */
      }
      return { name: want };
    }
  } catch {
    /* count-only / where unsupported on some builds */
  }

  try {
    const full = await api.execCli('/ppp secret print detail without-paging');
    if (!detailStdoutMentionsPppSecretName(full, want)) return null;
    hit = pickPppSecretRow(parseDetailPrintOutput(full), want);
    return hit || { name: want };
  } catch {
    return null;
  }
}

/**
 * Drop live PPP sessions for this login only (same `user` + `service` on /ppp/active).
 * Changing `/ppp/secret` does not affect sessions that are already up.
 */
export async function disconnectPppSessionsBySecretName(api, secretName, options = {}) {
  const u = String(secretName ?? '').trim();
  if (!u) return;
  const service = String(options.service ?? 'pppoe').trim() || 'pppoe';

  const isSsh = typeof api?.execCli === 'function';
  /**
   * One scoped remove: login + service. Avoid `[find name=login]` — `name` there is the session
   * interface, not the PPP username; a second broad remove was disconnecting unrelated users.
   */
  if (isSsh) {
    const scoped = `/ppp active remove [find user=${rosFindQuotedString(u)} and service=${rosFindQuotedString(service)}]`;
    try {
      await api.execCli(scoped);
      return;
    } catch (e) {
      if (!isBenignPppActiveRemoveFailure(e?.message)) throw e;
    }
    /* Some builds show service as pppoe-in / different token — fall back to login-only (still quoted, no `name=` find). */
    const userOnly = `/ppp active remove [find user=${rosFindQuotedString(u)}]`;
    try {
      await api.execCli(userOnly);
    } catch (e2) {
      if (isBenignPppActiveRemoveFailure(e2?.message)) return;
      throw e2;
    }
    return;
  }

  const rows = normalizePrintRows(await api.write('/ppp/active/print'));
  const matches = rows.filter(
    (r) => pppActiveRowMatchesLogin(r, u) && pppActiveServiceMatches(r.service, service)
  );
  for (const row of matches) {
    const rid = row['.id'] ?? row.numbers;
    if (rid == null || String(rid).trim() === '') continue;
    const id = String(rid).trim();
    if (/^\d+$/.test(id)) {
      await api.write(['/ppp/active/remove', `=numbers=${id}`]);
    } else {
      await api.write(['/ppp/active/remove', `=.id=${id}`]);
    }
  }
}

export async function addPppSecret(api, fields) {
  const { name, password, service, profile, comment, disabled } = fields;
  const payload = {
    name,
    password,
    service: service || 'pppoe',
    profile,
    ...(comment != null && { comment }),
    ...(disabled != null && { disabled }),
  };
  return api.write(['/ppp/secret/add', ...rosPairs(payload)]);
}

/**
 * @param {string | undefined} internalId  API `.id` (*N) or SSH `print detail` row index as string
 * @param {string | undefined} secretNameFallback  SSH: used in `[find name=…]` if id missing
 */
export async function setPppSecret(api, internalId, fields, secretNameFallback = null) {
  const isSsh = typeof api?.execCli === 'function';
  const id =
    internalId != null && String(internalId).trim() !== '' ? String(internalId).trim() : '';
  const payload = { ...fields };

  if (id) {
    if (isSsh && /^\d+$/.test(id)) {
      payload.numbers = id;
    } else {
      payload['.id'] = id;
    }
    return api.write(['/ppp/secret/set', ...rosPairs(payload)]);
  }

  if (isSsh && secretNameFallback) {
    const nameLit = cliEscapeValue(secretNameFallback);
    const rest = rosApiWordsToCli(rosPairs(payload));
    const line = `/ppp secret set [find name=${nameLit}] ${rest}`.trim();
    return api.execCli(line);
  }

  throw new Error(
    'PPP secret set needs router row id (numbers or .id). Re-run sync after a successful /ppp/secret/print, or check SSH output parsing.'
  );
}

export async function removePppSecret(api, internalId, secretNameFallback = null) {
  const isSsh = typeof api?.execCli === 'function';
  const id =
    internalId != null && String(internalId).trim() !== '' ? String(internalId).trim() : '';

  if (id) {
    if (isSsh && /^\d+$/.test(id)) {
      return api.write(['/ppp/secret/remove', `=numbers=${id}`]);
    }
    return api.write(['/ppp/secret/remove', `=.id=${id}`]);
  }

  if (isSsh && secretNameFallback) {
    const nameLit = cliEscapeValue(secretNameFallback);
    return api.execCli(`/ppp secret remove [find name=${nameLit}]`);
  }

  throw new Error('PPP secret remove needs id/numbers or secret name (SSH).');
}
