import {
  apiPathToCliVerb,
  buildExecFromWriteArgs,
  connectSsh,
  execRos,
  isSshAuthFailure,
  isActiveSessionsListPrint,
  normalizeRouterForSsh,
  parseAsValuePrintOutput,
  parseDetailPrintOutput,
  parseIdentityName,
  sshLoginRejectedError,
} from './rosSsh.js';

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
      if (isActiveSessionsListPrint(cmd)) {
        const asRows = parseAsValuePrintOutput(out);
        if (asRows.length > 0) return asRows;
        const looksLikeEmptyList = /flags:/i.test(out) && !/=/.test(out);
        if (looksLikeEmptyList || !String(out || '').trim()) {
          if (looksLikeEmptyList) return [];
          /* Empty stdout: retry detail (some ROS builds mishandle as-value). */
        } else if (/=/.test(out)) {
          return parseDetailPrintOutput(out);
        }
        const verb = apiPathToCliVerb(cmd.replace(/\/print$/, ''));
        try {
          const detailOut = await execRos(this.conn, `${verb} print detail without-paging`);
          return parseDetailPrintOutput(detailOut);
        } catch {
          return parseDetailPrintOutput(out);
        }
      }
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
