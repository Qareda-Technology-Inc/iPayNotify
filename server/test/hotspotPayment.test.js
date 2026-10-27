import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  pushSavedVouchersToRouter: vi.fn(),
  notifyTransactionPaidSms: vi.fn(),
  notifyTransactionPaidAdminEmail: vi.fn(),
}));

/* The router (MikroTik) and SMS/email are the only things faked; codes and DB writes are real. */
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

const { HotspotVoucher, Organization, PlanPackage, Transaction, User } = await import('../src/models/index.js');
const {
  createHotspotPurchaseCheckout,
  fulfillPaidTransaction,
  markTransactionPaidByReference,
  retryPaidFulfillments,
} = await import('../src/services/paymentService.js');
const { createHotspotPackage, createOrg, createRouter, reloadTx, setPlatformFee } = await import(
  './helpers/fixtures.js'
);

const MSISDN = '0241234567';

describe('createHotspotPurchaseCheckout', () => {
  let org;
  let router;
  let pkg;

  beforeEach(async () => {
    org = await createOrg();
    router = await createRouter(org);
    pkg = await createHotspotPackage(org, { priceCents: 500 });
  });

  const checkout = (overrides = {}) =>
    createHotspotPurchaseCheckout({
      packageId: pkg._id,
      routerId: router._id,
      customerMsisdn: MSISDN,
      ...overrides,
    });

  it('creates a pending voucher transaction priced from the database', async () => {
    const out = await checkout();
    expect(out.mode).toBe('hubtel_checkout');
    expect(out.purchaseInfo.amount).toBe(5);
    expect(out.hubtelConfig.callbackUrl).toBe('https://api.test/api/payments/hubtel/callback');

    const tx = await Transaction.findOne({ clientReference: out.clientReference }).lean();
    expect(tx).toMatchObject({ status: 'pending', kind: 'voucher', amountCents: 500 });
    expect(String(tx.organizationId)).toBe(String(org._id));
    expect(tx.meta.routerId).toBe(String(router._id));
    expect(tx.customerPhone).toBe('233241234567');
  });

  it('rejects a deactivated package even when posted by id', async () => {
    await PlanPackage.updateOne({ _id: pkg._id }, { $set: { isActive: false } });
    await expect(checkout()).rejects.toMatchObject({ status: 400, message: 'This package is no longer available' });
    expect(await Transaction.countDocuments()).toBe(0);
  });

  it('still sells a package hidden from the login-page plan list', async () => {
    await PlanPackage.updateOne({ _id: pkg._id }, { $set: { showOnPortal: false } });
    await expect(checkout()).resolves.toMatchObject({ mode: 'hubtel_checkout' });
  });

  it('rejects a package from another organisation', async () => {
    const other = await createHotspotPackage(await createOrg(), { priceCents: 100 });
    await expect(checkout({ packageId: other._id })).rejects.toMatchObject({ status: 400 });
  });

  it('rejects a free or non-hotspot package', async () => {
    const free = await createHotspotPackage(org, { priceCents: 0 });
    await expect(checkout({ packageId: free._id })).rejects.toMatchObject({ status: 400 });
    const pppoe = await createHotspotPackage(org, { kind: 'pppoe' });
    await expect(checkout({ packageId: pppoe._id })).rejects.toMatchObject({ status: 400 });
  });

  it('links the buyer to an existing customer with the same phone', async () => {
    const user = await User.create({ organizationId: org._id, phone: MSISDN, fullName: 'Ama' });
    const out = await checkout();
    const tx = await Transaction.findOne({ clientReference: out.clientReference }).lean();
    expect(String(tx.userId)).toBe(String(user._id));
  });
});

describe('voucher fulfilment after payment', () => {
  let org;
  let reference;

  beforeEach(async () => {
    mocks.pushSavedVouchersToRouter.mockReset().mockResolvedValue({ pushed: 1, failed: [] });
    mocks.notifyTransactionPaidSms.mockReset().mockResolvedValue({ sent: true });
    mocks.notifyTransactionPaidAdminEmail.mockReset().mockResolvedValue({ sent: true });
    org = await createOrg();
    await setPlatformFee(1000);
    const router = await createRouter(org);
    const pkg = await createHotspotPackage(org, { priceCents: 1000 });
    const out = await createHotspotPurchaseCheckout({
      packageId: pkg._id,
      routerId: router._id,
      customerMsisdn: MSISDN,
    });
    reference = out.clientReference;
  });

  const tx = () => Transaction.findOne({ clientReference: reference }).lean();

  it('creates one online voucher, pushes it, SMSes the code and credits the wallet', async () => {
    await markTransactionPaidByReference(reference, { TransactionId: 'HUB-2' });
    const saved = await tx();
    const vouchers = await HotspotVoucher.find().lean();

    expect(saved.status).toBe('paid');
    expect(saved.meta.fulfillment).toBe('done');
    expect(vouchers).toHaveLength(1);
    expect(vouchers[0]).toMatchObject({ source: 'online', code: saved.meta.voucherCode });
    expect(mocks.pushSavedVouchersToRouter).toHaveBeenCalledTimes(1);
    expect(mocks.notifyTransactionPaidSms.mock.calls[0][1]).toMatchObject({
      kind: 'voucher',
      code: saved.meta.voucherCode,
    });
    expect(saved.orgNetCents).toBe(900);
    expect((await Organization.findById(org._id).lean()).walletBalanceCents).toBe(900);
  });

  it('keeps the paid code when the router is offline and pushes the same code on retry', async () => {
    mocks.pushSavedVouchersToRouter.mockRejectedValueOnce(new Error('router offline'));
    await markTransactionPaidByReference(reference, {});
    const afterFailure = await tx();
    expect(afterFailure.status).toBe('paid');
    expect(afterFailure.meta.fulfillment).toBe('router_pending');
    expect(afterFailure.meta.voucherCode).toMatch(/^\d{6}$/);
    expect(mocks.notifyTransactionPaidSms).not.toHaveBeenCalled();

    const summary = await retryPaidFulfillments();
    const afterRetry = await tx();
    expect(summary.done).toBe(1);
    expect(afterRetry.meta.fulfillment).toBe('done');
    expect(afterRetry.meta.voucherCode).toBe(afterFailure.meta.voucherCode);
    expect(await HotspotVoucher.countDocuments()).toBe(1);
    expect(mocks.notifyTransactionPaidSms).toHaveBeenCalledTimes(1);
  });

  it('creates a single voucher when fulfilment runs concurrently', async () => {
    await Transaction.updateOne({ clientReference: reference }, { $set: { status: 'paid' } });
    const row = await tx();
    await Promise.all([fulfillPaidTransaction({ _id: row._id }), fulfillPaidTransaction({ _id: row._id })]);
    expect(await HotspotVoucher.countDocuments()).toBe(1);
  });

  it('does nothing for a transaction that is not paid', async () => {
    const row = await tx();
    expect(await fulfillPaidTransaction({ _id: row._id })).toMatchObject({ ok: false, reason: 'not_paid' });
    expect(await HotspotVoucher.countDocuments()).toBe(0);
    expect((await reloadTx(row)).meta.fulfillment).toBe('pending');
  });
});
