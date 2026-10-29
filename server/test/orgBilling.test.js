import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  sendSmtpMail: vi.fn(),
  sendArkeselSms: vi.fn(),
  vpsPeers: new Set(),
}));

/* Never touch the real WireGuard VPS: track which peers would be on it. */
vi.mock('../src/services/wireguard/wgPeerSync.js', async (importOriginal) => ({
  ...(await importOriginal()),
  syncWireGuardPeerToVps: async ({ publicKey }) => mocks.vpsPeers.add(publicKey),
  removeWireGuardPeerFromVps: async ({ publicKey }) => mocks.vpsPeers.delete(publicKey),
}));
vi.mock('../src/integrations/mail.js', async (importOriginal) => ({
  ...(await importOriginal()),
  sendSmtpMail: mocks.sendSmtpMail,
}));
vi.mock('../src/integrations/arkesel.js', async (importOriginal) => ({
  ...(await importOriginal()),
  sendArkeselSms: mocks.sendArkeselSms,
}));

const { Admin, Organization, Transaction } = await import('../src/models/index.js');
const { WireGuardPeer } = await import('../src/models/WireGuardPeer.js');
const {
  applyOrgBillingStatus,
  createOrgBillCheckout,
  orgBillQuote,
  orgBillingSummary,
  runOrgBillingJob,
  sendOrgBillReminder,
} = await import('../src/services/orgPlatformBillingService.js');
const { markTransactionPaidByReference } = await import('../src/services/paymentService.js');
const { listStuckPayments } = await import('../src/services/stuckPaymentService.js');
const { requireActiveOrganization } = await import('../src/middleware/requireActiveOrganization.js');
const { resolvePortalRouter } = await import('../src/services/portalContextService.js');
const { createOrg, createRouter } = await import('./helpers/fixtures.js');

const DAY = 24 * 60 * 60 * 1000;
const daysFromNow = (d) => new Date(Date.now() + d * DAY);

async function billedOrg({ paidUntil, graceDays = 7, routers = 2 } = {}) {
  const org = await createOrg({
    platformBilling: { enabled: true, orgFeeCents: 10000, routerFeeCents: 2500, graceDays, paidUntil },
  });
  for (let i = 0; i < routers; i += 1) await createRouter(org);
  await Admin.create({ email: `admin-${org.slug}@isp.test`, phone: '0241234567', role: 'org_admin', organizationId: org._id, status: 'active' });
  return org;
}

async function vpnProfile(org, n = 1) {
  const peer = await WireGuardPeer.create({
    siteName: `Owner phone ${n}`,
    publicKey: `${org.slug}-key-${n}`.padEnd(44, 'A'),
    tunnelIp: `10.66.54.${200 + n}`,
    kind: 'client',
    organizationId: org._id,
    status: 'active',
  });
  mocks.vpsPeers.add(peer.publicKey);
  return peer;
}

beforeEach(() => {
  mocks.sendSmtpMail.mockReset().mockResolvedValue({ ok: true });
  mocks.sendArkeselSms.mockReset().mockResolvedValue({ ok: true });
  mocks.vpsPeers.clear();
});

describe('organisation bill', () => {
  it('is the org fee plus the fee per router, with overdue months added up', async () => {
    const current = await billedOrg({ paidUntil: daysFromNow(10) });
    expect(await orgBillQuote(current)).toMatchObject({ routers: 2, monthlyCents: 15000, monthsOwed: 0, amountDueCents: 0 });

    const behind = await billedOrg({ paidUntil: daysFromNow(-65), routers: 4 });
    expect(await orgBillQuote(behind)).toMatchObject({ routers: 4, monthlyCents: 20000, monthsOwed: 3, amountDueCents: 60000 });
  });

  it('moves active → past due → suspended as the due date and grace period pass', async () => {
    const org = await billedOrg({ paidUntil: daysFromNow(10), graceDays: 5 });
    expect((await applyOrgBillingStatus(org._id)).to).toBe('active');

    await Organization.updateOne({ _id: org._id }, { 'platformBilling.paidUntil': daysFromNow(-2) });
    expect((await applyOrgBillingStatus(org._id)).to).toBe('past_due');

    await Organization.updateOne({ _id: org._id }, { 'platformBilling.paidUntil': daysFromNow(-6) });
    await applyOrgBillingStatus(org._id);
    expect(await Organization.findById(org._id).lean()).toMatchObject({ status: 'suspended', statusReason: 'unpaid' });
  });

  it('cuts only the organisation’s VPN profiles when suspended, never router tunnels', async () => {
    const org = await billedOrg({ paidUntil: daysFromNow(-30) });
    const phone = await vpnProfile(org);
    const routerPeer = await WireGuardPeer.create({
      siteName: 'Mall router',
      publicKey: 'router-key'.padEnd(44, 'B'),
      tunnelIp: '10.66.54.18',
      kind: 'router',
      organizationId: org._id,
      status: 'active',
    });
    mocks.vpsPeers.add(routerPeer.publicKey);
    const otherOrg = await billedOrg({ paidUntil: daysFromNow(30) });
    const otherPhone = await vpnProfile(otherOrg, 2);

    await applyOrgBillingStatus(org._id);

    expect(await WireGuardPeer.findById(phone._id).lean()).toMatchObject({ status: 'disabled', disabledReason: 'org_unpaid' });
    expect(mocks.vpsPeers.has(phone.publicKey)).toBe(false);
    expect(mocks.vpsPeers.has(routerPeer.publicKey)).toBe(true);
    expect(mocks.vpsPeers.has(otherPhone.publicKey)).toBe(true);
  });

  it('leaves a suspension set by a super admin alone', async () => {
    const org = await billedOrg({ paidUntil: daysFromNow(30) });
    await Organization.updateOne({ _id: org._id }, { status: 'suspended', statusReason: 'manual' });
    expect(await applyOrgBillingStatus(org._id)).toMatchObject({ skipped: 'manual_status' });
    expect((await Organization.findById(org._id).lean()).status).toBe('suspended');
  });

  it('sends each reminder once per due date: due soon, overdue, suspended', async () => {
    const org = await billedOrg({ paidUntil: daysFromNow(2) });
    await runOrgBillingJob();
    await runOrgBillingJob();
    expect(mocks.sendArkeselSms).toHaveBeenCalledTimes(1);
    expect(mocks.sendArkeselSms.mock.calls[0][0].message).toMatch(/is due on/);

    await Organization.updateOne({ _id: org._id }, { 'platformBilling.paidUntil': daysFromNow(-1) });
    await runOrgBillingJob();
    await runOrgBillingJob();
    expect(mocks.sendArkeselSms).toHaveBeenCalledTimes(2);
    expect(mocks.sendArkeselSms.mock.calls[1][0].message).toMatch(/overdue/);

    await Organization.updateOne({ _id: org._id }, { 'platformBilling.paidUntil': daysFromNow(-10) });
    await runOrgBillingJob();
    expect(mocks.sendArkeselSms).toHaveBeenCalledTimes(3);
    expect(mocks.sendArkeselSms.mock.calls[2][0].message).toMatch(/suspended/);
    expect(mocks.sendSmtpMail).toHaveBeenCalledTimes(3);
  });

  it('a super admin can send a reminder any time without disturbing the automatic ones', async () => {
    mocks.sendSmtpMail.mockResolvedValue({ ok: true });
    mocks.sendArkeselSms.mockResolvedValue({ ok: true });
    const org = await billedOrg({ paidUntil: daysFromNow(-2) });
    const out = await sendOrgBillReminder(org._id);
    expect(out).toMatchObject({ ok: true, kind: 'past_due', emails: 1, sms: 1 });
    expect(mocks.sendArkeselSms.mock.calls[0][0].message).toMatch(/overdue/);

    await runOrgBillingJob();
    expect(mocks.sendArkeselSms).toHaveBeenCalledTimes(2);

    const off = await createOrg();
    expect(await sendOrgBillReminder(off._id)).toMatchObject({ ok: false, reason: 'billing_off' });
  });

  it('ignores organisations with platform billing off', async () => {
    const org = await createOrg({ status: 'active' });
    expect(await applyOrgBillingStatus(org._id)).toMatchObject({ skipped: 'billing_off' });
  });
});

describe('paying the bill with Hubtel', () => {
  it('settles arrears, restores access and VPN, and never credits the org wallet', async () => {
    const org = await billedOrg({ paidUntil: daysFromNow(-40) });
    const phone = await vpnProfile(org);
    await applyOrgBillingStatus(org._id);
    expect((await Organization.findById(org._id).lean()).status).toBe('suspended');

    const checkout = await createOrgBillCheckout({ organizationId: org._id, months: 2, customerMsisdn: '0241234567' });
    expect(checkout).toMatchObject({ mode: 'hubtel_checkout', months: 2, amountCents: 30000 });
    const tx = await Transaction.findOne({ clientReference: checkout.clientReference }).lean();
    expect(tx).toMatchObject({ kind: 'org_subscription', meta: { billedOrganizationId: String(org._id) } });
    expect(tx.organizationId ?? null).toBeNull();

    const oldPaidUntil = (await Organization.findById(org._id).lean()).platformBilling.paidUntil;
    await markTransactionPaidByReference(checkout.clientReference, { TransactionId: 'HUB-ORG-1' });
    await markTransactionPaidByReference(checkout.clientReference, { TransactionId: 'HUB-ORG-1' });

    const after = await Organization.findById(org._id).lean();
    const expected = new Date(oldPaidUntil);
    expected.setUTCMonth(expected.getUTCMonth() + 2);
    expect(after.platformBilling.paidUntil.getTime()).toBe(expected.getTime());
    expect(after).toMatchObject({ status: 'active', statusReason: '', walletBalanceCents: 0 });
    expect(await WireGuardPeer.findById(phone._id).lean()).toMatchObject({ status: 'active', disabledReason: '' });
    expect(mocks.vpsPeers.has(phone.publicKey)).toBe(true);
    expect(await listStuckPayments({})).toEqual([]);
  });

  it('paying one month while three behind still leaves the organisation overdue', async () => {
    const org = await billedOrg({ paidUntil: daysFromNow(-80) });
    const checkout = await createOrgBillCheckout({ organizationId: org._id, months: 1, customerMsisdn: '0241234567' });
    await markTransactionPaidByReference(checkout.clientReference, {});
    expect((await Organization.findById(org._id).lean()).status).not.toBe('active');
    expect((await orgBillingSummary(org._id)).quote.monthsOwed).toBe(2);
  });

  it('shows a paid but unapplied bill under Needs attention for the platform', async () => {
    const org = await billedOrg({ paidUntil: daysFromNow(-1) });
    const tx = await Transaction.create({
      amountCents: 15000,
      status: 'paid',
      kind: 'org_subscription',
      provider: 'hubtel',
      clientReference: 'QF-org-stuck',
      meta: { hubtelCheckout: true, billedOrganizationId: String(org._id), months: 1, fulfillment: 'pending' },
    });
    await Transaction.collection.updateOne({ _id: tx._id }, { $set: { createdAt: daysFromNow(-1) } });
    expect((await listStuckPayments({})).map((i) => i.reason)).toEqual(['org_bill_not_applied']);
  });
});

describe('while suspended for an unpaid bill', () => {
  let server;
  let base;
  let actingOrgId;
  let role;

  beforeAll(() => {
    const app = express();
    app.use((req, _res, next) => {
      req.organizationId = actingOrgId;
      req.admin = { role };
      next();
    });
    app.use(requireActiveOrganization);
    app.all('*', (_req, res) => res.json({ ok: true }));
    server = app.listen(0);
    base = `http://127.0.0.1:${server.address().port}`;
  });
  afterAll(() => server?.close());

  it('locks the dashboard except the billing pages', async () => {
    const org = await billedOrg({ paidUntil: daysFromNow(-30) });
    await applyOrgBillingStatus(org._id);
    actingOrgId = String(org._id);
    role = 'org_admin';

    const blocked = await fetch(`${base}/routers`);
    expect(blocked.status).toBe(403);
    expect(await blocked.json()).toMatchObject({ billingLocked: true });
    expect((await fetch(`${base}/organization/platform-billing`)).status).toBe(200);
    expect((await fetch(`${base}/organization/platform-billing/checkout`, { method: 'POST' })).status).toBe(200);
    expect((await fetch(`${base}/organization`)).status).toBe(200);

    role = 'super_admin';
    expect((await fetch(`${base}/routers`)).status).toBe(200);
  });

  it('keeps the customer buy page working', async () => {
    const org = await billedOrg({ paidUntil: daysFromNow(-30) });
    const router = await createRouter(org);
    await applyOrgBillingStatus(org._id);
    expect(await resolvePortalRouter({ headers: {} }, router.portalSlug)).toMatchObject({ resolved: true });
  });

  it('still blocks everything, including the buy page, for a manual suspension', async () => {
    const org = await createOrg({ status: 'suspended', statusReason: 'manual' });
    const router = await createRouter(org);
    actingOrgId = String(org._id);
    role = 'org_admin';
    expect((await fetch(`${base}/organization/platform-billing`)).status).toBe(403);
    expect(await resolvePortalRouter({ headers: {} }, router.portalSlug)).toMatchObject({ resolved: false, reason: 'org_suspended' });
  });
});
