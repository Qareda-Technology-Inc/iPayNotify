import { describe, expect, it } from 'vitest';
import { OrgLedgerEntry, Organization } from '../src/models/index.js';
import {
  computeFeeSplit,
  getOrgAvailableBalanceCents,
  settlePaidTransactionToWallet,
} from '../src/services/orgWalletService.js';
import { createOrg, createPendingTx, setPlatformFee } from './helpers/fixtures.js';

describe('computeFeeSplit', () => {
  it('splits gross into platform fee and org net', () => {
    expect(computeFeeSplit(1000, 500)).toEqual({ feeBps: 500, platformFeeCents: 50, orgNetCents: 950 });
  });

  it('rounds the fee to whole pesewas', () => {
    expect(computeFeeSplit(333, 500)).toEqual({ feeBps: 500, platformFeeCents: 17, orgNetCents: 316 });
  });

  it('clamps out-of-range fees', () => {
    expect(computeFeeSplit(1000, -50).platformFeeCents).toBe(0);
    expect(computeFeeSplit(1000, 20_000)).toEqual({ feeBps: 10_000, platformFeeCents: 1000, orgNetCents: 0 });
  });
});

describe('settlePaidTransactionToWallet', () => {
  it('uses the platform default fee', async () => {
    await setPlatformFee(500);
    const org = await createOrg();
    const tx = await createPendingTx(org, { amountCents: 2000, status: 'paid' });
    const out = await settlePaidTransactionToWallet(tx);
    expect(out).toMatchObject({ ok: true, feeBps: 500, platformFeeCents: 100, orgNetCents: 1900 });
    expect(await getOrgAvailableBalanceCents(org._id)).toBe(1900);
  });

  it('prefers the organisation fee override', async () => {
    await setPlatformFee(500);
    const org = await createOrg({ billing: { platformFeeBps: 200 } });
    const tx = await createPendingTx(org, { amountCents: 2000, status: 'paid' });
    expect(await settlePaidTransactionToWallet(tx)).toMatchObject({ platformFeeCents: 40, orgNetCents: 1960 });
  });

  it('is idempotent, even from a stale copy of the transaction', async () => {
    await setPlatformFee(500);
    const org = await createOrg();
    const tx = await createPendingTx(org, { amountCents: 1000, status: 'paid' });
    const staleCopy = await tx.constructor.findById(tx._id);
    await settlePaidTransactionToWallet(tx);
    expect(await settlePaidTransactionToWallet(staleCopy)).toMatchObject({ ok: true, duplicate: true });
    expect(await getOrgAvailableBalanceCents(org._id)).toBe(950);
    expect(await OrgLedgerEntry.countDocuments({ organizationId: org._id, type: 'sale_credit' })).toBe(1);
  });

  it('never credits an unpaid transaction', async () => {
    const org = await createOrg();
    const tx = await createPendingTx(org);
    expect(await settlePaidTransactionToWallet(tx)).toMatchObject({ ok: false, reason: 'not_paid' });
    expect((await Organization.findById(org._id).lean()).walletBalanceCents).toBe(0);
  });
});
