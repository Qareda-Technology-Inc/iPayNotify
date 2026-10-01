/**
 * Hotspot login page templates. One renderer serves the router's login.html, the hosted
 * web login and the admin previews, so all three always look the same.
 * Only inline CSS and system fonts: guests are not online yet when this page loads.
 */

const SANS = "system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif";
const SERIF = "Georgia,'Times New Roman',serif";
const MONO = "'Courier New',Courier,monospace";
const ROUND = "'Trebuchet MS','Segoe UI',Arial,sans-serif";

/**
 * c: bg, bg2 (gradient end, optional), text, muted, card, accent, accentText, field, fieldBorder,
 *    plan (plan row background), line (borders), price
 */
export const LOGIN_THEMES = [
  {
    id: 'midnight',
    name: 'Midnight',
    blurb: 'Dark card with an emerald button.',
    layout: 'card',
    font: SANS,
    radius: 22,
    headline: 'Connect to Wi-Fi',
    subtitle: 'Type the code from your ticket.',
    c: { bg: '#020617', text: '#f8fafc', muted: '#94a3b8', card: '#0f172a', accent: '#10b981', accentText: '#ffffff', field: '#020617', fieldBorder: '#334155', plan: '#0f172a', line: '#1e293b', price: '#6ee7b7' },
  },
  {
    id: 'sunrise',
    name: 'Sunrise',
    blurb: 'Light card on a warm background.',
    layout: 'card',
    font: SANS,
    radius: 24,
    headline: 'Get online',
    subtitle: 'Enter the code on your ticket.',
    c: { bg: '#fff7ed', text: '#1c1917', muted: '#78716c', card: '#ffffff', accent: '#ea580c', accentText: '#ffffff', field: '#fff7ed', fieldBorder: '#fdba74', plan: '#ffffff', line: '#fed7aa', price: '#c2410c' },
  },
  {
    id: 'signal',
    name: 'Signal',
    blurb: 'No card, big cyan code field.',
    layout: 'minimal',
    font: SANS,
    radius: 16,
    headline: 'Enter your code',
    subtitle: 'The number printed on your ticket.',
    c: { bg: '#06141f', text: '#ecfeff', muted: '#94a3b8', card: '#06141f', accent: '#22d3ee', accentText: '#042f2e', field: '#083344', fieldBorder: '#22d3ee', plan: '#0b2532', line: '#164e63', price: '#67e8f9' },
  },
  {
    id: 'ocean',
    name: 'Ocean',
    blurb: 'Blue hero banner over a white card.',
    layout: 'hero',
    font: SANS,
    radius: 18,
    headline: 'Welcome aboard',
    subtitle: 'Enter your ticket code to start browsing.',
    c: { bg: '#eff6ff', bg2: '#1d4ed8', text: '#0f172a', muted: '#64748b', card: '#ffffff', accent: '#2563eb', accentText: '#ffffff', field: '#f8fafc', fieldBorder: '#bfdbfe', plan: '#ffffff', line: '#dbeafe', price: '#1d4ed8' },
  },
  {
    id: 'forest',
    name: 'Forest',
    blurb: 'Green hero banner, calm and natural.',
    layout: 'hero',
    font: ROUND,
    radius: 18,
    headline: 'Relax and connect',
    subtitle: 'Your ticket code gets you online.',
    c: { bg: '#f0fdf4', bg2: '#166534', text: '#14532d', muted: '#4d7c0f', card: '#ffffff', accent: '#16a34a', accentText: '#ffffff', field: '#f7fee7', fieldBorder: '#bbf7d0', plan: '#ffffff', line: '#dcfce7', price: '#15803d' },
  },
  {
    id: 'aurora',
    name: 'Aurora',
    blurb: 'Purple-to-teal gradient with a glass card.',
    layout: 'glass',
    font: SANS,
    radius: 24,
    headline: 'Hello there',
    subtitle: 'Pop in your code and you are online.',
    c: { bg: '#6d28d9', bg2: '#0d9488', text: '#ffffff', muted: '#e9d5ff', card: 'rgba(255,255,255,0.14)', accent: '#ffffff', accentText: '#5b21b6', field: 'rgba(255,255,255,0.18)', fieldBorder: 'rgba(255,255,255,0.45)', plan: 'rgba(255,255,255,0.12)', line: 'rgba(255,255,255,0.25)', price: '#ffffff' },
  },
  {
    id: 'candy',
    name: 'Candy',
    blurb: 'Pink-to-orange gradient, playful.',
    layout: 'glass',
    font: ROUND,
    radius: 28,
    headline: 'Let’s get you online',
    subtitle: 'Type the code on your ticket.',
    c: { bg: '#db2777', bg2: '#f97316', text: '#ffffff', muted: '#fde7f3', card: 'rgba(255,255,255,0.16)', accent: '#ffffff', accentText: '#be185d', field: 'rgba(255,255,255,0.2)', fieldBorder: 'rgba(255,255,255,0.5)', plan: 'rgba(255,255,255,0.14)', line: 'rgba(255,255,255,0.3)', price: '#ffffff' },
  },
  {
    id: 'paper',
    name: 'Paper',
    blurb: 'Clean black-on-white, no frills.',
    layout: 'minimal',
    font: SANS,
    radius: 6,
    headline: 'Wi-Fi login',
    subtitle: 'Enter the code printed on your ticket.',
    c: { bg: '#ffffff', text: '#0a0a0a', muted: '#525252', card: '#ffffff', accent: '#0a0a0a', accentText: '#ffffff', field: '#ffffff', fieldBorder: '#0a0a0a', plan: '#fafafa', line: '#e5e5e5', price: '#0a0a0a' },
  },
  {
    id: 'coffee',
    name: 'Coffee',
    blurb: 'Cream and espresso, café style.',
    layout: 'card',
    font: SERIF,
    radius: 14,
    headline: 'Enjoy free-flowing Wi-Fi',
    subtitle: 'Ask at the counter for a ticket, then enter the code.',
    c: { bg: '#f5ede3', text: '#3b2416', muted: '#7c5a43', card: '#fffaf3', accent: '#6f4e37', accentText: '#fffaf3', field: '#fffaf3', fieldBorder: '#d6bfa6', plan: '#fffaf3', line: '#e7d6c3', price: '#6f4e37' },
  },
  {
    id: 'neon',
    name: 'Neon',
    blurb: 'Black page with lime glow.',
    layout: 'minimal',
    font: MONO,
    radius: 4,
    headline: 'ACCESS POINT',
    subtitle: 'Enter code to unlock the network.',
    c: { bg: '#000000', text: '#ecfccb', muted: '#a3e635', card: '#000000', accent: '#a3e635', accentText: '#000000', field: '#0a0a0a', fieldBorder: '#a3e635', plan: '#0a0a0a', line: '#365314', price: '#bef264' },
  },
  {
    id: 'royal',
    name: 'Royal',
    blurb: 'Indigo banner with gold accents.',
    layout: 'hero',
    font: SERIF,
    radius: 12,
    headline: 'Premium Wi-Fi',
    subtitle: 'Enter your access code to continue.',
    c: { bg: '#f8f7ff', bg2: '#312e81', heroTo: '#4f46e5', text: '#1e1b4b', muted: '#6366f1', card: '#ffffff', accent: '#d97706', accentText: '#ffffff', field: '#fffbeb', fieldBorder: '#fcd34d', plan: '#ffffff', line: '#e0e7ff', price: '#b45309' },
  },
  {
    id: 'coral',
    name: 'Coral',
    blurb: 'Full coral page, white card.',
    layout: 'bold',
    font: ROUND,
    radius: 20,
    headline: 'You’re almost online',
    subtitle: 'Just enter the code from your ticket.',
    c: { bg: '#f43f5e', text: '#1f2937', muted: '#6b7280', card: '#ffffff', accent: '#e11d48', accentText: '#ffffff', field: '#fff1f2', fieldBorder: '#fecdd3', plan: 'rgba(255,255,255,0.92)', line: '#ffe4e6', price: '#e11d48' },
  },
  {
    id: 'lagoon',
    name: 'Lagoon',
    blurb: 'Full teal page, white card.',
    layout: 'bold',
    font: SANS,
    radius: 16,
    headline: 'Connect in seconds',
    subtitle: 'Enter the code on your ticket below.',
    c: { bg: '#0f766e', text: '#134e4a', muted: '#5f7f7c', card: '#ffffff', accent: '#0d9488', accentText: '#ffffff', field: '#f0fdfa', fieldBorder: '#99f6e4', plan: 'rgba(255,255,255,0.94)', line: '#ccfbf1', price: '#0f766e' },
  },
  {
    id: 'slate',
    name: 'Slate',
    blurb: 'Login and price list side by side.',
    layout: 'split',
    font: SANS,
    radius: 14,
    headline: 'Sign in to Wi-Fi',
    subtitle: 'Already have a ticket? Enter the code.',
    c: { bg: '#f1f5f9', text: '#0f172a', muted: '#64748b', card: '#ffffff', accent: '#334155', accentText: '#ffffff', field: '#f8fafc', fieldBorder: '#cbd5e1', plan: '#ffffff', line: '#e2e8f0', price: '#0f172a' },
  },
  {
    id: 'citrus',
    name: 'Citrus',
    blurb: 'Fresh yellow and green, side by side.',
    layout: 'split',
    font: ROUND,
    radius: 18,
    headline: 'Fresh internet here',
    subtitle: 'Enter your ticket code to connect.',
    c: { bg: '#fefce8', text: '#365314', muted: '#65a30d', card: '#ffffff', accent: '#65a30d', accentText: '#ffffff', field: '#fefce8', fieldBorder: '#d9f99d', plan: '#ffffff', line: '#ecfccb', price: '#4d7c0f' },
  },
  {
    id: 'stub',
    name: 'Ticket stub',
    blurb: 'Login card shaped like a paper ticket.',
    layout: 'ticket',
    font: SANS,
    radius: 16,
    headline: 'Admit one device',
    subtitle: 'Enter the code from your ticket stub.',
    c: { bg: '#fdf6e3', text: '#3f1d1d', muted: '#92400e', card: '#ffffff', accent: '#b91c1c', accentText: '#ffffff', field: '#fffbeb', fieldBorder: '#fca5a5', plan: '#ffffff', line: '#fde68a', price: '#b91c1c' },
  },
  {
    id: 'boarding',
    name: 'Boarding pass',
    blurb: 'Dark ticket card with amber highlights.',
    layout: 'ticket',
    font: MONO,
    radius: 14,
    headline: 'Boarding: Wi-Fi',
    subtitle: 'Scan your ticket code and take off.',
    c: { bg: '#111827', text: '#f9fafb', muted: '#9ca3af', card: '#1f2937', accent: '#f59e0b', accentText: '#111827', field: '#111827', fieldBorder: '#f59e0b', plan: '#1f2937', line: '#374151', price: '#fbbf24' },
  },
  {
    id: 'glacier',
    name: 'Glacier',
    blurb: 'Icy blue gradient with a frosted card.',
    layout: 'glass',
    font: SANS,
    radius: 20,
    headline: 'Stay cool, stay connected',
    subtitle: 'Enter your ticket code.',
    c: { bg: '#0ea5e9', bg2: '#1e3a8a', text: '#ffffff', muted: '#e0f2fe', card: 'rgba(255,255,255,0.15)', accent: '#ffffff', accentText: '#0c4a6e', field: 'rgba(255,255,255,0.2)', fieldBorder: 'rgba(255,255,255,0.5)', plan: 'rgba(255,255,255,0.12)', line: 'rgba(255,255,255,0.28)', price: '#ffffff' },
  },
  {
    id: 'sahara',
    name: 'Sahara',
    blurb: 'Sand and terracotta, warm and earthy.',
    layout: 'card',
    font: SERIF,
    radius: 10,
    headline: 'Akwaaba! Get online',
    subtitle: 'Enter the code on your ticket.',
    c: { bg: '#f3e4cf', text: '#432818', muted: '#8a5a44', card: '#fbf3e7', accent: '#bc4b2a', accentText: '#ffffff', field: '#fff8ee', fieldBorder: '#e2b98f', plan: '#fbf3e7', line: '#ead2b4', price: '#bc4b2a' },
  },
  {
    id: 'kente',
    name: 'Kente',
    blurb: 'Gold, green and red stripes, bold card.',
    layout: 'bold',
    font: SANS,
    radius: 14,
    stripes: true,
    headline: 'Akwaaba to our Wi-Fi',
    subtitle: 'Enter your ticket code to connect.',
    c: { bg: '#14532d', text: '#1c1917', muted: '#57534e', card: '#ffffff', accent: '#ca8a04', accentText: '#1c1917', field: '#fefce8', fieldBorder: '#facc15', plan: 'rgba(255,255,255,0.95)', line: '#fef08a', price: '#15803d' },
  },
];

export const LOGIN_THEME_IDS = LOGIN_THEMES.map((t) => t.id);

export function loginThemeById(id) {
  return LOGIN_THEMES.find((t) => t.id === id) || LOGIN_THEMES[0];
}

/** Escapes HTML and `$` so router macros like $(error) cannot be injected through saved text. */
function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\$/g, '&#36;');
}

function formatSeconds(total) {
  const n = Number(total);
  if (!Number.isFinite(n) || n <= 0) return '';
  if (n % 86400 === 0) return `${n / 86400} day${n === 86400 ? '' : 's'}`;
  if (n >= 86400) return `${(n / 86400).toFixed(1)} days`;
  if (n % 3600 === 0) return `${n / 3600} hr${n === 3600 ? '' : 's'}`;
  if (n >= 3600) return `${(n / 3600).toFixed(1)} hrs`;
  return `${Math.round(n / 60)} min`;
}

function formatBytes(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return '';
  if (v >= 1073741824) return `${+(v / 1073741824).toFixed(1)} GB`;
  return `${Math.round(v / 1048576)} MB`;
}

export function formatPlanPrice(priceCents, currency = 'GHS') {
  const amount = Math.max(0, Number(priceCents) || 0) / 100;
  if (!amount) return 'Free';
  const text = Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
  return `${currency || 'GHS'} ${text}`;
}

/** Short plan facts: "1 day · 2 GB · 2 devices". */
export function planDetail(p) {
  const paused = p.ticketDurationType === 'paused';
  const time = paused
    ? formatSeconds(p.pausedSeconds ?? p.timeLimitSeconds)
    : formatSeconds(p.elapsedSeconds);
  const parts = [];
  if (time) parts.push(paused ? `${time} online` : time);
  parts.push(formatBytes(p.dataLimitBytes) || 'Unlimited data');
  if (Number(p.usersPerTicket) > 1) parts.push(`${p.usersPerTicket} devices`);
  if (Number(p.speedDownMbps) > 0) parts.push(`${p.speedDownMbps} Mbps`);
  return parts.join(' · ');
}

export const SAMPLE_PLANS = [
  { _id: 'sample-1', name: '1 Hour', priceCents: 100, currency: 'GHS', elapsedSeconds: 3600, dataLimitBytes: 524288000 },
  { _id: 'sample-2', name: 'Daily', priceCents: 500, currency: 'GHS', elapsedSeconds: 86400, dataLimitBytes: 2147483648 },
  { _id: 'sample-3', name: 'Weekly', priceCents: 2500, currency: 'GHS', elapsedSeconds: 604800, usersPerTicket: 2 },
];

function css(t) {
  const c = t.c;
  const r = t.radius;
  const pageBg = t.layout === 'glass' && c.bg2 ? `linear-gradient(160deg,${c.bg},${c.bg2})` : c.bg;
  const onAccentPage = t.layout === 'bold' || t.layout === 'glass';
  const headColor = onAccentPage ? '#ffffff' : c.text;
  const headMuted = onAccentPage ? 'rgba(255,255,255,0.85)' : c.muted;
  const stripes = t.stripes
    ? 'body:before{content:"";display:block;height:10px;background:repeating-linear-gradient(90deg,#facc15 0 24px,#15803d 24px 48px,#dc2626 48px 60px,#111827 60px 66px)}'
    : '';

  let layout = '';
  if (t.layout === 'card' || t.layout === 'glass' || t.layout === 'bold' || t.layout === 'ticket') {
    layout += `.card{background:${c.card};border-radius:${r}px;padding:26px 22px;box-shadow:0 18px 40px rgba(0,0,0,.18)}`;
  }
  if (t.layout === 'glass') {
    layout += `.card{border:1px solid ${c.line};-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px)}`;
  }
  if (t.layout === 'bold') {
    layout += `.card{color:${c.text}}.card .sub{color:${c.muted}}.lead h1,.lead .sub,.brand{color:#fff}`;
  }
  if (t.layout === 'minimal') {
    layout += `.card{padding:4px 0}.plans{border-top:1px solid ${c.line};padding-top:18px}`;
  }
  if (t.layout === 'hero') {
    layout += `.hero{background:linear-gradient(135deg,${c.bg2},${c.heroTo || c.accent});color:#fff;padding:30px 0 64px}.hero .brand,.hero h1,.hero .sub{color:#fff}.hero .sub{opacity:.85}.lift{margin-top:-46px}.card{background:${c.card};border-radius:${r}px;padding:22px;box-shadow:0 18px 40px rgba(15,23,42,.15)}`;
  }
  if (t.layout === 'split') {
    layout += `.wrap.wide{max-width:880px}.card{background:${c.card};border-radius:${r}px;padding:26px 22px;border:1px solid ${c.line}}.grid{display:block}@media(min-width:720px){.grid{display:flex;gap:22px;align-items:flex-start}.grid>*{flex:1}.grid .plans{margin-top:0}}`;
  }
  if (t.layout === 'ticket') {
    layout += `.card{position:relative;overflow:hidden}.card:before,.card:after{content:"";position:absolute;top:118px;width:26px;height:26px;border-radius:50%;background:${c.bg}}.card:before{left:-13px}.card:after{right:-13px}.tear{border-top:2px dashed ${c.line};margin:18px -22px 0}`;
  }

  return `*{box-sizing:border-box}
body{margin:0;min-height:100vh;background:${pageBg};background-attachment:fixed;color:${c.text};font-family:${t.font};-webkit-text-size-adjust:100%}
${stripes}
a{color:${c.accent}}
.wrap{max-width:440px;margin:0 auto;padding:24px 18px}
.brand{display:flex;align-items:center;gap:10px;margin:0 0 14px;font-size:14px;font-weight:700;letter-spacing:.02em;color:${t.layout === 'hero' ? '#fff' : onAccentPage ? '#fff' : c.accent}}
.brand img{max-height:40px;max-width:150px}
.site{font-weight:400;opacity:.75}
h1{margin:0;font-size:27px;line-height:1.2;color:${headColor}}
.sub{margin:8px 0 0;font-size:14px;line-height:1.45;color:${headMuted}}
.card h1{color:${t.layout === 'glass' ? '#fff' : c.text}}.card .sub{color:${c.muted}}
form{margin-top:18px}
label{display:block;margin:0 0 6px;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:${c.muted}}
input[type=text]{width:100%;border:2px solid ${c.fieldBorder};background:${c.field};color:${t.layout === 'glass' ? '#fff' : c.text};border-radius:${Math.max(4, r - 8)}px;padding:14px;font-size:24px;letter-spacing:.3em;font-family:${MONO};outline:none}
button{width:100%;margin-top:14px;border:0;border-radius:${Math.max(4, r - 8)}px;background:${c.accent};color:${c.accentText};font-size:16px;font-weight:700;padding:15px;cursor:pointer;font-family:inherit}
.err{margin:14px 0 0;color:#991b1b;background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:10px 12px;font-size:14px}
.buy{display:block;margin-top:14px;text-align:center;font-size:14px;font-weight:700;text-decoration:none;color:${t.layout === 'glass' ? '#fff' : c.accent}}
.plans{margin-top:22px}
.plans h2{margin:0 0 10px;font-size:13px;text-transform:uppercase;letter-spacing:.1em;color:${onAccentPage && t.layout !== 'split' ? '#fff' : c.muted}}
.plan{display:flex;align-items:center;gap:12px;margin-bottom:8px;padding:12px 14px;background:${c.plan};border:1px solid ${c.line};border-radius:${Math.max(4, r - 8)}px;text-decoration:none;color:${t.layout === 'glass' ? '#fff' : c.text}}
.plan .pi{flex:1;min-width:0}
.plan .pn{display:block;font-weight:700;font-size:15px}
.plan .pd{display:block;margin-top:2px;font-size:12px;color:${t.layout === 'glass' ? 'rgba(255,255,255,.8)' : c.muted}}
.plan .pp{font-weight:800;font-size:16px;white-space:nowrap;color:${c.price}}
.foot{margin-top:26px;text-align:center;font-size:12px;line-height:1.6;color:${headMuted}}
.foot p{margin:0}
.foot a{color:inherit;font-weight:700}
${layout}`;
}

/**
 * @param {{
 *   designId?: string, brandName?: string, logoUrl?: string, siteName?: string,
 *   headline?: string, subtitle?: string, buttonLabel?: string, buyLabel?: string, buyUrl?: string,
 *   footerText?: string, supportPhone?: string, plans?: object[], showPlans?: boolean,
 *   mode?: 'router' | 'web' | 'preview',
 *   web?: { action?: string, dst?: string, error?: string, username?: string },
 * }} o
 */
export function renderLoginPage(o = {}) {
  const t = loginThemeById(o.designId);
  const pick = (v, fallback) => String(v || '').trim() || fallback;
  const headline = pick(o.headline, t.headline);
  const subtitle = pick(o.subtitle, t.subtitle);
  const buttonLabel = pick(o.buttonLabel, 'Connect');
  const buyLabel = pick(o.buyLabel, 'Buy a code');
  const brandName = pick(o.brandName, 'Wi-Fi');
  const buyUrl = String(o.buyUrl || '').trim();
  const mode = o.mode === 'web' || o.mode === 'preview' ? o.mode : 'router';
  const web = o.web || {};

  let action = '$(link-login-only)';
  let dst = '$(link-orig)';
  let username = '$(username)';
  let errorBlock = '$(if error)<p class="err">$(error)</p>$(endif)';
  let formAttrs = '';
  if (mode === 'web') {
    action = esc(web.action || '');
    dst = esc(web.dst || '');
    username = esc(web.username || '');
    errorBlock = web.error ? `<p class="err">${esc(web.error)}</p>` : '';
    formAttrs = ' target="_top"';
  } else if (mode === 'preview') {
    action = '#';
    dst = '';
    username = '';
    errorBlock = '';
    formAttrs = ' onsubmit="return false"';
  }

  const logo = /^https:\/\//i.test(String(o.logoUrl || ''))
    ? `<img src="${esc(o.logoUrl)}" alt="" onerror="this.style.display='none'">`
    : '';
  const site = String(o.siteName || '').trim();
  const brand = `<p class="brand">${logo}<span>${esc(brandName)}${site ? ` <span class="site">· ${esc(site)}</span>` : ''}</span></p>`;
  const lead = `<div class="lead"><h1>${esc(headline)}</h1><p class="sub">${esc(subtitle)}</p></div>`;
  const buyLink = buyUrl ? `<a class="buy" href="${esc(buyUrl)}">${esc(buyLabel)}</a>` : '';
  const form = `${errorBlock}
<form action="${action}" method="post"${formAttrs}>
<input type="hidden" name="dst" value="${dst}">
<input type="hidden" name="popup" value="true">
<label for="code">Access code</label>
<input id="code" type="text" name="username" value="${username}" inputmode="numeric" autocomplete="off" autocapitalize="off" spellcheck="false">
<input type="hidden" name="password" value="">
<button type="submit">${esc(buttonLabel)}</button>
</form>
${buyLink}`;

  const plans = o.showPlans === false ? [] : Array.isArray(o.plans) ? o.plans.slice(0, 12) : [];
  const planItems = plans
    .map((p) => {
      const inner = `<span class="pi"><span class="pn">${esc(p.name)}</span><span class="pd">${esc(planDetail(p))}</span></span><span class="pp">${esc(formatPlanPrice(p.priceCents, p.currency))}</span>`;
      if (!buyUrl) return `<div class="plan">${inner}</div>`;
      const sep = buyUrl.includes('?') ? '&' : '?';
      const href = /^[a-f\d]{24}$/i.test(String(p._id)) ? `${buyUrl}${sep}package=${p._id}` : buyUrl;
      return `<a class="plan" href="${esc(href)}">${inner}</a>`;
    })
    .join('');
  const plansBlock = planItems ? `<section class="plans"><h2>Plans &amp; prices</h2>${planItems}</section>` : '';

  const footLines = [];
  if (String(o.footerText || '').trim()) footLines.push(`<p>${esc(o.footerText)}</p>`);
  const phone = String(o.supportPhone || '').trim();
  if (phone) {
    footLines.push(`<p>Need help? <a href="tel:${esc(phone.replace(/[^\d+]/g, ''))}">${esc(phone)}</a></p>`);
  }
  footLines.push(`<p>&copy; ${new Date().getFullYear()} ${esc(brandName)}</p>`);
  const footer = `<footer class="foot">${footLines.join('')}</footer>`;

  let body;
  switch (t.layout) {
    case 'hero':
      body = `<div class="hero"><div class="wrap">${brand}${lead}</div></div><div class="wrap lift"><div class="card">${form}</div>${plansBlock}${footer}</div>`;
      break;
    case 'minimal':
      body = `<div class="wrap">${brand}${lead}<div class="card">${form}</div>${plansBlock}${footer}</div>`;
      break;
    case 'bold':
      body = `<div class="wrap">${brand}${lead}<div class="card" style="margin-top:18px">${form}</div>${plansBlock}${footer}</div>`;
      break;
    case 'split':
      body = `<div class="wrap wide"><div class="grid"><div class="card">${brand}${lead}${form}</div>${plansBlock}</div>${footer}</div>`;
      break;
    case 'ticket':
      body = `<div class="wrap"><div class="card">${brand}${lead}<div class="tear"></div>${form}</div>${plansBlock}${footer}</div>`;
      break;
    default:
      body = `<div class="wrap"><div class="card">${brand}${lead}${form}</div>${plansBlock}${footer}</div>`;
  }

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${mode === 'web' ? '<base target="_top">\n' : ''}<title>${esc(headline)}</title>
<style>
${css(t)}
</style>
</head>
<body>
${body}
</body>
</html>
`;
}
