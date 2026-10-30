import express from 'express';
import { PlanPackage } from '../models/index.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { limits } from '../middleware/rateLimit.js';
import { config } from '../config.js';
import {
  quotePppoeRenewal,
  createPppoeRenewalCheckout,
  createHotspotPurchaseCheckout,
  getTransactionByReference,
  fulfillPaidTransaction,
  markTransactionPaidByReference,
  reconcilePaymentStatus,
  recordHubtelClientCheckoutEvent,
  submitPaystackOtp,
} from '../services/paymentService.js';
import {
  loadPortalPlans,
  sitePlanQuery,
  resolvePortalRouter,
  resolvePortalSiteFromRequest,
} from '../services/portalContextService.js';
import { buildCaptiveLoginHtml } from '../services/captivePortalHtml.js';
import { planDetail } from '../services/captiveTemplates.js';
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
  const plans =
    b.portalShowPlans === false ? [] : await loadPortalPlans(ctx.router.organizationId, ctx.router.id);
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
        serverName: String(req.query['server-name'] || req.query.s || ''),
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
    /* Tells the buy page whether to ask for the MoMo network (Paystack) or open Hubtel checkout. */
    res.json({
      ...ctx,
      hotspotPayment: config.hotspotPaymentProvider === 'paystack' && !config.paymentDraftCheckout ? 'paystack' : 'hubtel',
    });
  })
);

/**
 * Packages for the resolved venue only (never cross-tenant), limited to the site's chosen plans.
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
    const list = await PlanPackage.find(await sitePlanQuery(ctx.router.organizationId, ctx.router.id))
      .select(
        'name priceCents currency activeProfile durationDays durationAmount durationUnit dataLimitBytes timeLimitSeconds elapsedSeconds pausedSeconds ticketDurationType usersPerTicket speedUpMbps speedDownMbps description'
      )
      .sort({ priceCents: 1, name: 1 })
      .lean();
    /* `detail` is the same "1 day · Unlimited" line the login page shows for the plan. */
    res.json(list.map((p) => ({ ...p, detail: planDetail(p) })));
  })
);

publicPortalRouter.post(
  '/renew/quote',
  limits.renewQuote,
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
  limits.checkoutPerIp,
  limits.checkoutPerPhone,
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
  limits.checkoutPerIp,
  limits.checkoutPerPhone,
  asyncHandler(async (req, res) => {
    const { packageId, customerMsisdn, customerName, portalSlug, hotspotServer, momoProvider } = req.body;
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
      hotspotServer,
      customerMsisdn: customerMsisdn ? String(customerMsisdn).replace(/\s/g, '') : undefined,
      customerName,
      momoProvider,
    });
    res.json(out);
  })
);

/** Paystack MoMo: the code the customer received by SMS, when the network asks for one. */
publicPortalRouter.post(
  '/payment/:ref/otp',
  limits.statusPerRef,
  asyncHandler(async (req, res) => {
    res.json(await submitPaystackOtp(req.params.ref, req.body?.otp));
  })
);

publicPortalRouter.get(
  '/payment/:ref/status',
  limits.statusPerRef,
  asyncHandler(async (req, res) => {
    let tx = await getTransactionByReference(req.params.ref);
    if (!tx) return res.status(404).json({ error: 'Not found' });

    /**
     * If merchant callback never arrived, try Hubtel Status Check while the customer waits.
     * Throttle: at most once per 12s per tx (PayReturn polls every 1.5s).
     */
    const recentClientFailure =
      tx.status === 'failed' &&
      /^client_/.test(String(tx.meta?.callback?.failedVia || '')) &&
      Date.now() - new Date(tx.createdAt || 0).getTime() < 6 * 60 * 60 * 1000;
    if (tx.status === 'pending' || recentClientFailure) {
      const lastCheck = tx.meta?.statusCheckAt ? new Date(tx.meta.statusCheckAt).getTime() : 0;
      const every = tx.provider === 'paystack' ? 5_000 : 12_000;
      const due = !lastCheck || Date.now() - lastCheck >= every;
      if (due) {
        try {
          await reconcilePaymentStatus(req.params.ref);
          tx = await getTransactionByReference(req.params.ref);
        } catch (e) {
          console.warn('[hubtel.reconcile] status poll failed', req.params.ref, e?.message || e);
        }
      }
    }

    if (tx.status === 'paid' && tx.kind === 'voucher' && tx.meta?.fulfillment !== 'done') {
      const lastTry = tx.meta?.routerPushError?.at ? new Date(tx.meta.routerPushError.at).getTime() : 0;
      if (!lastTry || Date.now() - lastTry >= 10_000) {
        try {
          await fulfillPaidTransaction({ _id: tx._id });
          tx = await getTransactionByReference(req.params.ref);
        } catch (e) {
          console.warn('[voucher.fulfill] status poll retry failed', req.params.ref, e?.message || e);
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
      provider: tx.provider || 'hubtel',
      /* Paystack's instruction for the customer while they approve, e.g. "Dial *170#…". */
      displayText: tx.status === 'pending' ? tx.meta?.paystackCharge?.displayText || '' : '',
    });
  })
);

/**
 * Called from the portal when Hubtel SDK fires onPaymentSuccess / onPaymentFailure.
 * Guarantees a Render log line even if Hubtel never POSTs the merchant callback.
 */
publicPortalRouter.post(
  '/payment/hubtel-client-event',
  limits.clientEvent,
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
