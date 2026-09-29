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

/**
 * MikroTik hotspot/PPP rate-limit is `rx/tx` from the router's side:
 * rx = what the router receives (client upload), tx = what it sends (client download).
 * So "Up 5 / Down 10" becomes `5M/10M`.
 * @param {number|null|undefined} downMbps
 * @param {number|null|undefined} upMbps
 */
export function formatRateLimit(downMbps, upMbps) {
  const down = Number(downMbps);
  const up = Number(upMbps);
  const hasDown = Number.isFinite(down) && down > 0;
  const hasUp = Number.isFinite(up) && up > 0;
  if (!hasDown && !hasUp) return undefined;
  const fmt = (n) => {
    if (n >= 1) return `${Number(n.toFixed(3))}M`;
    return `${Math.round(n * 1000)}k`;
  };
  return `${fmt(hasUp ? up : down)}/${fmt(hasDown ? down : up)}`;
}

/** Split seconds into { days, hours, minutes }. */
export function splitDuration(totalSeconds) {
  let s = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const days = Math.floor(s / 86400);
  s %= 86400;
  const hours = Math.floor(s / 3600);
  s %= 3600;
  const minutes = Math.floor(s / 60);
  return { days, hours, minutes };
}

export function combineDuration({ days = 0, hours = 0, minutes = 0 } = {}) {
  const d = Math.max(0, Math.floor(Number(days) || 0));
  const h = Math.max(0, Math.floor(Number(hours) || 0));
  const m = Math.max(0, Math.floor(Number(minutes) || 0));
  return d * 86400 + h * 3600 + m * 60;
}
