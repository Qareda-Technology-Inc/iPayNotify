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
      customerName: quote.customerName,
      customerPhone: quote.customerPhone,
      hasLinkedCustomer: quote.hasLinkedCustomer,
    });
  })
);

publicPortalRouter.post(
  '/renew/checkout',
  asyncHandler(async (req, res) => {
    const { secretName, routerId, customerMsisdn, customerName } = req.body;
    if (!secretName) {
      return res.status(400).json({ error: 'secretName is required' });
    }
    const out = await createPppoeRenewalCheckout({
      secretName,
      routerId: routerId || undefined,
      customerMsisdn: customerMsisdn ? String(customerMsisdn).replace(/\s/g, '') : undefined,
      customerName,
    });
    res.json(out);
  })
);

publicPortalRouter.post(
  '/hotspot/checkout',
  asyncHandler(async (req, res) => {
    const { packageId, customerMsisdn, customerName, portalSlug } = req.body;
    if (!packageId) {
      return res.status(400).json({ error: 'packageId is required' });
    }

    /**
     * Site is resolved only from captive/QR slug or the client's public IP.
     * Clients cannot pick an arbitrary router.
     */
    const slug =
      portalSlug != null && String(portalSlug).trim()
        ? String(portalSlug).trim()
        : req.query.r ?? req.query.router ?? req.query.site;
    const ctx = await resolvePortalRouter(req, slug);
    if (!ctx.resolved || !ctx.router?.id) {
      return res.status(400).json({
        error:
          'Could not determine this venue. Connect to the site Wi‑Fi or open the buy link from the login page (?r=site).',
        reason: ctx.reason || 'unresolved',
      });
    }

    const out = await createHotspotPurchaseCheckout({
      packageId,
      routerId: ctx.router.id,
      customerMsisdn: customerMsisdn ? String(customerMsisdn).replace(/\s/g, '') : undefined,
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
      process.env.HUBTEL_MOCK === 'true' ||
      process.env.PAYMENT_DRAFT_CHECKOUT === 'true' ||
      process.env.PAYMENT_DRAFT_MOMO === 'true' ||
      process.env.MTN_MOMO_MOCK === 'true' ||
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
