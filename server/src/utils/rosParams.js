/** Build RouterOS API word array: ['/path/add', '=key=value', ...] */
export function rosPairs(obj) {
  const pairs = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const val =
      typeof v === 'boolean' ? (v ? 'yes' : 'no') : String(v);
    pairs.push(`=${k}=${val}`);
  }
  return pairs;
}

/** Convert seconds to RouterOS uptime limit (e.g. 1d2h). */
export function formatLimitUptime(totalSeconds) {
  if (!totalSeconds || totalSeconds <= 0) return undefined;
  let s = Math.floor(totalSeconds);
  const d = Math.floor(s / 86400);
  s %= 86400;
  const h = Math.floor(s / 3600);
  s %= 3600;
  const m = Math.floor(s / 60);
  s %= 60;
  const parts = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  if (s || parts.length === 0) parts.push(`${s}s`);
  return parts.join('');
}
