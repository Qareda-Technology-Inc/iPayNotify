import express from 'express';
import { PlanPackage } from '../models/index.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { config } from '../config.js';
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
  loadPortalPlans,
  resolvePortalRouter,
  resolvePortalSiteFromRequest,
} from '../services/portalContextService.js';
import { buildCaptiveLoginHtml } from '../services/captivePortalHtml.js';
import { captiveBuyUrl } from '../services/captivePortalPushService.js';
import { recordHotspotLoginEvent } from '../services/hotspotService.js';
import { normalizeGhanaMsisdn } from '../utils/phoneGhana.js';

export const publicPortalRouter = express.Router();

/** Hotspot profile on-login script reports a voucher's first login here. */
publicPortalRouter.post(
  '/hotspot/login-event',
  asyncHandler(async (req, res) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const result = await recordHotspotLoginEvent({
      key: body.key || req.get('x-qarefi-key'),
      code: body.code || body.user,
      mac: body.mac,
    });
    if (!result.ok) return res.status(result.status || 400).json({ ok: false });
    res.json(result);
  })
);

async function loginPageOptions(ctx, slug) {
  const b = ctx.branding || {};
  const plans = b.portalShowPlans === false ? [] : await loadPortalPlans(ctx.router.organizationId);
  return {
    designId: b.portalDesign,
    brandName: b.displayName,
    logoUrl: b.logoUrl,
    siteName: ctx.router?.name,
    headline: b.portalHeadline,
    subtitle: b.portalSubtitle,
    buttonLabel: b.portalButtonLabel,
    buyLabel: b.portalBuyLabel,
    footerText: b.portalFooter,
    supportPhone: b.portalSupportPhone,
    showPlans: b.portalShowPlans !== false,
    plans,
    buyUrl: slug ? captiveBuyUrl(slug) : '',
  };
}

/** Router downloads this as its hotspot login.html (plans are baked in at push time). */
publicPortalRouter.get(
  '/captive/:slug/login.html',
  asyncHandler(async (req, res) => {
    const ctx = await resolvePortalRouter(req, req.params.slug);
    if (!ctx.resolved) {
      return res.status(404).type('text/plain').send('Unknown hotspot site');
    }
    const html = buildCaptiveLoginHtml(await loginPageOptions(ctx, req.params.slug));
    res.set('Cache-Control', 'no-store');
    res.type('html').send(html);
  })
);

/**
 * Hosted login page (web app /portal/login). The form posts to the router login URL
 * the hotspot passed in (`link-login-only`), so it only works from the venue Wi-Fi.
 * GET /captive/page.html?r=slug&link-login-only=&dst=&error=
 */
publicPortalRouter.get(
  '/captive/page.html',
  asyncHandler(async (req, res) => {
    const slug = req.query.r ?? req.query.router ?? req.query.site;
    const ctx = await resolvePortalRouter(req, slug);
    if (!ctx.resolved) {
      return res.status(404).type('text/plain').send('Unknown hotspot site');
    }
    const link = String(req.query['link-login-only'] || req.query['link-login'] || '').trim();
    const action = /^https?:\/\//i.test(link) ? link : '';
    const opts = await loginPageOptions(ctx, slug ? String(slug) : '');
    const html = buildCaptiveLoginHtml({
      ...opts,
      mode: 'web',
      web: {
        action,
        dst: String(req.query.dst || req.query['link-orig'] || ''),
        error: action
          ? String(req.query.error || '')
          : 'Open this page from the venue Wi-Fi login so the router can accept your code.',
      },
    });
    res.set('Cache-Control', 'no-store');
    res.type('html').send(html);
  })
);
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
      .select(
        'name priceCents currency activeProfile durationDays durationAmount durationUnit dataLimitBytes timeLimitSeconds elapsedSeconds pausedSeconds ticketDurationType usersPerTicket speedUpMbps speedDownMbps description'
      )
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
    if (!normalizeGhanaMsisdn(customerMsisdn)) {
      return res.status(400).json({ error: 'Enter a valid mobile money number (e.g. 024 123 4567).' });
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

    /**
     * If merchant callback never arrived, try Hubtel Status Check while the customer waits.
     * Throttle: at most once per 12s per tx (PayReturn polls every 1.5s).
     */
    if (tx.status === 'pending') {
      const lastCheck = tx.meta?.statusCheckAt ? new Date(tx.meta.statusCheckAt).getTime() : 0;
      const due = !lastCheck || Date.now() - lastCheck >= 12_000;
      if (due) {
        try {
          await reconcilePaymentFromHubtelStatus(req.params.ref);
          tx = await getTransactionByReference(req.params.ref);
        } catch (e) {
          console.warn('[hubtel.reconcile] status poll failed', req.params.ref, e?.message || e);
        }
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
      hubtelStatus: tx.meta?.statusCheckResult?.hubtelStatus || null,
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
    if (!config.allowPaymentSimulation) {
      return res.status(403).json({
        error:
          'Payment simulation is disabled. Set ALLOW_PAYMENT_SIMULATION=true (or use HUBTEL_MOCK / PAYMENT_DRAFT_CHECKOUT in non-production).',
      });
    }
    const { clientReference } = req.body;
    if (!clientReference) {
      return res.status(400).json({ error: 'clientReference required' });
    }
    const existing = await getTransactionByReference(clientReference);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    if (existing.status !== 'pending') {
      return res.status(409).json({ error: 'Transaction is not pending', status: existing.status });
    }
    const result = await markTransactionPaidByReference(clientReference, {
      mock: true,
      TransactionId: `mock-${clientReference}`,
    });
    res.json(result);
  })
);
