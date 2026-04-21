import express from 'express';
import {
  extractMomoClientReference,
  momoPaymentSucceeded,
  momoPaymentExplicitlyFailed,
} from '../integrations/mtnMomo.js';
import {
  markTransactionPaidByReference,
  markTransactionFailedByReference,
} from '../services/paymentService.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

export const momoPaymentsRouter = express.Router();

function mergePayload(req) {
  const q = req.query && typeof req.query === 'object' ? req.query : {};
  const b = req.body && typeof req.body === 'object' ? req.body : {};
  return { ...q, ...b };
}

async function handleCallback(req, res) {
  const payload = mergePayload(req);
  const clientReference = extractMomoClientReference(payload);
  if (!clientReference) {
    return res.status(400).json({ error: 'Missing externalId (client reference)' });
  }

  if (momoPaymentSucceeded(payload)) {
    const result = await markTransactionPaidByReference(clientReference, payload);
    return res.status(200).json({
      received: true,
      paid: result.ok !== false && result.reason !== 'not_found',
      ...result,
    });
  }

  if (momoPaymentExplicitlyFailed(payload)) {
    await markTransactionFailedByReference(clientReference, payload);
    return res.status(200).json({ received: true, paid: false, failed: true, clientReference });
  }

  return res.status(200).json({ received: true, paid: false, pending: true, clientReference });
}

momoPaymentsRouter.post(
  '/callback',
  asyncHandler(async (req, res) => {
    await handleCallback(req, res);
  })
);

momoPaymentsRouter.get(
  '/callback',
  asyncHandler(async (req, res) => {
    await handleCallback(req, res);
  })
);
