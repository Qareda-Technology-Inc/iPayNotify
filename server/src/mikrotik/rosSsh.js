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
  const { host, port, username, password } = creds;
  const endpoint = `${host}:${port}`;
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
            `TCP may be open but the service is not speaking SSH — confirm the public port forwards to RouterOS ssh (usually 22), ` +
            `or switch this router to transport "api" and use the api service port (usually 8728).`;
        } else if (/ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|ETIMEDOUT/i.test(msg)) {
          hint = `Cannot reach MikroTik SSH at ${endpoint}: ${msg}`;
        }
        const err = new Error(hint);
        err.status = 502;
        err.cause = e;
        reject(err);
      })
      .connect({
        host,
        port,
        username,
        password,
        tryKeyboard: true,
        readyTimeout: 30000,
        keepaliveInterval: 15000,
        /* MikroTik is not OpenSSH; relax vendor quirks for KEX/handshake */
        strictVendor: false,
        algorithms: MIKROTIK_SSH_ALGORITHMS,
      });
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

/**
 * RouterOS `print as-value without-paging` (one logical record per line): `key=value;key=value`.
 * Safer than `print detail` for long session lists where wrapped lines can be dropped by
 * {@link parseDetailPrintOutput}.
 */
export function parseAsValuePrintOutput(stdout) {
  const rows = [];
  if (!stdout || typeof stdout !== 'string') return rows;

  for (const raw of stdout.split('\n')) {
    let line = raw.replace(/\r$/, '').trim();
    if (!line || line.startsWith(';;;')) continue;
    if (/^flags:/i.test(line)) continue;
    /* Strip optional prompt / column header noise */
    line = line.replace(/^#\s*\d+:\s*/, '').replace(/^>\s*/, '');
    if (!line) continue;
    /**
     * Export / `print as-value` often prefixes each row with `!`. Stripping restores `key=value;…`.
     * Skip only bare `!` or `!re` markers with no property data.
     */
    if (line.startsWith('!')) {
      const rest = line.slice(1).trim();
      if (!rest.includes('=')) continue;
      line = rest;
    }

    if (line.startsWith(':')) line = line.slice(1);
    const retEq = /^ret\s*=\s*(.+)$/i.exec(line);
    if (retEq) line = retEq[1].trim();

    const obj = {};
    for (const segment of line.split(';')) {
      const seg = segment.trim();
      if (!seg.includes('=')) continue;
      const eq = seg.indexOf('=');
      const k = seg.slice(0, eq).trim();
      if (!k || k === 'ret') continue;
      let v = seg.slice(eq + 1).trim();
      if (v.startsWith('"') && v.endsWith('"') && v.length >= 2) {
        v = v.slice(1, -1).replace(/\\"/g, '"');
      }
      obj[k] = v;
    }
    if (Object.keys(obj).length > 0) rows.push(obj);
  }
  return rows;
}

/** PPP / hotspot active lists: use `print as-value` over SSH for complete row counts. */
export function isActiveSessionsListPrint(cmd) {
  return (
    typeof cmd === 'string' &&
    (cmd === '/ppp/active/print' || cmd === '/ip/hotspot/active/print')
  );
}

export function parseIdentityName(stdout) {
  const m =
    /^\s*name:\s*(.+)$/im.exec(stdout) ||
    /\bname="([^"]+)"/i.exec(stdout) ||
    /\bname=(\S+)/i.exec(stdout);
  return m ? String(m[1]).trim().replace(/^"|"$/g, '') : 'MikroTik';
}

export function cliEscapeValue(v) {
  const s = String(v);
  if (s === '') return '""';
  if (/[\s"'\\;]/.test(s)) return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  return s;
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
      if (verb === '/system identity') {
        return '/system identity print without-paging';
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
          /failure:\s|syntax error|expected end of command|ambiguous command|script error/i.test(
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
