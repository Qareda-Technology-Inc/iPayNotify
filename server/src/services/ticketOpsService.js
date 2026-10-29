import mongoose from 'mongoose';
import { HotspotVoucher, PlanPackage, Router, TicketSite, TicketSiteSeller, TicketType } from '../models/index.js';
import { routerDisplayName } from '../utils/routerLabel.js';
import { backfillOnlineVouchers, issueTickets, sellerBalances } from './ticketLedgerService.js';

/*
 * Ticket operations by router: every router is a ticket site and its hotspot plans are the ticket
 * types. TicketSite / TicketType rows are still the ledger's keys; they are created on demand here,
 * so admins never manage them by hand. Sites from before (no router) stay listed for old balances.
 */

function fail(message, status = 400) {
  const e = new Error(message);
  e.status = status;
  return e;
}

const oid = (v) => new mongoose.Types.ObjectId(String(v));

/** The ticket site for a router (oldest if several were linked by hand), created when missing. */
export async function siteForRouter(organizationId, routerId, { create = true } = {}) {
  const existing = await TicketSite.findOne({ organizationId, routerId }).sort({ createdAt: 1 }).lean();
  if (existing || !create) return existing;
  const router = await Router.findOne({ _id: routerId, organizationId }).select('name comment').lean();
  if (!router) throw fail('Router not found', 404);
  const name = routerDisplayName(router) || 'Router';
  /* An old unlinked site with the router's name is the same place: adopt it with its sellers. */
  const sameName = await TicketSite.findOneAndUpdate(
    { organizationId, routerId: null, name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
    { $set: { routerId, active: true } },
    { new: true }
  ).lean();
  if (sameName) return sameName;
  for (let n = 0; n < 5; n += 1) {
    try {
      const doc = await TicketSite.create({
        organizationId,
        routerId,
        name: n ? `${name} (${n + 1})` : name,
      });
      return doc.toObject();
    } catch (e) {
      if (e?.code !== 11000) throw e;
      const raced = await TicketSite.findOne({ organizationId, routerId }).lean();
      if (raced) return raced;
    }
  }
  throw fail('Could not create the ticket site for this router');
}

/** The ticket type for a plan at a site, created (or refreshed from the plan) on demand. */
export async function typeForPlan(organizationId, siteId, plan) {
  const durationDays = Math.max(1, Math.ceil(Number(plan.elapsedSeconds || 0) / 86400) || 1);
  const fields = {
    label: String(plan.name || 'Ticket').trim(),
    priceCents: Math.max(0, Math.round(Number(plan.priceCents) || 0)),
    durationDays,
    active: true,
  };
  const existing = await TicketType.findOneAndUpdate(
    { organizationId, siteId, packageId: plan._id },
    { $set: fields },
    { new: true, sort: { createdAt: 1 } }
  ).lean();
  if (existing) return existing;
  return (await TicketType.create({ organizationId, siteId, packageId: plan._id, ...fields })).toObject();
}

/** Unused, unissued system codes per plan on a router: Map(packageId → { available, batches }). */
async function stockByPlan(organizationId, routerId) {
  await backfillOnlineVouchers(organizationId);
  const rows = await HotspotVoucher.aggregate([
    {
      $match: {
        organizationId: oid(organizationId),
        routerId: oid(routerId),
        usedAt: null,
        issueSaleId: null,
        source: { $ne: 'online' },
        $or: [{ validUntil: null }, { validUntil: { $gt: new Date() } }],
      },
    },
    {
      $group: {
        _id: { packageId: '$packageId', batchId: { $ifNull: ['$batchId', ''] } },
        available: { $sum: 1 },
        createdAt: { $min: '$createdAt' },
      },
    },
    { $sort: { createdAt: 1 } },
  ]);
  const out = new Map();
  for (const r of rows) {
    const k = String(r._id.packageId || '');
    const cur = out.get(k) || { available: 0, batches: [] };
    cur.available += r.available;
    cur.batches.push({ batchId: r._id.batchId, available: r.available, createdAt: r.createdAt });
    out.set(k, cur);
  }
  return out;
}

/** Hotspot plans that can be issued at a router, with how many system codes are ready for each. */
export async function plansForRouter(organizationId, routerId) {
  if (!(await Router.exists({ _id: routerId, organizationId }))) throw fail('Router not found', 404);
  const [plans, stock] = await Promise.all([
    PlanPackage.find({ organizationId, kind: 'hotspot', isActive: true })
      .select('name priceCents currency elapsedSeconds')
      .sort({ priceCents: 1, name: 1 })
      .lean(),
    stockByPlan(organizationId, routerId),
  ]);
  return plans.map((p) => {
    const s = stock.get(String(p._id)) || { available: 0, batches: [] };
    return {
      _id: String(p._id),
      name: p.name,
      priceCents: p.priceCents,
      currency: p.currency || 'GHS',
      available: s.available,
      batches: s.batches.filter((b) => b.batchId),
    };
  });
}

/**
 * Everything the Sellers / Issue / Collections pages need: each router as a site with its sellers
 * and their current position, plus old sites without a router that still have sellers or history.
 */
export async function ticketOpsOverview(organizationId, { onlyIssuedBy } = {}) {
  const [routers, sites, sellers, balances] = await Promise.all([
    Router.find({ organizationId }).select('name comment').lean(),
    TicketSite.find({ organizationId }).select('name routerId active').lean(),
    TicketSiteSeller.find({ organizationId }).sort({ name: 1 }).lean(),
    sellerBalances(organizationId, onlyIssuedBy ? { query: { sellerAdminId: oid(onlyIssuedBy) } } : {}),
  ]);
  const siteById = new Map(sites.map((s) => [String(s._id), s]));
  const balanceByKey = new Map(balances.map((b) => [b.sellerKey, b]));
  const groups = new Map();
  const groupFor = (site) => {
    const routerId = site?.routerId ? String(site.routerId) : '';
    const key = routerId ? `router:${routerId}` : `site:${site._id}`;
    return groups.get(key);
  };
  for (const r of routers) {
    groups.set(`router:${r._id}`, {
      key: `router:${r._id}`,
      routerId: String(r._id),
      name: routerDisplayName(r) || r.name,
      siteIds: [],
      sellers: [],
    });
  }
  for (const s of sites) {
    let g = groupFor(s);
    if (!g) {
      /* Linked to a router that no longer exists, or never linked: keep it for its history. */
      g = { key: `site:${s._id}`, routerId: '', name: s.name, legacy: true, siteIds: [], sellers: [] };
      groups.set(g.key, g);
    }
    g.siteIds.push(String(s._id));
  }

  const empty = { holdingQty: 0, usedQty: 0, issuedQty: 0, owedCents: 0, collectedCents: 0, balanceCents: 0, daysOwing: 0 };
  const pick = (b) => ({
    holdingQty: b.holdingQty,
    usedQty: b.usedQty,
    issuedQty: b.issuedQty,
    owedCents: b.owedCents,
    collectedCents: b.collectedCents,
    balanceCents: b.balanceCents,
    daysOwing: b.daysOwing,
    lastIssuedAt: b.lastIssuedAt,
  });
  for (const s of sellers) {
    const site = siteById.get(String(s.siteId));
    const g = site && groupFor(site);
    if (!g) continue;
    const sellerKey = `s:${s._id}`;
    const b = balanceByKey.get(sellerKey);
    balanceByKey.delete(sellerKey);
    g.sellers.push({
      _id: String(s._id),
      siteId: String(s.siteId),
      sellerKey,
      name: s.name,
      phone: s.phone || '',
      active: s.active !== false,
      ...(b ? pick(b) : empty),
    });
  }
  /* Names typed in by hand before sellers were saved: still shown so their balance can be cleared. */
  for (const b of balanceByKey.values()) {
    const site = siteById.get(b.siteId);
    const g = site && groupFor(site);
    if (!g) continue;
    g.sellers.push({
      _id: '',
      siteId: b.siteId,
      sellerKey: b.sellerKey,
      name: b.sellerName,
      phone: b.sellerPhone || '',
      active: false,
      unsaved: true,
      ...pick(b),
    });
  }

  const list = [...groups.values()].filter((g) => !g.legacy || g.sellers.length);
  for (const g of list) {
    g.sellers.sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name));
    g.totals = g.sellers.reduce(
      (t, s) => ({
        holdingQty: t.holdingQty + s.holdingQty,
        balanceCents: t.balanceCents + Math.max(0, s.balanceCents),
      }),
      { holdingQty: 0, balanceCents: 0 }
    );
  }
  return list.sort((a, b) => Number(Boolean(a.legacy)) - Number(Boolean(b.legacy)) || a.name.localeCompare(b.name));
}

/** Add a seller at a router's site. */
export async function addSellerAtRouter(organizationId, routerId, { name, phone }) {
  const n = String(name || '').trim();
  if (!n) throw fail('Enter the seller’s name');
  const site = await siteForRouter(organizationId, routerId);
  try {
    return (
      await TicketSiteSeller.create({
        organizationId,
        siteId: site._id,
        name: n,
        ...(String(phone || '').trim() ? { phone: String(phone).trim() } : {}),
      })
    ).toObject();
  } catch (e) {
    if (e?.code === 11000) throw fail('A seller with this name already works at this site');
    throw e;
  }
}

/**
 * Issue tickets to a seller at a router.
 * source 'system': unused codes for the plan are reserved for the seller; owed as customers use them.
 * source 'external': tickets made elsewhere for the same router; owed in full when issued.
 */
export async function issueAtRouter({
  organizationId,
  admin,
  routerId,
  sellerId,
  packageId,
  quantity,
  source = 'system',
  unitPriceCents,
  batchId,
  note,
}) {
  if (!mongoose.isValidObjectId(String(sellerId))) throw fail('Choose a seller');
  if (!mongoose.isValidObjectId(String(packageId))) throw fail('Choose a plan');
  const seller = await TicketSiteSeller.findOne({ _id: sellerId, organizationId, active: true }).lean();
  if (!seller) throw fail('Seller not found', 404);
  const site = await TicketSite.findOne({ _id: seller.siteId, organizationId }).lean();
  if (!site || String(site.routerId || '') !== String(routerId)) throw fail('This seller does not work at that site');
  const plan = await PlanPackage.findOne({ _id: packageId, organizationId, kind: 'hotspot' }).lean();
  if (!plan) throw fail('Plan not found', 404);
  const type = await typeForPlan(organizationId, site._id, plan);
  const external = source === 'external';
  let price;
  if (external && unitPriceCents != null && unitPriceCents !== '') {
    price = Math.round(Number(unitPriceCents));
    if (!Number.isFinite(price) || price < 0) throw fail('Enter a valid price');
  }
  return issueTickets({
    organizationId,
    admin,
    ticketTypeId: type._id,
    quantity,
    batchId: external ? undefined : batchId,
    seller: { ticketSiteSellerId: String(seller._id) },
    note,
    external,
    unitPriceCents: price,
  });
}
