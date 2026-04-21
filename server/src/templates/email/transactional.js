import { escapeHtml } from './htmlEscape.js';
import { wrapTransactionalHtml } from './layout.js';

/**
 * Organisation admin sign-in OTP (HTML + plain text).
 * @param {{ brand: string, code: string, expiresMinutes: number, appUrl?: string }} p
 */
export function buildAdminSignInOtpEmail(p) {
  const brand = String(p.brand || 'QareFi Billing').trim();
  const code = String(p.code || '').trim();
  const mins = Number(p.expiresMinutes) || 10;
  const appUrl = String(p.appUrl || '').trim();

  const subject = `${brand} — sign-in verification code`;

  const text = [
    `${brand}`,
    '',
    `Your sign-in verification code is: ${code}`,
    '',
    `This code expires in ${mins} minutes.`,
    'If you did not try to sign in, you can ignore this email.',
    appUrl ? `\n${brand}: ${appUrl}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const innerHtml = `
    <p style="margin:0 0 16px;">Use this code to finish signing in to the billing dashboard:</p>
    <p style="margin:0 0 20px;text-align:center;">
      <span style="display:inline-block;padding:14px 28px;background:#0f172a;border:1px solid #334155;border-radius:10px;font-size:28px;font-weight:700;letter-spacing:0.25em;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;color:#a5b4fc;">${escapeHtml(code)}</span>
    </p>
    <p style="margin:0;color:#94a3b8;font-size:14px;">The code expires in <strong style="color:#cbd5e1;">${escapeHtml(String(mins))} minutes</strong>. If you did not request this, you can safely ignore this message.</p>
  `.trim();

  const footerLines = [
    appUrl ? `Dashboard: ${appUrl}` : null,
    'Never share this code with anyone. Staff will never ask you for it.',
  ].filter(Boolean);

  const html = wrapTransactionalHtml({
    brand,
    title: 'Sign-in verification',
    preheader: `Your code is ${code}. Expires in ${mins} minutes.`,
    innerHtml,
    footerText: footerLines.join('\n'),
  });

  return { subject, text, html };
}

/**
 * SMTP connectivity test (HTML + plain text).
 * @param {{ brand: string, appUrl?: string }} p
 */
export function buildSmtpTestEmail(p) {
  const brand = String(p.brand || 'QareFi Billing').trim();
  const appUrl = String(p.appUrl || '').trim();
  const subject = `${brand} — email delivery test`;

  const text = [
    `${brand}`,
    '',
    'This is a test message from your billing server.',
    'If you are reading this, SMTP settings are working.',
    appUrl ? `\nApp URL: ${appUrl}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const innerHtml = `
    <p style="margin:0 0 12px;">Your outbound email is configured correctly.</p>
    <p style="margin:0;color:#94a3b8;font-size:14px;">This is a manual test from the <strong style="color:#cbd5e1;">Email &amp; templates</strong> page. No action is required.</p>
  `;

  const html = wrapTransactionalHtml({
    brand,
    title: 'Email delivery test',
    preheader: 'SMTP test — no action required.',
    innerHtml,
    footerText: appUrl ? `App: ${appUrl}` : '',
  });

  return { subject, text, html };
}
