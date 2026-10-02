import express from 'express';
import mongoose from 'mongoose';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requireRoles } from '../middleware/requireRoles.js';
import { requireOrgModule } from '../middleware/requireOrgModule.js';
import {
  Admin,
  HotspotVoucher,
  PlanPackage,
  Router,
  TicketSale,
  TicketSite,
  TicketSiteSeller,
  TicketType,
} from '../models/index.js';
import { notifyTicketTransactionUpdate } from '../services/ticketNotificationService.js';
import { logOrgAudit } from '../services/orgAuditService.js';
import {
  collectFromSeller,
  issueTickets,
  issuesWithBalances,
  returnTickets,
  rollupSellers,
  sellerBalances,
  sellerKeyOf,
  sellerQueryFromKey,
  stockForType,
  voidEntry,
} from '../services/ticketLedgerService.js';
import { ticketSalesReport } from '../services/ticketSalesReportService.js';
import { orgQuery } from '../utils/tenantScope.js';

export const ticketSalesRouter = express.Router();

function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Body value → ObjectId string, null to clear, or undefined when not sent. Throws on garbage. */
function optionalRef(v) {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  if (!mongoose.isValidObjectId(String(v))) {
    const e = new Error('Invalid id');
    e.status = 400;
    throw e;
  }
  return String(v);
}

async function checkRouter(organizationId, routerId) {
  if (!routerId) return;
  const ok = await Router.exists({ _id: routerId, organizationId });
  if (!ok) {
    const e = new Error('Router not found');
    e.status = 404;
    throw e;
  }
}

async function checkHotspotPackage(organizationId, packageId) {
  if (!packageId) return;
  const ok = await PlanPackage.exists({ _id: packageId, organizationId, kind: 'hotspot' });
  if (!ok) {
    const e = new Error('Hotspot plan not found');
    e.status = 404;
    throw e;
  }
}

ticketSalesRouter.use(
  requireRoles('super_admin', 'org_admin', 'ticket_manager', 'org_staff')
);
ticketSalesRouter.use(requireOrgModule('tickets'));

ticketSalesRouter.get(
  '/sites',
  asyncHandler(async (req, res) => {
    const rows = await TicketSite.find(orgQuery(req.organizationId)).sort({ name: 1 }).lean();
    res.json(rows);
  })
);

ticketSalesRouter.post(
  '/sites',
  requireRoles('super_admin', 'org_admin'),
  asyncHandler(async (req, res) => {
    const name = String(req.body?.name || '').trim();
    if (!name) return res.status(400).json({ error: 'name is required' });
    const routerId = optionalRef(req.body?.routerId);
    await checkRouter(req.organizationId, routerId);
    try {
      const doc = await TicketSite.create({
        organizationId: req.organizationId,
        name,
        active: req.body?.active !== false,
        routerId: routerId || null,
      });
      res.status(201).json(doc.toObject());
    } catch (e) {
      if (e?.code === 11000) {
        return res.status(400).json({ error: 'Site name already exists in this organisation' });
      }
      throw e;
    }
  })
);

ticketSalesRouter.patch(
  '/sites/:id',
  requireRoles('super_admin', 'org_admin'),
  asyncHandler(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
    const doc = await TicketSite.findOne({ _id: req.params.id, organizationId: req.organizationId });
    if (!doc) return res.status(404).json({ error: 'Site not found' });
    if (req.body?.name != null) {
      const n = String(req.body.name).trim();
      if (!n) return res.status(400).json({ error: 'name cannot be empty' });
      doc.name = n;
    }
    if (req.body?.active != null) doc.active = Boolean(req.body.active);
    const routerId = optionalRef(req.body?.routerId);
    if (routerId !== undefined) {
      await checkRouter(req.organizationId, routerId);
      doc.routerId = routerId;
    }
    try {
      await doc.save();
    } catch (e) {
      if (e?.code === 11000) return res.status(400).json({ error: 'Site name already exists in this organisation' });
      throw e;
    }
    res.json(doc.toObject());
  })
);

ticketSalesRouter.delete(
  '/sites/:id',
  requireRoles('super_admin', 'org_admin'),
  asyncHandler(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
    const inUse = await TicketType.countDocuments({ organizationId: req.organizationId, siteId: req.params.id });
    if (inUse > 0) return res.status(400).json({ error: 'Site is in use by ticket types. Deactivate or move types first.' });
    const sellersLeft = await TicketSiteSeller.countDocuments({
      organizationId: req.organizationId,
      siteId: req.params.id,
    });
    if (sellersLeft > 0) {
      return res.status(400).json({ error: 'Site has registered sellers. Remove or move them first.' });
    }
    const r = await TicketSite.findOneAndDelete({ _id: req.params.id, organizationId: req.organizationId });
    if (!r) return res.status(404).json({ error: 'Site not found' });
    res.status(204).end();
  })
);

ticketSalesRouter.get(
  '/types',
  asyncHandler(async (req, res) => {
    const q = { ...orgQuery(req.organizationId) };
    const siteId = String(req.query.siteId || '').trim();
    if (siteId && mongoose.isValidObjectId(siteId)) q.siteId = siteId;
    const rows = await TicketType.find(q).sort({ createdAt: -1 }).lean();
    res.json(rows);
  })
);

ticketSalesRouter.post(
  '/types',
  requireRoles('super_admin', 'org_admin'),
  asyncHandler(async (req, res) => {
    const siteId = String(req.body?.siteId || '').trim();
    const label = String(req.body?.label || '').trim();
    const durationDays = Number(req.body?.durationDays);
    const priceCents = Number(req.body?.priceCents);
    if (!mongoose.isValidObjectId(siteId)) {
      return res.status(400).json({ error: 'siteId is required' });
    }
    if (!label) return res.status(400).json({ error: 'label is required' });
    if (!Number.isFinite(durationDays) || durationDays < 1) {
      return res.status(400).json({ error: 'durationDays must be >= 1' });
    }
    if (!Number.isFinite(priceCents) || priceCents < 0) {
      return res.status(400).json({ error: 'priceCents must be >= 0' });
    }
    const site = await TicketSite.findOne({ _id: siteId, organizationId: req.organizationId, active: true })
      .select('_id')
      .lean();
    if (!site) return res.status(404).json({ error: 'Active site not found for organisation' });
    const packageId = optionalRef(req.body?.packageId);
    await checkHotspotPackage(req.organizationId, packageId);
    const doc = await TicketType.create({
      organizationId: req.organizationId,
      siteId,
      label,
      durationDays: Math.round(durationDays),
      priceCents: Math.round(priceCents),
      active: req.body?.active !== false,
      packageId: packageId || null,
    });
    res.status(201).json(doc.toObject());
  })
);

ticketSalesRouter.patch(
  '/types/:id',
  requireRoles('super_admin', 'org_admin'),
  asyncHandler(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ error: 'Invalid id' });
    }
    const doc = await TicketType.findOne({ _id: req.params.id, organizationId: req.organizationId });
    if (!doc) return res.status(404).json({ error: 'Ticket type not found' });
    if (req.body?.label != null) {
      const label = String(req.body.label).trim();
      if (!label) return res.status(400).json({ error: 'label cannot be empty' });
      doc.label = label;
    }
    if (req.body?.durationDays != null) {
      const n = Number(req.body.durationDays);
      if (!Number.isFinite(n) || n < 1) return res.status(400).json({ error: 'durationDays must be >= 1' });
      doc.durationDays = Math.round(n);
    }
    if (req.body?.priceCents != null) {
      const n = Number(req.body.priceCents);
      if (!Number.isFinite(n) || n < 0) return res.status(400).json({ error: 'priceCents must be >= 0' });
      doc.priceCents = Math.round(n);
    }
    if (req.body?.active != null) {
      doc.active = Boolean(req.body.active);
    }
    const packageId = optionalRef(req.body?.packageId);
    if (packageId !== undefined) {
      await checkHotspotPackage(req.organizationId, packageId);
      doc.packageId = packageId;
    }
    await doc.save();
    res.json(doc.toObject());
  })
);

ticketSalesRouter.get(
  '/sites/:siteId/sellers',
  asyncHandler(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.siteId)) {
      return res.status(400).json({ error: 'Invalid site id' });
    }
    const site = await TicketSite.findOne({
      _id: req.params.siteId,
      organizationId: req.organizationId,
    })
      .select('_id')
      .lean();
    if (!site) return res.status(404).json({ error: 'Site not found' });
    const rows = await TicketSiteSeller.find({
      siteId: site._id,
      organizationId: req.organizationId,
    })
      .sort({ name: 1 })
      .lean();
    res.json(rows);
  })
);

ticketSalesRouter.post(
  '/sites/:siteId/sellers',
  requireRoles('super_admin', 'org_admin', 'ticket_manager'),
  asyncHandler(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.siteId)) {
      return res.status(400).json({ error: 'Invalid site id' });
    }
    const site = await TicketSite.findOne({
      _id: req.params.siteId,
      organizationId: req.organizationId,
    })
      .select('_id')
      .lean();
    if (!site) return res.status(404).json({ error: 'Site not found' });
    const name = String(req.body?.name || '').trim();
    if (!name) return res.status(400).json({ error: 'name is required' });
    const phone = String(req.body?.phone || '').trim();
    const notes = String(req.body?.notes || '').trim();
    try {
      const doc = await TicketSiteSeller.create({
        organizationId: req.organizationId,
        siteId: site._id,
        name,
        ...(phone ? { phone } : {}),
        ...(notes ? { notes } : {}),
        active: req.body?.active !== false,
      });
      res.status(201).json(doc.toObject());
    } catch (e) {
      if (e?.code === 11000) {
        return res.status(400).json({ error: 'A seller with this name already exists at this site' });
      }
      throw e;
    }
  })
);

ticketSalesRouter.patch(
  '/sites/:siteId/sellers/:sellerId',
  requireRoles('super_admin', 'org_admin', 'ticket_manager'),
  asyncHandler(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.siteId) || !mongoose.isValidObjectId(req.params.sellerId)) {
      return res.status(400).json({ error: 'Invalid id' });
    }
    const doc = await TicketSiteSeller.findOne({
      _id: req.params.sellerId,
      siteId: req.params.siteId,
      organizationId: req.organizationId,
    });
    if (!doc) return res.status(404).json({ error: 'Seller not found' });
    if (req.body?.name != null) {
      const n = String(req.body.name).trim();
      if (!n) return res.status(400).json({ error: 'name cannot be empty' });
      doc.name = n;
    }
    if (req.body?.phone !== undefined) doc.phone = String(req.body.phone || '').trim();
    if (req.body?.notes !== undefined) doc.notes = String(req.body.notes || '').trim();
    if (req.body?.active != null) doc.active = Boolean(req.body.active);
    try {
      await doc.save();
    } catch (e) {
      if (e?.code === 11000) {
        return res.status(400).json({ error: 'A seller with this name already exists at this site' });
      }
      throw e;
    }
    res.json(doc.toObject());
  })
);

ticketSalesRouter.delete(
  '/sites/:siteId/sellers/:sellerId',
  requireRoles('super_admin', 'org_admin', 'ticket_manager'),
  asyncHandler(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.siteId) || !mongoose.isValidObjectId(req.params.sellerId)) {
      return res.status(400).json({ error: 'Invalid id' });
    }
    const r = await TicketSiteSeller.findOneAndDelete({
      _id: req.params.sellerId,
      siteId: req.params.siteId,
      organizationId: req.organizationId,
    });
    if (!r) return res.status(404).json({ error: 'Seller not found' });
    res.status(204).end();
  })
);

ticketSalesRouter.get(
  '/sellers',
  requireRoles('super_admin', 'org_admin'),
  asyncHandler(async (req, res) => {
    const rows = await Admin.find({
      organizationId: req.organizationId,
      role: 'ticket_manager',
    })
      .select('_id email phone fullName role createdAt updatedAt')
      .sort({ email: 1 })
      .lean();
    res.json(rows);
  })
);

ticketSalesRouter.get(
  '/seller-names',
  asyncHandler(async (req, res) => {
    const q = { ...orgQuery(req.organizationId) };
    if (req.query.siteId && mongoose.isValidObjectId(String(req.query.siteId))) {
      q.siteId = String(req.query.siteId);
    }
    const seen = new Set();
    const names = [];
    if (req.query.siteId && mongoose.isValidObjectId(String(req.query.siteId))) {
      const sellers = await TicketSiteSeller.find({
        organizationId: req.organizationId,
        siteId: String(req.query.siteId),
        active: true,
      })
        .select('name')
        .sort({ name: 1 })
        .lean();
      for (const s of sellers) {
        const n = String(s?.name || '').trim();
        const k = n.toLowerCase();
        if (!n || seen.has(k)) continue;
        seen.add(k);
        names.push(n);
      }
    }
    const rows = await TicketSale.find(q)
      .select('sellerName')
      .sort({ soldAt: -1, createdAt: -1 })
      .limit(500)
      .lean();
    for (const r of rows) {
      const n = String(r?.sellerName || '').trim();
      const k = n.toLowerCase();
      if (!n || seen.has(k)) continue;
      seen.add(k);
      names.push(n);
    }
    res.json(names);
  })
);

/** Routers and hotspot plans a site / ticket type can be linked to. */
ticketSalesRouter.get(
  '/link-options',
  asyncHandler(async (req, res) => {
    const [routers, packages] = await Promise.all([
      Router.find({ organizationId: req.organizationId }).select('name comment').sort({ name: 1 }).lean(),
      PlanPackage.find({ organizationId: req.organizationId, kind: 'hotspot' })
        .select('name priceCents currency isActive elapsedSeconds pausedSeconds')
        .sort({ priceCents: 1, name: 1 })
        .lean(),
    ]);
    res.json({ routers, packages });
  })
);

/** Unused, unissued hotspot codes available for a ticket type (count-only types: linked=false). */
ticketSalesRouter.get(
  '/types/:id/stock',
  asyncHandler(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
    res.json(await stockForType(req.organizationId, req.params.id));
  })
);

ticketSalesRouter.post(
  '/sales',
  asyncHandler(async (req, res) => {
    const note = String(req.body?.note || '').trim();
    const { issue, codes } = await issueTickets({
      organizationId: req.organizationId,
      admin: req.admin,
      ticketTypeId: String(req.body?.ticketTypeId || '').trim(),
      quantity: req.body?.quantity,
      batchId: req.body?.batchId,
      seller: {
        ticketSiteSellerId: String(req.body?.ticketSiteSellerId || '').trim(),
        sellerName: req.body?.sellerName,
        sellerPhone: req.body?.sellerPhone,
      },
      note,
    });
    notifyTicketTransactionUpdate({
      organizationId: req.organizationId,
      actorAdminId: req.admin.id,
      eventKind: 'issued',
      saleId: issue._id,
    });
    void logOrgAudit({
      organizationId: req.organizationId,
      actorEmail: req.admin?.email,
      action: 'ticket.issue',
      meta: {
        saleId: String(issue._id),
        quantity: issue.quantity,
        amountCents: issue.amountCents,
        sellerName: issue.sellerName,
        linked: issue.linked,
      },
    });
    res.status(201).json({ ...issue, codes });
  })
);

/** One issue with its balance and (linked) codes, for reprinting. */
ticketSalesRouter.get(
  '/issues/:id([0-9a-fA-F]{24})',
  asyncHandler(async (req, res) => {
    const [row] = await issuesWithBalances(req.organizationId, {
      _id: new mongoose.Types.ObjectId(req.params.id),
    });
    if (!row) return res.status(404).json({ error: 'Issue not found' });
    const codes = row.linked
      ? await HotspotVoucher.find({ issueSaleId: row._id, organizationId: req.organizationId })
          .sort({ code: 1 })
          .populate('packageId', 'name priceCents currency')
          .populate('routerId', 'name comment')
          .lean()
      : [];
    res.json({ ...row, sellerKey: sellerKeyOf(row), codes });
  })
);

ticketSalesRouter.post(
  '/collections',
  asyncHandler(async (req, res) => {
    const note = String(req.body?.note || '').trim();
    const receivedFromName = String(req.body?.receivedFromName || '').trim();
    const receivedFromPhone = String(req.body?.receivedFromPhone || '').trim();
    const amountCents = Math.round(Number(req.body?.amountCents) || 0);
    let sellerKey = String(req.body?.sellerKey || '').trim();
    const issueSaleId = String(req.body?.issueSaleId || '').trim();

    let result;
    if (!sellerKey && mongoose.isValidObjectId(issueSaleId)) {
      const [row] = await issuesWithBalances(req.organizationId, {
        _id: new mongoose.Types.ObjectId(issueSaleId),
      });
      if (!row) return res.status(404).json({ error: 'Issue not found' });
      if (amountCents <= 0) return res.status(400).json({ error: 'Enter the amount received' });
      if (amountCents > row.maxCollectCents) {
        return res.status(400).json({
          error: `This issue can take at most GHS ${(row.maxCollectCents / 100).toFixed(2)} right now.`,
        });
      }
      const price = Number(row.unitPriceCents || 0);
      const doc = await TicketSale.create({
        organizationId: req.organizationId,
        siteId: row.siteId?._id || row.siteId,
        ...(row.ticketTypeId ? { ticketTypeId: row.ticketTypeId._id || row.ticketTypeId } : {}),
        kind: 'collected',
        sellerName: row.sellerName,
        ...(row.ticketSiteSellerId ? { ticketSiteSellerId: row.ticketSiteSellerId } : {}),
        sellerAdminId: req.admin.id,
        issueSaleId: row._id,
        quantity: price > 0 ? Math.max(1, Math.round(amountCents / price)) : 1,
        amountCents,
        ...(receivedFromName ? { receivedFromName } : {}),
        ...(receivedFromPhone ? { receivedFromPhone } : {}),
        ...(note ? { note } : {}),
      });
      result = { collectionGroupId: '', entries: [doc.toObject()], allocatedTo: 1 };
      sellerKey = sellerKeyOf(row);
    } else {
      if (!sellerKey) return res.status(400).json({ error: 'Choose a seller' });
      result = await collectFromSeller({
        organizationId: req.organizationId,
        admin: req.admin,
        sellerKey,
        amountCents,
        receivedFromName,
        receivedFromPhone,
        note,
      });
    }

    if (result.entries[0]) {
      notifyTicketTransactionUpdate({
        organizationId: req.organizationId,
        actorAdminId: req.admin.id,
        eventKind: 'collected',
        saleId: result.entries[0]._id,
      });
    }
    void logOrgAudit({
      organizationId: req.organizationId,
      actorEmail: req.admin?.email,
      action: 'ticket.collect',
      meta: {
        sellerKey,
        amountCents,
        entries: result.entries.map((e) => String(e._id)),
      },
    });
    res.status(201).json(result);
  })
);

ticketSalesRouter.post(
  '/returns',
  asyncHandler(async (req, res) => {
    const issueSaleId = String(req.body?.issueSaleId || '').trim();
    if (!mongoose.isValidObjectId(issueSaleId)) return res.status(400).json({ error: 'Choose the issue' });
    const doc = await returnTickets({
      organizationId: req.organizationId,
      admin: req.admin,
      issueSaleId,
      quantity: req.body?.quantity,
      note: String(req.body?.note || '').trim(),
    });
    notifyTicketTransactionUpdate({
      organizationId: req.organizationId,
      actorAdminId: req.admin.id,
      eventKind: 'returned',
      saleId: doc._id,
    });
    void logOrgAudit({
      organizationId: req.organizationId,
      actorEmail: req.admin?.email,
      action: 'ticket.return',
      meta: { saleId: String(doc._id), issueSaleId, quantity: doc.quantity },
    });
    res.status(201).json(doc);
  })
);

ticketSalesRouter.post(
  '/sales/:id/void',
  requireRoles('super_admin', 'org_admin'),
  asyncHandler(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
    const doc = await voidEntry({
      organizationId: req.organizationId,
      admin: req.admin,
      saleId: req.params.id,
      reason: req.body?.reason,
    });
    void logOrgAudit({
      organizationId: req.organizationId,
      actorEmail: req.admin?.email,
      action: 'ticket.void',
      meta: { saleId: String(doc._id), kind: doc.kind, amountCents: doc.amountCents, reason: doc.voidReason },
    });
    res.json(doc);
  })
);

/** Per-seller position: owed, paid ahead, tickets held, days owing. */
ticketSalesRouter.get(
  '/seller-balances',
  asyncHandler(async (req, res) => {
    res.json(await sellerBalances(req.organizationId, { siteId: req.query.siteId }));
  })
);

/** One seller's issues (oldest first) with balances. */
ticketSalesRouter.get(
  '/seller-balances/:key/issues',
  asyncHandler(async (req, res) => {
    res.json(await issuesWithBalances(req.organizationId, sellerQueryFromKey(req.organizationId, req.params.key)));
  })
);

ticketSalesRouter.get(
  '/issues/open',
  asyncHandler(async (req, res) => {
    const q = {};
    if (req.query.siteId && mongoose.isValidObjectId(String(req.query.siteId))) {
      q.siteId = new mongoose.Types.ObjectId(String(req.query.siteId));
    }
    if (req.query.ticketTypeId && mongoose.isValidObjectId(String(req.query.ticketTypeId))) {
      q.ticketTypeId = new mongoose.Types.ObjectId(String(req.query.ticketTypeId));
    }
    if (req.query.sellerName) {
      q.sellerName = new RegExp(`^${escapeRegex(String(req.query.sellerName).trim())}$`, 'i');
    }
    const rows = await issuesWithBalances(req.organizationId, q, { openOnly: true });
    res.json(
      rows
        .reverse()
        .slice(0, 300)
        .map((r) => ({
          ...r,
          sellerKey: sellerKeyOf(r),
          expectedCents: r.owedCents,
          remainingCents: Math.max(0, r.balanceCents),
        }))
    );
  })
);

function rangeFromQuery(req) {
  const now = new Date();
  const from = req.query.from ? new Date(String(req.query.from)) : new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const to = req.query.to ? new Date(String(req.query.to)) : now;
  return {
    from: Number.isNaN(from.getTime()) ? new Date(now.getFullYear(), now.getMonth(), now.getDate()) : from,
    to: Number.isNaN(to.getTime()) ? now : to,
  };
}

ticketSalesRouter.get(
  '/sales',
  asyncHandler(async (req, res) => {
    const limit = Math.min(2000, Math.max(1, Number(req.query.limit) || 100));
    const q = { ...orgQuery(req.organizationId) };
    if (req.admin.role === 'ticket_manager') {
      q.sellerAdminId = req.admin.id;
    } else if (req.query.sellerAdminId && mongoose.isValidObjectId(String(req.query.sellerAdminId))) {
      q.sellerAdminId = String(req.query.sellerAdminId);
    }
    if (req.query.siteId && mongoose.isValidObjectId(String(req.query.siteId))) {
      q.siteId = String(req.query.siteId);
    }
    if (req.query.kind && ['issued', 'collected', 'returned'].includes(String(req.query.kind))) {
      q.kind = String(req.query.kind);
    }
    if (req.query.sellerName) {
      q.sellerName = new RegExp(`^${escapeRegex(String(req.query.sellerName).trim())}$`, 'i');
    }
    if (req.query.from || req.query.to) {
      const { from, to } = rangeFromQuery(req);
      q.soldAt = { $gte: from, $lte: to };
    }
    if (String(req.query.includeVoided || '') !== '1') q.voidedAt = null;
    const rows = await TicketSale.find(q)
      .sort({ soldAt: -1, createdAt: -1 })
      .limit(limit)
      .populate('ticketTypeId', 'label durationDays priceCents')
      .populate('siteId', 'name active')
      .populate('sellerAdminId', 'email role fullName')
      .populate('voidedByAdminId', 'email fullName')
      .lean();
    res.json(rows);
  })
);

/** Tickets sold and sales value per router / site / plan / seller / channel / day. */
ticketSalesRouter.get(
  '/sales-report',
  requireRoles('super_admin', 'org_admin', 'org_staff'),
  asyncHandler(async (req, res) => {
    const { from, to } = rangeFromQuery(req);
    if (to - from > 400 * 86400000) return res.status(400).json({ error: 'Pick a period of 400 days or less.' });
    const id = (v) => (v && mongoose.isValidObjectId(String(v)) ? String(v) : '');
    const tz = /^[A-Za-z_]+\/[A-Za-z_]+$/.test(String(req.query.tz || '')) ? String(req.query.tz) : 'Africa/Accra';
    res.json(
      await ticketSalesReport(req.organizationId, {
        from,
        to,
        tz,
        routerId: id(req.query.routerId),
        siteId: id(req.query.siteId),
        packageId: id(req.query.packageId),
        ticketTypeId: id(req.query.ticketTypeId),
        sellerKey: String(req.query.sellerKey || ''),
        channel: String(req.query.channel || ''),
      })
    );
  })
);

/**
 * Report: activity in a date range plus everyone's current position.
 * Owed follows the ledger rules (linked codes owe once used; count-only owe once issued).
 */
ticketSalesRouter.get(
  '/summary',
  asyncHandler(async (req, res) => {
    const orgId = new mongoose.Types.ObjectId(req.organizationId);
    const base = { organizationId: orgId, voidedAt: null };
    const issueQuery = {};
    if (req.admin.role === 'ticket_manager') {
      base.sellerAdminId = new mongoose.Types.ObjectId(req.admin.id);
      issueQuery.sellerAdminId = base.sellerAdminId;
    }
    if (req.query.siteId && mongoose.isValidObjectId(String(req.query.siteId))) {
      base.siteId = new mongoose.Types.ObjectId(String(req.query.siteId));
      issueQuery.siteId = base.siteId;
    }
    const { from, to } = rangeFromQuery(req);

    const sumBy = () => ({
      issuedQty: { $sum: { $cond: [{ $eq: ['$kind', 'issued'] }, '$quantity', 0] } },
      issuedCents: { $sum: { $cond: [{ $eq: ['$kind', 'issued'] }, '$amountCents', 0] } },
      collectedCents: { $sum: { $cond: [{ $eq: ['$kind', 'collected'] }, '$amountCents', 0] } },
      returnedQty: { $sum: { $cond: [{ $eq: ['$kind', 'returned'] }, '$quantity', 0] } },
      returnedCents: { $sum: { $cond: [{ $eq: ['$kind', 'returned'] }, '$amountCents', 0] } },
      transactionCount: { $sum: 1 },
    });

    const [rangeTotals, rangeBySite, issues] = await Promise.all([
      TicketSale.aggregate([{ $match: { ...base, soldAt: { $gte: from, $lte: to } } }, { $group: { _id: null, ...sumBy() } }]),
      TicketSale.aggregate([
        { $match: { ...base, soldAt: { $gte: from, $lte: to } } },
        { $group: { _id: '$siteId', ...sumBy() } },
      ]),
      issuesWithBalances(req.organizationId, issueQuery),
    ]);

    const sellers = rollupSellers(issues);
    const position = sellers.reduce(
      (t, s) => {
        t.owedCents += Math.max(0, s.balanceCents);
        t.creditCents += Math.max(0, -s.balanceCents);
        t.holdingQty += s.holdingQty;
        t.usedQty += s.usedQty;
        if (s.balanceCents > 0) t.sellersOwing += 1;
        if (s.balanceCents > 0 && s.daysOwing > 7) t.overdueCents += s.balanceCents;
        return t;
      },
      { owedCents: 0, creditCents: 0, holdingQty: 0, usedQty: 0, sellersOwing: 0, overdueCents: 0 }
    );

    const siteOwed = new Map();
    for (const s of sellers) {
      const cur = siteOwed.get(s.siteId) || { owedCents: 0, holdingQty: 0 };
      cur.owedCents += Math.max(0, s.balanceCents);
      cur.holdingQty += s.holdingQty;
      siteOwed.set(s.siteId, cur);
    }

    const byType = new Map();
    for (const r of issues) {
      if (r.balanceCents <= 0 && r.holdingQty <= 0) continue;
      const key = String(r.ticketTypeId?._id || r.ticketTypeId || '');
      const cur = byType.get(key) || {
        ticketTypeId: key || null,
        ticketTypeLabel: r.ticketTypeId?.label || 'Ticket',
        priceCents: Number(r.ticketTypeId?.priceCents || 0),
        owedCents: 0,
        holdingQty: 0,
        openBatches: 0,
      };
      cur.owedCents += Math.max(0, r.balanceCents);
      cur.holdingQty += r.holdingQty;
      cur.openBatches += 1;
      byType.set(key, cur);
    }

    const siteIds = [...new Set([...rangeBySite.map((r) => String(r._id)), ...siteOwed.keys()].filter(Boolean))];
    const sites = await TicketSite.find({ _id: { $in: siteIds }, organizationId: orgId }).select('name').lean();
    const siteName = new Map(sites.map((s) => [String(s._id), s.name]));
    const rangeSite = new Map(rangeBySite.map((r) => [String(r._id), r]));
    const rr = rangeTotals[0] || {};

    res.json({
      from,
      to,
      inRange: {
        transactionCount: Number(rr.transactionCount || 0),
        issuedQty: Number(rr.issuedQty || 0),
        issuedCents: Number(rr.issuedCents || 0),
        collectedCents: Number(rr.collectedCents || 0),
        returnedQty: Number(rr.returnedQty || 0),
        returnedCents: Number(rr.returnedCents || 0),
      },
      position,
      bySite: siteIds
        .map((id) => {
          const r = rangeSite.get(id) || {};
          const o = siteOwed.get(id) || {};
          return {
            siteId: id,
            siteName: siteName.get(id) || 'Unknown site',
            issuedQty: Number(r.issuedQty || 0),
            issuedCents: Number(r.issuedCents || 0),
            collectedCents: Number(r.collectedCents || 0),
            returnedQty: Number(r.returnedQty || 0),
            owedCents: Number(o.owedCents || 0),
            holdingQty: Number(o.holdingQty || 0),
          };
        })
        .sort((a, b) => b.owedCents - a.owedCents || b.collectedCents - a.collectedCents),
      sellers,
      remainingByType: [...byType.values()].sort((a, b) => b.owedCents - a.owedCents),
    });
  })
);
