import express from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { verifyWebhookSignature } from '../integrations/paystack.js';
import { reconcilePaystackPayment } from '../services/paymentService.js';

export const paystackPaymentsRouter = express.Router();

/**
 * Paystack webhook (Dashboard → Settings → API Keys & Webhooks):
 *   https://<api host>/api/payments/paystack/webhook
 * Signed with the secret key. It only triggers a verify call; that answer is what marks a payment paid.
 */
paystackPaymentsRouter.post(
  '/webhook',
  asyncHandler(async (req, res) => {
    if (!verifyWebhookSignature(req.rawBody, req.get('x-paystack-signature'))) {
      return res.status(401).json({ error: 'Invalid signature' });
    }
    const event = String(req.body?.event || '');
    const reference = String(req.body?.data?.reference || '').trim();
    if (reference && /^charge\.(success|failed)$/.test(event)) {
      const out = await reconcilePaystackPayment(reference);
      console.log('[paystack.webhook]', event, reference, out.status || out.reason);
    }
    res.json({ ok: true });
  })
);
