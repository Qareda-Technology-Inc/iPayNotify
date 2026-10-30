import crypto from 'crypto';
import { config } from '../config.js';

/*
 * Paystack Mobile Money (Ghana) through the Charge API: the customer types their number on our
 * own buy page and approves the prompt on their phone. No Paystack page has to load, so a hotspot
 * customer who is not logged in only needs to reach this API.
 */

const PROVIDERS = new Set(['mtn', 'vod', 'atl']);

export function paystackConfigured() {
  return Boolean(config.paystack.secretKey);
}

/** 0XXXXXXXXX, the format Paystack's Ghana Mobile Money examples use. */
function localGhanaNumber(msisdn) {
  const d = String(msisdn || '').replace(/\D/g, '');
  if (d.startsWith('233') && d.length === 12) return `0${d.slice(3)}`;
  if (d.length === 9) return `0${d}`;
  return d;
}

/** Paystack network code from a Ghana number: mtn, vod (Telecel) or atl (AirtelTigo). */
export function momoProviderForMsisdn(msisdn) {
  const prefix = localGhanaNumber(msisdn).slice(0, 3);
  if (['024', '025', '053', '054', '055', '059'].includes(prefix)) return 'mtn';
  if (['020', '050'].includes(prefix)) return 'vod';
  if (['026', '027', '056', '057'].includes(prefix)) return 'atl';
  return '';
}

export function normalizeMomoProvider(value) {
  const v = String(value || '').trim().toLowerCase();
  if (v === 'telecel' || v === 'vodafone') return 'vod';
  if (v === 'airteltigo' || v === 'at' || v === 'tigo' || v === 'airtel') return 'atl';
  return PROVIDERS.has(v) ? v : '';
}

/** Paystack needs an email; MoMo customers rarely give one, so use a stable per-number address. */
function customerEmail(msisdn) {
  const digits = String(msisdn || '').replace(/\D/g, '') || 'customer';
  return `${digits}@${config.paystack.customerEmailDomain}`;
}

async function call(method, path, body) {
  if (!paystackConfigured()) {
    const e = new Error('Mobile money payments are not set up yet. Please contact support.');
    e.status = 503;
    throw e;
  }
  let res;
  try {
    res = await fetch(`${config.paystack.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${config.paystack.secretKey}`,
        'Content-Type': 'application/json',
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    const e = new Error('Could not reach the payment service. Please try again.');
    e.status = 502;
    e.cause = err;
    throw e;
  }
  const json = await res.json().catch(() => ({}));
  return { httpStatus: res.status, ok: res.ok && json?.status !== false, json };
}

/**
 * Normalised charge state:
 *   paid | prompt (approve on phone) | otp (enter code) | failed | pending
 */
function chargeState(data) {
  const s = String(data?.status || '').toLowerCase();
  if (s === 'success') return 'paid';
  if (s === 'pay_offline') return 'prompt';
  if (s === 'send_otp') return 'otp';
  if (s === 'failed' || s === 'abandoned' || s === 'reversed') return 'failed';
  return 'pending';
}

function chargeResult({ ok, json, httpStatus }) {
  const data = json?.data || {};
  const state = ok ? chargeState(data) : 'failed';
  return {
    ok,
    state,
    httpStatus,
    reference: data.reference || '',
    amountCents: Number.isFinite(Number(data.amount)) ? Number(data.amount) : null,
    currency: data.currency || '',
    paystackId: data.id != null ? String(data.id) : '',
    /* What Paystack tells the customer to do, e.g. "Please complete authorization on your phone". */
    displayText: String(data.display_text || data.message || data.gateway_response || json?.message || '').trim(),
    raw: { status: data.status || null, gateway_response: data.gateway_response || null, message: json?.message || null },
  };
}

/** Start a MoMo charge: the customer gets a prompt (or an OTP) on their phone. */
export async function chargeMobileMoney({ reference, amountCents, currency = 'GHS', msisdn, provider, metadata }) {
  const out = await call('POST', '/charge', {
    email: customerEmail(msisdn),
    amount: Math.round(Number(amountCents)),
    currency,
    reference,
    mobile_money: { phone: localGhanaNumber(msisdn), provider },
    metadata: metadata || {},
  });
  return chargeResult(out);
}

export async function submitChargeOtp({ reference, otp }) {
  return chargeResult(await call('POST', '/charge/submit_otp', { reference, otp: String(otp).trim() }));
}

/** Source of truth for whether a reference was paid. */
export async function verifyTransaction(reference) {
  const out = await call('GET', `/transaction/verify/${encodeURIComponent(reference)}`);
  const r = chargeResult(out);
  /* Unknown reference: Paystack answers 404 / status false; that is "not paid", not an error. */
  if (!out.ok && out.httpStatus === 400) return { ...r, state: 'pending' };
  return r;
}

/** Paystack signs the raw webhook body with the secret key (HMAC-SHA512). */
export function verifyWebhookSignature(rawBody, signature) {
  if (!paystackConfigured() || !rawBody || !signature) return false;
  const expected = crypto.createHmac('sha512', config.paystack.secretKey).update(rawBody).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(String(signature));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
