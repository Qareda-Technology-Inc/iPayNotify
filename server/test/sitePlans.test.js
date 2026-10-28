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

  it('rejects plans from another organisation or of another kind', async () => {
    const otherOrgPlan = await createHotspotPackage(await createOrg(), { name: 'Rival Pass' });
    const pppoePlan = await createHotspotPackage(org, { name: 'Home 10M', kind: 'pppoe' });

    for (const bad of [[otherOrgPlan], [pppoePlan], ['not-an-id']]) {
      const res = await choosePlans(mall, bad);
      expect(res.status).toBe(400);
    }
    expect((await Router.findById(mall._id).lean()).portalPackageIds).toEqual([]);
  });
});
