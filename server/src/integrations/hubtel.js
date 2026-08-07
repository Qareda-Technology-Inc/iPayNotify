import { config } from '../config.js';
import { normalizeGhanaMsisdn } from '../utils/phoneGhana.js';

/**
 * Hubtel Online Checkout (External) — merchant account + Basic Auth for the JS SDK.
 * @see https://github.com/hubtel/hubtel-web-merchant-checkout-sdk
 */

export function hubtelBasicAuth(clientId, clientSecret) {
  const id = String(clientId || '').trim();
  const secret = String(clientSecret || '').trim();
  if (!id || !secret) return '';
  return Buffer.from(`${id}:${secret}`).toString('base64');
}

/**
 * Absolute merchant callback URL Hubtel must POST/GET.
 * Never fall back to PUBLIC_APP_URL (Vercel SPA) — that swallows callbacks as index.html.
 */
export function resolveHubtelCallbackUrl(hubtel = config.hubtel) {
  const h = hubtel || config.hubtel;
  const explicit = String(h.callbackUrl || '').trim();
  if (explicit) return explicit.replace(/\/$/, '');

  const apiBase = String(config.publicApiUrl || '').trim().replace(/\/$/, '');
  if (apiBase) return `${apiBase}/api/payments/hubtel/callback`;

  const app = String(config.publicAppUrl || '').trim().replace(/\/$/, '');
  if (app && /vercel\.app|netlify\.app|pages\.dev/i.test(app)) {
    console.error(
      '[hubtel] Refusing PUBLIC_APP_URL as callback host (frontend). Set HUBTEL_CALLBACK_URL or PUBLIC_API_URL to your Render API.'
    );
    return '';
  }
  if (app) return `${app}/api/payments/hubtel/callback`;
  return '';
}

/**
 * Transaction Status Check API (requires Hubtel IP whitelist on caller egress).
 * GET …/transactions/{Collection_Account}/status?clientReference=
 */
export async function fetchHubtelTransactionStatus(clientReference, hubtel = config.hubtel) {
  const h = hubtel || config.hubtel;
  const ref = String(clientReference || '').trim();
  const account = String(h.merchantAccount || '').trim();
  const auth = hubtelBasicAuth(h.clientId, h.clientSecret);
  if (!ref || !account || !auth) {
    return { ok: false, error: 'missing_config_or_ref', httpStatus: 0, body: null, url: '' };
  }
  const base = String(h.statusCheckBaseUrl || 'https://api-txnstatus.hubtel.com/transactions').replace(
    /\/$/,
    ''
  );
  const url = `${base}/${encodeURIComponent(account)}/status?clientReference=${encodeURIComponent(ref)}`;
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: 'application/json',
      },
    });
    const text = await res.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = { raw: text?.slice?.(0, 800) || text };
    }
    const interpreted = interpretHubtelStatusCheckBody(body);
    console.log('========== HUBTEL STATUS CHECK ==========');
    console.log('[hubtel.statusCheck]', {
      clientReference: ref,
      httpStatus: res.status,
      hubtelStatus: interpreted.hubtelStatus,
      transactionId: interpreted.transactionId || null,
    });
    console.log('[hubtel.statusCheck] body=\n' + JSON.stringify(body, null, 2));
    console.log('========================================');
    return {
      ok: res.ok,
      httpStatus: res.status,
      body,
      url,
      ...interpreted,
    };
  } catch (e) {
    console.error('[hubtel.statusCheck] network error', ref, e?.message || e);
    return {
      ok: false,
      error: e?.message || 'network_error',
      httpStatus: 0,
      body: null,
      url,
      hubtelStatus: 'Unknown',
      paid: false,
      unpaid: false,
    };
  }
}

/**
 * Status Check responses use data.status = "Paid" | "Unpaid" with responseCode "0000" for both.
 * Never treat responseCode alone as Paid when data.status is present.
 */
export function interpretHubtelStatusCheckBody(body) {
  if (!body || typeof body !== 'object') {
    return { hubtelStatus: 'Unknown', paid: false, unpaid: false, transactionId: '', amount: null };
  }
  const nested = body.data || body.Data || {};
  const raw = String(
    nested.status || nested.Status || nested.paymentStatus || nested.PaymentStatus || ''
  ).trim();
  const upper = raw.toUpperCase();
  const transactionId = String(
    nested.transactionId || nested.TransactionId || body.transactionId || ''
  ).trim();
  const amount =
    nested.amount != null
      ? Number(nested.amount)
      : body.amount != null
        ? Number(body.amount)
        : null;

  if (['PAID', 'SUCCESS', 'SUCCESSFUL', 'COMPLETED', 'PAYMENTCOMPLETED'].includes(upper)) {
    return { hubtelStatus: raw || 'Paid', paid: true, unpaid: false, transactionId, amount };
  }
  if (['UNPAID', 'PENDING', 'FAILED', 'FAILURE', 'CANCELLED', 'CANCELED', 'DECLINED'].includes(upper)) {
    return {
      hubtelStatus: raw || 'Unpaid',
      paid: false,
      unpaid: upper === 'UNPAID' || upper === 'PENDING',
      transactionId,
      amount,
    };
  }

  /* Fallback: some shapes only send top-level Status (callback-like) */
  if (hubtelPaymentSucceeded(body) && !hubtelPaymentExplicitlyFailed(body)) {
    const nestedUnpaid = upper === 'UNPAID';
    if (nestedUnpaid) {
      return { hubtelStatus: 'Unpaid', paid: false, unpaid: true, transactionId, amount };
    }
    return { hubtelStatus: raw || 'Paid', paid: true, unpaid: false, transactionId, amount };
  }
  if (hubtelPaymentExplicitlyFailed(body)) {
    return { hubtelStatus: raw || 'Failed', paid: false, unpaid: false, transactionId, amount };
  }
  return { hubtelStatus: raw || 'Unknown', paid: false, unpaid: false, transactionId, amount };
}

export function hubtelLiveReady(hubtel = config.hubtel) {
  const h = hubtel || config.hubtel;
  if (h.mock) return false;
  return Boolean(String(h.merchantAccount || '').trim()) && Boolean(hubtelBasicAuth(h.clientId, h.clientSecret));
}

/**
 * Build SDK purchase + config for the portal (modal / iframe).
 * basicAuth is required by Hubtel's External checkout SDK on the client.
 */
export function buildHubtelCheckoutSession({
  amountGhs,
  description,
  customerMsisdn,
  clientReference,
  hubtel,
  publicAppBaseUrl,
}) {
  const h = hubtel || config.hubtel;
  const phone = normalizeGhanaMsisdn(customerMsisdn) || String(customerMsisdn || '').trim();
  const amount = Number(amountGhs);
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: 'Invalid amount' };
  }
  /** Phone may be empty — Hubtel checkout collects MoMo number in its own UI. */

  if (h.mock) {
    const base = String(publicAppBaseUrl || config.publicAppUrl || '').replace(/\/$/, '');
    return {
      ok: true,
      mock: true,
      checkoutUrl: `${base}/portal/pay/mock?ref=${encodeURIComponent(clientReference)}`,
      clientReference,
    };
  }

  const merchantAccount = Number(String(h.merchantAccount || '').trim());
  const basicAuth = hubtelBasicAuth(h.clientId, h.clientSecret);
  if (!Number.isFinite(merchantAccount) || merchantAccount <= 0 || !basicAuth) {
    const missing = [];
    if (!String(h.merchantAccount || '').trim() || !Number.isFinite(merchantAccount) || merchantAccount <= 0) {
      missing.push('HUBTEL_MERCHANT_ACCOUNT (numeric merchant id)');
    }
    if (!String(h.clientId || '').trim()) missing.push('HUBTEL_CLIENT_ID');
    if (!String(h.clientSecret || '').trim()) missing.push('HUBTEL_CLIENT_SECRET');
    return {
      ok: false,
      error:
        `Hubtel is not configured (${missing.join(', ') || 'invalid credentials'}). ` +
        `Set them in server .env (or org Hubtel credentials) and restart the API process so env changes load.`,
    };
  }

  const callbackUrl = resolveHubtelCallbackUrl(h);
  if (!callbackUrl) {
    return {
      ok: false,
      error:
        'Hubtel callback URL is not configured. Set HUBTEL_CALLBACK_URL=https://YOUR-API.onrender.com/api/payments/hubtel/callback (API host, not the Vercel frontend).',
    };
  }
  console.log('[hubtel.checkout] clientReference=', clientReference, 'callbackUrl=', callbackUrl);

  const purchaseDescription = String(description || 'Payment').slice(0, 160);

  return {
    ok: true,
    mock: false,
    mode: 'hubtel_checkout',
    clientReference,
    purchaseInfo: {
      amount,
      purchaseDescription,
      ...(phone ? { customerPhoneNumber: phone } : {}),
      clientReference: String(clientReference),
    },
    config: {
      branding: 'enabled',
      callbackUrl,
      merchantAccount,
      basicAuth,
      integrationType: 'External',
      allowedChannels: Array.isArray(h.allowedChannels) && h.allowedChannels.length
        ? h.allowedChannels
        : ['mobileMoney', 'bankCard'],
    },
  };
}

export function extractHubtelClientReference(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const nested = payload.Data || payload.data || payload.Response || payload.response || {};
  const candidates = [
    payload.ClientReference,
    payload.clientReference,
    payload.client_reference,
    nested.ClientReference,
    nested.clientReference,
    nested.ClientReferenceId,
    nested.clientReferenceId,
    payload.ExternalTransactionId,
    nested.ExternalTransactionId,
  ];
  for (const c of candidates) {
    if (c != null && String(c).trim()) return String(c).trim();
  }
  return null;
}

function hubtelNestedPaymentStatus(payload) {
  if (!payload || typeof payload !== 'object') return '';
  const nested = payload.Data || payload.data || {};
  return String(
    nested.status || nested.Status || nested.PaymentStatus || nested.paymentStatus || ''
  ).trim();
}

function hubtelStatusToken(payload) {
  if (!payload || typeof payload !== 'object') return '';
  const nested = payload.Data || payload.data || {};
  /** Prefer payment status fields over ResponseCode — Status Check uses 0000 for Paid and Unpaid. */
  return String(
    nested.status ||
      nested.Status ||
      nested.PaymentStatus ||
      nested.paymentStatus ||
      payload.Status ||
      payload.status ||
      payload.ResponseCode ||
      payload.responseCode ||
      ''
  ).trim();
}

export function hubtelPaymentSucceeded(payload) {
  const nestedStatus = hubtelNestedPaymentStatus(payload).toUpperCase();
  if (['UNPAID', 'FAILED', 'FAILURE', 'REJECTED', 'CANCELLED', 'CANCELED', 'DECLINED'].includes(nestedStatus)) {
    return false;
  }
  if (['PAID', 'SUCCESS', 'SUCCESSFUL', 'COMPLETED', 'PAYMENTCOMPLETED', 'PAYMENT_SUCCESSFUL'].includes(nestedStatus)) {
    return true;
  }

  const s = hubtelStatusToken(payload).toUpperCase();
  if (!s) {
    const code = String(payload?.ResponseCode ?? payload?.responseCode ?? '').trim();
    return code === '0000' || code === '200' || code === '00';
  }
  if (['SUCCESS', 'SUCCESSFUL', 'PAID', 'COMPLETED', 'PAYMENTCOMPLETED', 'PAYMENT_SUCCESSFUL'].includes(s)) {
    return true;
  }
  /** Only treat bare response codes as success when there is no nested Unpaid/Failed status. */
  if ((s === '0000' || s === '00') && !nestedStatus) return true;
  return false;
}

export function hubtelPaymentExplicitlyFailed(payload) {
  const nestedStatus = hubtelNestedPaymentStatus(payload).toUpperCase();
  if (nestedStatus === 'UNPAID') return false;
  const s = (nestedStatus || hubtelStatusToken(payload)).toUpperCase();
  return [
    'FAILED',
    'FAILURE',
    'REJECTED',
    'CANCELLED',
    'CANCELED',
    'DECLINED',
    'PAYMENTFAILED',
    'PAYMENT_FAILED',
  ].includes(s);
}

export function hubtelProviderReference(payload) {
  if (!payload || typeof payload !== 'object') return '';
  const nested = payload.Data || payload.data || {};
  const candidates = [
    nested.TransactionId,
    nested.transactionId,
    nested.SalesInvoiceId,
    nested.InvoiceNumber,
    payload.TransactionId,
    payload.transactionId,
    payload.ProviderDescription,
  ];
  for (const c of candidates) {
    if (c != null && String(c).trim()) return String(c).trim();
  }
  return '';
}

/** Silent auto-debit is not available via Online Checkout; keep auto-renew job no-op. */
export async function chargeForRenewal() {
  return {
    success: false,
    raw: {
      reason:
        'Hubtel Online Checkout requires the customer to complete checkout; auto-renew does not charge wallets silently.',
    },
  };
}
