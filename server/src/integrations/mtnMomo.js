import crypto from 'crypto';
import { config } from '../config.js';
import { normalizeGhanaMsisdn } from '../utils/phoneGhana.js';

/** @type {Map<string, { token: string | null, expiresAt: number }>} */
const tokenCaches = new Map();

function cacheKey(mtn) {
  return `${String(mtn.subscriptionKey || '')}|${String(mtn.apiUser || '')}`;
}

function subscriptionHeaders(mtn) {
  return {
    'Ocp-Apim-Subscription-Key': mtn.subscriptionKey,
  };
}

function basicAuthHeader(mtn) {
  const raw = `${mtn.apiUser}:${mtn.apiKey}`;
  return `Basic ${Buffer.from(raw).toString('base64')}`;
}

/**
 * @param {typeof config.mtnMomo} mtn
 */
export async function getCollectionAccessToken(mtn, forceRefresh = false) {
  const key = cacheKey(mtn);
  let slot = tokenCaches.get(key);
  if (!slot) {
    slot = { token: null, expiresAt: 0 };
    tokenCaches.set(key, slot);
  }
  const now = Date.now();
  if (!forceRefresh && slot.token && slot.expiresAt > now + 10000) {
    return slot.token;
  }
  const url = `${mtn.baseUrl}/collection/token/`;
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: basicAuthHeader(mtn),
        ...subscriptionHeaders(mtn),
      },
    });
  } catch (e) {
    const err = new Error(
      `MTN token network error: ${e.message || e}. Check internet, DNS, and MTN MoMo base URL.`
    );
    err.raw = { cause: String(e) };
    throw err;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.message || data.error || res.statusText);
    err.status = res.status;
    err.raw = data;
    throw err;
  }
  const token = data.access_token;
  if (!token) {
    throw new Error('MTN token response missing access_token');
  }
  const ttlSec = Number(data.expires_in) || 3600;
  slot.token = token;
  slot.expiresAt = now + Math.max(60, ttlSec - 120) * 1000;
  return token;
}

function formatAmount(amountGhs) {
  return Number(amountGhs).toFixed(2);
}

/**
 * MTN Collections: Request to Pay.
 * @param {object} opts
 * @param {typeof config.mtnMomo} opts.mtnMomo - Resolved credentials (platform or per-org).
 */
export async function initiateMtnMomoRequestToPay({
  amountGhs,
  currency = 'GHS',
  clientReference,
  description,
  customerMsisdn,
  merchantName,
  publicAppBaseUrl,
  mtnMomo = config.mtnMomo,
}) {
  const base = String(publicAppBaseUrl || config.publicAppUrl).replace(/\/$/, '');

  if (
    mtnMomo.mockRequest ||
    !mtnMomo.subscriptionKey ||
    !mtnMomo.apiUser ||
    !mtnMomo.apiKey
  ) {
    const mockUrl = `${base}/portal/pay/mock?ref=${encodeURIComponent(clientReference)}`;
    return {
      ok: true,
      checkoutUrl: mockUrl,
      mtnReferenceId: `mock-${clientReference}`,
      raw: { mock: true },
    };
  }

  if (!mtnMomo.callbackUrl) {
    return {
      ok: false,
      error:
        'MTN callback URL is not set (public HTTPS URL where MTN posts payment results). Set platform MTN_MOMO_CALLBACK_URL or the organisation custom callback URL.',
      raw: {},
    };
  }

  const partyId = normalizeGhanaMsisdn(customerMsisdn);
  if (!partyId) {
    return {
      ok: false,
      error: 'Enter a valid Ghana mobile number (e.g. 024… or 233…)',
      raw: {},
    };
  }

  const xReferenceId = crypto.randomUUID();
  const externalId = String(clientReference).slice(0, 128);
  const body = {
    amount: formatAmount(amountGhs),
    currency,
    externalId,
    payer: {
      partyIdType: 'MSISDN',
      partyId,
    },
    payerMessage: String(description || 'Payment').slice(0, 140),
    payeeNote: String(merchantName || 'Payment').slice(0, 140),
  };

  const url = `${mtnMomo.baseUrl}/collection/v1_0/requesttopay`;

  async function doPost(bearer) {
    return fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${bearer}`,
        'X-Reference-Id': xReferenceId,
        'X-Callback-Url': mtnMomo.callbackUrl,
        'X-Target-Environment': mtnMomo.targetEnvironment,
        'Content-Type': 'application/json',
        ...subscriptionHeaders(mtnMomo),
      },
      body: JSON.stringify(body),
    });
  }

  let token;
  try {
    token = await getCollectionAccessToken(mtnMomo);
  } catch (e) {
    return {
      ok: false,
      error: e.message || 'Could not obtain MTN collection token',
      raw: e.raw || {},
    };
  }

  let res;
  try {
    res = await doPost(token);
    if (res.status === 401) {
      token = await getCollectionAccessToken(mtnMomo, true);
      res = await doPost(token);
    }
  } catch (e) {
    return {
      ok: false,
      error:
        e?.message?.includes('MTN token')
          ? e.message
          : `Cannot reach MTN request-to-pay API (${e.message || 'network error'}). Check internet, firewall, and sandbox URL.`,
      raw: { cause: String(e) },
    };
  }

  let text;
  try {
    text = await res.text();
  } catch (e) {
    return {
      ok: false,
      error: `MTN response read failed: ${e.message || e}`,
      raw: {},
    };
  }
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { rawBody: text };
  }

  if (res.status !== 202 && res.status !== 200) {
    const mtnMsg =
      data.message ||
      data.Message ||
      data.errorReason ||
      data.reason ||
      (typeof data.error === 'string' ? data.error : data.error?.message) ||
      data.code ||
      res.statusText ||
      `HTTP ${res.status}`;
    return {
      ok: false,
      error: String(mtnMsg),
      raw: data,
    };
  }

  const checkoutUrl = `${base}/portal/pay/return?ref=${encodeURIComponent(clientReference)}`;

  return {
    ok: true,
    checkoutUrl,
    mtnReferenceId: xReferenceId,
    raw: data,
  };
}

export function extractMomoClientReference(data) {
  if (!data || typeof data !== 'object') return null;
  return data.externalId ?? data.ExternalId ?? data.external_id ?? null;
}

export function momoPaymentSucceeded(data) {
  if (!data || typeof data !== 'object') return false;
  const status = data.status ?? data.Status ?? data.financialStatus ?? data.FinancialStatus;
  const s = String(status || '').toUpperCase();
  if (['SUCCESSFUL', 'SUCCESS', 'COMPLETED', 'PAID'].includes(s)) return true;
  if (String(data.result || '').toUpperCase() === 'SUCCESSFUL') return true;
  return false;
}

export function momoPaymentExplicitlyFailed(data) {
  if (!data || typeof data !== 'object') return false;
  const s = String(data.status ?? data.Status ?? '').toUpperCase();
  return ['FAILED', 'REJECTED', 'CANCELLED', 'CANCELED', 'TIMEOUT', 'DECLINED'].includes(s);
}

export async function chargeForRenewal() {
  return {
    success: false,
    raw: {
      reason:
        'MTN MoMo requires the customer to approve each charge on their phone; auto-renew only uses in-app balance for this provider.',
    },
  };
}
