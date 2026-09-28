import { portalCopy } from './captivePortalCopy.js';

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const SKINS = {
  midnight: {
    page: '#020617',
    card: '#0f172a',
    text: '#f8fafc',
    muted: '#94a3b8',
    brand: '#6ee7b7',
    field: '#020617',
    fieldBorder: '#334155',
    button: '#059669',
    buttonText: '#ffffff',
    link: '#6ee7b7',
  },
  sunrise: {
    page: '#fff7ed',
    card: '#ffffff',
    text: '#1c1917',
    muted: '#78716c',
    brand: '#c2410c',
    field: '#fff7ed',
    fieldBorder: '#fdba74',
    button: '#ea580c',
    buttonText: '#ffffff',
    link: '#c2410c',
  },
  signal: {
    page: '#06141f',
    card: '#06141f',
    text: '#ecfeff',
    muted: '#94a3b8',
    brand: '#67e8f9',
    field: '#083344',
    fieldBorder: '#22d3ee',
    button: '#22d3ee',
    buttonText: '#042f2e',
    link: '#67e8f9',
  },
};

/**
 * Hotspot login.html served by the router. MikroTik replaces $(...) before the guest sees it.
 * Username is the voucher code. Password stays empty (username-only hotspot users).
 */
export function buildCaptiveLoginHtml({
  designId,
  brandName,
  headline,
  subtitle,
  buttonLabel,
  buyLabel,
  voucherTitle,
  buyUrl,
}) {
  const copy = portalCopy(designId, { headline, subtitle, buttonLabel, buyLabel, voucherTitle });
  const skin = SKINS[copy.designId] || SKINS.midnight;
  const buy = String(buyUrl || '').trim();
  const buyBlock = buy
    ? `<p class="buy"><a href="${esc(buy)}">${esc(copy.buyLabel)}</a></p>`
    : '';

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(copy.headline)}</title>
<style>
body{margin:0;min-height:100vh;background:${skin.page};color:${skin.text};font-family:Arial,sans-serif}
.wrap{max-width:420px;margin:0 auto;padding:28px 18px}
.card{background:${skin.card};border-radius:24px;padding:28px 22px}
.brand{margin:0 0 8px;color:${skin.brand};font-size:14px;font-weight:700}
h1{margin:0;font-size:28px;line-height:1.2}
.sub{margin:8px 0 0;color:${skin.muted};font-size:14px}
label{display:block;margin:22px 0 6px;color:${skin.muted};font-size:12px}
input[type=text]{width:100%;box-sizing:border-box;border:1px solid ${skin.fieldBorder};background:${skin.field};color:${skin.text};border-radius:14px;padding:14px 12px;font-size:22px;letter-spacing:.25em}
button{width:100%;margin-top:16px;border:0;border-radius:14px;background:${skin.button};color:${skin.buttonText};font-size:16px;font-weight:700;padding:14px}
.err{margin-top:12px;color:#b91c1c;background:#fef2f2;border-radius:10px;padding:10px 12px;font-size:14px}
.buy{text-align:center;margin:16px 0 0}
.buy a{color:${skin.link};font-size:14px;font-weight:700;text-decoration:none}
</style>
</head>
<body>
<div class="wrap"><div class="card">
<p class="brand">${esc(brandName || 'Wi-Fi')}</p>
<h1>${esc(copy.headline)}</h1>
<p class="sub">${esc(copy.subtitle)}</p>
$(if error)
<p class="err">$(error)</p>
$(endif)
<form action="$(link-login-only)" method="post">
<input type="hidden" name="dst" value="$(link-orig)">
<input type="hidden" name="popup" value="true">
<label>Access code</label>
<input type="text" name="username" value="$(username)" inputmode="numeric" autocomplete="off">
<input type="hidden" name="password" value="">
<button type="submit">${esc(copy.buttonLabel)}</button>
</form>
${buyBlock}
</div></div>
</body>
</html>
`;
}
