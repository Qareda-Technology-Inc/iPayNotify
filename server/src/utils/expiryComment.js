/** Marker RouterOS scheduler script looks for (14-digit UTC stamp). */
export const EXPIRY_STAMP_PREFIX = 'QareFi-exp=';

function pad2(n) {
  return String(n).padStart(2, '0');
}

/** YYYYMMDDHHmmss in UTC — compared as a number on the router. */
export function formatExpiryStamp(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  return (
    `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}` +
    `${pad2(d.getUTCHours())}${pad2(d.getUTCMinutes())}${pad2(d.getUTCSeconds())}`
  );
}

/**
 * Hotspot user comment for wall-clock expiry (router scheduler + admin readability).
 * Example: `QareFi-exp=20260927213000 Exp: 2026-09-27 21:30:00Z`
 */
export function formatExpiryComment(date) {
  const d = date instanceof Date ? date : new Date(date);
  const stamp = formatExpiryStamp(d);
  if (!stamp) return 'QareFi hotspot';
  const human =
    `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())} ` +
    `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}Z`;
  return `${EXPIRY_STAMP_PREFIX}${stamp} Exp: ${human}`;
}

export function parseExpiryFromComment(comment) {
  if (!comment || typeof comment !== 'string') return null;
  const stamp = comment.match(/QareFi-exp=(\d{14})/i);
  if (stamp) {
    const s = stamp[1];
    const y = Number(s.slice(0, 4));
    const mo = Number(s.slice(4, 6));
    const day = Number(s.slice(6, 8));
    const h = Number(s.slice(8, 10));
    const mi = Number(s.slice(10, 12));
    const sec = Number(s.slice(12, 14));
    return new Date(Date.UTC(y, mo - 1, day, h, mi, sec));
  }
  const m = comment.match(/Exp:\s*(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/i);
  if (!m) return null;
  const [y, mo, d] = m[1].split('-').map(Number);
  const hh = m[2] != null ? Number(m[2]) : 23;
  const mm = m[3] != null ? Number(m[3]) : 59;
  const ss = m[4] != null ? Number(m[4]) : 59;
  return new Date(Date.UTC(y, mo - 1, d, hh, mm, ss));
}
