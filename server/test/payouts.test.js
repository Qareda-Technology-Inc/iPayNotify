import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { config } from '../src/config.js';
import { OrgLedgerEntry, Organization, WithdrawalRequest } from '../src/models/index.js';
import { appendLedgerEntry, getOrgAvailableBalanceCents, requestWithdrawal } from '../src/services/orgWalletService.js';
import { updatePayoutSettings } from '../src/services/platformSettingsService.js';
import {
  processNewWithdrawal,
  reconcileProcessingWithdrawals,
  reconcileWithdrawalTransfer,
  sendWithdrawalToMomo,
} from '../src/services/payoutService.js';
import { createOrg } from './helpers/fixtures.js';

const realFetch = globalThis.fetch;

/**
 * Fake Paystack Transfers. `state.transfer`: what POST /transfer answers (success | pending | otp | failed);
 * `state.verify`: what verify answers. Calls land in the returned array.
 */
function fakePaystack(state) {
  const calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (!u.startsWith('https://paystack.test/')) throw new Error(`Unexpected network call in test: ${u}`);
    const body = opts.body ? JSON.parse(opts.body) : null;
    const path = u.slice('https://paystack.test'.length);
    calls.push({ path, body });
    if (path === '/transferrecipient') {
      return Response.json({ status: true, data: { recipient_code: `RCP_${body.account_number}` } });
    }
    if (path === '/transfer') {
      if (state.transfer === 'failed') {
        return Response.json({ status: false, message: 'Your balance is not enough to fulfil this request' }, { status: 400 });
      }
      return Response.json({ status: true, data: { reference: body.reference, status: state.transfer, amount: body.amount } });
    }
    if (path.startsWith('/transfer/verify/')) {
      if (state.verify === 'missing') return Response.json({ status: false, message: 'Transfer not found' }, { status: 404 });
      return Response.json({ status: true, data: { status: state.verify, amount: 1000, reason: '' } });
    }
    throw new Error(`Unexpected Paystack path in test: ${path}`);
  };
  return calls;
}

async function orgWithBalance(cents, billing = {}) {
  const org = await createOrg({ billing: { payoutMomoNumber: '0241234567', ...billing } });
  if (cents) await appendLedgerEntry({ organizationId: org._id, type: 'adjustment', amountCents: cents, note: 'test' });
  return org;
}

async function ask(org, amountCents) {
  const doc = await requestWithdrawal({ organizationId: org._id, amountCents });
  return { doc, out: await processNewWithdrawal(doc) };
}

const LIMITS = { autoEnabled: true, maxAutoCents: 50_000, dailyAutoCents: 80_000, newNumberHoldHours: 48, firstNeedsApproval: false };

describe('automatic vendor payouts', () => {
  const saved = {};
  let calls;
  let state;

  beforeAll(() => {
    saved.key = config.paystack.secretKey;
    saved.base = config.paystack.baseUrl;
    config.paystack.secretKey = 'sk_test_fake';
    config.paystack.baseUrl = 'https://paystack.test';
  });
  afterAll(() => {
    config.paystack.secretKey = saved.key;
    config.paystack.baseUrl = saved.base;
    globalThis.fetch = realFetch;
  });
  beforeEach(async () => {
    state = { transfer: 'success', verify: 'success' };
    calls = fakePaystack(state);
    await updatePayoutSettings(LIMITS);
  });

  it('pays straight to the saved MoMo number within the limits and debits the wallet', async () => {
    const org = await orgWithBalance(100_000);
    const { doc, out } = await ask(org, 20_000);
    expect(out.status).toBe('paid');
    const recipient = calls.find((c) => c.path === '/transferrecipient');
    expect(recipient.body).toMatchObject({ type: 'mobile_money', account_number: '0241234567', bank_code: 'MTN' });
    const transfer = calls.find((c) => c.path === '/transfer');
    expect(transfer.body).toMatchObject({ amount: 20_000, recipient: 'RCP_0241234567', reference: `wd_${doc._id}_1` });
    expect(await getOrgAvailableBalanceCents(org._id)).toBe(80_000);
    expect((await WithdrawalRequest.findById(doc._id)).payoutMethod).toBe('auto');
  });

  it('waits for approval when automatic payouts are off', async () => {
    await updatePayoutSettings({ autoEnabled: false });
    const org = await orgWithBalance(100_000);
    const { out } = await ask(org, 1_000);
    expect(out).toMatchObject({ status: 'pending', holdReason: 'Automatic payouts are turned off' });
    expect(calls).toHaveLength(0);
  });

  it('waits for approval above the single-payout limit', async () => {
    const org = await orgWithBalance(100_000);
    const { out } = await ask(org, 60_000);
    expect(out.status).toBe('pending');
    expect(out.holdReason).toContain('GHS 500.00');
    expect(calls).toHaveLength(0);
  });

  it('waits for approval once the daily automatic total is used up', async () => {
    const org = await orgWithBalance(200_000);
    expect((await ask(org, 50_000)).out.status).toBe('paid');
    const second = await ask(org, 40_000);
    expect(second.out.status).toBe('pending');
    expect(second.out.holdReason).toContain('daily');
  });

  it('waits for approval soon after the payout number changed', async () => {
    const org = await orgWithBalance(100_000, { payoutMomoChangedAt: new Date(Date.now() - 60 * 60 * 1000) });
    const { out } = await ask(org, 1_000);
    expect(out.status).toBe('pending');
    expect(out.holdReason).toContain('Payout number changed');
  });

  it('can hold each organisation\'s first withdrawal', async () => {
    await updatePayoutSettings({ firstNeedsApproval: true });
    const org = await orgWithBalance(100_000);
    expect((await ask(org, 1_000)).out.holdReason).toBe('First withdrawal for this organisation');
  });

  it('sends it back for approval, without touching the wallet, when Paystack refuses', async () => {
    state.transfer = 'failed';
    const org = await orgWithBalance(100_000);
    const { doc, out } = await ask(org, 1_000);
    expect(out.status).toBe('pending');
    const after = await WithdrawalRequest.findById(doc._id);
    expect(after.holdReason).toContain('balance is not enough');
    expect(await getOrgAvailableBalanceCents(org._id)).toBe(100_000);
  });

  it('settles a pending transfer from the webhook check, once only', async () => {
    state.transfer = 'pending';
    const org = await orgWithBalance(100_000);
    const { doc, out } = await ask(org, 1_000);
    expect(out.status).toBe('processing');
    const ref = `wd_${doc._id}_1`;
    await reconcileWithdrawalTransfer(ref);
    await reconcileWithdrawalTransfer(ref);
    expect((await WithdrawalRequest.findById(doc._id)).status).toBe('paid');
    expect(await OrgLedgerEntry.countDocuments({ withdrawalId: doc._id, type: 'withdrawal' })).toBe(1);
    expect(await getOrgAvailableBalanceCents(org._id)).toBe(99_000);
  });

  it('puts the money back when Paystack reverses a paid transfer', async () => {
    const org = await orgWithBalance(100_000);
    const { doc } = await ask(org, 1_000);
    state.verify = 'reversed';
    await reconcileWithdrawalTransfer(`wd_${doc._id}_1`);
    expect((await WithdrawalRequest.findById(doc._id)).status).toBe('pending');
    expect(await getOrgAvailableBalanceCents(org._id)).toBe(100_000);
  });

  it('gives up on a transfer Paystack never heard of after a while', async () => {
    state.transfer = 'pending';
    state.verify = 'missing';
    const org = await orgWithBalance(100_000);
    const { doc } = await ask(org, 1_000);
    await WithdrawalRequest.collection.updateOne({ _id: doc._id }, { $set: { updatedAt: new Date(Date.now() - 31 * 60 * 1000) } });
    const summary = await reconcileProcessingWithdrawals();
    expect(summary.checked).toBe(1);
    expect((await WithdrawalRequest.findById(doc._id)).status).toBe('pending');
  });

  it('lets a platform admin send a held withdrawal, with a new reference each attempt', async () => {
    const org = await orgWithBalance(100_000);
    const { doc } = await ask(org, 60_000);
    state.transfer = 'failed';
    await sendWithdrawalToMomo(doc._id);
    state.transfer = 'success';
    const out = await sendWithdrawalToMomo(doc._id);
    expect(out.status).toBe('paid');
    const refs = calls.filter((c) => c.path === '/transfer').map((c) => c.body.reference);
    expect(refs).toEqual([`wd_${doc._id}_1`, `wd_${doc._id}_2`]);
    expect((await WithdrawalRequest.findById(doc._id)).payoutMethod).toBe('manual');
  });

  it('never sends one withdrawal twice', async () => {
    state.transfer = 'pending';
    const org = await orgWithBalance(100_000);
    const { doc } = await ask(org, 1_000);
    await expect(sendWithdrawalToMomo(doc._id)).rejects.toThrow(/already processing/);
    expect(calls.filter((c) => c.path === '/transfer')).toHaveLength(1);
  });

  it('makes a new recipient when the payout number changes', async () => {
    const org = await orgWithBalance(100_000);
    await ask(org, 1_000);
    await Organization.updateOne({ _id: org._id }, { $set: { 'billing.payoutMomoNumber': '0201234567' } });
    await ask(org, 1_000);
    const recipients = calls.filter((c) => c.path === '/transferrecipient').map((c) => c.body);
    expect(recipients.map((r) => r.bank_code)).toEqual(['MTN', 'VOD']);
  });

  it('rejects limits that are not numbers', async () => {
    await expect(updatePayoutSettings({ maxAutoCents: 'lots' })).rejects.toThrow(/Largest automatic payout/);
  });
});
