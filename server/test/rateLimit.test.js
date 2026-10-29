import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hit, limits } from '../src/middleware/rateLimit.js';

let server;
let base;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.post('/checkout', limits.checkoutPerIp, limits.checkoutPerPhone, (_req, res) => res.json({ ok: true }));
  app.get('/status/:ref', limits.statusPerRef, (_req, res) => res.json({ ok: true }));
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(() => server?.close());

const checkout = (phone, ip = '41.0.0.1') =>
  fetch(`${base}/checkout`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify({ customerMsisdn: phone }),
  });

describe('rate limits', () => {
  it('counts per window and resets after it', () => {
    const now = 1_000_000;
    expect(hit('t:a', 1000, 2, now)).toBe(0);
    expect(hit('t:a', 1000, 2, now)).toBe(0);
    expect(hit('t:a', 1000, 2, now + 10)).toBe(1);
    expect(hit('t:a', 1000, 2, now + 1001)).toBe(0);
  });

  it('stops repeated checkouts for one phone, in any number format', async () => {
    for (let i = 0; i < 6; i += 1) expect((await checkout(i % 2 ? '0241234567' : '233241234567')).status).toBe(200);
    const res = await checkout('024 123 4567');
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBeTruthy();
    expect((await res.json()).error).toMatch(/payment attempts for this number/);
  });

  it('lets many buyers on the same site IP pay', async () => {
    for (let i = 0; i < 30; i += 1) {
      expect((await checkout(`02412345${String(i).padStart(2, '0')}`, '154.160.1.1')).status).toBe(200);
    }
  });

  it('limits status polling per payment, not per site', async () => {
    let last;
    for (let i = 0; i < 91; i += 1) last = await fetch(`${base}/status/QF-a`);
    expect(last.status).toBe(429);
    expect((await fetch(`${base}/status/QF-b`)).status).toBe(200);
  });
});
