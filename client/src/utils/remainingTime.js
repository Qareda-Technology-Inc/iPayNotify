/**
 * Milliseconds from now until paidUntil (negative if already expired).
 * @param {string|Date|undefined|null} paidUntil
 * @returns {number | null}
 */
export function remainingMsUntil(paidUntil) {
  if (paidUntil == null || paidUntil === '') return null;
  const end = new Date(paidUntil).getTime();
  if (Number.isNaN(end)) return null;
  return end - Date.now();
}

/**
 * Human-readable time left or how long ago access ended.
 * @param {string|Date|undefined|null} paidUntil
 * @returns {string}
 */
export function formatRemainingFromPaidUntil(paidUntil) {
  if (paidUntil == null || paidUntil === '') return '—';
  const end = new Date(paidUntil).getTime();
  if (Number.isNaN(end)) return '—';
  const diffMs = end - Date.now();
  const past = diffMs < 0;
  const ms = Math.abs(diffMs);

  const sec = Math.floor(ms / 1000);
  const min = Math.floor(sec / 60);
  const hr = Math.floor(min / 60);
  const day = Math.floor(hr / 24);

  if (past) {
    if (day > 0) return `Expired · ${day}d ago`;
    if (hr > 0) return `Expired · ${hr}h ago`;
    if (min > 0) return `Expired · ${min}m ago`;
    return sec > 0 ? `Expired · ${sec}s ago` : 'Expired';
  }

  if (day > 0) {
    const h = hr % 24;
    return h > 0 ? `${day}d ${h}h left` : `${day}d left`;
  }
  if (hr > 0) {
    const m = min % 60;
    return m > 0 ? `${hr}h ${m}m left` : `${hr}h left`;
  }
  if (min > 0) {
    const s = sec % 60;
    return min < 5 && s > 0 ? `${min}m ${s}s left` : `${min}m left`;
  }
  if (sec > 0) return `${sec}s left`;
  return 'Ends now';
}
