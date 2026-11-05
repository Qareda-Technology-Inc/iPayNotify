import { describe, expect, it } from 'vitest';
import { disconnectHotspotUser, upsertHotspotUserProfile } from '../src/mikrotik/hotspotCommands.js';
import { macCookieSecondsFor } from '../src/services/hotspotService.js';

/* Returning phones are let back in by MAC cookie for as long as the plan can last. */
describe('hotspot MAC cookie', () => {
  it('lasts as long as the plan, 30 days for online-time plans', () => {
    expect(macCookieSecondsFor({ elapsedSeconds: 86400 })).toBe(86400);
    expect(macCookieSecondsFor({ elapsedSeconds: 600 })).toBe(3600);
    expect(macCookieSecondsFor({ ticketDurationType: 'paused', timeLimitSeconds: 7200 })).toBe(30 * 86400);
  });

  it('is turned on for the plan profile', async () => {
    const calls = [];
    const api = {
      async write(cmd) {
        calls.push(cmd);
        return [];
      },
    };
    await upsertHotspotUserProfile(api, '1-Day', { macCookieSeconds: 86400 });
    const add = calls.find((c) => Array.isArray(c) && c[0] === '/ip/hotspot/user/profile/add');
    expect(add).toEqual(expect.arrayContaining(['=add-mac-cookie=yes', '=mac-cookie-timeout=1d']));
  });

  it('removes the phone cookie with the code, so an expired ticket cannot log back in', async () => {
    const lines = [];
    await disconnectHotspotUser({ execCli: async (l) => lines.push(l) }, '123456');
    expect(lines).toContain('/ip hotspot cookie remove [find where user="123456"]');
  });
});
