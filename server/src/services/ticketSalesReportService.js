import mongoose from 'mongoose';
import { HotspotVoucher, PlanPackage, Router, TicketSale, TicketSite, TicketType, Transaction } from '../models/index.js';
import { backfillOnlineVouchers, sellerKeyOf, unitPrice } from './ticketLedgerService.js';

/*
 * Tickets sold, from every channel:
 *   seller  — codes handed to a seller, counted when a customer used them (price = issue unit price)
 *   count   — count-only seller issues: issued minus returned (no codes to watch)
 *   office  — codes printed on the Tickets page and sold without a seller, counted when used (plan price)
 *   online  — bought on the portal with mobile money (amount paid)
 */
export const SALES_CHANNELS = {
  seller: 'Sellers (codes used)',
  count: 'Sellers (count only)',
  office: 'Printed / direct',
  online: 'Online (MoMo)',
};

const oid = (v) => new mongoose.Types.ObjectId(String(v));
const str = (v) => (v == null ? '' : String(v._id || v));

function dayExpr(field, tz) {
  return { $dateToString: { format: '%Y-%m-%d', date: field, timezone: tz } };
}

async function gatherRows(organizationId, from, to, tz) {
  const org = oid(organizationId);
  await backfillOnlineVouchers(organizationId);

  const [sellerUsed, officeUsed, onlineTx, countIssues, returns] = await Promise.all([
    HotspotVoucher.aggregate([
      { $match: { organizationId: org, issueSaleId: { $ne: null }, usedAt: { $gte: from, $lte: to } } },
      { $group: { _id: { issue: '$issueSaleId', day: dayExpr('$usedAt', tz) }, qty: { $sum: 1 } } },
    ]),
    HotspotVoucher.aggregate([
      {
        $match: {
          organizationId: org,
          issueSaleId: null,
          source: { $ne: 'online' },
          usedAt: { $gte: from, $lte: to },
        },
      },
      {
        $group: {
          _id: { router: '$routerId', pkg: '$packageId', day: dayExpr('$usedAt', tz) },
          qty: { $sum: 1 },
        },
      },
    ]),
    Transaction.aggregate([
      { $match: { organizationId: org, kind: 'voucher', status: 'paid', createdAt: { $gte: from, $lte: to } } },
      {
        $group: {
          _id: { router: '$meta.routerId', pkg: '$packageId', day: dayExpr('$createdAt', tz) },
          qty: { $sum: 1 },
          cents: { $sum: '$amountCents' },
        },
      },
    ]),
    TicketSale.find({
      organizationId: org,
      kind: 'issued',
      linked: { $ne: true },
      voidedAt: null,
      soldAt: { $gte: from, $lte: to },
    })
      .select('soldAt siteId ticketTypeId sellerName ticketSiteSellerId quantity amountCents')
      .lean(),
    TicketSale.find({ organizationId: org, kind: 'returned', voidedAt: null, soldAt: { $gte: from, $lte: to } })
      .select('soldAt siteId ticketTypeId sellerName ticketSiteSellerId quantity amountCents issueSaleId')
      .lean(),
  ]);

  const issueIds = [
    ...new Set([...sellerUsed.map((r) => str(r._id.issue)), ...returns.map((r) => str(r.issueSaleId))].filter(Boolean)),
  ];
  const [issues, sites] = await Promise.all([
    TicketSale.find({ _id: { $in: issueIds } })
      .select('siteId ticketTypeId sellerName ticketSiteSellerId routerId packageId linked unitPriceCents quantity amountCents')
      .lean(),
    TicketSite.find({ organizationId: org }).select('routerId').lean(),
  ]);
  const issueById = new Map(issues.map((i) => [str(i._id), i]));
  const routerOfSite = new Map(sites.map((s) => [str(s._id), str(s.routerId)]));
  const siteOfRouter = new Map();
  for (const s of sites) if (s.routerId && !siteOfRouter.has(str(s.routerId))) siteOfRouter.set(str(s.routerId), str(s._id));

  const pkgIds = [...new Set([...officeUsed, ...onlineTx].map((r) => str(r._id.pkg)).filter(Boolean))];
  const pkgs = await PlanPackage.find({ _id: { $in: pkgIds } }).select('priceCents').lean();
  const pkgPrice = new Map(pkgs.map((p) => [str(p._id), Number(p.priceCents || 0)]));

  const rows = [];
  for (const r of sellerUsed) {
    const issue = issueById.get(str(r._id.issue));
    if (!issue) continue;
    rows.push({
      day: r._id.day,
      channel: 'seller',
      routerId: str(issue.routerId),
      siteId: str(issue.siteId),
      packageId: str(issue.packageId),
      ticketTypeId: str(issue.ticketTypeId),
      sellerKey: sellerKeyOf(issue),
      sellerName: issue.sellerName,
      qty: r.qty,
      cents: r.qty * unitPrice(issue),
    });
  }
  for (const r of officeUsed) {
    const routerId = str(r._id.router);
    rows.push({
      day: r._id.day,
      channel: 'office',
      routerId,
      siteId: siteOfRouter.get(routerId) || '',
      packageId: str(r._id.pkg),
      ticketTypeId: '',
      sellerKey: '',
      sellerName: '',
      qty: r.qty,
      cents: r.qty * (pkgPrice.get(str(r._id.pkg)) || 0),
    });
  }
  for (const r of onlineTx) {
    const routerId = str(r._id.router);
    rows.push({
      day: r._id.day,
      channel: 'online',
      routerId,
      siteId: siteOfRouter.get(routerId) || '',
      packageId: str(r._id.pkg),
      ticketTypeId: '',
      sellerKey: '',
      sellerName: '',
      qty: r.qty,
      cents: Number(r.cents || 0),
    });
  }
  const dayOf = (d) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  for (const i of countIssues) {
    rows.push({
      day: dayOf(i.soldAt),
      channel: 'count',
      routerId: routerOfSite.get(str(i.siteId)) || '',
      siteId: str(i.siteId),
      packageId: '',
      ticketTypeId: str(i.ticketTypeId),
      sellerKey: sellerKeyOf(i),
      sellerName: i.sellerName,
      qty: Number(i.quantity || 0),
      cents: Number(i.amountCents || 0),
    });
  }
  for (const r of returns) {
    const issue = issueById.get(str(r.issueSaleId));
    if (!issue || issue.linked) continue;
    rows.push({
      day: dayOf(r.soldAt),
      channel: 'count',
      routerId: routerOfSite.get(str(r.siteId)) || '',
      siteId: str(r.siteId),
      packageId: '',
      ticketTypeId: str(r.ticketTypeId),
      sellerKey: sellerKeyOf(r),
      sellerName: r.sellerName,
      qty: -Number(r.quantity || 0),
      cents: -Number(r.amountCents || 0),
    });
  }
  return rows;
}

function emptyTotals() {
  return { qty: 0, cents: 0, channels: Object.fromEntries(Object.keys(SALES_CHANNELS).map((c) => [c, { qty: 0, cents: 0 }])) };
}

function add(t, r) {
  t.qty += r.qty;
  t.cents += r.cents;
  t.channels[r.channel].qty += r.qty;
  t.channels[r.channel].cents += r.cents;
}

function groupBy(rows, keyOf, labelOf) {
  const m = new Map();
  for (const r of rows) {
    const key = keyOf(r) || '';
    const g = m.get(key) || { key, label: labelOf(key, r), ...emptyTotals() };
    add(g, r);
    m.set(key, g);
  }
  return [...m.values()].sort((a, b) => b.cents - a.cents || b.qty - a.qty);
}

/**
 * @param {object} f filters: routerId, siteId, packageId, ticketTypeId, sellerKey, channel
 */
export async function ticketSalesReport(organizationId, { from, to, tz = 'Africa/Accra', ...f }) {
  const all = await gatherRows(organizationId, from, to, tz);
  const channels = String(f.channel || '')
    .split(',')
    .map((c) => c.trim())
    .filter((c) => SALES_CHANNELS[c]);
  const rows = all.filter(
    (r) =>
      (!f.routerId || r.routerId === f.routerId) &&
      (!f.siteId || r.siteId === f.siteId) &&
      (!f.packageId || r.packageId === f.packageId) &&
      (!f.ticketTypeId || r.ticketTypeId === f.ticketTypeId) &&
      (!f.sellerKey || r.sellerKey === f.sellerKey) &&
      (!channels.length || channels.includes(r.channel))
  );

  const org = oid(organizationId);
  const [routers, sites, pkgs, types] = await Promise.all([
    Router.find({ organizationId: org }).select('name').lean(),
    TicketSite.find({ organizationId: org }).select('name').lean(),
    PlanPackage.find({ organizationId: org, kind: 'hotspot' }).select('name').lean(),
    TicketType.find({ organizationId: org }).select('label').lean(),
  ]);
  const names = (list, field) => new Map(list.map((x) => [str(x._id), x[field]]));
  const routerName = names(routers, 'name');
  const siteName = names(sites, 'name');
  const pkgName = names(pkgs, 'name');
  const typeName = names(types, 'label');

  const totals = emptyTotals();
  for (const r of rows) add(totals, r);

  return {
    from,
    to,
    channels: SALES_CHANNELS,
    totals,
    byRouter: groupBy(rows, (r) => r.routerId, (k) => routerName.get(k) || (k ? 'Deleted router' : 'No router')),
    bySite: groupBy(rows, (r) => r.siteId, (k) => siteName.get(k) || (k ? 'Deleted site' : 'No site')),
    byPlan: groupBy(
      rows,
      (r) => (r.packageId ? `p:${r.packageId}` : r.ticketTypeId ? `t:${r.ticketTypeId}` : ''),
      (k) =>
        k.startsWith('p:')
          ? pkgName.get(k.slice(2)) || 'Deleted plan'
          : k.startsWith('t:')
            ? `${typeName.get(k.slice(2)) || 'Ticket type'} (count only)`
            : 'Unknown'
    ),
    bySeller: groupBy(
      rows.filter((r) => r.sellerKey),
      (r) => r.sellerKey,
      (k, r) => `${r.sellerName}${r.siteId && siteName.get(r.siteId) ? ` · ${siteName.get(r.siteId)}` : ''}`
    ),
    byChannel: groupBy(rows, (r) => r.channel, (k) => SALES_CHANNELS[k] || k),
    byDay: groupBy(rows, (r) => r.day, (k) => k).sort((a, b) => a.key.localeCompare(b.key)),
  };
}
