import { describe, expect, it } from 'vitest';
import { LOGIN_THEMES, loginThemeById, planDetail, renderLoginPage } from '../src/services/captiveTemplates.js';
import { normalizePortalDesign } from '../src/utils/portalDesigns.js';

const plans = [
  { _id: '6650a1b2c3d4e5f6a7b8c9d0', name: 'Daily', priceCents: 500, currency: 'GHS', elapsedSeconds: 86400 },
  { _id: '6650a1b2c3d4e5f6a7b8c9d1', name: 'Weekly', priceCents: 2500, currency: 'GHS', elapsedSeconds: 604800 },
];
const base = { brandName: 'Qaretech Wi-Fi', siteName: 'Accra Mall', plans, buyUrl: 'https://app.test/portal/hotspot?r=accra' };
const showcase = LOGIN_THEMES.filter((t) => t.layout === 'showcase').map((t) => t.id);

describe('login page designs', () => {
  it('registers the showcase designs for the picker and saving', () => {
    expect(showcase).toEqual(['lumen', 'daylight', 'goldcoast']);
    for (const id of showcase) expect(normalizePortalDesign(id)).toBe(id);
  });

  it('falls back to Midnight for an unknown design', () => {
    expect(loginThemeById('no-such-design').id).toBe('midnight');
    expect(normalizePortalDesign('no-such-design')).toBe('midnight');
  });

  it.each(LOGIN_THEMES.map((t) => t.id))('%s keeps every field and macro the router needs', (id) => {
    const html = renderLoginPage({ ...base, designId: id, mode: 'router' });
    expect(html).toContain('action="$(link-login-only)"');
    expect(html).toContain('name="dst" value="$(link-orig)"');
    expect(html).toContain('name="username" value="$(username)"');
    expect(html).toContain('name="password" value=""');
    expect(html).toContain('$(if error)<p class="err">$(error)</p>$(endif)');
    expect(html).toContain('s=$(server-name)');
  });

  it.each(showcase)('%s shows plan tiles that link to buying that plan at this site', (id) => {
    const html = renderLoginPage({ ...base, designId: id, mode: 'router' });
    expect(html).toContain('class="tile"');
    expect(html).toContain('href="https://app.test/portal/hotspot?r=accra&amp;package=6650a1b2c3d4e5f6a7b8c9d0&amp;s=$(server-name)"');
    expect(html).toContain('GHS 25');
    expect(html).toContain('Accra Mall');
  });

  it('drops the buy button, tile links and steps when there is no buy link', () => {
    const html = renderLoginPage({ ...base, buyUrl: '', designId: 'lumen', mode: 'router' });
    expect(html).not.toContain('class="buy"');
    expect(html).not.toContain('<a class="tile"');
    expect(html).not.toContain('class="steps"');
    expect(html).toContain('<div class="tile">');
  });

  it('escapes admin text so it cannot inject HTML or router macros', () => {
    const html = renderLoginPage({
      ...base,
      designId: 'daylight',
      mode: 'router',
      brandName: '<script>x</script>',
      siteName: '$(username)',
      headline: '"><b>',
    });
    expect(html).not.toContain('<script>x</script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&#36;(username)');
    expect(html).not.toContain('"><b>');
  });

  it('uses the organisation logo in place of the Wi-Fi emblem', () => {
    const html = renderLoginPage({ ...base, designId: 'goldcoast', logoUrl: 'https://cdn.test/logo.png' });
    expect(html).toContain('<span class="logo"><img src="https://cdn.test/logo.png"');
    expect(html).not.toContain('class="emblem"');
  });
});

describe('plan details on the login page', () => {
  const unlimited = {
    _id: '6650a1b2c3d4e5f6a7b8c9d2',
    name: 'Premium Day',
    priceCents: 1000,
    currency: 'GHS',
    elapsedSeconds: 86400,
    usersPerTicket: 3,
    speedDownMbps: 5,
    speedUpMbps: 2,
  };

  it('shows duration and "Unlimited", never speed, caps or devices', () => {
    expect(planDetail(unlimited)).toBe('1 day · Unlimited');
    expect(planDetail({ ticketDurationType: 'paused', pausedSeconds: 7200 })).toBe('2 hrs online · Unlimited');
    expect(planDetail({ name: 'No time limit' })).toBe('Unlimited');
  });

  it('does not call a capped plan unlimited, and does not show the cap', () => {
    expect(planDetail({ ...unlimited, dataLimitBytes: 2147483648 })).toBe('1 day');
  });

  it.each(LOGIN_THEMES.map((t) => t.id))('%s shows name, duration, Unlimited and price only', (id) => {
    const html = renderLoginPage({ ...base, plans: [unlimited], designId: id, mode: 'router' });
    expect(html).toContain('Premium Day');
    expect(html).toContain('1 day · Unlimited');
    expect(html).toContain('GHS 10');
    expect(html).not.toMatch(/Mbps|devices|GB|MB|Unlimited data/);
  });
});
