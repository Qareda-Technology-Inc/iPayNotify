import { afterEach, describe, expect, it, vi } from 'vitest';
import { Organization, Router } from '../src/models/index.js';
import { config } from '../src/config.js';

const writes = [];
vi.mock('../src/mikrotik/routeros.js', async (orig) => ({
  ...(await orig()),
  withRouterMikrotik: async (_router, fn) =>
    fn({
      write: async (cmd) => {
        writes.push(Array.isArray(cmd) ? cmd : [cmd]);
        return [];
      },
    }),
}));
import { buildPaymentWalledGardenTargets, syncPaymentWalledGarden } from '../src/services/walledGardenSyncService.js';

describe('hotspot walled garden', () => {
  const saved = { api: config.publicApiUrl, render: process.env.RENDER_EXTERNAL_HOSTNAME };
  afterEach(() => {
    config.publicApiUrl = saved.api;
    if (saved.render === undefined) delete process.env.RENDER_EXTERNAL_HOSTNAME;
    else process.env.RENDER_EXTERNAL_HOSTNAME = saved.render;
  });

  it('lets customers reach the API before login', () => {
    config.publicApiUrl = 'https://api.example.test';
    expect(buildPaymentWalledGardenTargets().hosts).toContain('api.example.test');
  });

  it('lets Hubtel\'s checkout page load its scripts and security check', () => {
    const { hosts } = buildPaymentWalledGardenTargets();
    for (const h of ['unified-pay.hubtel.com', 'challenges.cloudflare.com', 'designs.hubtel.com', 'code.jquery.com']) {
      expect(hosts).toContain(h);
    }
  });

  it('uses the Render host when no API URL is configured', () => {
    config.publicApiUrl = '';
    process.env.RENDER_EXTERNAL_HOSTNAME = 'billing-api.onrender.com';
    expect(buildPaymentWalledGardenTargets().hosts).toContain('billing-api.onrender.com');
  });
});

describe('hotspot walled garden sync', () => {
  it('opens each host for HTTPS too, not only HTTP', async () => {
    const org = await Organization.create({ name: 'WG Org', slug: `wg-${Date.now()}` });
    const router = await Router.create({ organizationId: org._id, name: 'wg-router', host: '10.0.0.9', apiUser: 'qf', apiPassword: 'test-only' });
    writes.length = 0;
    const out = await syncPaymentWalledGarden(router._id, org._id);
    const ipRules = writes.filter((c) => c[0] === '/ip/hotspot/walled-garden/ip/add');
    expect(ipRules.length).toBeGreaterThan(0);
    expect(ipRules.some((c) => c.includes('=dst-host=pay.hubtel.com') && c.includes('=action=accept'))).toBe(true);
    expect(out.httpsHostRules).toBe(out.addedHosts.length);
  });
});
