import { formatExpiryComment } from './expiryComment.js';

/**
 * Hotspot user comment shown on the router.
 * Create:  QareFi-dc:2026-09-17 12:37:25-ot:1-em:<voucherId>
 * Active:  …-da:2026-09-26 20:26:02-mc:92:D4:5A:3C:76:C7
 * Optional wall-clock stamp appended for the expiry scheduler.
 */

function pad2(n) {
  return String(n).padStart(2, '0');
}

/** `YYYY-MM-DD HH:mm:ss` (UTC). */
export function formatMikroTicketDate(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  return (
    `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())} ` +
    `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`
  );
}

export function normalizeMacAddress(mac) {
  const raw = String(mac || '')
    .trim()
    .toUpperCase()
    .replace(/-/g, ':');
  if (!/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(raw)) return '';
  return raw;
}

export function parseMikroTicketComment(comment) {
  const c = String(comment || '');
  const dc = c.match(/-dc:(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/i)?.[1];
  const ot = c.match(/-ot:(\d+)/i)?.[1];
  const em = c.match(/-em:([a-f0-9]+)/i)?.[1];
  const da = c.match(/-da:(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/i)?.[1];
  const mc = normalizeMacAddress(c.match(/-mc:([0-9A-Fa-f:.-]+)/i)?.[1] || '');
  return {
    createdAt: dc || null,
    ot: ot != null ? Number(ot) : null,
    em: em || null,
    activatedAt: da || null,
    mac: mc || null,
  };
}

/**
 * @param {{
 *   createdAt?: Date|string|number,
 *   voucherId?: string,
 *   usersPerTicket?: number,
 *   activatedAt?: Date|string|number|null,
 *   mac?: string|null,
 *   validUntil?: Date|string|number|null,
 * }} opts
 */
export function formatMikroTicketComment(opts = {}) {
  const createdAt = opts.createdAt ? new Date(opts.createdAt) : new Date();
  const dc = formatMikroTicketDate(createdAt) || formatMikroTicketDate(new Date());
  const ot = Math.max(1, Math.floor(Number(opts.usersPerTicket) || 1));
  const em = String(opts.voucherId || '')
    .replace(/[^a-f0-9]/gi, '')
    .slice(0, 24);
  let comment = `QareFi-dc:${dc}-ot:${ot}-em:${em || '0'}`;

  const mac = normalizeMacAddress(opts.mac);
  if (opts.activatedAt && mac) {
    const da = formatMikroTicketDate(opts.activatedAt);
    if (da) comment += `-da:${da}-mc:${mac}`;
  }

  if (opts.validUntil) {
    const exp = formatExpiryComment(opts.validUntil);
    if (exp && !/^QareFi hotspot$/i.test(exp)) comment += ` ${exp}`;
  }

  return comment;
}
