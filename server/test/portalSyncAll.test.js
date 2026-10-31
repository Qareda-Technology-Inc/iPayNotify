import { describe, expect, it, vi } from 'vitest';

const writes = [];
/* Router "offline" refuses the connection; the others answer like a MikroTik with an old-domain row. */
vi.mock('../src/mikrotik/routeros.js', async (orig) => ({
  ...(await orig()),
  withRouterMikrotik: async (router, fn) => {
    if (router.name === 'offline') throw new Error('connect ETIMEDOUT');
    return fn({
      write: async (cmd) => {
        const c = Array.isArray(cmd) ? cmd : [cmd];
        writes.push({ router: router.name, cmd: c });
        if (c[0] === '/ip/hotspot/walled-garden/print') {
          return [{ '.id': '*1', 'dst-host': 'ipaysub.vercel.app', comment: 'QareFi:ipaysub.vercel.app' }];
        }
        return [];
      },
    });
  },
}));

const { config } = await import('../src/config.js');
const { syncAllRoutersToCurrentDomain } = await import('../src/services/captivePortalPushService.js');
const { createOrg, createRouter } = await import('./helpers/fixtures.js');

describe('sync all routers to the current customer domain', () => {
  it('swaps the old domain for the new one on every reachable router', async () => {
    const saved = config.publicAppUrl;
    config.publicAppUrl = 'https://qarefipay.example.test';
    try {
      const org = await createOrg();
      await createRouter(org, { name: 'mall' });
      await createRouter(org, { name: 'offline' });
      await createRouter(await createOrg(), { name: 'other-org' });

      const out = await syncAllRoutersToCurrentDomain(org._id);

      expect(out).toMatchObject({ domain: 'qarefipay.example.test', total: 2, updated: 1 });
      expect(out.routers.find((r) => r.name === 'offline')).toMatchObject({ ok: false, error: 'connect ETIMEDOUT' });
      const mall = writes.filter((w) => w.router === 'mall').map((w) => w.cmd);
      expect(mall).toContainEqual(['/ip/hotspot/walled-garden/remove', '=.id=*1']);
      expect(mall.some((c) => c[0] === '/ip/hotspot/walled-garden/ip/add' && c.includes('=dst-host=qarefipay.example.test'))).toBe(true);
      expect(writes.some((w) => w.router === 'other-org')).toBe(false);
    } finally {
      config.publicAppUrl = saved;
    }
  });

  it('needs an organisation', async () => {
    await expect(syncAllRoutersToCurrentDomain('')).rejects.toMatchObject({ status: 400 });
  });
});
