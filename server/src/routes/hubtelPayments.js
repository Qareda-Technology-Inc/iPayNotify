import express from 'express';
import {
  extractHubtelClientReference,
  hubtelPaymentSucceeded,
  hubtelPaymentExplicitlyFailed,
  hubtelProviderReference,
} from '../integrations/hubtel.js';
import {
  markTransactionPaidByReference,
  markTransactionFailedByReference,
} from '../services/paymentService.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

export const hubtelPaymentsRouter = express.Router();

function safeJson(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/** Every hit under /api/payments/hubtel — use console.log so Render always surfaces it. */
hubtelPaymentsRouter.use((req, _res, next) => {
  const bodyKeys =
    req.body && typeof req.body === 'object' ? Object.keys(req.body).slice(0, 25).join(',') : '';
  const queryKeys =
    req.query && typeof req.query === 'object' ? Object.keys(req.query).slice(0, 25).join(',') : '';
  console.log(
    '[hubtel.payments]',
    req.method,
    req.originalUrl,
    'ip=',
    req.ip,
    'ct=',
    req.get('content-type') || '',
    'queryKeys=',
    queryKeys || '(none)',
    'bodyKeys=',
    bodyKeys || '(none)'
  );
  next();
});

function mergePayload(req) {
  const q = req.query && typeof req.query === 'object' ? req.query : {};
  const b = req.body && typeof req.body === 'object' ? req.body : {};
  return { ...q, ...b };
}

async function handleCallback(req, res) {
  const payload = mergePayload(req);
  const clientReference = extractHubtelClientReference(payload);
  const keys = payload && typeof payload === 'object' ? Object.keys(payload) : [];
  console.log(
    '[hubtel.callback] received',
    req.method,
    clientReference || '(no ClientReference)',
    'keys=',
    keys.slice(0, 20).join(',') || '(empty body/query)'
  );
  console.log('[hubtel.callback] payload=\n' + safeJson(payload));

  if (!clientReference) {
    console.warn('[hubtel.callback] rejected: missing ClientReference', {
      method: req.method,
      contentType: req.get('content-type') || '',
      queryKeys: Object.keys(req.query || {}),
      bodyType: typeof req.body,
    });
    return res.status(400).json({ error: 'Missing ClientReference' });
  }

  if (hubtelPaymentSucceeded(payload)) {
    const enriched = {
      ...payload,
      TransactionId: hubtelProviderReference(payload) || undefined,
    };
    const result = await markTransactionPaidByReference(clientReference, enriched);
    console.log('========== HUBTEL CALLBACK SUCCESS ==========');
    console.log('[hubtel.callback.SUCCESS]', {
      clientReference,
      ResponseCode: payload.ResponseCode ?? payload.responseCode,
      Status: payload.Status ?? payload.status,
      TransactionId: hubtelProviderReference(payload) || null,
      merchantResult: {
        ok: result.ok,
        duplicate: result.duplicate,
        reason: result.reason,
        paid: result.ok !== false && result.reason !== 'not_found',
      },
    });
    console.log('=============================================');
    return res.status(200).json({
      received: true,
      paid: result.ok !== false && result.reason !== 'not_found',
      ...result,
    });
  }

  if (hubtelPaymentExplicitlyFailed(payload)) {
    const result = await markTransactionFailedByReference(clientReference, payload);
    console.log('========== HUBTEL CALLBACK FAILED ==========');
    console.log('[hubtel.callback.FAILED]', {
      clientReference,
      ResponseCode: payload.ResponseCode ?? payload.responseCode,
      Status: payload.Status ?? payload.status,
      Message: payload.Message ?? payload.message,
      merchantResult: {
        ok: result.ok,
        reason: result.reason,
        failed: true,
      },
    });
    console.log('============================================');
    return res.status(200).json({ received: true, paid: false, failed: true, clientReference, ...result });
  }

  console.log('[hubtel.callback] pending/unknown status', clientReference);
  return res.status(200).json({ received: true, paid: false, pending: true, clientReference });
}

/** Manual smoke test: curl this and confirm a line appears in Render logs. */
hubtelPaymentsRouter.get('/callback/ping', (_req, res) => {
  console.log('[hubtel.callback] PING ok — if you see this, Render logging works for this route');
  res.status(200).json({
    ok: true,
    message: 'Hubtel callback route is reachable. Check Render logs for [hubtel.callback] PING.',
  });
});

hubtelPaymentsRouter.post(
  '/callback',
  asyncHandler(async (req, res) => {
    await handleCallback(req, res);
  })
);

hubtelPaymentsRouter.get(
  '/callback',
  asyncHandler(async (req, res) => {
    await handleCallback(req, res);
  })
);
