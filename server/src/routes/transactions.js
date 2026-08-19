import express from 'express';
import mongoose from 'mongoose';
import { Transaction } from '../models/index.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requireRoles } from '../middleware/requireRoles.js';
import { checkTransactionStatusWithHubtel } from '../services/paymentService.js';

export const transactionsRouter = express.Router();

function orgFilter(organizationId) {
  if (
    organizationId != null &&
    String(organizationId).trim() &&
    mongoose.isValidObjectId(String(organizationId).trim())
  ) {
    return { organizationId: new mongoose.Types.ObjectId(String(organizationId).trim()) };
  }
  return {};
}

function buildTransactionQuery(req) {
  const q = { ...orgFilter(req.organizationId) };

  const status = String(req.query.status || '').trim().toLowerCase();
  if (status && ['pending', 'paid', 'failed', 'refunded'].includes(status)) {
    q.status = status;
  }

  const kind = String(req.query.kind || '').trim().toLowerCase();
  if (kind && ['subscription', 'voucher', 'renewal', 'topup'].includes(kind)) {
    q.kind = kind;
  }

  const provider = String(req.query.provider || '').trim().toLowerCase();
  if (provider) q.provider = provider;

  const from = req.query.from ? new Date(String(req.query.from)) : null;
  const to = req.query.to ? new Date(String(req.query.to)) : null;
  if ((from && !Number.isNaN(from.getTime())) || (to && !Number.isNaN(to.getTime()))) {
    q.createdAt = {};
    if (from && !Number.isNaN(from.getTime())) q.createdAt.$gte = from;
    if (to && !Number.isNaN(to.getTime())) {
      const end = new Date(to);
      if (String(req.query.to).length <= 10) end.setHours(23, 59, 59, 999);
      q.createdAt.$lte = end;
    }
  }

  const search = String(req.query.q || '').trim();
  if (search) {
    const rx = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    q.$or = [
      { clientReference: rx },
      { providerReference: rx },
      { customerPhone: rx },
      { customerName: rx },
    ];
  }
  return q;
}

function mapTransactionRow(t) {
  return {
    id: String(t._id),
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    status: t.status,
    kind: t.kind,
    provider: t.provider || 'hubtel',
    amountCents: t.amountCents,
    currency: t.currency || 'GHS',
    clientReference: t.clientReference || '',
    providerReference: t.providerReference || '',
    customerPhone: t.customerPhone || '',
    customerName: t.customerName || (t.userId && t.userId.fullName) || '',
    packageName: (t.packageId && t.packageId.name) || '',
    packageKind: (t.packageId && t.packageId.kind) || '',
    fulfillment: t.meta?.fulfillment || null,
    voucherCode: t.meta?.voucherCode || null,
    renewedUntil: t.meta?.renewedUntil || null,
    feeBps: t.feeBps ?? t.meta?.feeBps ?? null,
    platformFeeCents: t.platformFeeCents ?? t.meta?.platformFeeCents ?? null,
    orgNetCents: t.orgNetCents ?? t.meta?.orgNetCents ?? null,
    lastHubtelStatus: t.meta?.statusCheckResult?.hubtelStatus || null,
    lastHubtelStatusAt: t.meta?.statusCheckAt || null,
  };
}

function csvCell(s) {
  const t = String(s ?? '').replace(/"/g, '""');
  if (/[",\r\n]/.test(t)) return `"${t}"`;
  return t;
}

function formatTransactionsCsv(rows) {
  const header = [
    'createdAt',
    'status',
    'kind',
    'amountGhs',
    'currency',
    'customerPhone',
    'customerName',
    'packageName',
    'clientReference',
    'providerReference',
    'feeBps',
    'platformFeeGhs',
    'orgNetGhs',
  ];
  const lines = [header.join(',')];
  for (const r of rows) {
    lines.push(
      [
        r.createdAt ? new Date(r.createdAt).toISOString() : '',
        csvCell(r.status),
        csvCell(r.kind),
        ((Number(r.amountCents) || 0) / 100).toFixed(2),
        csvCell(r.currency),
        csvCell(r.customerPhone),
        csvCell(r.customerName),
        csvCell(r.packageName),
        csvCell(r.clientReference),
        csvCell(r.providerReference),
        r.feeBps != null ? String(r.feeBps) : '',
        r.platformFeeCents != null ? ((Number(r.platformFeeCents) || 0) / 100).toFixed(2) : '',
        r.orgNetCents != null ? ((Number(r.orgNetCents) || 0) / 100).toFixed(2) : '',
      ].join(',')
    );
  }
  return lines.join('\n');
}

/**
 * POST /api/transactions/hubtel-status-check
 * Body: { clientReference, apply?: boolean }
 * Calls Hubtel Transaction Status Check; when apply≠false and Hubtel says Paid, fulfills locally.
 */
transactionsRouter.post(
  '/hubtel-status-check',
  requireRoles('super_admin', 'org_admin', 'org_staff', 'ticket_manager'),
  asyncHandler(async (req, res) => {
    const clientReference = String(req.body?.clientReference || '').trim();
    if (!clientReference) {
      return res.status(400).json({ error: 'clientReference required' });
    }

    const tx = await Transaction.findOne({ clientReference }).select('organizationId').lean();
    if (!tx) return res.status(404).json({ error: 'Transaction not found' });

    const orgId = req.organizationId != null ? String(req.organizationId) : '';
    if (
      orgId &&
      mongoose.isValidObjectId(orgId) &&
      tx.organizationId &&
      String(tx.organizationId) !== orgId &&
      req.user?.role !== 'super_admin'
    ) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    const apply = req.body?.apply !== false && req.body?.apply !== 'false';
    /** Admin check: Unpaid (cancelled/abandoned) → mark failed so it does not stay “pending”. */
    const applyUnpaidAsFailed =
      req.body?.applyUnpaidAsFailed !== false && req.body?.applyUnpaidAsFailed !== 'false';
    const result = await checkTransactionStatusWithHubtel(clientReference, {
      apply,
      applyUnpaidAsFailed,
    });
    const status =
      result.reason === 'not_found'
        ? 404
        : result.reason === 'hubtel_not_configured'
          ? 503
          : 200;
    res.status(status).json(result);
  })
);

/**
 * GET /api/transactions
 * Query: status, kind, provider, q, from, to, page, limit, format=csv
 */
transactionsRouter.get(
  '/',
  requireRoles('super_admin', 'org_admin', 'org_staff', 'ticket_manager'),
  asyncHandler(async (req, res) => {
    const q = buildTransactionQuery(req);
    const wantsCsv = String(req.query.format || '').toLowerCase() === 'csv';

    if (wantsCsv) {
      const limit = Math.min(5000, Math.max(1, Number(req.query.limit) || 2000));
      const items = await Transaction.find(q)
        .sort({ createdAt: -1 })
        .limit(limit)
        .populate('packageId', 'name kind')
        .populate('userId', 'fullName phone email')
        .select('-meta.callback -meta.hubtelConfig')
        .lean();
      const rows = items.map(mapTransactionRow);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        'attachment; filename="payments-export.csv"'
      );
      res.send('\ufeff' + formatTransactionsCsv(rows));
      return;
    }

    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
    const skip = (page - 1) * limit;

    const [total, items, paidAgg, statusAgg] = await Promise.all([
      Transaction.countDocuments(q),
      Transaction.find(q)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('packageId', 'name kind')
        .populate('userId', 'fullName phone email')
        .select('-meta.callback -meta.hubtelConfig')
        .lean(),
      Transaction.aggregate([
        { $match: { ...q, status: 'paid' } },
        { $group: { _id: null, cents: { $sum: '$amountCents' }, count: { $sum: 1 } } },
      ]),
      Transaction.aggregate([
        { $match: orgFilter(req.organizationId) },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
    ]);

    const statusCounts = { pending: 0, paid: 0, failed: 0, refunded: 0 };
    for (const row of statusAgg) {
      if (row._id && statusCounts[row._id] != null) statusCounts[row._id] = row.count;
    }

    res.json({
      page,
      limit,
      total,
      pages: Math.max(1, Math.ceil(total / limit)),
      paidInFilter: {
        count: paidAgg[0]?.count || 0,
        amountCents: paidAgg[0]?.cents || 0,
      },
      statusCounts,
      items: items.map(mapTransactionRow),
    });
  })
);
