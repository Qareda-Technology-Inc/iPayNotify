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

function mergePayload(req) {
  const q = req.query && typeof req.query === 'object' ? req.query : {};
  const b = req.body && typeof req.body === 'object' ? req.body : {};
  return { ...q, ...b };
}

async function handleCallback(req, res) {
  const payload = mergePayload(req);
  const clientReference = extractHubtelClientReference(payload);
  if (!clientReference) {
    return res.status(400).json({ error: 'Missing ClientReference' });
  }

  if (hubtelPaymentSucceeded(payload)) {
    const enriched = {
      ...payload,
      TransactionId: hubtelProviderReference(payload) || undefined,
    };
    const result = await markTransactionPaidByReference(clientReference, enriched);
    return res.status(200).json({
      received: true,
      paid: result.ok !== false && result.reason !== 'not_found',
      ...result,
    });
  }

  if (hubtelPaymentExplicitlyFailed(payload)) {
    await markTransactionFailedByReference(clientReference, payload);
    return res.status(200).json({ received: true, paid: false, failed: true, clientReference });
  }

  return res.status(200).json({ received: true, paid: false, pending: true, clientReference });
}

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
