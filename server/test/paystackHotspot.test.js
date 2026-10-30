import crypto from 'crypto';
import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  pushSavedVouchersToRouter: vi.fn(),
  notifyTransactionPaidSms: vi.fn(),
  notifyTransactionPaidAdminEmail: vi.fn(),
}));

/* The router (MikroTik), SMS/email and Paystack itself are faked; codes and DB writes are real. */
vi.mock('../src/services/hotspotService.js', async (importOriginal) => ({
  ...(await importOriginal()),
  pushSavedVouchersToRouter: mocks.pushSavedVouchersToRouter,
}));
vi.mock('../src/services/paymentSmsService.js', () => ({
  notifyTransactionPaidSms: mocks.notifyTransactionPaidSms,
}));
vi.mock('../src/services/paymentAdminNotifyService.js', () => ({
  notifyTransactionPaidAdminEmail: mocks.notifyTransactionPaidAdminEmail,
}));

const { config } = await import('../src/config.js');
const { HotspotVoucher, Transaction } = await import('../src/models/index.js');
const {
  createHotspotPurchaseCheckout,
  expireStalePendingPayments,
  reconcilePaystackPayment,
  submitPaystackOtp,
} = await import('../src/services/paymentService.js');
const { momoProviderForMsisdn } = await import('../src/integrations/paystack.js');
const { paystackPaymentsRouter } = await import('../src/routes/paystackPayments.js');
const { ageTransaction, createHotspotPackage, createOrg, createRouter } = await import('./helpers/fixtures.js');

const SECRET = 'sk_test_fake';
const realFetch = globalThis.fetch;

/**
 * Fake Paystack. `state.charge`: what POST /charge answers (pay_offline | send_otp | failed);
 * `state.verify`: what verify answers (success | failed | ongoing); `state.amount` in pesewas.
 */
function fakePaystack(state) {
  const calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (/^http:\/\/127\.0\.0\.1:\d+\//.test(u)) return realFetch(url, opts);
    if (!u.startsWith('https://paystack.test/')) throw new Error(`Unexpected network call in test: ${u}`);
    const body = opts.body ? JSON.parse(opts.body) : null;
    calls.push({ path: u.slice('https://paystack.test'.length), body, auth: opts.headers?.Authorization });
    if (u.endsWith('/charge')) {
      return Response.json({
        status: true,
        data: { reference: body.reference, status: state.charge, display_text: 'Approve on your phone' },
      });
    }
    if (u.endsWith('/charge/submit_otp')) {
      return Response.json({ status: true, data: { reference: body.reference, status: state.otp || 'pay_offline' } });
    }
    if (u.includes('/transaction/verify/')) {
      return Response.json({
        status: true,
        data: { id: 9001, status: state.verify, amount: state.amount, currency: 'GHS', gateway_response: 'Approved' },
      });
    }
    throw new Error(`Unexpected Paystack path in test: ${u}`);
  };
  return calls;
}

describe('hotspot purchase with Paystack Mobile Money', () => {
  let org;
  let router;
  let pkg;
  const saved = {};

  beforeAll(() => {
    saved.provider = config.hotspotPaymentProvider;
    saved.key = config.paystack.secretKey;
    config.hotspotPaymentProvider = 'paystack';
    config.paystack.secretKey = SECRET;
  });
  afterAll(() => {
    config.hotspotPaymentProvider = saved.provider;
    config.paystack.secretKey = saved.key;
  });

  beforeEach(async () => {
    mocks.pushSavedVouchersToRouter.mockReset().mockResolvedValue({ pushed: 1, failed: [] });
    mocks.notifyTransactionPaidSms.mockReset().mockResolvedValue({ sent: true });
    mocks.notifyTransactionPaidAdminEmail.mockReset().mockResolvedValue({ sent: true });
    org = await createOrg();
    router = await createRouter(org);
    pkg = await createHotspotPackage(org, { priceCents: 500 });
  });

  const buy = (overrides = {}) =>
    createHotspotPurchaseCheckout({ packageId: pkg._id, routerId: router._id, customerMsisdn: '0241234567', ...overrides });

  it('detects the network from the number', () => {
    expect(momoProviderForMsisdn('0241234567')).toBe('mtn');
    expect(momoProviderForMsisdn('233201234567')).toBe('vod');
    expect(momoProviderForMsisdn('0571234567')).toBe('atl');
    expect(momoProviderForMsisdn('0311234567')).toBe('');
  });

  it('sends a MoMo prompt for the database price and waits for approval', async () => {
    const calls = fakePaystack({ charge: 'pay_offline' });
    const out = await buy();
    expect(out).toMatchObject({ mode: 'paystack_momo', next: 'approve', momoProvider: 'mtn' });
    expect(calls[0]).toMatchObject({
      path: '/charge',
      auth: `Bearer ${SECRET}`,
      body: { amount: 500, currency: 'GHS', reference: out.clientReference, mobile_money: { phone: '0241234567', provider: 'mtn' } },
    });
    const tx = await Transaction.findOne({ clientReference: out.clientReference }).lean();
    expect(tx).toMatchObject({ status: 'pending', provider: 'paystack', kind: 'voucher' });
  });

  it('asks for a network when it cannot tell from the number', async () => {
    fakePaystack({ charge: 'pay_offline' });
    await expect(buy({ customerMsisdn: '0311234567' })).rejects.toMatchObject({ status: 400 });
    const out = await buy({ customerMsisdn: '0311234567', momoProvider: 'telecel' });
    expect(out.momoProvider).toBe('vod');
  });

  it('delivers the voucher once Paystack verify says paid, only once', async () => {
    const state = { charge: 'pay_offline', verify: 'ongoing', amount: 500 };
    fakePaystack(state);
    const { clientReference } = await buy();

    expect((await reconcilePaystackPayment(clientReference)).status).toBe('pending');
    state.verify = 'success';
    expect(await reconcilePaystackPayment(clientReference)).toMatchObject({ status: 'paid', applied: true });
    expect(await reconcilePaystackPayment(clientReference)).toMatchObject({ status: 'paid', applied: false });

    const tx = await Transaction.findOne({ clientReference }).lean();
    expect(tx.meta.fulfillment).toBe('done');
    expect(tx.providerReference).toBe('9001');
    expect(await HotspotVoucher.countDocuments()).toBe(1);
    expect(mocks.notifyTransactionPaidSms).toHaveBeenCalledTimes(1);
  });

  it('never marks paid when Paystack collected less than the price', async () => {
    fakePaystack({ charge: 'pay_offline', verify: 'success', amount: 100 });
    const { clientReference } = await buy();
    expect(await reconcilePaystackPayment(clientReference)).toMatchObject({ reason: 'amount_mismatch' });
    expect((await Transaction.findOne({ clientReference }).lean()).status).toBe('pending');
    expect(await HotspotVoucher.countDocuments()).toBe(0);
  });

  it('marks a declined payment failed', async () => {
    fakePaystack({ charge: 'pay_offline', verify: 'failed', amount: 500 });
    const { clientReference } = await buy();
    expect((await reconcilePaystackPayment(clientReference)).status).toBe('failed');
    expect((await Transaction.findOne({ clientReference }).lean()).status).toBe('failed');
  });

  it('fails straight away when Paystack refuses the charge', async () => {
    fakePaystack({ charge: 'failed' });
    await expect(buy()).rejects.toMatchObject({ status: 402 });
    expect((await Transaction.findOne().lean()).status).toBe('failed');
  });

  it('handles networks that send an OTP first', async () => {
    const state = { charge: 'send_otp', otp: 'pay_offline' };
    const calls = fakePaystack(state);
    const out = await buy();
    expect(out.next).toBe('otp');
    await expect(submitPaystackOtp(out.clientReference, 'abc')).rejects.toMatchObject({ status: 400 });
    const after = await submitPaystackOtp(out.clientReference, '123456');
    expect(after.next).toBe('approve');
    expect(calls.at(-1)).toMatchObject({ path: '/charge/submit_otp', body: { otp: '123456', reference: out.clientReference } });
  });

  it('checks Paystack, not Hubtel, before expiring an old pending payment', async () => {
    const state = { charge: 'pay_offline', verify: 'success', amount: 500 };
    fakePaystack(state);
    const { clientReference } = await buy();
    await ageTransaction(await Transaction.findOne({ clientReference }), 30);
    const summary = await expireStalePendingPayments({ maxAgeHours: 24 });
    expect(summary).toMatchObject({ rescued: 1, expired: 0 });
    expect((await Transaction.findOne({ clientReference }).lean()).status).toBe('paid');
  });
});

describe('Paystack webhook', () => {
  let server;
  let base;
  const saved = {};

  beforeAll(async () => {
    saved.key = config.paystack.secretKey;
    config.paystack.secretKey = SECRET;
    const app = express();
    app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } }));
    app.use('/api/payments/paystack', paystackPaymentsRouter);
    server = app.listen(0);
    base = `http://127.0.0.1:${server.address().port}/api/payments/paystack`;
  });
  afterAll(() => {
    config.paystack.secretKey = saved.key;
    server?.close();
  });

  const post = (payload, signature) => {
    const body = JSON.stringify(payload);
    return fetch(`${base}/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-paystack-signature': signature ?? crypto.createHmac('sha512', SECRET).update(body).digest('hex'),
      },
      body,
    });
  };

  it('refuses an unsigned or wrongly signed webhook', async () => {
    expect((await post({ event: 'charge.success', data: { reference: 'QF-x' } }, 'bad')).status).toBe(401);
  });

  it('verifies with Paystack before applying a signed charge.success', async () => {
    const org = await createOrg();
    const router = await createRouter(org);
    const pkg = await createHotspotPackage(org, { priceCents: 500 });
    const tx = await Transaction.create({
      organizationId: org._id,
      packageId: pkg._id,
      amountCents: 500,
      currency: 'GHS',
      status: 'pending',
      kind: 'voucher',
      clientReference: 'QF-paystack-webhook',
      provider: 'paystack',
      meta: { routerId: String(router._id), fulfillment: 'pending' },
    });
    mocks.pushSavedVouchersToRouter.mockReset().mockResolvedValue({ pushed: 1, failed: [] });
    mocks.notifyTransactionPaidSms.mockReset().mockResolvedValue({ sent: true });
    const calls = fakePaystack({ verify: 'success', amount: 500 });

    expect((await post({ event: 'charge.success', data: { reference: tx.clientReference } })).status).toBe(200);
    expect(calls.some((c) => c.path === `/transaction/verify/${tx.clientReference}`)).toBe(true);
    expect((await Transaction.findById(tx._id).lean()).status).toBe('paid');
  });
});
