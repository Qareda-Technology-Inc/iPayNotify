import {
  apiPathToCliVerb,
  buildExecFromWriteArgs,
  connectSsh,
  execRos,
  isSshAuthFailure,
  isActiveSessionsListPrint,
  normalizeRouterForSsh,
  parseActiveListStdout,
  parseAsValuePrintOutput,
  parseDetailPrintOutput,
  parseIdentityName,
  sshLoginRejectedError,
} from './rosSsh.js';

function listKindFromPrintCmd(cmd) {
  if (cmd === '/ppp/active/print') return 'ppp';
  if (cmd === '/ip/hotspot/active/print') return 'hotspot';
  if (cmd === '/ppp/secret/print') return 'ppp';
  /* Hotspot *users* and *user profiles* are not active sessions — keep as-value/detail */
  if (cmd === '/ip/hotspot/user/print') return 'hotspot-user';
  if (cmd === '/ip/hotspot/user/profile/print') return 'hotspot-profile';
  return 'generic';
}

/**
 * Fetch a print list using as-value → detail → terse → default table.
 * Fixes empty results when RouterOS returns tabular `Flags:` output (no key=value).
 */
async function fetchPrintList(adapter, printCmd) {
  const verb = apiPathToCliVerb(printCmd.replace(/\/print$/, ''));
  const kind = listKindFromPrintCmd(printCmd);
  const attempts = [
    `${verb} print as-value without-paging`,
    `${verb} print detail without-paging`,
    `${verb} print terse without-paging`,
    `${verb} print without-paging`,
  ];

  let lastOut = '';
  let best = [];
  for (const line of attempts) {
    try {
      const out = await execRos(adapter.conn, line);
      lastOut = out || lastOut;
      const rows = parseActiveListStdout(out, kind);
      if (rows.length > best.length) best = rows;
      if (rows.length > 0) {
        /* Prefer as-value/detail when they return data; keep scanning if first pass was weak */
        if (line.includes('as-value') || line.includes('detail') || rows.length >= 1) {
          return rows;
        }
      }
    } catch (e) {
      /* try next format — some ROS builds dislike as-value/terse */
      if (/syntax error|expected end of command|ambiguous|bad command/i.test(String(e.message || e))) {
        continue;
      }
      /* Non-syntax failures (permission) — still try other formats once */
      continue;
    }
  }

  if (best.length > 0) return best;
  if (lastOut && String(lastOut).trim()) {
    console.warn(
      '[mikrotik.print]',
      printCmd,
      'parsed 0 rows; stdout sample=',
      String(lastOut).slice(0, 280).replace(/\s+/g, ' ')
    );
  }
  return parseActiveListStdout(lastOut, kind);
}

/** Minimal RouterOS API-like surface over SSH exec (same CLI as Winbox terminal). */
export class SshRosAdapter {
  constructor(conn) {
    this.conn = conn;
  }

  /** Raw CLI line (e.g. `[find …]` selectors the API word array cannot express). */
  async execCli(commandLine) {
    try {
      return await execRos(this.conn, commandLine);
    } catch (e) {
      const err = new Error(`${e.message}\n(SSH exec: ${commandLine})`);
      err.status = e.status;
      throw err;
    }
  }

  /**
   * @param {string | string[]} cmd
   * @param {...unknown} _rest unused (API compat)
   */
  async write(cmd, ..._rest) {
    if (typeof cmd === 'string' && isActiveSessionsListPrint(cmd)) {
      return fetchPrintList(this, cmd);
    }

    const execLine = buildExecFromWriteArgs(cmd);
    let out;
    try {
      out = await execRos(this.conn, execLine);
    } catch (e) {
      const err = new Error(`${e.message}\n(SSH exec: ${execLine})`);
      err.status = e.status;
      throw err;
    }

    if (typeof cmd === 'string' && cmd.endsWith('/print')) {
      const base = cmd.replace(/\/print$/, '').split('/').filter(Boolean).join(' ');
      if (base === 'system identity') {
        return [{ name: parseIdentityName(out) }];
      }
      const asRows = parseAsValuePrintOutput(out);
      if (asRows.length > 0) return asRows;
      return parseDetailPrintOutput(out);
    }

    if (Array.isArray(cmd)) {
      const path = cmd[0];
      if (
        typeof path === 'string' &&
        (path.endsWith('/add') || path.endsWith('/set') || path.endsWith('/remove'))
      ) {
        return [];
      }
    }

    return parseDetailPrintOutput(out);
  }

  async close() {
    try {
      this.conn.end();
    } catch {
      /* ignore */
    }
  }
}

export async function withRouterSsh(router, fn) {
  const creds = normalizeRouterForSsh(router);
  let conn;
  try {
    conn = await connectSsh(creds);
  } catch (e) {
    if (isSshAuthFailure(e)) throw sshLoginRejectedError(creds);
    if (!e.status) e.status = 502;
    throw e;
  }
  const adapter = new SshRosAdapter(conn);
  try {
    return await fn(adapter);
  } finally {
    try {
      conn.end();
    } catch {
      /* ignore */
    }
  }
}
