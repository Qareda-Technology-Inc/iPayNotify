import mongoose from 'mongoose';
import { issuesWithBalances } from './ticketLedgerService.js';

function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function gh(cents) {
  return `GHS ${(Number(cents || 0) / 100).toFixed(2)}`;
}

/**
 * For one seller at one site: sum unpaid balance (what they owe minus what was collected)
 * grouped by ticket type across all batches.
 *
 * @param {mongoose.Types.ObjectId | string} organizationId
 * @param {mongoose.Types.ObjectId | string} siteId
 * @param {string} sellerName Exact seller/receiver display name as stored on TicketSale (case-insensitive match).
 */
export async function aggregateSellerOutstandingByTicketType(organizationId, siteId, sellerName) {
  const orgOid = mongoose.Types.ObjectId.isValid(String(organizationId))
    ? new mongoose.Types.ObjectId(String(organizationId))
    : null;
  const siteOid = mongoose.Types.ObjectId.isValid(String(siteId)) ? new mongoose.Types.ObjectId(String(siteId)) : null;
  if (!orgOid || !siteOid) return [];

  const name = String(sellerName || '').trim();
  if (!name) return [];

  const issued = await issuesWithBalances(orgOid, {
    siteId: siteOid,
    sellerName: new RegExp(`^${escapeRegex(name)}$`, 'i'),
  });
  if (issued.length === 0) return [];

  const byType = new Map();
  for (const r of issued) {
    const remaining = Math.max(0, Number(r.balanceCents || 0));
    const tid =
      r.ticketTypeId != null && typeof r.ticketTypeId === 'object' && r.ticketTypeId._id != null
        ? String(r.ticketTypeId._id)
        : '';
    const label =
      r.ticketTypeId != null && typeof r.ticketTypeId === 'object' && r.ticketTypeId.label
        ? String(r.ticketTypeId.label).trim()
        : 'Ticket';
    const cur = byType.get(tid || '_') || { label, remainingCents: 0 };
    cur.remainingCents += remaining;
    if (!cur.label) cur.label = label;
    byType.set(tid || '_', cur);
  }

  return [...byType.values()]
    .map((v) => ({ label: v.label, remainingCents: v.remainingCents }))
    .sort((a, b) => String(a.label).localeCompare(String(b.label)));
}

/** Short appendix for SMS: per-type balances + total (only types with remaining if any). */
export function formatSellerOutstandingSms(rows, opts = {}) {
  const maxPartLen = opts.maxLabelChars ?? 12;
  const maxPartsInline = opts.maxParts ?? 5;
  if (!rows || rows.length === 0) {
    return ' Outstanding by type: none.';
  }

  const total = rows.reduce((s, r) => s + Number(r.remainingCents || 0), 0);
  const positive = rows.filter((r) => Number(r.remainingCents || 0) > 0);

  if (positive.length === 0) {
    return ' Outstanding: all ticket types cleared.';
  }

  let parts = positive.map((r) => {
    const lab = String(r.label || '').trim().slice(0, maxPartLen);
    return `${lab || '?'} ${gh(r.remainingCents)}`;
  });

  let extra = '';
  if (parts.length > maxPartsInline) {
    extra = ` +${parts.length - maxPartsInline} more`;
    parts = parts.slice(0, maxPartsInline);
  }

  return ` Still owed ${parts.join('; ')}${extra}. Total ${gh(total)}.`;
}
