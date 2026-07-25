import express from 'express';
import mongoose from 'mongoose';
import { WithdrawalRequest } from '../models/index.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requireRoles } from '../middleware/requireRoles.js';
import {
  getWalletSummary,
  requestWithdrawal,
} from '../services/orgWalletService.js';

export const walletRouter = express.Router();

walletRouter.use(requireRoles('super_admin', 'org_admin', 'org_staff'));

walletRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const oid = req.organizationId;
    if (!oid || !mongoose.isValidObjectId(String(oid))) {
      return res.status(503).json({ error: 'No organisation context' });
    }
    res.json(await getWalletSummary(oid));
  })
);

walletRouter.get(
  '/withdrawals',
  asyncHandler(async (req, res) => {
    const oid = req.organizationId;
    if (!oid || !mongoose.isValidObjectId(String(oid))) {
      return res.status(503).json({ error: 'No organisation context' });
    }
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 40));
    const rows = await WithdrawalRequest.find({ organizationId: oid })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
    res.json(
      rows.map((w) => ({
        id: String(w._id),
        amountCents: w.amountCents,
        status: w.status,
        destinationNote: w.destinationNote || '',
        processNote: w.processNote || '',
        createdAt: w.createdAt,
        processedAt: w.processedAt || null,
      }))
    );
  })
);

walletRouter.post(
  '/withdrawals',
  requireRoles('super_admin', 'org_admin'),
  asyncHandler(async (req, res) => {
    const oid = req.organizationId;
    if (!oid || !mongoose.isValidObjectId(String(oid))) {
      return res.status(503).json({ error: 'No organisation context' });
    }
    const amountGhs = Number(req.body?.amountGhs);
    const amountCents =
      req.body?.amountCents != null
        ? Math.round(Number(req.body.amountCents))
        : Math.round(amountGhs * 100);
    try {
      const doc = await requestWithdrawal({
        organizationId: oid,
        amountCents,
        destinationNote: req.body?.destinationNote,
        requestedByAdminId: req.admin?.id,
      });
      res.status(201).json({
        id: String(doc._id),
        amountCents: doc.amountCents,
        status: doc.status,
        destinationNote: doc.destinationNote || '',
        createdAt: doc.createdAt,
      });
    } catch (e) {
      const status = e.status && Number(e.status) >= 400 ? e.status : 500;
      return res.status(status).json({ error: e.message || 'Withdrawal failed' });
    }
  })
);
