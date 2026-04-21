/** @typedef {'minute'|'hour'|'day'|'month'} DurationUnit */

const UNITS = new Set(['minute', 'hour', 'day', 'month']);

export function normalizeDurationUnit(u) {
  const s = String(u || 'day').toLowerCase();
  if (s === 'minutes') return 'minute';
  if (s === 'hours') return 'hour';
  if (s === 'days') return 'day';
  if (s === 'months') return 'month';
  return UNITS.has(s) ? s : 'day';
}

/**
 * Calendar-style end time from an anchor (typically `now` or current `paidUntil`).
 * @param {Date} anchor
 * @param {number} amount positive count
 * @param {DurationUnit} unit
 */
export function addPaidDuration(anchor, amount, unit) {
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) {
    const e = new Error('validity amount must be a positive number');
    e.status = 400;
    throw e;
  }
  const d = new Date(anchor.getTime());
  const u = normalizeDurationUnit(unit);
  switch (u) {
    case 'minute':
      d.setUTCMinutes(d.getUTCMinutes() + Math.floor(n));
      break;
    case 'hour':
      d.setUTCHours(d.getUTCHours() + Math.floor(n));
      break;
    case 'day':
      d.setUTCDate(d.getUTCDate() + Math.floor(n));
      break;
    case 'month':
      d.setUTCMonth(d.getUTCMonth() + Math.floor(n));
      break;
    default:
      d.setUTCDate(d.getUTCDate() + Math.floor(n));
  }
  return d;
}

/**
 * Read billing period from a package (supports legacy `durationDays` only).
 * @param {{ durationAmount?: number, durationUnit?: string, durationDays?: number } | null | undefined} pkg
 * @returns {{ amount: number, unit: DurationUnit }}
 */
export function getPackageDuration(pkg) {
  if (!pkg) return { amount: 30, unit: 'day' };
  if (pkg.durationAmount != null && pkg.durationUnit) {
    const amt = Number(pkg.durationAmount);
    if (Number.isFinite(amt) && amt > 0) {
      return { amount: amt, unit: normalizeDurationUnit(pkg.durationUnit) };
    }
  }
  if (pkg.durationDays != null) {
    const days = Number(pkg.durationDays);
    if (Number.isFinite(days) && days > 0) return { amount: days, unit: 'day' };
  }
  return { amount: 30, unit: 'day' };
}

/**
 * Extend paid-until from base date using package rules.
 * @param {Date} base
 * @param {{ durationAmount?: number, durationUnit?: string, durationDays?: number } | null | undefined} pkg
 */
export function extendPaidUntilByPackage(base, pkg) {
  const { amount, unit } = getPackageDuration(pkg);
  return addPaidDuration(base, amount, unit);
}
