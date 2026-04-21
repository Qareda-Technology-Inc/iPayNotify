import express from 'express';
import { Router as MikrotikRouter } from '../models/index.js';
import { PlanPackage } from '../models/index.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import {
  quotePppoeRenewal,
  createPppoeRenewalCheckout,
  createHotspotPurchaseCheckout,
  getTransactionByReference,
  markTransactionPaidByReference,
} from '../services/paymentService.js';
import { resolvePortalRouter } from '../services/portalContextService.js';
import { routerDisplayName } from '../utils/routerLabel.js';

export const publicPortalRouter = express.Router();

publicPortalRouter.get(
  '/portal-context',
  asyncHandler(async (req, res) => {
    const slug = req.query.r ?? req.query.router ?? req.query.site;
    const ctx = await resolvePortalRouter(req, slug);
    res.json(ctx);
  })
);

publicPortalRouter.get(
  '/routers',
  asyncHandler(async (req, res) => {
    const list = await MikrotikRouter.find()
      .select('name comment host')
      .sort({ createdAt: 1 })
      .lean();
    res.json(
      list.map((r) => ({
        _id: r._id,
        name: routerDisplayName(r),
        host: r.host,
      }))
    );
  })
);

publicPortalRouter.get(
  '/packages/hotspot',
  asyncHandler(async (req, res) => {
    const list = await PlanPackage.find({ kind: 'hotspot', isActive: true })
      .select('name priceCents currency activeProfile durationDays description')
      .sort({ name: 1 })
      .lean();
    res.json(list);
  })
);

publicPortalRouter.post(
  '/renew/quote',
  asyncHandler(async (req, res) => {
    const { secretName, routerId } = req.body;
    if (!secretName) {
      return res.status(400).json({ error: 'secretName is required' });
    }
    const quote = await quotePppoeRenewal(secretName, routerId || undefined);
    if (quote.needRouterSelection) {
      return res.json({ needRouterSelection: true, routers: quote.routers });
    }
    res.json({
      secretName: quote.secretName,
      packageName: quote.packageName,
      amountCents: quote.amountCents,
      currency: quote.currency,
      routerId: quote.routerId,
      routerName: quote.routerName,
      paidUntil: quote.paidUntil,
      needsPrice: quote.needsPrice,
    });
  })
);

publicPortalRouter.post(
  '/renew/checkout',
  asyncHandler(async (req, res) => {
    const { secretName, routerId, customerMsisdn, customerName } = req.body;
    if (!secretName || !customerMsisdn) {
      return res
        .status(400)
        .json({ error: 'secretName and customerMsisdn (mobile money number) are required' });
    }
    const out = await createPppoeRenewalCheckout({
      secretName,
      routerId: routerId || undefined,
      customerMsisdn: String(customerMsisdn).replace(/\s/g, ''),
      customerName,
    });
    res.json(out);
  })
);

publicPortalRouter.post(
  '/hotspot/checkout',
  asyncHandler(async (req, res) => {
    const { packageId, routerId, customerMsisdn, customerName } = req.body;
    if (!packageId || !routerId || !customerMsisdn) {
      return res.status(400).json({
        error: 'packageId, routerId, and customerMsisdn are required',
      });
    }
    const out = await createHotspotPurchaseCheckout({
      packageId,
      routerId,
      customerMsisdn: String(customerMsisdn).replace(/\s/g, ''),
      customerName,
    });
    res.json(out);
  })
);

publicPortalRouter.get(
  '/payment/:ref/status',
  asyncHandler(async (req, res) => {
    const tx = await getTransactionByReference(req.params.ref);
    if (!tx) return res.status(404).json({ error: 'Not found' });
    res.json({
      status: tx.status,
      kind: tx.kind,
      amountCents: tx.amountCents,
      currency: tx.currency,
      voucherCode: tx.meta?.voucherCode,
      renewedUntil: tx.meta?.renewedUntil,
      fulfillment: tx.meta?.fulfillment,
    });
  })
);

publicPortalRouter.post(
  '/payment/mock-complete',
  asyncHandler(async (req, res) => {
    const simOk =
      process.env.ALLOW_PAYMENT_SIMULATION === 'true' ||
      process.env.MTN_MOMO_MOCK === 'true' ||
      process.env.PAYMENT_DRAFT_MOMO === 'true' ||
      process.env.NODE_ENV !== 'production';
    if (!simOk) {
      return res.status(403).json({ error: 'Simulation disabled in production' });
    }
    const { clientReference } = req.body;
    if (!clientReference) {
      return res.status(400).json({ error: 'clientReference required' });
    }
    const result = await markTransactionPaidByReference(clientReference, {
      mock: true,
    });
    res.json(result);
  })
);
