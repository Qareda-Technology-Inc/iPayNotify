import express from 'express';
import { PlanPackage } from '../models/index.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import {
  quotePppoeRenewal,
  createPppoeRenewalCheckout,
  createHotspotPurchaseCheckout,
  getTransactionByReference,
  markTransactionPaidByReference,
  reconcilePaymentFromHubtelStatus,
  recordHubtelClientCheckoutEvent,
} from '../services/paymentService.js';
import {
  resolvePortalRouter,
  resolvePortalSiteFromRequest,
} from '../services/portalContextService.js';

export const publicPortalRouter = express.Router();

function portalUnresolvedError(ctx) {
  if (ctx?.reason === 'org_suspended') {
    return {
      status: 403,
      error: 'This service provider is temporarily unavailable. Please try again later.',
    };
  }
  return {
    status: 400,
    error:
      'Could not determine this venue. Open your ISP link (?r=site) or connect on the site network.',
    reason: ctx?.reason || 'unresolved',
  };
}

publicPortalRouter.get(
  '/portal-context',
  asyncHandler(async (req, res) => {
    const slug = req.query.r ?? req.query.router ?? req.query.site;
    const ctx = await resolvePortalRouter(req, slug);
    res.json(ctx);
  })
);

/**
 * Packages for the resolved venue only (never cross-tenant).
 * GET /packages/hotspot?r=slug  (or on-site IP match)
 */
publicPortalRouter.get(
  '/packages/hotspot',
  asyncHandler(async (req, res) => {
    const ctx = await resolvePortalSiteFromRequest(req, req.query.r);
    if (!ctx.resolved || !ctx.router?.organizationId) {
      const e = portalUnresolvedError(ctx);
      return res.status(e.status).json({ error: e.error, reason: e.reason });
    }
    const list = await PlanPackage.find({
      organizationId: ctx.router.organizationId,
      kind: 'hotspot',
      isActive: true,
    })
      .select('name priceCents currency activeProfile durationDays description')
      .sort({ name: 1 })
      .lean();
    res.json(list);
  })
);

publicPortalRouter.post(
  '/renew/quote',
  asyncHandler(async (req, res) => {
    const { secretName, renewCode, phone, portalSlug } = req.body || {};
    const hasCode = Boolean(String(renewCode || '').trim());
    const hasPhone = Boolean(String(phone || '').trim());
    const hasSecret = Boolean(String(secretName || '').trim());
    if (!hasCode && !hasPhone && !hasSecret) {
      return res.status(400).json({
        error: 'Enter your renew ID, registered phone, or PPPoE username',
      });
    }

    let routerId;
    if (hasSecret && !hasCode && !hasPhone) {
      const ctx = await resolvePortalSiteFromRequest(req, portalSlug);
      if (!ctx.resolved || !ctx.router?.id) {
        const e = portalUnresolvedError(ctx);
        return res.status(e.status).json({
          error:
            'PPPoE username needs your ISP renew link (?r=site), or use renew ID / phone instead.',
          reason: e.reason,
        });
      }
      routerId = ctx.router.id;
    }

    const quote = await quotePppoeRenewal({
      renewCode,
      phone,
      secretName: hasSecret ? secretName : undefined,
      routerId,
    });
    if (quote.needsPrice) {
      return res.json({
        ...quote,
        needsPrice: true,
      });
    }
    res.json({
      renewCode: quote.renewCode,
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
    const { secretName, renewCode, phone, customerMsisdn, customerName, portalSlug } =
      req.body || {};
    const hasCode = Boolean(String(renewCode || '').trim());
    const hasPhone = Boolean(String(phone || '').trim());
    const hasSecret = Boolean(String(secretName || '').trim());
    if (!hasCode && !hasPhone && !hasSecret) {
      return res.status(400).json({
        error: 'Enter your renew ID, registered phone, or PPPoE username',
      });
    }

    let routerId;
    if (hasSecret && !hasCode && !hasPhone) {
      const ctx = await resolvePortalSiteFromRequest(req, portalSlug);
      if (!ctx.resolved || !ctx.router?.id) {
        const e = portalUnresolvedError(ctx);
        return res.status(e.status).json({
          error:
            'PPPoE username needs your ISP renew link (?r=site), or use renew ID / phone instead.',
          reason: e.reason,
        });
      }
      routerId = ctx.router.id;
    }

    const out = await createPppoeRenewalCheckout({
      renewCode,
      phone,
      secretName: hasSecret ? secretName : undefined,
      routerId,
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

    const ctx = await resolvePortalSiteFromRequest(req, portalSlug);
    if (!ctx.resolved || !ctx.router?.id) {
      const e = portalUnresolvedError(ctx);
      return res.status(e.status).json({ error: e.error, reason: e.reason });
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
    let tx = await getTransactionByReference(req.params.ref);
    if (!tx) return res.status(404).json({ error: 'Not found' });

    /** If merchant callback never arrived, try Hubtel Status Check while the customer waits. */
    if (tx.status === 'pending') {
      try {
        await reconcilePaymentFromHubtelStatus(req.params.ref);
        tx = await getTransactionByReference(req.params.ref);
      } catch (e) {
        console.warn('[hubtel.reconcile] status poll failed', req.params.ref, e?.message || e);
      }
    }

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

/**
 * Called from the portal when Hubtel SDK fires onPaymentSuccess / onPaymentFailure.
 * Guarantees a Render log line even if Hubtel never POSTs the merchant callback.
 */
publicPortalRouter.post(
  '/payment/hubtel-client-event',
  asyncHandler(async (req, res) => {
    const { clientReference, event, payload } = req.body || {};
    const out = await recordHubtelClientCheckoutEvent({
      clientReference,
      event,
      payload: payload && typeof payload === 'object' ? payload : {},
    });
    res.json(out);
  })
);

publicPortalRouter.post(
  '/payment/mock-complete',
  asyncHandler(async (req, res) => {
    const { clientReference } = req.body;
    if (!clientReference) {
      return res.status(400).json({ error: 'clientReference required' });
    }
    const result = await markTransactionPaidByReference(clientReference, {
      mock: true,
      TransactionId: `mock-${clientReference}`,
    });
    res.json(result);
  })
);
