import { createRequire } from 'module';
import { parseRouterConnectString } from '../utils/routerConnect.js';

const require = createRequire(import.meta.url);
const { Client } = require('ssh2');

/** @param {import('mongoose').Document | Record<string, unknown>} router */
export function normalizeRouterForSsh(router) {
  const src =
    router && typeof router.toObject === 'function'
      ? router.toObject({ getters: false, virtuals: false })
      : router;
  const rawHost = String(src?.host ?? '').trim();
  const storedPort = Number(src.sshPort) || 22;
  const parsed = parseRouterConnectString(rawHost, storedPort);
  const host = parsed.host;
  const port = parsed.port;
  const username =
    String(src.sshUser ?? '').trim() || String(src.apiUser ?? '').trim();
  const sshPass = src.sshPassword;
  const apiPass = src.apiPassword;
  const password =
    sshPass != null && String(sshPass).length > 0
      ? String(sshPass)
      : apiPass != null
        ? String(apiPass)
        : '';

  if (!host) {
    const e = new Error('Router host is empty.');
    e.status = 400;
    throw e;
  }
  if (!username) {
    const e = new Error('SSH user is empty (set API user or SSH user).');
    e.status = 400;
    throw e;
  }
  if (!password) {
    const e = new Error(
      'No password for SSH. Set API password when saving the router, or set an SSH-only password.'
    );
    e.status = 400;
    throw e;
  }

  return { host, port, username, password };
}

/** Algorithms many RouterOS builds still negotiate (ssh2 defaults dropped some). */
const MIKROTIK_SSH_ALGORITHMS = {
  serverHostKey: [
    'ssh-rsa',
    'ssh-dss',
    'ecdsa-sha2-nistp256',
    'ecdsa-sha2-nistp384',
    'ecdsa-sha2-nistp521',
    'rsa-sha2-512',
    'rsa-sha2-256',
  ],
  kex: [
    'curve25519-sha256',
    'ecdh-sha2-nistp256',
    'diffie-hellman-group14-sha256',
    'diffie-hellman-group14-sha1',
    'diffie-hellman-group-exchange-sha256',
    'diffie-hellman-group-exchange-sha1',
    'diffie-hellman-group1-sha1',
  ],
  cipher: ['aes128-ctr', 'aes192-ctr', 'aes256-ctr', 'aes128-cbc', 'aes256-cbc', '3des-cbc'],
  hmac: ['hmac-sha2-256', 'hmac-sha1', 'hmac-sha2-512'],
};

export function connectSsh(creds) {
  const { host, port, username, password, sock } = creds;
  const endpoint = sock ? `${host}:${port} (via WireGuard jump)` : `${host}:${port}`;
  return new Promise((resolve, reject) => {
    const conn = new Client();
    const t = setTimeout(() => {
      try {
        conn.end();
      } catch {
        /* ignore */
      }
      const err = new Error(
        `SSH connection timed out to ${endpoint}. Check host/port, firewall, and that this port is MikroTik SSH (IP → Services → ssh), not Winbox/API.`
      );
      err.status = 502;
      reject(err);
    }, 35000);
    conn.on('keyboard-interactive', (_name, _instr, _lang, prompts, finish) => {
      if (prompts?.length && /password/i.test(String(prompts[0].prompt))) {
        finish([password]);
      } else {
        finish([]);
      }
    });
    conn
      .on('ready', () => {
        clearTimeout(t);
        resolve(conn);
      })
      .on('error', (e) => {
        clearTimeout(t);
        const msg = String(e?.message || e);
        let hint = msg;
        if (/handshake|timed out while waiting/i.test(msg)) {
          hint =
            `SSH handshake failed for ${endpoint} (${msg}). ` +
            `TCP may be open but the service is not speaking SSH — confirm RouterOS ssh is enabled (IP → Services → ssh), ` +
            `or use transport "api" (8728). If the host is a WireGuard tunnel IP and the API is not on the WG VPS, set WG_MIKROTIK_JUMP=auto.`;
        } else if (/ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|ETIMEDOUT/i.test(msg)) {
          hint = `Cannot reach MikroTik SSH at ${endpoint}: ${msg}`;
        }
        const err = new Error(hint);
        err.status = 502;
        err.cause = e;
        reject(err);
      });

    const opts = {
      username,
      password,
      tryKeyboard: true,
      readyTimeout: 30000,
      keepaliveInterval: 15000,
      strictVendor: false,
      algorithms: MIKROTIK_SSH_ALGORITHMS,
    };
    if (sock) {
      opts.sock = sock;
    } else {
      opts.host = host;
      opts.port = port;
    }
    conn.connect(opts);
  });
}

export function parseRosKvSegment(segment) {
  const obj = {};
  const re = /([^\s=]+)=("(?:\\.|[^"])*"|[^\s]+)/g;
  let m;
  while ((m = re.exec(segment))) {
    let v = m[2];
    if (v.startsWith('"')) v = v.slice(1, -1).replace(/\\"/g, '"');
    obj[m[1]] = v;
  }
  return obj;
}

/**
 * RouterOS `print detail without-paging` over SSH: one row index (`0`, `1`, …) starts a record;
 * further properties often appear on following indented lines. Merge those into the same object
 * so we do not drop `uptime`, `address`, `bytes-in`, etc.
 */
export function parseDetailPrintOutput(stdout) {
  const rows = [];
  let cur = null;

  for (const raw of stdout.split('\n')) {
    const line = raw.replace(/\r$/, '');
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith(';;;')) continue;
    if (/^flags:/i.test(trimmed)) continue;

    /** Row index alone (next lines are `name=…` etc.) — must not skip, or we drop the whole record. */
    const idxOnly = /^(\d+)$/.exec(trimmed);
    if (idxOnly) {
      if (cur) rows.push(cur);
      cur = { numbers: idxOnly[1] };
      continue;
    }

    /**
     * RouterOS 7+ detail lines often start with a resource id (`*3FA2…`) instead of a decimal row index.
     */
    const hexRowId = /^\*([0-9A-Fa-f]+)\s+(.+)$/.exec(trimmed);
    if (hexRowId) {
      if (cur) rows.push(cur);
      const idTok = `*${hexRowId[1]}`;
      const parsed = parseRosKvSegment(hexRowId[2]);
      cur =
        Object.keys(parsed).length > 0
          ? { numbers: idTok, '.id': idTok, ...parsed }
          : { numbers: idTok, '.id': idTok };
      continue;
    }

    if (!trimmed.includes('=')) continue;

    const withIdx = /^(\d+)\s+(.+)$/.exec(trimmed);
    if (withIdx) {
      if (cur) rows.push(cur);
      const segment = withIdx[2];
      const parsed = parseRosKvSegment(segment);
      if (Object.keys(parsed).length === 0) {
        cur = { numbers: withIdx[1] };
      } else {
        cur = { numbers: withIdx[1], ...parsed };
      }
    } else if (cur) {
      Object.assign(cur, parseRosKvSegment(trimmed));
    }
  }
  if (cur) rows.push(cur);
  return rows;
}

function isAsValueNoise(line) {
  const t = String(line || '').trim();
  if (!t) return true;
  if (t.startsWith(';;;')) return true;
  if (/^flags:/i.test(t)) return true;
  if (t.startsWith('#') && !t.includes('=')) return true;
  return false;
}

/**
 * SSH wraps long `print as-value` lines at the terminal width. The next physical
 * line is the rest of the same record (often starting at `uptime=` / `bytes-in=`).
 * Joining them stops one hotspot session from being counted as two rows.
 */
function joinWrappedAsValueLines(stdout) {
  const records = [];
  let cur = '';
  for (const raw of String(stdout || '').split(/\r?\n/)) {
    const line = raw.replace(/\r$/, '');
    if (isAsValueNoise(line)) continue;
    const trimmed = line.trim();
    if (!cur) {
      cur = trimmed;
      continue;
    }
    const tail = cur.split(';').pop();
    const midToken = Boolean(tail) && !tail.includes('=');
    /* PPPoE interface names are `<pppoe-login>`; a wrap can split inside the brackets. */
    const unclosedPppoe = /<pppoe-[^>]*$/i.test(cur);
    const boundary =
      cur.endsWith('=') || cur.endsWith(';') || trimmed.startsWith(';') || midToken || unclosedPppoe;
    if (boundary || !trimmed.includes('=')) {
      cur += trimmed;
      continue;
    }
    records.push(cur);
    cur = trimmed;
  }
  if (cur) records.push(cur);
  return records;
}

/**
 * RouterOS `print as-value without-paging` (one logical record per line): `key=value;key=value`.
 * Also accepts space-separated `key=value` (terse-like) on a single line.
 */
export function parseAsValuePrintOutput(stdout) {
  const rows = [];
  if (!stdout || typeof stdout !== 'string') return rows;

  for (const raw of joinWrappedAsValueLines(stdout)) {
    let line = raw.replace(/\r$/, '').trim();
    if (!line || line.startsWith(';;;')) continue;
    if (/^flags:/i.test(line)) continue;
    line = line.replace(/^#\s*\d+:\s*/, '').replace(/^>\s*/, '');
    if (!line) continue;
    if (line.startsWith('!')) {
      const rest = line.slice(1).trim();
      if (!rest.includes('=')) continue;
      line = rest;
    }

    if (line.startsWith(':')) line = line.slice(1);
    const retEq = /^ret\s*=\s*(.+)$/i.exec(line);
    if (retEq) line = retEq[1].trim();

    /* Drop a row index only (`0;.id=`). A leading voucher code (`482193;address=`) is the username. */
    line = line.replace(/^\d+\s+(?=[A-Za-z_.])/ , '');
    if (/^\d+;\.id=/i.test(line)) line = line.replace(/^\d+;/, '');
    const bareCode = /^(\d{4,});([\s\S]*)$/.exec(line);
    if (bareCode && !/(?:^|;)user=/.test(line)) {
      line = `user=${bareCode[1]};${bareCode[2]}`;
    }

    const obj = {};
    const parts = line.includes(';') ? line.split(';') : null;
    if (parts) {
      for (const segment of parts) {
        const seg = segment.trim();
        if (!seg.includes('=')) continue;
        const eq = seg.indexOf('=');
        const k = seg.slice(0, eq).trim().replace(/^\./, '');
        if (!k || k === 'ret') continue;
        let v = seg.slice(eq + 1).trim();
        if (v.startsWith('"') && v.endsWith('"') && v.length >= 2) {
          v = v.slice(1, -1).replace(/\\"/g, '"');
        }
        obj[k] = v;
        /* Keep dotted form too for callers that expect `.id` */
        if (k === 'id' && !obj['.id']) obj['.id'] = v.startsWith('*') ? v : v;
      }
    } else if (line.includes('=')) {
      const chained = parseEqualsChain(line);
      if (chained) {
        Object.assign(obj, chained);
      } else {
        /* Terse / detail one-liner: space-separated key=value (values may be quoted) */
        Object.assign(obj, parseRosKvSegment(line));
      }
      /* Normalize `.id` / leading dots */
      for (const k of Object.keys(obj)) {
        if (k.startsWith('.') && k.length > 1) {
          const bare = k.slice(1);
          if (obj[bare] == null) obj[bare] = obj[k];
        }
      }
    }

    if (Object.keys(obj).length > 0) rows.push(obj);
  }
  return mergeWrappedSessionFragments(rows);
}

function parseEqualsChain(line) {
  const raw = String(line || '').trim();
  if (/\s/.test(raw)) return null;
  const body = raw.replace(/^=+/, '');
  const parts = body.split('=');
  if (parts.length < 4 || parts.length % 2 !== 0) return null;
  if (!/^[A-Za-z0-9_.-]+$/.test(parts[0].replace(/^\./, ''))) return null;
  const obj = {};
  for (let i = 0; i < parts.length; i += 2) {
    const k = parts[i];
    if (!k || !/^[A-Za-z0-9_.-]+$/.test(k)) return null;
    obj[k] = parts[i + 1];
  }
  return obj;
}

/** Second physical line of one session: uptime/bytes with no username of its own. */
function mergeWrappedSessionFragments(rows) {
  const merged = [];
  for (const row of rows) {
    const prev = merged[merged.length - 1];
    const prevIdentity = prev && (prev.user || prev.name || prev.address || prev['mac-address']);
    const rowUser = row.user || row.name;
    const rowStats = row.uptime || row['bytes-in'] || row['bytes-out'] || row['session-time-left'];
    if (prev && prevIdentity && !prev.uptime && !rowUser && rowStats) {
      Object.assign(prev, row);
      continue;
    }
    if (
      prev &&
      prevIdentity &&
      prev.uptime &&
      !prev['bytes-in'] &&
      !prev['bytes-out'] &&
      !rowUser &&
      !row.address &&
      !row['mac-address'] &&
      (row['bytes-in'] || row['bytes-out'])
    ) {
      Object.assign(prev, row);
      continue;
    }
    merged.push(row);
  }
  return merged;
}

/**
 * Default `print` (no detail/as-value) for /ppp active and /ip hotspot active —
 * column table under a Flags: header. Previously mis-detected as "empty list".
 */
export function parseTabularActivePrint(stdout, kind = 'ppp') {
  const rows = [];
  if (!stdout || typeof stdout !== 'string') return rows;

  const lines = stdout.split(/\r?\n/).map((l) => l.replace(/\r$/, ''));
  let headerIdx = -1;
  let headers = [];

  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t || /^flags:/i.test(t) || t.startsWith(';;;')) continue;
    /* Header row often starts with # */
    if (/^#\s+/i.test(t) || (/NAME/i.test(t) && /UPTIME/i.test(t))) {
      headerIdx = i;
      headers = t.split(/\s+/).filter(Boolean);
      /* Drop leading # column label */
      if (headers[0] === '#') headers = headers.slice(1);
      break;
    }
  }

  const dataLines = headerIdx >= 0 ? lines.slice(headerIdx + 1) : lines;

  for (const line of dataLines) {
    const trimmed = line.trim();
    if (!trimmed || /^flags:/i.test(trimmed) || trimmed.startsWith(';;;')) continue;
    if (!/^\d+/.test(trimmed) && !/^[A-Z]{0,3}\s+\S/.test(trimmed)) continue;

    /* `0 R name …` or `0 name …` — strip index + optional flag letters */
    let rest = trimmed.replace(/^\d+\s+/, '');
    rest = rest.replace(/^[A-Z]{1,4}\s+/, '');
    if (!rest) continue;

    const cols = rest.split(/\s+/).filter(Boolean);
    if (cols.length === 0) continue;

    const obj = { numbers: String(rows.length) };

    if (kind === 'hotspot') {
      /*
       * Typical: USER ADDRESS MAC-ADDRESS UPTIME [SERVER …]
       * Empty USER collapses in split(/\s+/) → detect IP/MAC/uptime shapes.
       * Never put MAC into `user`.
       */
      const looksIp = (s) => /^\d{1,3}(\.\d{1,3}){3}$/.test(s);
      const looksMac = (s) => /^([0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/i.test(s);
      const looksUptime = (s) => /^\d+[wdhms]/i.test(s) || /^\d+:\d+/.test(s);

      if (cols.length >= 4 && !looksIp(cols[0]) && !looksMac(cols[0])) {
        obj.user = cols[0];
        obj.address = cols[1];
        obj['mac-address'] = cols[2];
        obj.uptime = cols[3];
      } else if (cols.length >= 3 && looksIp(cols[0])) {
        /* USER blank: ADDRESS MAC UPTIME */
        obj.user = '';
        obj.address = cols[0];
        obj['mac-address'] = looksMac(cols[1]) ? cols[1] : '';
        obj.uptime = looksUptime(cols[cols.length - 1])
          ? cols[cols.length - 1]
          : looksUptime(cols[2])
            ? cols[2]
            : '';
      } else if (headers.length >= 3) {
        const map = zipTabular(headers, cols);
        const u = map.USER || map.NAME || '';
        obj.user = looksMac(u) ? '' : u;
        obj.address = map.ADDRESS || '';
        obj['mac-address'] = map['MAC-ADDRESS'] || map.MAC || '';
        obj.uptime = map.UPTIME || '';
        obj.server = map.SERVER || '';
      } else {
        obj.user = looksMac(cols[0]) ? '' : cols[0] || '';
        obj.address = looksIp(cols[0]) ? cols[0] : cols[1] || '';
        obj['mac-address'] = cols.find((c) => looksMac(c)) || '';
        obj.uptime = cols.find((c) => looksUptime(c)) || '';
      }
    } else {
      /*
       * Typical: NAME SERVICE CALLER-ID ADDRESS UPTIME ENCODING
       * NAME is often <pppoe-login> interface; real login may be absent in tabular mode.
       */
      if (headers.length >= 3) {
        const map = zipTabular(headers, cols);
        obj.name = map.NAME || cols[0] || '';
        obj.service = map.SERVICE || '';
        obj['caller-id'] = map['CALLER-ID'] || map.CALLER || '';
        obj.address = map.ADDRESS || '';
        obj.uptime = map.UPTIME || '';
        obj.user = map.USER || map.LOGIN || '';
      } else {
        obj.name = cols[0] || '';
        obj.service = cols[1] || '';
        obj['caller-id'] = cols[2] || '';
        obj.address = cols[3] || '';
        obj.uptime = cols[4] || '';
      }
      if (!obj.user && obj.name) {
        const m = /^<pppoe-(.+)>$/i.exec(String(obj.name));
        if (m) obj.user = m[1];
      }
    }

    if (obj.user || obj.name || obj.address || obj['mac-address']) rows.push(obj);
  }

  return rows;
}

function zipTabular(headers, cols) {
  const map = {};
  /* Align from the right when caller-id / MAC has spaces — best-effort left fill */
  const n = Math.min(headers.length, cols.length);
  for (let i = 0; i < n; i++) {
    map[String(headers[i]).toUpperCase()] = cols[i];
  }
  return map;
}

/** PPP / hotspot active lists: use `print as-value` over SSH for complete row counts. */
export function isActiveSessionsListPrint(cmd) {
  return (
    typeof cmd === 'string' &&
    (cmd === '/ppp/active/print' ||
      cmd === '/ip/hotspot/active/print' ||
      cmd === '/ppp/secret/print' ||
      cmd === '/ip/hotspot/user/print' ||
      cmd === '/ip/hotspot/user/profile/print')
  );
}

/**
 * Parse active/list print output with multiple RouterOS formats.
 * @param {'ppp'|'hotspot'|'generic'} kind
 */
export function parseActiveListStdout(stdout, kind = 'generic') {
  if (!stdout || !String(stdout).trim()) return [];

  const asRows = parseAsValuePrintOutput(stdout);
  if (asRows.length > 0) return asRows;

  const detailRows = parseDetailPrintOutput(stdout);
  if (detailRows.length > 0) return detailRows;

  if (kind === 'ppp' || kind === 'hotspot') {
    const tabRows = parseTabularActivePrint(stdout, kind);
    if (tabRows.length > 0) return tabRows;
  }

  /* Hotspot *users* table: # SERVER NAME … — map NAME → name for vouchers */
  if (kind === 'hotspot-user') {
    const tabRows = parseTabularHotspotUsersPrint(stdout);
    if (tabRows.length > 0) return tabRows;
  }

  return [];
}

/** Default `print` table for /ip/hotspot/user (not active sessions). */
export function parseTabularHotspotUsersPrint(stdout) {
  const rows = [];
  if (!stdout || typeof stdout !== 'string') return rows;

  const lines = stdout.split(/\r?\n/).map((l) => l.replace(/\r$/, ''));
  let headerIdx = -1;
  let headers = [];

  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t || /^flags:/i.test(t) || t.startsWith(';;;')) continue;
    if (/^#\s+/i.test(t) && /NAME/i.test(t)) {
      headerIdx = i;
      headers = t.split(/\s+/).filter(Boolean);
      if (headers[0] === '#') headers = headers.slice(1);
      break;
    }
  }

  const dataLines = headerIdx >= 0 ? lines.slice(headerIdx + 1) : lines;
  for (const line of dataLines) {
    const trimmed = line.trim();
    if (!trimmed || /^flags:/i.test(trimmed) || trimmed.startsWith(';;;')) continue;
    if (!/^\d+/.test(trimmed)) continue;

    let rest = trimmed.replace(/^\d+\s+/, '');
    rest = rest.replace(/^[A-Z]{1,4}\s+/, '');
    const cols = rest.split(/\s+/).filter(Boolean);
    if (!cols.length) continue;

    const obj = { numbers: String(rows.length) };
    if (headers.length >= 2) {
      const map = zipTabular(headers, cols);
      obj.name = map.NAME || cols[cols.length > 1 ? 1 : 0] || '';
      obj.server = map.SERVER || (cols.length > 1 ? cols[0] : '') || '';
      obj.profile = map.PROFILE || '';
      obj.uptime = map.UPTIME || '';
    } else {
      /* SERVER NAME … or NAME alone */
      if (cols.length >= 2) {
        obj.server = cols[0];
        obj.name = cols[1];
      } else {
        obj.name = cols[0];
      }
    }
    if (obj.name) rows.push(obj);
  }
  return rows;
}

export function parseIdentityName(stdout) {
  const m =
    /^\s*name:\s*(.+)$/im.exec(stdout) ||
    /\bname="([^"]+)"/i.exec(stdout) ||
    /\bname=(\S+)/i.exec(stdout);
  return m ? String(m[1]).trim().replace(/^"|"$/g, '') : '';
}

/** RouterOS default print uses `key: value` (not `key=value`) — system resource/identity. */
export function parseColonDetailOutput(stdout) {
  const obj = {};
  for (const raw of String(stdout || '').split('\n')) {
    const line = raw.replace(/\r$/, '').trim();
    const m = /^([a-z0-9][a-z0-9-]{0,40}):\s*(.*)$/i.exec(line);
    if (!m) continue;
    if (/^flags$/i.test(m[1])) continue;
    obj[m[1]] = m[2].trim();
  }
  return Object.keys(obj).length ? obj : null;
}

/**
 * Quote a value for RouterOS CLI (SSH/terminal).
 * Unquoted `/` starts a new command path — WireGuard keys and CIDRs must be quoted.
 * Alphanumeric names (including leading digits like 5MIN) stay unquoted — MikroTik accepts them.
 */
export function cliEscapeValue(v) {
  const s = String(v);
  if (s === '') return '""';
  if (/^[A-Za-z0-9._@-]+$/.test(s)) return s;
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** API-style `=key=value` words → CLI args */
export function rosApiWordsToCli(pairWords) {
  const parts = [];
  for (const part of pairWords) {
    const m = /^=([^=]+)=(.*)$/s.exec(part);
    if (!m) continue;
    parts.push(`${m[1]}=${cliEscapeValue(m[2])}`);
  }
  return parts.join(' ');
}

/** RouterOS CLI paths must start with `/` (same as Winbox terminal). */
export function apiPathToCliVerb(path) {
  const parts = String(path).split('/').filter(Boolean);
  if (parts.length === 0) return '/';
  return `/${parts.join(' ')}`;
}

export function buildExecFromWriteArgs(cmd) {
  if (typeof cmd === 'string') {
    if (cmd.endsWith('/print')) {
      const base = cmd.slice(0, -'/print'.length);
      const verb = apiPathToCliVerb(base);
      if (verb === '/system identity' || verb === '/system resource' || verb === '/system routerboard') {
        return `${verb} print as-value without-paging`;
      }
      if (isActiveSessionsListPrint(cmd)) {
        return `${verb} print as-value without-paging`;
      }
      return `${verb} print detail without-paging`;
    }
    return apiPathToCliVerb(cmd);
  }
  if (Array.isArray(cmd) && cmd.length >= 1) {
    const [path, ...rest] = cmd;
    const verb = apiPathToCliVerb(path);
    if (rest.length === 0) return verb;
    return `${verb} ${rosApiWordsToCli(rest)}`.trim();
  }
  throw new Error('Invalid SSH command shape');
}

export async function execRos(conn, command) {
  return new Promise((resolve, reject) => {
    conn.exec(command, (err, stream) => {
      if (err) return reject(err);
      const out = [];
      const errChunks = [];
      stream.on('data', (d) => out.push(d.toString('utf8')));
      stream.stderr.on('data', (d) => errChunks.push(d.toString('utf8')));
      stream.on('close', (code) => {
        const stdout = out.join('');
        const stderr = errChunks.join('');
        const text = stdout + stderr;
        if (
          /failure:\s|syntax error|expected end of command|ambiguous command|script error|input does not match|no such item|invalid value|unknown parameter|already have/i.test(
            text
          )
        ) {
          const line =
            text
              .split('\n')
              .map((l) => l.trim())
              .filter(Boolean)
              .find((l) => /failure:|syntax error|expected/i.test(l)) || text.trim();
          return reject(new Error(line.slice(0, 500)));
        }
        if (code !== 0 && code != null && !stdout.trim() && stderr.trim()) {
          return reject(new Error(stderr.trim().slice(0, 500)));
        }
        if (code !== 0 && code != null && /error|failure|invalid/i.test(text)) {
          return reject(new Error(text.trim().slice(0, 500)));
        }
        resolve(stdout);
      });
    });
  });
}

export function isSshAuthFailure(err) {
  const m = String(err?.message ?? err);
  if (/ECONNREFUSED|ENOTFOUND|ETIMEDOUT|connection timed out|timed out/i.test(m)) return false;
  return /authentication|password|denied|All configured|Unable to|no matching|handshake failed/i.test(
    m
  );
}

export function sshLoginRejectedError(creds) {
  const err = new Error(
    `SSH login failed for "${creds.username}" at ${creds.host}:${creds.port}. ` +
      `Use System → Users credentials (same as terminal SSH). Enable SSH service (IP → Services → ssh). ` +
      `If using transport SSH, optional SSH user/password fields override API user/password.`
  );
  err.status = 502;
  return err;
}
