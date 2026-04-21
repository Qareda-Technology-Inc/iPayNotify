/**
 * Parse MikroTicket / RouterOS "connect" string: `hostname`, `1.2.3.4`, or `host:port`.
 * Also accepts SSH copy-paste suffix ` -p 10864` / ` -P 10864` (otherwise that whole string is
 * wrongly passed to DNS and causes ENOTFOUND).
 * Does not support bracketed IPv6.
 */
export function parseRouterConnectString(raw, defaultPort = 8728) {
  let s = String(raw ?? '').trim();
  if (!s) return { host: '', port: defaultPort };

  let forcedPort = null;
  const dashP = s.match(/\s+-[pP]\s+(\d{1,5})\s*$/);
  if (dashP) {
    const n = Number(dashP[1]);
    if (n >= 1 && n <= 65535) {
      forcedPort = n;
      s = s.slice(0, dashP.index).trim();
    }
  }

  const lastColon = s.lastIndexOf(':');
  if (lastColon > 0) {
    const tail = s.slice(lastColon + 1);
    if (/^\d{1,5}$/.test(tail)) {
      const n = Number(tail);
      if (n >= 1 && n <= 65535) {
        return {
          host: s.slice(0, lastColon).trim(),
          port: forcedPort != null ? forcedPort : n,
        };
      }
    }
  }

  return { host: s, port: forcedPort != null ? forcedPort : defaultPort };
}
