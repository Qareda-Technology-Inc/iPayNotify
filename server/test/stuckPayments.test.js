import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  sendSmtpMail: vi.fn(),
  sendArkeselSms: vi.fn(),
  pushSavedVouchersToRouter: vi.fn(),
}));

vi.mock('../src/integrations/mail.js', async (importOriginal) => ({
  ...(await importOriginal()),
  sendSmtpMail: mocks.sendSmtpMail,
}));
vi.mock('../src/integrations/arkesel.js', async (importOriginal) => ({
  ...(await importOriginal()),
  sendArkeselSms: mocks.sendArkeselSms,
}));
vi.mock('../src/services/hotspotService.js', async (importOriginal) => ({
  ...(await importOriginal()),
  pushSavedVouchersToRouter: mocks.pushSavedVouchersToRouter,
}));
vi.mock('../src/services/paymentSmsService.js', () => ({ notifyTransactionPaidSms: vi.fn() }));
vi.mock('../src/services/paymentAdminNotifyService.js', () => ({ notifyTransactionPaidAdminEmail: vi.fn() }));

const { Admin, Organization, Transaction } = await import('../src/models/index.js');
const { listStuckPayments, retryStuckPayment, runStuckPaymentAlerts } = await import(
  '../src/services/stuckPaymentService.js'
);
const { generateVouchers } = await import('../src/services/hotspotService.js');
const { ageTransaction, createHotspotPackage, createOrg, createPendingTx, createRouter, setPlatformFee } =
  await import('./helpers/fixtures.js');

describe('stuck payments', () => {
  let org;

  beforeEach(async () => {
    mocks.sendSmtpMail.mockReset().mockResolvedValue({ ok: true });
    mocks.sendArkeselSms.mockReset().mockResolvedValue({ ok: true });
    mocks.pushSavedVouchersToRouter.mockReset().mockResolvedValue(undefined);
    await setPlatformFee(500);
    org = await createOrg();
    await Admin.create({
      email: 'ops@isp.test',
      phone: '0241234567',
      role: 'org_admin',
      organizationId: org._id,
      status: 'active',
    });
  });

  const paidVoucherStuck = async (hoursAgo = 1, extra = {}) => {
    const tx = await createPendingTx(org, {
      status: 'paid',
      kind: 'voucher',
      meta: { fulfillment: 'router_pending', voucherCode: '482193', routerPushError: { error: 'router offline' } },
      ...extra,
    });
    await ageTransaction(tx, hoursAgo);
    return tx;
  };

  it('lists paid-but-undelivered payments with the reason and last error', async () => {
    await paidVoucherStuck();
    const unconfirmed = await createPendingTx(org, { meta: { callbackUnverified: { reason: 'status_check_ip_blocked' } } });
    await ageTransaction(unconfirmed, 1);
    const noWallet = await createPendingTx(org, { status: 'paid', kind: 'voucher', meta: { fulfillment: 'done' } });
    await ageTransaction(noWallet, 1);

    const items = await listStuckPayments({ organizationId: org._id });
    expect(items.map((i) => i.reason).sort()).toEqual(['payment_unconfirmed', 'voucher_not_delivered', 'wallet_not_credited']);
    const voucher = items.find((i) => i.reason === 'voucher_not_delivered');
    expect(voucher).toMatchObject({ lastError: 'router offline', voucherCode: '482193', customerPhone: '233241234567' });
  });

  it('ignores healthy payments, very recent ones, and balance-paid auto-renewals', async () => {
    const done = await createPendingTx(org, {
      status: 'paid',
      kind: 'voucher',
      meta: { fulfillment: 'done', walletSettled: true },
    });
    await ageTransaction(done, 1);
    await paidVoucherStuck(0.1); /* 6 minutes: still being retried normally */
    const autoRenew = await Transaction.create({
      organizationId: org._id,
      amountCents: 500,
      status: 'paid',
      kind: 'renewal',
      providerReference: 'balance',
      meta: { newPaidUntil: new Date().toISOString() },
    });
    await ageTransaction(autoRenew, 1);
    const abandoned = await createPendingTx(org);
    await ageTransaction(abandoned, 1);

    expect(await listStuckPayments({ organizationId: org._id })).toEqual([]);
  });

  it('only shows an organisation its own stuck payments', async () => {
    await paidVoucherStuck();
    const other = await createOrg();
    expect(await listStuckPayments({ organizationId: other._id })).toEqual([]);
  });

  it('sends one email and SMS summary per organisation, once per payment', async () => {
    await paidVoucherStuck();
    await paidVoucherStuck(2);

    const first = await runStuckPaymentAlerts();
    expect(first).toMatchObject({ stuck: 2, organizations: 1, emails: 1, sms: 1 });
    expect(mocks.sendSmtpMail).toHaveBeenCalledTimes(1);
    expect(mocks.sendSmtpMail.mock.calls[0][0]).toMatchObject({ to: 'ops@isp.test', subject: '⚠️ 2 payments need attention' });
    expect(mocks.sendSmtpMail.mock.calls[0][0].text).toContain('voucher code has not reached the router');
    expect(mocks.sendArkeselSms.mock.calls[0][0].message).toMatch(/2 paid payments need attention \(e\.g\. voucher not delivered\)/);

    const second = await runStuckPaymentAlerts();
    expect(second.stuck).toBe(0);
    expect(mocks.sendSmtpMail).toHaveBeenCalledTimes(1);
    /* Still listed until it is actually fixed. */
    expect(await listStuckPayments({ organizationId: org._id })).toHaveLength(2);
  });

  it('Retry delivers the voucher and credits the wallet', async () => {
    const router = await createRouter(org);
    const pkg = await createHotspotPackage(org, { elapsedSeconds: 86400 });
    const [voucher] = await generateVouchers({
      count: 1,
      packageId: pkg._id,
      routerId: router._id,
      organizationId: org._id,
      pushToRouter: false,
      source: 'online',
    });
    const tx = await paidVoucherStuck(1, {
      packageId: pkg._id,
      hotspotVoucherId: voucher._id,
      meta: { fulfillment: 'router_pending', voucherCode: voucher.code, routerId: String(router._id) },
    });

    const out = await retryStuckPayment(tx._id, { organizationId: org._id });
    const saved = await Transaction.findById(tx._id).lean();
    expect(out).toMatchObject({ ok: true, stillStuck: null });
    expect(mocks.pushSavedVouchersToRouter).toHaveBeenCalledTimes(1);
    expect(saved.meta.fulfillment).toBe('done');
    expect(saved.meta.walletSettled).toBe(true);
    expect((await Organization.findById(org._id).lean()).walletBalanceCents).toBe(475);
    expect(await listStuckPayments({ organizationId: org._id })).toEqual([]);
  });

  it('Retry reports what is still wrong when the router is still offline', async () => {
    mocks.pushSavedVouchersToRouter.mockRejectedValue(new Error('router still offline'));
    const router = await createRouter(org);
    const pkg = await createHotspotPackage(org, { elapsedSeconds: 86400 });
    const tx = await paidVoucherStuck(1, { packageId: pkg._id, meta: { fulfillment: 'pending', routerId: String(router._id) } });

    const out = await retryStuckPayment(tx._id, { organizationId: org._id });
    expect(out).toMatchObject({ ok: false, stillStuck: 'voucher_not_delivered' });
    expect(out.item.lastError).toBe('router still offline');
  });

  it('Retry cannot touch another organisation’s payment', async () => {
    const tx = await paidVoucherStuck();
    const other = await createOrg();
    expect(await retryStuckPayment(tx._id, { organizationId: other._id })).toMatchObject({ ok: false, reason: 'not_found' });
  });
});
