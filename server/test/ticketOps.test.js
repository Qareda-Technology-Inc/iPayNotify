import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/services/ticketNotificationService.js', () => ({ notifyTicketTransactionUpdate: vi.fn() }));

const { HotspotVoucher, TicketSite, TicketSiteSeller, TicketType } = await import('../src/models/index.js');
const { generateVouchers } = await import('../src/services/hotspotService.js');
const { collectFromSeller, returnTickets, issuesWithBalances } = await import('../src/services/ticketLedgerService.js');
const { addSellerAtRouter, issueAtRouter, plansForRouter, siteForRouter, ticketOpsOverview } = await import(
  '../src/services/ticketOpsService.js'
);
const { createHotspotPackage, createOrg, createRouter } = await import('./helpers/fixtures.js');

const admin = { id: '64b000000000000000000001', email: 'ops@isp.test' };

describe('ticket operations by router', () => {
  let org;
  let router;
  let plan;

  beforeEach(async () => {
    org = await createOrg({ modules: { tickets: true } });
    router = await createRouter(org, { name: 'wamahinso', comment: 'Wamahinso' });
    plan = await createHotspotPackage(org, { name: '1 Day', priceCents: 500, elapsedSeconds: 86400 });
    await generateVouchers({
      count: 10,
      packageId: plan._id,
      routerId: router._id,
      organizationId: org._id,
      pushToRouter: false,
    });
  });

  const seller = (name = 'Kofi') => addSellerAtRouter(org._id, router._id, { name, phone: '0241234567' });
  const sellerPosition = async (id) =>
    (await ticketOpsOverview(org._id)).flatMap((s) => s.sellers).find((s) => s._id === String(id));

  it('every router is a site; adding a seller creates the site once', async () => {
    const before = await ticketOpsOverview(org._id);
    expect(before).toHaveLength(1);
    expect(before[0]).toMatchObject({ name: 'Wamahinso', routerId: String(router._id), sellers: [] });

    await seller('Kofi');
    await seller('Ama');
    expect(await TicketSite.countDocuments({ organizationId: org._id })).toBe(1);
    const [site] = await ticketOpsOverview(org._id);
    expect(site.sellers.map((s) => s.name)).toEqual(['Ama', 'Kofi']);
    await expect(seller('kofi')).rejects.toThrow(/already works at this site/);
  });

  it('adopts an old unlinked site with the router’s name, sellers included', async () => {
    const old = await TicketSite.create({ organizationId: org._id, name: 'wamahinso' });
    await TicketSiteSeller.create({ organizationId: org._id, siteId: old._id, name: 'Yaw' });
    const site = await siteForRouter(org._id, router._id);
    expect(String(site._id)).toBe(String(old._id));
    const [group] = await ticketOpsOverview(org._id);
    expect(group.sellers.map((s) => s.name)).toEqual(['Yaw']);
  });

  it('lists the router’s plans with system codes ready', async () => {
    const plans = await plansForRouter(org._id, router._id);
    expect(plans).toEqual([expect.objectContaining({ name: '1 Day', priceCents: 500, available: 10 })]);
  });

  it('system codes: reserved for the seller, owed only as customers use them', async () => {
    const kofi = await seller();
    const { issue, codes } = await issueAtRouter({
      organizationId: org._id,
      admin,
      routerId: router._id,
      sellerId: kofi._id,
      packageId: plan._id,
      quantity: 4,
    });
    expect(codes).toHaveLength(4);
    expect(issue).toMatchObject({ linked: true, quantity: 4, unitPriceCents: 500 });
    expect((await plansForRouter(org._id, router._id))[0].available).toBe(6);
    expect(await sellerPosition(kofi._id)).toMatchObject({ holdingQty: 4, balanceCents: 0 });

    await HotspotVoucher.updateOne({ _id: codes[0]._id }, { usedAt: new Date() });
    expect(await sellerPosition(kofi._id)).toMatchObject({ holdingQty: 3, usedQty: 1, balanceCents: 500 });

    await collectFromSeller({ organizationId: org._id, admin, sellerKey: `s:${kofi._id}`, amountCents: 500 });
    expect(await sellerPosition(kofi._id)).toMatchObject({ balanceCents: 0 });

    await returnTickets({ organizationId: org._id, admin, issueSaleId: issue._id, quantity: 3 });
    expect(await sellerPosition(kofi._id)).toMatchObject({ holdingQty: 0 });
    expect((await plansForRouter(org._id, router._id))[0].available).toBe(9);
  });

  it('external tickets: no codes taken, owed in full at the price given', async () => {
    const ama = await seller('Ama');
    const { issue, codes } = await issueAtRouter({
      organizationId: org._id,
      admin,
      routerId: router._id,
      sellerId: ama._id,
      packageId: plan._id,
      quantity: 20,
      source: 'external',
      unitPriceCents: 400,
    });
    expect(codes).toEqual([]);
    expect(issue).toMatchObject({ linked: false, external: true, amountCents: 8000 });
    expect((await plansForRouter(org._id, router._id))[0].available).toBe(10);
    expect(await sellerPosition(ama._id)).toMatchObject({ holdingQty: 20, balanceCents: 8000 });

    await returnTickets({ organizationId: org._id, admin, issueSaleId: issue._id, quantity: 5 });
    expect(await sellerPosition(ama._id)).toMatchObject({ holdingQty: 15, balanceCents: 6000 });
  });

  it('one ticket type per plan and site, refreshed from the plan', async () => {
    const kofi = await seller();
    const args = { organizationId: org._id, admin, routerId: router._id, sellerId: kofi._id, packageId: plan._id, quantity: 1 };
    await issueAtRouter(args);
    await plan.updateOne({ priceCents: 600 });
    const { issue } = await issueAtRouter(args);
    expect(issue.unitPriceCents).toBe(600);
    expect(await TicketType.countDocuments({ organizationId: org._id })).toBe(1);
    const rows = await issuesWithBalances(org._id, {});
    expect(rows.map((r) => r.unitPriceCents)).toEqual([500, 600]);
  });

  it('refuses a seller from another site and stock it does not have', async () => {
    const other = await createRouter(org, { name: 'other' });
    const yaw = await addSellerAtRouter(org._id, other._id, { name: 'Yaw' });
    const base = { organizationId: org._id, admin, routerId: router._id, packageId: plan._id, quantity: 1 };
    await expect(issueAtRouter({ ...base, sellerId: yaw._id })).rejects.toThrow(/does not work at that site/);
    const kofi = await seller();
    await expect(issueAtRouter({ ...base, sellerId: kofi._id, quantity: 11 })).rejects.toThrow(/Only 10 unused/);
  });
});
