import express from 'express';
import mongoose from 'mongoose';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requireRoles } from '../middleware/requireRoles.js';
import { Admin, TicketSale, TicketSite, TicketSiteSeller, TicketType } from '../models/index.js';
import { notifyTicketTransactionUpdate } from '../services/ticketNotificationService.js';

export const ticketSalesRouter = express.Router();

function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

ticketSalesRouter.use(requireRoles('super_admin', 'org_admin', 'ticket_manager', 'org_staff'));

ticketSalesRouter.get(
  '/sites',
  asyncHandler(async (req, res) => {
    const rows = await TicketSite.find({ organizationId: req.organizationId }).sort({ name: 1 }).lean();
    res.json(rows);
  })
);

ticketSalesRouter.post(
  '/sites',
  requireRoles('super_admin', 'org_admin'),
  asyncHandler(async (req, res) => {
    const name = String(req.body?.name || '').trim();
    if (!name) return res.status(400).json({ error: 'name is required' });
    try {
      const doc = await TicketSite.create({
        organizationId: req.organizationId,
        name,
        active: req.body?.active !== false,
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
    const q = { organizationId: req.organizationId };
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
    const doc = await TicketType.create({
      organizationId: req.organizationId,
      siteId,
      label,
      durationDays: Math.round(durationDays),
      priceCents: Math.round(priceCents),
      active: req.body?.active !== false,
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
    const q = { organizationId: req.organizationId };
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

ticketSalesRouter.post(
  '/sales',
  asyncHandler(async (req, res) => {
    const ticketTypeId = String(req.body?.ticketTypeId || '').trim();
    const quantity = Number(req.body?.quantity || 1);
    const ticketSiteSellerIdRaw = String(req.body?.ticketSiteSellerId || '').trim();
    let sellerName = String(req.body?.sellerName || '').trim();
    let sellerPhone = String(req.body?.sellerPhone || '').trim();
    const note = String(req.body?.note || '').trim();
    if (!mongoose.isValidObjectId(ticketTypeId)) {
      return res.status(400).json({ error: 'ticketTypeId is required' });
    }
    if (!Number.isFinite(quantity) || quantity < 1) {
      return res.status(400).json({ error: 'quantity must be >= 1' });
    }
    const tt = await TicketType.findOne({
      _id: ticketTypeId,
      organizationId: req.organizationId,
      active: true,
    })
      .select('_id siteId priceCents')
      .lean();
    if (!tt) return res.status(404).json({ error: 'Active ticket type not found' });

    let ticketSiteSellerId = null;
    if (mongoose.isValidObjectId(ticketSiteSellerIdRaw)) {
      const ts = await TicketSiteSeller.findOne({
        _id: ticketSiteSellerIdRaw,
        organizationId: req.organizationId,
        siteId: tt.siteId,
        active: true,
      }).lean();
      if (!ts) {
        return res.status(400).json({ error: 'ticketSiteSellerId not found for this ticket site' });
      }
      ticketSiteSellerId = ts._id;
      sellerName = String(ts.name || '').trim();
      if (!sellerPhone) sellerPhone = String(ts.phone || '').trim();
    }
    if (!sellerName) {
      return res.status(400).json({ error: 'sellerName or ticketSiteSellerId is required' });
    }

    const amountCents = Math.round(Number(tt.priceCents || 0) * Math.round(quantity));
    const doc = await TicketSale.create({
      organizationId: req.organizationId,
      siteId: tt.siteId,
      ticketTypeId: tt._id,
      kind: 'issued',
      sellerName,
      sellerAdminId: req.admin.id,
      quantity: Math.round(quantity),
      amountCents,
      ...(ticketSiteSellerId ? { ticketSiteSellerId } : {}),
      ...(sellerPhone ? { sellerPhone } : {}),
      ...(note ? { note } : {}),
    });
    notifyTicketTransactionUpdate({
      organizationId: req.organizationId,
      actorAdminId: req.admin.id,
      eventKind: 'issued',
      saleId: doc._id,
    });
    res.status(201).json(doc.toObject());
  })
);

ticketSalesRouter.post(
  '/collections',
  asyncHandler(async (req, res) => {
    const issueSaleId = String(req.body?.issueSaleId || '').trim();
    const amountCents = Number(req.body?.amountCents);
    const note = String(req.body?.note || '').trim();
    const receivedFromName = String(req.body?.receivedFromName || '').trim();
    const receivedFromPhone = String(req.body?.receivedFromPhone || '').trim();
    if (!mongoose.isValidObjectId(issueSaleId)) {
      return res.status(400).json({ error: 'issueSaleId is required' });
    }
    if (!Number.isFinite(amountCents) || amountCents < 0) {
      return res.status(400).json({ error: 'amountCents must be >= 0' });
    }
    const issue = await TicketSale.findOne({
      _id: issueSaleId,
      organizationId: req.organizationId,
      kind: 'issued',
    })
      .select('siteId sellerName sellerPhone ticketSiteSellerId amountCents ticketTypeId')
      .lean();
    if (!issue) return res.status(404).json({ error: 'Issued batch not found' });
    const agg = await TicketSale.aggregate([
      {
        $match: {
          organizationId: new mongoose.Types.ObjectId(req.organizationId),
          kind: 'collected',
          issueSaleId: new mongoose.Types.ObjectId(issueSaleId),
        },
      },
      { $group: { _id: null, total: { $sum: '$amountCents' } } },
    ]);
    const already = Number(agg?.[0]?.total || 0);
    const remaining = Math.max(0, Number(issue.amountCents || 0) - already);
    const add = Math.round(amountCents);
    if (add <= 0) return res.status(400).json({ error: 'amountCents must be > 0' });
    if (add > remaining) {
      return res.status(400).json({
        error: `Collection exceeds remaining balance (${remaining} cents left on this issued batch)`,
      });
    }
    let collectedQty = 1;
    if (issue.ticketTypeId) {
      const tt = await TicketType.findOne({
        _id: issue.ticketTypeId,
        organizationId: req.organizationId,
      })
        .select('priceCents')
        .lean();
      const unitPrice = Number(tt?.priceCents || 0);
      if (unitPrice > 0) {
        collectedQty = Number((add / unitPrice).toFixed(2));
      }
    }
    const doc = await TicketSale.create({
      organizationId: req.organizationId,
      siteId: issue.siteId,
      ...(issue.ticketTypeId ? { ticketTypeId: issue.ticketTypeId } : {}),
      kind: 'collected',
      sellerName: issue.sellerName,
      issueSaleId: issue._id,
      ...(issue.ticketSiteSellerId ? { ticketSiteSellerId: issue.ticketSiteSellerId } : {}),
      sellerAdminId: req.admin.id,
      quantity: collectedQty,
      amountCents: add,
      ...(receivedFromName ? { receivedFromName } : {}),
      ...(receivedFromPhone ? { receivedFromPhone } : {}),
      ...(note ? { note } : {}),
    });
    notifyTicketTransactionUpdate({
      organizationId: req.organizationId,
      actorAdminId: req.admin.id,
      eventKind: 'collected',
      saleId: doc._id,
    });
    res.status(201).json(doc.toObject());
  })
);

ticketSalesRouter.get(
  '/issues/open',
  asyncHandler(async (req, res) => {
    const matchIssued = { organizationId: req.organizationId, kind: 'issued' };
    if (req.query.siteId && mongoose.isValidObjectId(String(req.query.siteId))) {
      matchIssued.siteId = String(req.query.siteId);
    }
    if (req.query.ticketTypeId && mongoose.isValidObjectId(String(req.query.ticketTypeId))) {
      matchIssued.ticketTypeId = String(req.query.ticketTypeId);
    }
    if (req.query.sellerName) {
      matchIssued.sellerName = new RegExp(`^${escapeRegex(String(req.query.sellerName).trim())}$`, 'i');
    }
    const issued = await TicketSale.find(matchIssued)
      .sort({ soldAt: -1, createdAt: -1 })
      .limit(300)
      .populate('siteId', 'name')
      .populate('ticketTypeId', 'label priceCents')
      .lean();
    const ids = issued.map((r) => r._id).filter(Boolean);
    const sums = await TicketSale.aggregate([
      {
        $match: {
          organizationId: new mongoose.Types.ObjectId(req.organizationId),
          kind: 'collected',
          issueSaleId: { $in: ids.map((id) => new mongoose.Types.ObjectId(String(id))) },
        },
      },
      { $group: { _id: '$issueSaleId', total: { $sum: '$amountCents' } } },
    ]);
    const m = new Map(sums.map((s) => [String(s._id), Number(s.total || 0)]));
    const rows = issued.map((r) => {
      const collectedCents = m.get(String(r._id)) || 0;
      const expectedCents = Number(r.amountCents || 0);
      const remainingCents = Math.max(0, expectedCents - collectedCents);
      return {
        ...r,
        expectedCents,
        collectedCents,
        remainingCents,
      };
    });
    res.json(rows.filter((r) => r.remainingCents > 0));
  })
);

ticketSalesRouter.get(
  '/sales',
  asyncHandler(async (req, res) => {
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));
    const q = { organizationId: req.organizationId };
    if (req.admin.role === 'ticket_manager') {
      q.sellerAdminId = req.admin.id;
    } else if (req.query.sellerAdminId && mongoose.isValidObjectId(String(req.query.sellerAdminId))) {
      q.sellerAdminId = String(req.query.sellerAdminId);
    }
    if (req.query.siteId && mongoose.isValidObjectId(String(req.query.siteId))) {
      q.siteId = String(req.query.siteId);
    }
    if (req.query.kind && ['issued', 'collected'].includes(String(req.query.kind))) {
      q.kind = String(req.query.kind);
    }
    if (req.query.sellerName) {
      q.sellerName = new RegExp(`^${escapeRegex(String(req.query.sellerName).trim())}$`, 'i');
    }
    const rows = await TicketSale.find(q)
      .sort({ soldAt: -1, createdAt: -1 })
      .limit(limit)
      .populate('ticketTypeId', 'label durationDays priceCents')
      .populate('siteId', 'name active')
      .populate('sellerAdminId', 'email role fullName')
      .lean();
    res.json(rows);
  })
);

ticketSalesRouter.get(
  '/summary',
  asyncHandler(async (req, res) => {
    const orgId = new mongoose.Types.ObjectId(req.organizationId);
    const q = { organizationId: orgId };
    if (req.admin.role === 'ticket_manager') q.sellerAdminId = new mongoose.Types.ObjectId(req.admin.id);
    if (req.query.siteId && mongoose.isValidObjectId(String(req.query.siteId))) {
      q.siteId = new mongoose.Types.ObjectId(String(req.query.siteId));
    }
    const now = new Date();
    const from = req.query.from ? new Date(String(req.query.from)) : new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const to = req.query.to ? new Date(String(req.query.to)) : now;
    const match = {
      ...q,
      soldAt: { $gte: from, $lte: to },
    };
    const overallTotals = await TicketSale.aggregate([
      { $match: q },
      {
        $group: {
          _id: null,
          issuedQty: { $sum: { $cond: [{ $eq: ['$kind', 'issued'] }, '$quantity', 0] } },
          issuedCents: { $sum: { $cond: [{ $eq: ['$kind', 'issued'] }, '$amountCents', 0] } },
          collectedCents: { $sum: { $cond: [{ $eq: ['$kind', 'collected'] }, '$amountCents', 0] } },
          transactionCount: { $sum: 1 },
        },
      },
    ]);
    const rangeTotals = await TicketSale.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          issuedQty: { $sum: { $cond: [{ $eq: ['$kind', 'issued'] }, '$quantity', 0] } },
          issuedCents: { $sum: { $cond: [{ $eq: ['$kind', 'issued'] }, '$amountCents', 0] } },
          collectedCents: { $sum: { $cond: [{ $eq: ['$kind', 'collected'] }, '$amountCents', 0] } },
          transactionCount: { $sum: 1 },
        },
      },
    ]);
    const outstanding = await TicketSale.aggregate([
      { $match: { ...q, kind: 'issued' } },
      {
        $lookup: {
          from: 'ticketsales',
          let: { issueId: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: { $eq: ['$issueSaleId', '$$issueId'] },
                kind: 'collected',
                organizationId: new mongoose.Types.ObjectId(req.organizationId),
              },
            },
            { $group: { _id: null, total: { $sum: '$amountCents' } } },
          ],
          as: 'c',
        },
      },
      {
        $addFields: {
          collectedCents: { $ifNull: [{ $first: '$c.total' }, 0] },
        },
      },
      {
        $addFields: {
          remainingCents: { $max: [0, { $subtract: ['$amountCents', '$collectedCents'] }] },
        },
      },
      { $match: { remainingCents: { $gt: 0 } } },
      {
        $group: {
          _id: null,
          remainingOpenBatches: { $sum: 1 },
          remainingOpenQty: { $sum: '$quantity' },
          remainingOpenCents: { $sum: '$remainingCents' },
        },
      },
    ]);
    const remainingByType = await TicketSale.aggregate([
      { $match: { ...q, kind: 'issued' } },
      {
        $lookup: {
          from: 'ticketsales',
          let: { issueId: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: { $eq: ['$issueSaleId', '$$issueId'] },
                kind: 'collected',
                organizationId: orgId,
              },
            },
            { $group: { _id: null, total: { $sum: '$amountCents' } } },
          ],
          as: 'c',
        },
      },
      {
        $addFields: {
          collectedCents: { $ifNull: [{ $first: '$c.total' }, 0] },
          remainingCents: {
            $max: [0, { $subtract: ['$amountCents', { $ifNull: [{ $first: '$c.total' }, 0] }] }],
          },
        },
      },
      { $match: { remainingCents: { $gt: 0 } } },
      {
        $group: {
          _id: '$ticketTypeId',
          remainingQty: { $sum: '$quantity' },
          remainingCents: { $sum: '$remainingCents' },
          openBatches: { $sum: 1 },
        },
      },
      { $sort: { remainingCents: -1 } },
    ]);
    const bySite = await TicketSale.aggregate([
      { $match: match },
      {
        $group: {
          _id: '$siteId',
          issuedQty: {
            $sum: {
              $cond: [{ $eq: ['$kind', 'issued'] }, '$quantity', 0],
            },
          },
          issuedCents: {
            $sum: {
              $cond: [{ $eq: ['$kind', 'issued'] }, '$amountCents', 0],
            },
          },
          collectedCents: {
            $sum: {
              $cond: [{ $eq: ['$kind', 'collected'] }, '$amountCents', 0],
            },
          },
        },
      },
      { $addFields: { varianceCents: { $subtract: ['$issuedCents', '$collectedCents'] } } },
      { $sort: { amountCents: -1 } },
    ]);
    const bySeller = await TicketSale.aggregate([
      { $match: match },
      {
        $group: {
          _id: { sellerName: '$sellerName', siteId: '$siteId' },
          issuedQty: {
            $sum: {
              $cond: [{ $eq: ['$kind', 'issued'] }, '$quantity', 0],
            },
          },
          issuedCents: {
            $sum: {
              $cond: [{ $eq: ['$kind', 'issued'] }, '$amountCents', 0],
            },
          },
          collectedCents: {
            $sum: {
              $cond: [{ $eq: ['$kind', 'collected'] }, '$amountCents', 0],
            },
          },
        },
      },
      { $addFields: { varianceCents: { $subtract: ['$issuedCents', '$collectedCents'] } } },
      { $sort: { issuedCents: -1 } },
    ]);
    const siteIds = [...new Set([...bySite.map((r) => r._id), ...bySeller.map((r) => r._id.siteId)].filter(Boolean))];
    const typeIds = remainingByType.map((r) => r._id).filter(Boolean);
    const [sites, types] = await Promise.all([
      TicketSite.find({ _id: { $in: siteIds } }).select('name').lean(),
      TicketType.find({ _id: { $in: typeIds } }).select('label durationDays priceCents').lean(),
    ]);
    const siteMap = new Map(sites.map((r) => [String(r._id), r]));
    const typeMap = new Map(types.map((r) => [String(r._id), r]));
    const all = overallTotals[0] || {};
    const rr = rangeTotals[0] || {};
    const oo = outstanding[0] || {};
    res.json({
      from,
      to,
      overview: {
        overall: {
          totalTransactions: Number(all.transactionCount || 0),
          totalIssuedQty: Number(all.issuedQty || 0),
          totalIssuedCents: Number(all.issuedCents || 0),
          totalCollectedCents: Number(all.collectedCents || 0),
          remainingOpenBatches: Number(oo.remainingOpenBatches || 0),
          remainingOpenQty: Number(oo.remainingOpenQty || 0),
          remainingCents: Number(oo.remainingOpenCents || 0),
        },
        inRange: {
          totalTransactions: Number(rr.transactionCount || 0),
          issuedQty: Number(rr.issuedQty || 0),
          issuedCents: Number(rr.issuedCents || 0),
          collectedCents: Number(rr.collectedCents || 0),
          remainingCents: Math.max(0, Number(rr.issuedCents || 0) - Number(rr.collectedCents || 0)),
        },
      },
      bySite: bySite.map((r) => ({
        siteId: r._id,
        siteName: siteMap.get(String(r._id))?.name || 'Unknown site',
        issuedQty: r.issuedQty,
        issuedCents: r.issuedCents,
        collectedCents: r.collectedCents,
        varianceCents: r.varianceCents,
      })),
      bySeller: bySeller.map((r) => ({
        sellerName: r._id.sellerName || 'Unknown seller',
        siteId: r._id.siteId,
        siteName: siteMap.get(String(r._id.siteId))?.name || 'Unknown site',
        issuedQty: r.issuedQty,
        issuedCents: r.issuedCents,
        collectedCents: r.collectedCents,
        varianceCents: r.varianceCents,
      })),
      remainingByType: remainingByType.map((r) => ({
        ticketTypeId: r._id,
        ticketTypeLabel: typeMap.get(String(r._id))?.label || 'Unknown ticket',
        durationDays: Number(typeMap.get(String(r._id))?.durationDays || 0),
        priceCents: Number(typeMap.get(String(r._id))?.priceCents || 0),
        remainingQty:
          Number(typeMap.get(String(r._id))?.priceCents || 0) > 0
            ? Number(
                (
                  Number(r.remainingCents || 0) /
                  Number(typeMap.get(String(r._id))?.priceCents || 1)
                ).toFixed(2)
              )
            : Number(r.remainingQty || 0),
        remainingCents: Number(r.remainingCents || 0),
        openBatches: Number(r.openBatches || 0),
      })),
    });
  })
);
