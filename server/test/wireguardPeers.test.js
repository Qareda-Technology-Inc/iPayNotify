import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/* A fake VPS: `live` is what `wg show dump` reports; removing a key drops it from there. */
const vps = vi.hoisted(() => ({ live: [], removed: [], synced: [], failRemove: false }));
vi.mock('../src/services/wireguard/wgPeerSync.js', async (orig) => ({
  ...(await orig()),
  readVpsPeers: async () => vps.live.map((p) => ({ ...p })),
  removeWireGuardPeerFromVps: async ({ publicKey }) => {
    if (vps.failRemove) {
      const e = new Error('Cannot SSH to the WireGuard VPS');
      e.status = 502;
      throw e;
    }
    vps.removed.push(publicKey);
    vps.live = vps.live.filter((p) => p.publicKey !== publicKey);
    return { ok: true };
  },
  syncWireGuardPeerToVps: async (peer) => {
    vps.synced.push(peer.publicKey);
    return { ok: true };
  },
}));

const { WireGuardPeer } = await import('../src/models/WireGuardPeer.js');
const { wireguardAdminRouter } = await import('../src/routes/wireguardAdmin.js');
const { createOrg } = await import('./helpers/fixtures.js');
const { parseWgDump } = await import('../src/services/wireguard/wgPeerSync.js');

const key = (c) => `${c.repeat(43)}=`;
const livePeer = (publicKey, ip) => ({ publicKey, endpoint: '41.66.1.2:51820', allowedIps: [`${ip}/32`], latestHandshake: 0, rxBytes: 0, txBytes: 0 });

describe('WireGuard peers follow the VPS', () => {
  let server;
  let base;
  const call = async (method, path, body) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: res.status, body: await res.json() };
  };

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.admin = { role: 'super_admin', id: 'x' };
      next();
    });
    app.use('/wg', wireguardAdminRouter);
    server = app.listen(0);
    base = `http://127.0.0.1:${server.address().port}/wg`;
  });
  afterAll(() => server.close());
  beforeEach(() => {
    vps.live = [];
    vps.removed = [];
    vps.synced = [];
    vps.failRemove = false;
  });

  it('deletes from the VPS before the database', async () => {
    const peer = await WireGuardPeer.create({ siteName: 'Kwame laptop', publicKey: key('A'), tunnelIp: '10.66.54.200', kind: 'client' });
    vps.live = [livePeer(key('A'), '10.66.54.200')];
    const out = await call('DELETE', `/peers/${peer._id}`);
    expect(out.status).toBe(200);
    expect(vps.removed).toEqual([key('A')]);
    expect(await WireGuardPeer.exists({ _id: peer._id })).toBe(null);
  });

  it('keeps the record when the VPS cannot be reached, so nothing is left live unseen', async () => {
    const peer = await WireGuardPeer.create({ siteName: 'Kwame laptop', publicKey: key('B'), tunnelIp: '10.66.54.201', kind: 'client' });
    vps.failRemove = true;
    const out = await call('DELETE', `/peers/${peer._id}`);
    expect(out.status).toBe(502);
    expect(out.body.error).toMatch(/Not deleted/);
    expect(await WireGuardPeer.exists({ _id: peer._id })).not.toBe(null);
  });

  it('shows peers live on the VPS that are not recorded, or switched off but still live', async () => {
    await WireGuardPeer.create({ siteName: 'Old phone', publicKey: key('C'), tunnelIp: '10.66.54.202', kind: 'client', status: 'disabled' });
    vps.live = [livePeer(key('C'), '10.66.54.202'), livePeer(key('D'), '10.66.54.203')];
    const out = await call('GET', '/vps-peers');
    expect(out.status).toBe(200);
    const [stale, unknown] = out.body.peers;
    expect(stale).toMatchObject({ shouldBeOff: true, record: { siteName: 'Old phone' } });
    expect(unknown).toMatchObject({ record: null, tunnelIp: '10.66.54.203' });
  });

  it('cuts any live peer off the VPS, recorded or not', async () => {
    vps.live = [livePeer(key('E'), '10.66.54.204')];
    const out = await call('POST', '/vps-peers/remove', { publicKey: key('E') });
    expect(out.status).toBe(200);
    expect(vps.live).toHaveLength(0);
  });

  it('records an unknown peer for an organisation, and cuts it at once if that organisation is suspended for an unpaid bill', async () => {
    const org = await createOrg({ status: 'suspended', statusReason: 'unpaid' });
    vps.live = [livePeer(key('F'), '10.66.54.205')];
    const out = await call('POST', '/vps-peers/adopt', { publicKey: key('F'), label: 'Admin laptop', organizationId: String(org._id) });
    expect(out.status).toBe(201);
    const rec = await WireGuardPeer.findOne({ publicKey: key('F') }).lean();
    expect(rec).toMatchObject({ kind: 'client', tunnelIp: '10.66.54.205', status: 'disabled', disabledReason: 'org_unpaid' });
    expect(vps.removed).toEqual([key('F')]);
  });

  it('linking a profile to a suspended organisation cuts it; linking it to a paid one brings it back', async () => {
    const unpaid = await createOrg({ status: 'suspended', statusReason: 'unpaid' });
    const paid = await createOrg();
    const peer = await WireGuardPeer.create({ siteName: 'Admin phone', publicKey: key('G'), tunnelIp: '10.66.54.206', kind: 'client' });
    let out = await call('PATCH', `/peers/${peer._id}`, { organizationId: String(unpaid._id) });
    expect(out.body.peer).toMatchObject({ status: 'disabled', disabledReason: 'org_unpaid' });
    expect(vps.removed).toEqual([key('G')]);
    out = await call('PATCH', `/peers/${peer._id}`, { organizationId: String(paid._id) });
    expect(out.body.peer.status).toBe('active');
    expect(vps.synced).toEqual([key('G')]);
  });

  it('will not create a phone/laptop profile without saying whose it is', async () => {
    const out = await call('POST', '/peers', { publicKey: key('H'), siteName: 'Someone', kind: 'client' });
    expect(out.status).toBe(400);
    expect(out.body.error).toMatch(/organisation/i);
    const staff = await call('POST', '/peers', { publicKey: key('H'), siteName: 'My laptop', kind: 'client', organizationId: 'platform' });
    expect(staff.status).toBe(201);
    expect(staff.body.peer).toMatchObject({ platformStaff: true, organizationId: null });
  });
});

describe('reading wg show dump', () => {
  it('skips the interface line and reads each peer', () => {
    const dump = [
      'privkey\tSERVERPUB=\t51820\toff',
      'PEER1=\t(none)\t41.66.1.2:51820\t10.66.54.10/32,192.168.88.0/24\t1793650000\t100\t200\toff',
      'PEER2=\t(none)\t(none)\t10.66.54.200/32\t0\t0\t0\t25',
    ].join('\n');
    expect(parseWgDump(dump)).toEqual([
      { publicKey: 'PEER1=', endpoint: '41.66.1.2:51820', allowedIps: ['10.66.54.10/32', '192.168.88.0/24'], latestHandshake: 1793650000, rxBytes: 100, txBytes: 200 },
      { publicKey: 'PEER2=', endpoint: '', allowedIps: ['10.66.54.200/32'], latestHandshake: 0, rxBytes: 0, txBytes: 0 },
    ]);
  });
});
