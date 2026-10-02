import crypto from 'crypto';
import mongoose from 'mongoose';
import { HotspotVoucher, TicketSale, TicketSite, TicketSiteSeller, TicketType, Transaction } from '../models/index.js';

/*
 * Ticket operations ledger.
 *
 * issued    — tickets handed to a seller. `linked` issues carry real hotspot codes (HotspotVoucher.issueSaleId);
 *             count-only issues are tickets printed elsewhere.
 * collected — cash received against one issue (one hand-over may be split over several issues: collectionGroupId).
 * returned  — unsold tickets given back.
 *
 * Owed:
 *   linked     → used codes × unit price (a code is "used" once a customer logged in with it).
 *   count-only → (issued − returned) × unit price (use cannot be seen).
 * A seller may pay ahead for linked codes they still hold (credit), never more than the face value they hold.
 */

function fail(message, status = 400) {
  const e = new Error(message);
  e.status = status;
  return e;
}

const oid = (v) => new mongoose.Types.ObjectId(String(v));
const notVoided = { voidedAt: null };

export function unitPrice(issue) {
  if (issue.unitPriceCents != null) return Number(issue.unitPriceCents) || 0;
  const q = Number(issue.quantity) || 0;
  return q > 0 ? Math.round(Number(issue.amountCents || 0) / q) : 0;
}

/** Stable key for "the same seller": registered seller id, else site + lowercased name. */
export function sellerKeyOf(row) {
  if (row.ticketSiteSellerId) return `s:${String(row.ticketSiteSellerId._id || row.ticketSiteSellerId)}`;
  const site = String(row.siteId?._id || row.siteId || '');
  return `n:${site}:${String(row.sellerName || '').trim().toLowerCase()}`;
}

export function sellerQueryFromKey(organizationId, key) {
  const k = String(key || '');
  if (k.startsWith('s:') && mongoose.isValidObjectId(k.slice(2))) {
    return { organizationId: oid(organizationId), ticketSiteSellerId: oid(k.slice(2)) };
  }
  const m = k.match(/^n:([0-9a-f]{24}):(.+)$/i);
  if (m) {
    return {
      organizationId: oid(organizationId),
      siteId: oid(m[1]),
      ticketSiteSellerId: null,
      sellerName: new RegExp(`^${m[2].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
    };
  }
  throw fail('Unknown seller');
}

/**
 * Balance figures for issues (lean TicketSale docs, kind=issued, not voided).
 * Returns Map(issueId → { issuedQty, usedQty, holdingQty, expiredQty, returnedQty, owedCents,
 *   collectedCents, balanceCents, maxCollectCents }).
 */
export async function computeIssueBalances(organizationId, issues) {
  const out = new Map();
  if (!issues.length) return out;
  const ids = issues.map((i) => oid(i._id));
  const orgOid = oid(organizationId);

  const [moneyRows, voucherRows] = await Promise.all([
    TicketSale.aggregate([
      { $match: { organizationId: orgOid, issueSaleId: { $in: ids }, kind: { $in: ['collected', 'returned'] }, ...notVoided } },
      {
        $group: {
          _id: { issue: '$issueSaleId', kind: '$kind' },
          cents: { $sum: '$amountCents' },
          qty: { $sum: '$quantity' },
        },
      },
    ]),
    issues.some((i) => i.linked)
      ? HotspotVoucher.aggregate([
          { $match: { issueSaleId: { $in: ids.filter((_, n) => issues[n].linked) } } },
          {
            $group: {
              _id: '$issueSaleId',
              used: { $sum: { $cond: [{ $ne: [{ $ifNull: ['$usedAt', null] }, null] }, 1, 0] } },
              expiredUnused: {
                $sum: {
                  $cond: [
                    {
                      $and: [
                        { $eq: [{ $ifNull: ['$usedAt', null] }, null] },
                        { $ne: [{ $ifNull: ['$validUntil', null] }, null] },
                        { $lte: ['$validUntil', new Date()] },
                      ],
                    },
                    1,
                    0,
                  ],
                },
              },
              total: { $sum: 1 },
            },
          },
        ])
      : [],
  ]);

  const collected = new Map();
  const returned = new Map();
  for (const r of moneyRows) {
    const k = String(r._id.issue);
    if (r._id.kind === 'collected') collected.set(k, Number(r.cents || 0));
    else returned.set(k, { cents: Number(r.cents || 0), qty: Number(r.qty || 0) });
  }
  const vouchers = new Map(voucherRows.map((r) => [String(r._id), r]));

  for (const issue of issues) {
    const id = String(issue._id);
    const price = unitPrice(issue);
    const issuedQty = Number(issue.quantity) || 0;
    const ret = returned.get(id) || { cents: 0, qty: 0 };
    const collectedCents = collected.get(id) || 0;
    let usedQty = null;
    let holdingQty;
    let expiredQty = 0;
    let owedCents;
    let maxCollectCents;
    if (issue.linked) {
      const v = vouchers.get(id) || { used: 0, expiredUnused: 0, total: 0 };
      usedQty = Number(v.used || 0) + Number(issue.archivedUsedQty || 0);
      expiredQty = Number(v.expiredUnused || 0);
      holdingQty = Math.max(0, Number(v.total || 0) - Number(v.used || 0) - expiredQty);
      owedCents = usedQty * price;
      maxCollectCents = (usedQty + holdingQty) * price - collectedCents;
    } else {
      holdingQty = Math.max(0, issuedQty - ret.qty);
      owedCents = Math.max(0, Number(issue.amountCents || 0) - ret.cents);
      maxCollectCents = owedCents - collectedCents;
    }
    out.set(id, {
      issuedQty,
      usedQty,
      holdingQty,
      expiredQty,
      returnedQty: ret.qty,
      unitPriceCents: price,
      owedCents,
      collectedCents,
      balanceCents: owedCents - collectedCents,
      maxCollectCents: Math.max(0, maxCollectCents),
    });
  }
  return out;
}

/** Issues (oldest first) with their balances, filtered by an arbitrary TicketSale query. */
export async function issuesWithBalances(organizationId, extraQuery = {}, { openOnly = false } = {}) {
  const issues = await TicketSale.find({ organizationId: oid(organizationId), kind: 'issued', ...notVoided, ...extraQuery })
    .sort({ soldAt: 1, createdAt: 1 })
    .populate('siteId', 'name')
    .populate('ticketTypeId', 'label priceCents durationDays')
    .lean();
  const bal = await computeIssueBalances(organizationId, issues);
  const rows = issues.map((i) => ({ ...i, ...bal.get(String(i._id)) }));
  return openOnly ? rows.filter((r) => r.balanceCents > 0 || r.holdingQty > 0 || r.maxCollectCents > 0) : rows;
}

/** Per-seller totals across all of their issues (current position, not date-bound). */
export async function sellerBalances(organizationId, { siteId, query = {} } = {}) {
  const q = { ...query };
  if (siteId && mongoose.isValidObjectId(String(siteId))) q.siteId = oid(siteId);
  return rollupSellers(await issuesWithBalances(organizationId, q));
}

/** Group issue rows (from issuesWithBalances) per seller. */
export function rollupSellers(rows) {
  const now = Date.now();
  const by = new Map();
  for (const r of rows) {
    const key = sellerKeyOf(r);
    const cur =
      by.get(key) ||
      {
        sellerKey: key,
        sellerName: r.sellerName,
        sellerPhone: r.sellerPhone || '',
        siteId: String(r.siteId?._id || r.siteId || ''),
        siteName: r.siteId?.name || '',
        issues: 0,
        openIssues: 0,
        issuedQty: 0,
        usedQty: 0,
        holdingQty: 0,
        expiredQty: 0,
        returnedQty: 0,
        owedCents: 0,
        collectedCents: 0,
        balanceCents: 0,
        oldestUnpaidAt: null,
        lastIssuedAt: null,
      };
    cur.issues += 1;
    cur.issuedQty += r.issuedQty;
    cur.usedQty += r.usedQty || 0;
    cur.holdingQty += r.holdingQty;
    cur.expiredQty += r.expiredQty;
    cur.returnedQty += r.returnedQty;
    cur.owedCents += r.owedCents;
    cur.collectedCents += r.collectedCents;
    cur.balanceCents += r.balanceCents;
    if (r.balanceCents > 0 || r.holdingQty > 0) cur.openIssues += 1;
    if (r.balanceCents > 0 && !cur.oldestUnpaidAt) cur.oldestUnpaidAt = r.soldAt;
    cur.lastIssuedAt = r.soldAt;
    if (r.sellerPhone) cur.sellerPhone = r.sellerPhone;
    by.set(key, cur);
  }
  return [...by.values()]
    .map((s) => ({
      ...s,
      daysOwing: s.oldestUnpaidAt ? Math.floor((now - new Date(s.oldestUnpaidAt).getTime()) / 86400000) : 0,
    }))
    .sort((a, b) => b.balanceCents - a.balanceCents || a.sellerName.localeCompare(b.sellerName));
}

/* ---------- Issue ---------- */

function stockQuery(organizationId, routerId, packageId) {
  return {
    organizationId: oid(organizationId),
    routerId: oid(routerId),
    packageId: oid(packageId),
    usedAt: null,
    issueSaleId: null,
    source: { $ne: 'online' },
    $or: [{ validUntil: null }, { validUntil: { $gt: new Date() } }],
  };
}

const onlineBackfilled = new Set();

/** Codes bought on the portal before `source` existed: tag them so they never reach a seller. */
async function backfillOnlineVouchers(organizationId) {
  const key = String(organizationId);
  if (onlineBackfilled.has(key)) return;
  const ids = await Transaction.distinct('hotspotVoucherId', {
    organizationId: oid(organizationId),
    hotspotVoucherId: { $ne: null },
  });
  if (ids.length) {
    await HotspotVoucher.updateMany({ _id: { $in: ids }, source: { $ne: 'online' } }, { $set: { source: 'online' } });
  }
  onlineBackfilled.add(key);
}

/** Where linked codes come from for a ticket type, or null when it is count-only. */
export async function linkedSourceForType(organizationId, ticketType) {
  if (!ticketType?.packageId) return null;
  const site = await TicketSite.findOne({ _id: ticketType.siteId, organizationId }).select('routerId').lean();
  if (!site?.routerId) return null;
  return { routerId: String(site.routerId), packageId: String(ticketType.packageId) };
}

export async function stockForType(organizationId, ticketTypeId) {
  const tt = await TicketType.findOne({ _id: ticketTypeId, organizationId }).lean();
  if (!tt) throw fail('Ticket type not found', 404);
  const src = await linkedSourceForType(organizationId, tt);
  if (!src) return { linked: false, available: null, batches: [] };
  await backfillOnlineVouchers(organizationId);
  const q = stockQuery(organizationId, src.routerId, src.packageId);
  const batches = await HotspotVoucher.aggregate([
    { $match: q },
    { $group: { _id: { $ifNull: ['$batchId', ''] }, available: { $sum: 1 }, createdAt: { $min: '$createdAt' } } },
    { $sort: { createdAt: 1 } },
  ]);
  return {
    linked: true,
    routerId: src.routerId,
    packageId: src.packageId,
    available: batches.reduce((n, b) => n + b.available, 0),
    batches: batches.map((b) => ({ batchId: b._id, available: b.available, createdAt: b.createdAt })),
  };
}

async function resolveSeller(organizationId, siteId, { ticketSiteSellerId, sellerName, sellerPhone }) {
  if (ticketSiteSellerId && mongoose.isValidObjectId(String(ticketSiteSellerId))) {
    const ts = await TicketSiteSeller.findOne({
      _id: ticketSiteSellerId,
      organizationId,
      siteId,
      active: true,
    }).lean();
    if (!ts) throw fail('Seller not found at this site');
    return {
      ticketSiteSellerId: ts._id,
      sellerName: String(ts.name || '').trim(),
      sellerPhone: String(sellerPhone || ts.phone || '').trim(),
    };
  }
  const name = String(sellerName || '').trim();
  if (!name) throw fail('Choose a seller');
  return { ticketSiteSellerId: null, sellerName: name, sellerPhone: String(sellerPhone || '').trim() };
}

/**
 * Hand tickets to a seller. For linked types the oldest unused, unissued codes are claimed
 * (optionally only from one print batch). Returns { issue, codes }.
 */
export async function issueTickets({ organizationId, admin, ticketTypeId, quantity, batchId, seller, note }) {
  if (!mongoose.isValidObjectId(String(ticketTypeId))) throw fail('Choose a ticket type');
  const tt = await TicketType.findOne({ _id: ticketTypeId, organizationId, active: true }).lean();
  if (!tt) throw fail('Active ticket type not found', 404);
  const who = await resolveSeller(organizationId, tt.siteId, seller || {});
  const src = await linkedSourceForType(organizationId, tt);
  const price = Math.round(Number(tt.priceCents || 0));

  let qty = Math.round(Number(quantity) || 0);
  let pickIds = [];
  if (src) {
    await backfillOnlineVouchers(organizationId);
    const q = stockQuery(organizationId, src.routerId, src.packageId);
    if (batchId != null && String(batchId) !== '') q.batchId = String(batchId);
    if (batchId != null && String(batchId) !== '' && !qty) {
      qty = await HotspotVoucher.countDocuments(q);
    }
    if (qty < 1) throw fail('Quantity must be at least 1');
    const picks = await HotspotVoucher.find(q).sort({ createdAt: 1, code: 1 }).limit(qty).select('_id').lean();
    if (picks.length < qty) {
      throw fail(
        `Only ${picks.length} unused ticket${picks.length === 1 ? '' : 's'} in stock for this plan` +
          `${batchId ? ' in that batch' : ''}. Generate more on the Tickets page, or issue fewer.`,
        409
      );
    }
    pickIds = picks.map((p) => p._id);
  } else if (qty < 1) {
    throw fail('Quantity must be at least 1');
  }

  const issue = await TicketSale.create({
    organizationId,
    siteId: tt.siteId,
    ticketTypeId: tt._id,
    kind: 'issued',
    ...who,
    sellerAdminId: admin.id,
    quantity: qty,
    unitPriceCents: price,
    amountCents: price * qty,
    linked: Boolean(src),
    ...(src ? { routerId: src.routerId, packageId: src.packageId } : {}),
    ...(note ? { note } : {}),
  });

  let codes = [];
  if (src) {
    const now = new Date();
    const r = await HotspotVoucher.updateMany(
      { _id: { $in: pickIds }, issueSaleId: null, usedAt: null },
      { $set: { issueSaleId: issue._id, issuedAt: now } }
    );
    if (r.modifiedCount !== pickIds.length) {
      await HotspotVoucher.updateMany({ issueSaleId: issue._id }, { $set: { issueSaleId: null, issuedAt: null } });
      await TicketSale.deleteOne({ _id: issue._id });
      throw fail('Some of those tickets were just taken by another issue or used. Try again.', 409);
    }
    codes = await HotspotVoucher.find({ issueSaleId: issue._id })
      .sort({ code: 1 })
      .populate('packageId', 'name priceCents currency')
      .populate('routerId', 'name comment')
      .lean();
  }
  return { issue: issue.toObject(), codes };
}

/* ---------- Collect ---------- */

/**
 * Record cash from a seller. The amount is applied oldest issue first: first to what is owed,
 * then (linked issues only) as advance payment for codes still held.
 */
export async function collectFromSeller({
  organizationId,
  admin,
  sellerKey,
  amountCents,
  receivedFromName,
  receivedFromPhone,
  note,
}) {
  const amount = Math.round(Number(amountCents) || 0);
  if (amount <= 0) throw fail('Enter the amount received');
  const rows = await issuesWithBalances(organizationId, sellerQueryFromKey(organizationId, sellerKey));
  const room = rows.reduce((n, r) => n + r.maxCollectCents, 0);
  if (!rows.length) throw fail('This seller has no issued tickets');
  if (amount > room) {
    const owed = rows.reduce((n, r) => n + Math.max(0, r.balanceCents), 0);
    throw fail(
      `That is more than this seller can owe right now: GHS ${(owed / 100).toFixed(2)} owed` +
        (room > owed ? `, GHS ${(room / 100).toFixed(2)} including tickets they still hold` : '') +
        '.'
    );
  }

  const plan = [];
  let left = amount;
  for (const pass of ['owed', 'advance']) {
    for (const r of rows) {
      if (left <= 0) break;
      const already = plan.find((p) => p.issue === r)?.cents || 0;
      const cap = pass === 'owed' ? Math.max(0, r.balanceCents) - already : r.maxCollectCents - already;
      const take = Math.min(left, Math.max(0, cap));
      if (take <= 0) continue;
      const existing = plan.find((p) => p.issue === r);
      if (existing) existing.cents += take;
      else plan.push({ issue: r, cents: take });
      left -= take;
    }
  }

  const groupId = crypto.randomUUID();
  const docs = await TicketSale.insertMany(
    plan.map(({ issue, cents }) => ({
      organizationId,
      siteId: issue.siteId?._id || issue.siteId,
      ...(issue.ticketTypeId ? { ticketTypeId: issue.ticketTypeId._id || issue.ticketTypeId } : {}),
      kind: 'collected',
      sellerName: issue.sellerName,
      ...(issue.ticketSiteSellerId ? { ticketSiteSellerId: issue.ticketSiteSellerId } : {}),
      sellerAdminId: admin.id,
      issueSaleId: issue._id,
      quantity: unitPrice(issue) > 0 ? Math.max(1, Math.round(cents / unitPrice(issue))) : 1,
      amountCents: cents,
      collectionGroupId: groupId,
      ...(receivedFromName ? { receivedFromName } : {}),
      ...(receivedFromPhone ? { receivedFromPhone } : {}),
      ...(note ? { note } : {}),
    }))
  );
  return { collectionGroupId: groupId, entries: docs.map((d) => d.toObject()), allocatedTo: plan.length };
}

/* ---------- Return ---------- */

/** Give back unsold tickets. Linked: the unused codes go back to stock. Count-only: reduces what is owed. */
export async function returnTickets({ organizationId, admin, issueSaleId, quantity, note }) {
  const [row] = await issuesWithBalances(organizationId, { _id: oid(issueSaleId) });
  if (!row) throw fail('Issue not found', 404);
  const qty = Math.round(Number(quantity) || 0);
  if (qty < 1) throw fail('Quantity must be at least 1');
  if (qty > row.holdingQty) {
    throw fail(`The seller holds only ${row.holdingQty} unsold ticket${row.holdingQty === 1 ? '' : 's'} from this issue.`);
  }
  const price = unitPrice(row);
  if (row.linked) {
    const collectedAhead = Math.max(0, row.collectedCents - row.owedCents);
    const stillPaidFor = Math.max(0, (row.holdingQty - qty) * price);
    if (collectedAhead > stillPaidFor) {
      throw fail('The seller already paid ahead for these tickets. Record a refund first, or return fewer.');
    }
    const picks = await HotspotVoucher.find({
      issueSaleId: row._id,
      usedAt: null,
      $or: [{ validUntil: null }, { validUntil: { $gt: new Date() } }],
    })
      .sort({ code: -1 })
      .limit(qty)
      .select('_id')
      .lean();
    await HotspotVoucher.updateMany(
      { _id: { $in: picks.map((p) => p._id) }, usedAt: null },
      { $set: { issueSaleId: null, issuedAt: null } }
    );
  } else if (row.collectedCents > (row.issuedQty - row.returnedQty - qty) * price) {
    throw fail('More cash was collected than the remaining tickets are worth. Return fewer.');
  }
  const doc = await TicketSale.create({
    organizationId,
    siteId: row.siteId?._id || row.siteId,
    ...(row.ticketTypeId ? { ticketTypeId: row.ticketTypeId._id || row.ticketTypeId } : {}),
    kind: 'returned',
    sellerName: row.sellerName,
    ...(row.ticketSiteSellerId ? { ticketSiteSellerId: row.ticketSiteSellerId } : {}),
    sellerAdminId: admin.id,
    issueSaleId: row._id,
    quantity: qty,
    amountCents: qty * price,
    ...(note ? { note } : {}),
  });
  return doc.toObject();
}

/* ---------- Void ---------- */

export async function voidEntry({ organizationId, admin, saleId, reason }) {
  const why = String(reason || '').trim();
  if (!why) throw fail('Give a reason for voiding');
  const doc = await TicketSale.findOne({ _id: saleId, organizationId, ...notVoided });
  if (!doc) throw fail('Entry not found or already voided', 404);
  if (doc.kind === 'issued') {
    const linkedEntries = await TicketSale.countDocuments({ issueSaleId: doc._id, ...notVoided });
    if (linkedEntries > 0) throw fail('Void its collections and returns first.');
    if (doc.linked) {
      const used = await HotspotVoucher.countDocuments({ issueSaleId: doc._id, usedAt: { $ne: null } });
      if (used > 0 || doc.archivedUsedQty > 0) {
        throw fail('Customers already used some of these tickets, so this issue cannot be voided.');
      }
      await HotspotVoucher.updateMany({ issueSaleId: doc._id }, { $set: { issueSaleId: null, issuedAt: null } });
    }
  } else if (doc.kind === 'returned') {
    const issue = await TicketSale.findById(doc.issueSaleId).select('linked').lean();
    if (issue?.linked) throw fail('Returned codes are already back in stock; issue them again instead.');
  }
  doc.voidedAt = new Date();
  doc.voidedByAdminId = admin.id;
  doc.voidReason = why.slice(0, 200);
  await doc.save();
  return doc.toObject();
}

/**
 * Called before hotspot tickets are deleted: keep linked issues' used/unused counts so balances do not change.
 * @param {Array<{ issueSaleId?: unknown, usedAt?: Date|null }>} vouchers
 */
export async function archiveLinkedUsage(vouchers) {
  const by = new Map();
  for (const v of vouchers || []) {
    if (!v?.issueSaleId) continue;
    const k = String(v.issueSaleId);
    const cur = by.get(k) || { used: 0, unused: 0 };
    if (v.usedAt) cur.used += 1;
    else cur.unused += 1;
    by.set(k, cur);
  }
  await Promise.all(
    [...by.entries()].map(([id, c]) =>
      TicketSale.updateOne({ _id: id }, { $inc: { archivedUsedQty: c.used, archivedUnusedQty: c.unused } })
    )
  );
}
