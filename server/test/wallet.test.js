import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OrgLedgerEntry, Organization, Transaction } from '../src/models/index.js';
import { markTransactionPaidByReference } from '../src/services/paymentService.js';
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

describe('settlement without the ledger unique index (as on a database where it never built)', () => {
  beforeAll(async () => {
    const unique = (await OrgLedgerEntry.collection.indexes()).find((i) => i.unique);
    if (unique) await OrgLedgerEntry.collection.dropIndex(unique.name);
  });
  afterAll(async () => {
    await OrgLedgerEntry.syncIndexes();
  });

  const balance = async (org) => (await Organization.findById(org._id).lean()).walletBalanceCents;
  const credits = (org) => OrgLedgerEntry.countDocuments({ organizationId: org._id, type: 'sale_credit' });

  it('credits once when settlements race', async () => {
    await setPlatformFee(500);
    const org = await createOrg();
    const tx = await createPendingTx(org, { status: 'paid' });
    const copies = await Promise.all([1, 2, 3, 4, 5].map(() => Transaction.findById(tx._id)));
    const results = await Promise.all(copies.map((c) => settlePaidTransactionToWallet(c)));
    expect(results.filter((r) => !r.duplicate)).toHaveLength(1);
    expect(await credits(org)).toBe(1);
    expect(await balance(org)).toBe(475);
  });

  it('credits once when payment confirmations race', async () => {
    await setPlatformFee(500);
    const org = await createOrg();
    const tx = await createPendingTx(org);
    await Promise.all([1, 2, 3].map(() => markTransactionPaidByReference(tx.clientReference, {})));
    expect(await credits(org)).toBe(1);
    expect(await balance(org)).toBe(475);
  });

  it('releases the claim when crediting fails, so a retry can settle', async () => {
    await setPlatformFee(500);
    const org = await createOrg();
    const tx = await createPendingTx(org, { status: 'paid' });
    await Organization.deleteOne({ _id: org._id });
    await expect(settlePaidTransactionToWallet(tx)).rejects.toMatchObject({ status: 404 });
    expect((await Transaction.findById(tx._id).lean()).walletClaimedAt).toBeNull();

    await Organization.collection.insertOne({ ...org.toObject(), walletBalanceCents: 0 });
    const retry = await settlePaidTransactionToWallet(await Transaction.findById(tx._id));
    expect(retry).toMatchObject({ ok: true, orgNetCents: 475 });
    expect(await balance(org)).toBe(475);
  });

  it('lets another caller take over a claim abandoned by a crash, but not a live one', async () => {
    await setPlatformFee(500);
    const org = await createOrg();
    const live = await createPendingTx(org, { status: 'paid', walletClaimedAt: new Date(Date.now() - 60_000) });
    expect(await settlePaidTransactionToWallet(live)).toMatchObject({ duplicate: true });
    expect(await balance(org)).toBe(0);

    const crashed = await createPendingTx(org, { status: 'paid', walletClaimedAt: new Date(Date.now() - 11 * 60_000) });
    expect(await settlePaidTransactionToWallet(crashed)).toMatchObject({ ok: true, orgNetCents: 475 });
    expect(await balance(org)).toBe(475);
  });
});
