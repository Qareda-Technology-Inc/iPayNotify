import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Fake MikroTik over SSH: every command costs `latencyMs` (one round trip through the tunnel).
 * It understands the bulk add script and can be told to reject some codes.
 */
const router = vi.hoisted(() => ({
  latencyMs: 300,
  users: new Map(),
  reject: new Set(),
  cliCalls: [],
  reset() {
    this.users.clear();
    this.reject.clear();
    this.cliCalls.length = 0;
  },
}));

vi.mock('../src/mikrotik/routeros.js', async (importOriginal) => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const api = {
    async execCli(line) {
      router.cliCalls.push(line);
      await sleep(router.latencyMs);
      if (line.includes(':put "QFDONE"')) {
        const errs = [];
        for (const m of line.matchAll(/:do \{\/ip hotspot user add name=(\S+) /g)) {
          if (router.reject.has(m[1])) errs.push(`QFERR ${m[1]}`);
          else router.users.set(m[1], true);
        }
        return `${errs.join('\n')}\nQFDONE\n`;
      }
      const single = line.match(/^\/ip hotspot user add name=(\S+) /);
      if (single) {
        if (router.reject.has(single[1])) throw new Error('failure: rejected by router');
        router.users.set(single[1], true);
      }
      return '';
    },
    async write() {
      await sleep(router.latencyMs);
      return [];
    },
  };
  return {
    ...(await importOriginal()),
    withRouterMikrotik: async (_router, fn) => fn(api),
  };
});

/* Profile setup is a few commands per batch and is not what is being measured; costs one round trip. */
vi.mock('../src/mikrotik/hotspotCommands.js', async (importOriginal) => ({
  ...(await importOriginal()),
  upsertHotspotUserProfile: async (_api, name) => {
    await new Promise((r) => setTimeout(r, router.latencyMs));
    return { name, created: false, updated: false };
  },
}));

const { buildHotspotUsersBulkScript } = await import('../src/mikrotik/hotspotCommands.js');
const { HotspotVoucher } = await import('../src/models/index.js');
const { generateVouchers, MAX_TICKETS_PER_BATCH } = await import('../src/services/hotspotService.js');
const { createHotspotPackage, createOrg, createRouter } = await import('./helpers/fixtures.js');

describe('bulk ticket script', () => {
  it('adds each user, replaces a same-named one on conflict, and reports failures', () => {
    const script = buildHotspotUsersBulkScript([
      { name: '482193', profile: 'QF-1-Day', comment: 'QareFi-dc:2026-10-28 10:00:00', timeLimitSeconds: 86400 },
      { name: '771020', profile: 'QF-1-Day', server: 'hotspot1' },
    ]);
    expect(script).toContain(':do {/ip hotspot user add name=482193 password="" profile=QF-1-Day comment="QareFi-dc:2026-10-28 10:00:00" limit-uptime=1d');
    expect(script).toContain('on-error={:do {/ip hotspot user remove [find where name="482193"];');
    expect(script).toContain('on-error={:put ("QFERR " . "771020")}');
    expect(script).toContain('server=hotspot1');
    expect(script.endsWith(':put "QFDONE"')).toBe(true);
  });
});

describe('generating tickets', () => {
  let org;
  let site;
  let pkg;

  beforeEach(async () => {
    router.reset();
    router.latencyMs = 300;
    org = await createOrg();
    site = await createRouter(org);
    pkg = await createHotspotPackage(org, { elapsedSeconds: 86400 });
  });

  const generate = (count) =>
    generateVouchers({ count, packageId: pkg._id, routerId: site._id, organizationId: org._id, pushToRouter: true });

  it('puts 200 tickets on a slow router within 5 seconds', async () => {
    const started = Date.now();
    const vouchers = await generate(200);
    const seconds = (Date.now() - started) / 1000;

    expect(vouchers).toHaveLength(200);
    expect(vouchers.routerPush).toMatchObject({ pushed: 200, failed: [] });
    expect(router.users.size).toBe(200);
    expect(router.cliCalls.filter((c) => c.includes('QFDONE'))).toHaveLength(5);
    expect(seconds).toBeLessThan(5);
  });

  it('retries only the tickets the router rejected, one by one', async () => {
    const vouchers = await generateVouchers({
      count: 3,
      packageId: pkg._id,
      routerId: site._id,
      organizationId: org._id,
      pushToRouter: false,
    });
    router.reject.add(vouchers[1].code);
    const { pushSavedVouchersToRouter } = await import('../src/services/hotspotService.js');
    await expect(pushSavedVouchersToRouter(vouchers)).rejects.toThrow(`Router rejected ${vouchers[1].code}`);
    expect(router.users.has(vouchers[0].code)).toBe(true);
    expect(router.users.has(vouchers[2].code)).toBe(true);
    expect(router.cliCalls.some((c) => c.startsWith(`/ip hotspot user add name=${vouchers[1].code} `))).toBe(true);
  });

  it('allows up to 500 tickets per batch, all saved', async () => {
    router.latencyMs = 5;
    expect(MAX_TICKETS_PER_BATCH).toBe(500);
    const vouchers = await generate(600);
    expect(vouchers).toHaveLength(500);
    expect(await HotspotVoucher.countDocuments({ routerId: site._id })).toBe(500);
    expect(new Set(vouchers.map((v) => v.code)).size).toBe(500);
  });
});
