import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { config } from '../src/config.js';
import { Organization } from '../src/models/index.js';
import { hubtelPaymentsRouter } from '../src/routes/hubtelPayments.js';
import {
  expireStalePendingPayments,
  reconcilePaymentFromHubtelStatus,
  releaseHeldCallbackPayment,
} from '../src/services/paymentService.js';
import { fakeHubtelStatus } from './helpers/network.js';
import {
  ageTransaction,
  createOrg,
  createPendingTx,
  reloadTx,
  setPlatformFee,
} from './helpers/fixtures.js';

let server;
let base;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/payments/hubtel', hubtelPaymentsRouter);
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}/api/payments/hubtel`;
});

afterAll(() => server?.close());

const postCallback = async (body) => {
  const res = await fetch(`${base}/callback`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
};

/** Shape Hubtel actually sends (see docs/hubtel-uat-pack/samples). */
const successBody = (tx, amountGhs = tx.amountCents / 100) => ({
  ResponseCode: '0000',
  Status: 'Success',
  Data: { ClientReference: tx.clientReference, Amount: amountGhs, TransactionId: 'HUB-CB-1' },
});

describe('Hubtel success callback', () => {
  let org;
  let hubtel;

  beforeEach(async () => {
    org = await createOrg();
    await setPlatformFee(500);
    hubtel = { mode: 'paid', amountGhs: 5 };
    fakeHubtelStatus(hubtel);
  });

  it('no longer accepts GET (query-string forgery)', async () => {
    const tx = await createPendingTx(org);
    const res = await fetch(`${base}/callback?ClientReference=${tx.clientReference}&ResponseCode=0000`);
    expect(res.status).toBe(404);
    expect((await reloadTx(tx)).status).toBe('pending');
  });

  it('refuses a callback without an amount', async () => {
    const tx = await createPendingTx(org);
    const out = await postCallback({ ClientReference: tx.clientReference, ResponseCode: '0000' });
    expect(out.reason).toBe('amount_missing');
    expect((await reloadTx(tx)).status).toBe('pending');
  });

  it('refuses a callback with the wrong amount', async () => {
    const tx = await createPendingTx(org);
    const out = await postCallback(successBody(tx, 0.01));
    expect(out.reason).toBe('amount_mismatch');
    expect((await reloadTx(tx)).status).toBe('pending');
  });

  it('refuses a forged callback when Hubtel says Unpaid', async () => {
    hubtel.mode = 'unpaid';
    const tx = await createPendingTx(org);
    const out = await postCallback(successBody(tx));
    const saved = await reloadTx(tx);
    expect(out.reason).toBe('not_paid_at_hubtel');
    expect(saved.status).toBe('pending');
    expect(saved.meta.callbackRejected.reason).toBe('not_paid_at_hubtel');
  });

  it('refuses when Hubtel reports Paid for a different amount', async () => {
    hubtel.amountGhs = 1;
    const tx = await createPendingTx(org);
    const out = await postCallback(successBody(tx));
    expect(out.reason).toBe('amount_mismatch');
    expect((await reloadTx(tx)).status).toBe('pending');
  });

  it('accepts a Paid amount that includes the customer’s MoMo charges', async () => {
    hubtel.amountGhs = 5.1;
    const tx = await createPendingTx(org);
    await postCallback(successBody(tx, 5.1));
    expect((await reloadTx(tx)).status).toBe('paid');
  });

  it('marks a genuine payment paid and credits the wallet net of fee', async () => {
    const tx = await createPendingTx(org);
    const out = await postCallback(successBody(tx));
    const saved = await reloadTx(tx);
    expect(out.received).toBe(true);
    expect(saved.status).toBe('paid');
    expect(saved.providerReference).toBe('HUB-CB-1');
    expect(saved.platformFeeCents).toBe(25);
    expect(saved.orgNetCents).toBe(475);
    expect((await Organization.findById(org._id).lean()).walletBalanceCents).toBe(475);
  });

  it('does not credit the wallet twice on a duplicate callback', async () => {
    const tx = await createPendingTx(org);
    await postCallback(successBody(tx));
    await postCallback(successBody(tx));
    expect((await Organization.findById(org._id).lean()).walletBalanceCents).toBe(475);
  });

  it('credits once when callbacks race', async () => {
    const tx = await createPendingTx(org);
    await Promise.all([postCallback(successBody(tx)), postCallback(successBody(tx)), postCallback(successBody(tx))]);
    expect((await reloadTx(tx)).status).toBe('paid');
    expect((await Organization.findById(org._id).lean()).walletBalanceCents).toBe(475);
  });
});

describe('when Hubtel Status Check is unavailable', () => {
  let org;
  let hubtel;

  beforeEach(async () => {
    org = await createOrg();
    await setPlatformFee(500);
    hubtel = { mode: 'blocked', amountGhs: 5 };
    fakeHubtelStatus(hubtel);
  });

  it('holds the payment as pending, flagged unverified', async () => {
    const tx = await createPendingTx(org);
    const out = await postCallback(successBody(tx));
    const saved = await reloadTx(tx);
    expect(out.pendingVerification).toBe(true);
    expect(out.paid).toBe(false);
    expect(saved.status).toBe('pending');
    expect(saved.meta.callbackUnverified.reason).toBe('status_check_ip_blocked');
  });

  it('treats a network failure the same way', async () => {
    hubtel.mode = 'down';
    const tx = await createPendingTx(org);
    const out = await postCallback(successBody(tx));
    expect(out.pendingVerification).toBe(true);
    expect((await reloadTx(tx)).status).toBe('pending');
  });

  it('keeps an unverified payment through stale expiry, then applies it once Hubtel answers', async () => {
    const tx = await createPendingTx(org);
    await postCallback(successBody(tx));
    await ageTransaction(tx, 30);

    const whileBlocked = await expireStalePendingPayments({ maxAgeHours: 24 });
    expect(whileBlocked.held).toBe(1);
    expect((await reloadTx(tx)).status).toBe('pending');

    hubtel.mode = 'paid';
    const afterWhitelist = await expireStalePendingPayments({ maxAgeHours: 24 });
    const saved = await reloadTx(tx);
    expect(afterWhitelist.rescued).toBe(1);
    expect(saved.status).toBe('paid');
    expect(saved.meta.walletSettled).toBe(true);
  });

  it('still expires abandoned checkouts that never got a callback', async () => {
    const tx = await createPendingTx(org);
    await ageTransaction(tx, 30);
    const out = await expireStalePendingPayments({ maxAgeHours: 24 });
    expect(out.expired).toBe(1);
    expect((await reloadTx(tx)).status).toBe('failed');
  });

  it('trusts the callback only when HUBTEL_TRUST_UNVERIFIED_CALLBACKS is on', async () => {
    config.hubtel.trustUnverifiedCallbacks = true;
    try {
      const tx = await createPendingTx(org);
      await postCallback(successBody(tx));
      const saved = await reloadTx(tx);
      expect(saved.status).toBe('paid');
      expect(saved.meta.callback.paidUnverified).toBe(true);

      const noAmount = await createPendingTx(org);
      const out = await postCallback({ ClientReference: noAmount.clientReference, ResponseCode: '0000' });
      expect(out.reason).toBe('amount_missing');
    } finally {
      config.hubtel.trustUnverifiedCallbacks = false;
    }
  });

  it('releases payments held while blocked once HUBTEL_TRUST_UNVERIFIED_CALLBACKS is turned on', async () => {
    hubtel.mode = 'blocked';
    const tx = await createPendingTx(org);
    await postCallback(successBody(tx));
    expect((await reloadTx(tx)).status).toBe('pending');

    config.hubtel.trustUnverifiedCallbacks = true;
    try {
      const out = await reconcilePaymentFromHubtelStatus(tx.clientReference);
      const saved = await reloadTx(tx);
      expect(out.status).toBe('paid');
      expect(saved.status).toBe('paid');
      expect(saved.meta.callback.releasedVia).toBe('trust_flag');
      expect(saved.meta.walletSettled).toBe(true);
    } finally {
      config.hubtel.trustUnverifiedCallbacks = false;
    }
  });

  it('a held payment can be confirmed by hand; a checkout with no callback cannot', async () => {
    hubtel.mode = 'blocked';
    const held = await createPendingTx(org);
    await postCallback(successBody(held));
    const out = await releaseHeldCallbackPayment(held.clientReference, { releasedVia: 'super_admin' });
    expect(out.reason).not.toBe('not_held');
    expect((await reloadTx(held)).status).toBe('paid');

    const noCallback = await createPendingTx(org);
    expect(await releaseHeldCallbackPayment(noCallback.clientReference)).toMatchObject({ ok: false, reason: 'not_held' });
    expect((await reloadTx(noCallback)).status).toBe('pending');
  });
});
