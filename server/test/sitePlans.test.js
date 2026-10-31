import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Router } from '../src/models/index.js';
import { publicPortalRouter } from '../src/routes/publicPortal.js';
import { routersApi } from '../src/routes/routers.js';
import { createHotspotPurchaseCheckout } from '../src/services/paymentService.js';
import { createHotspotPackage, createOrg, createRouter } from './helpers/fixtures.js';

let server;
let base;
let actingOrgId = null;

beforeAll(() => {
  const app = express();
  app.use(express.json());
  app.use('/api/public', publicPortalRouter);
  /* Stand-in for requireAuth + attachOrganization. */
  app.use('/api/routers', (req, _res, next) => {
    req.organizationId = actingOrgId;
    req.admin = { email: 'admin@test', role: 'org_admin' };
    next();
  }, routersApi);
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(() => server?.close());

describe('plans per captive portal site', () => {
  let org;
  let mall;
  let campus;
  let daily;
  let weekly;
  let monthly;

  beforeEach(async () => {
    org = await createOrg();
    actingOrgId = String(org._id);
    mall = await createRouter(org);
    campus = await createRouter(org);
    daily = await createHotspotPackage(org, { name: 'Daily Pass', priceCents: 300 });
    weekly = await createHotspotPackage(org, { name: 'Weekly Pass', priceCents: 1500 });
    monthly = await createHotspotPackage(org, { name: 'Monthly Pass', priceCents: 5000 });
  });

  const choosePlans = (router, ids) =>
    fetch(`${base}/api/routers/${router._id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ portalPackageIds: ids.map((p) => String(p._id ?? p)) }),
    });
  const loginPage = (router) =>
    fetch(`${base}/api/public/captive/${router.portalSlug}/login.html`).then((r) => r.text());
  const buyList = (router) =>
    fetch(`${base}/api/public/packages/hotspot?r=${router.portalSlug}`)
      .then((r) => r.json())
      .then((list) => list.map((p) => p.name).sort());

  it('offers every active plan at a site with no plans chosen', async () => {
    expect(await buyList(mall)).toEqual(['Daily Pass', 'Monthly Pass', 'Weekly Pass']);
    const html = await loginPage(mall);
    for (const name of ['Daily Pass', 'Weekly Pass', 'Monthly Pass']) expect(html).toContain(name);
  });

  it('shows only the chosen plans on that site, leaving other sites alone', async () => {
    expect((await choosePlans(mall, [daily, weekly])).status).toBe(200);

    expect(await buyList(mall)).toEqual(['Daily Pass', 'Weekly Pass']);
    const mallHtml = await loginPage(mall);
    expect(mallHtml).toContain('Daily Pass');
    expect(mallHtml).not.toContain('Monthly Pass');

    expect(await buyList(campus)).toEqual(['Daily Pass', 'Monthly Pass', 'Weekly Pass']);
  });

  it('refuses checkout for a plan the site does not sell, even posted by id', async () => {
    await choosePlans(mall, [daily]);
    const buy = (pkg, router) =>
      createHotspotPurchaseCheckout({ packageId: pkg._id, routerId: router._id, customerMsisdn: '0241234567' });

    await expect(buy(monthly, mall)).rejects.toMatchObject({ status: 400, message: 'Package is not available at this site' });
    await expect(buy(daily, mall)).resolves.toMatchObject({ mode: 'hubtel_checkout' });
    await expect(buy(monthly, campus)).resolves.toMatchObject({ mode: 'hubtel_checkout' });
  });

  it('still hides a chosen plan that was deactivated', async () => {
    await choosePlans(mall, [daily, weekly]);
    await weekly.updateOne({ isActive: false });
    expect(await buyList(mall)).toEqual(['Daily Pass']);
  });

  it('goes back to all plans when the list is cleared', async () => {
    await choosePlans(mall, [daily]);
    await choosePlans(mall, []);
    expect(await buyList(mall)).toHaveLength(3);
  });

  it('keeps the buy page in step with the login page when a plan is unticked', async () => {
    await monthly.updateOne({ showOnPortal: false });
    expect(await buyList(mall)).toEqual(['Daily Pass', 'Weekly Pass']);
    expect(await loginPage(mall)).not.toContain('Monthly Pass');
    await expect(
      createHotspotPurchaseCheckout({ packageId: monthly._id, routerId: mall._id, customerMsisdn: '0241234567' })
    ).rejects.toMatchObject({ status: 400 });
  });

  it('lists buy-page plans cheapest first with the same line the login page shows', async () => {
    await daily.updateOne({ elapsedSeconds: 86400 });
    const list = await fetch(`${base}/api/public/packages/hotspot?r=${mall.portalSlug}`).then((r) => r.json());
    expect(list.map((p) => p.name)).toEqual(['Daily Pass', 'Weekly Pass', 'Monthly Pass']);
    expect(list[0].detail).toBe('1 day · Unlimited');
  });

  it('rejects plans from another organisation or of another kind', async () => {
    const otherOrgPlan = await createHotspotPackage(await createOrg(), { name: 'Rival Pass' });
    const pppoePlan = await createHotspotPackage(org, { name: 'Home 10M', kind: 'pppoe' });

    for (const bad of [[otherOrgPlan], [pppoePlan], ['not-an-id']]) {
      const res = await choosePlans(mall, bad);
      expect(res.status).toBe(400);
    }
    expect((await Router.findById(mall._id).lean()).portalPackageIds).toEqual([]);
  });

  describe('prices per site', () => {
    const setPrices = (router, rows) =>
      fetch(`${base}/api/routers/${router._id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          portalPrices: rows.map(([pkg, priceCents]) => ({ packageId: String(pkg._id ?? pkg), priceCents })),
        }),
      });
    const buyPrices = (router) =>
      fetch(`${base}/api/public/packages/hotspot?r=${router.portalSlug}`)
        .then((r) => r.json())
        .then((list) => Object.fromEntries(list.map((p) => [p.name, p.priceCents])));
    const checkout = (pkg, router) =>
      createHotspotPurchaseCheckout({ packageId: pkg._id, routerId: router._id, customerMsisdn: '0241234567' });

    it('sells the same plan at each site at that site\'s own price', async () => {
      expect((await setPrices(mall, [[daily, 800]])).status).toBe(200);
      expect((await setPrices(campus, [[daily, 700]])).status).toBe(200);

      expect(await buyPrices(mall)).toMatchObject({ 'Daily Pass': 800, 'Weekly Pass': 1500 });
      expect(await buyPrices(campus)).toMatchObject({ 'Daily Pass': 700, 'Weekly Pass': 1500 });
      expect(await loginPage(mall)).toContain('GHS 8');
      expect(await loginPage(mall)).not.toContain('GHS 7');
      expect(await loginPage(campus)).toContain('GHS 7');

      const { Transaction } = await import('../src/models/index.js');
      const a = await checkout(daily, mall);
      const b = await checkout(daily, campus);
      expect((await Transaction.findOne({ clientReference: a.clientReference }).lean()).amountCents).toBe(800);
      expect((await Transaction.findOne({ clientReference: b.clientReference }).lean()).amountCents).toBe(700);
    });

    it('goes back to the plan price when a site price is cleared', async () => {
      await setPrices(mall, [[daily, 800]]);
      await setPrices(mall, []);
      expect((await buyPrices(mall))['Daily Pass']).toBe(300);
    });

    it('refuses a zero price, a duplicate plan or another organisation\'s plan', async () => {
      const otherOrgPlan = await createHotspotPackage(await createOrg(), { name: 'Rival Pass' });
      for (const bad of [[[daily, 0]], [[daily, 500], [daily, 600]], [[otherOrgPlan, 500]]]) {
        expect((await setPrices(mall, bad)).status).toBe(400);
      }
      expect((await Router.findById(mall._id).lean()).portalPrices).toEqual([]);
    });
  });
});
