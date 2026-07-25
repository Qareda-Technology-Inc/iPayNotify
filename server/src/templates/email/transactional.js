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

/**
 * Organisation admin invite (set password via link).
 * @param {{ brand: string, inviteeName: string, orgName: string, acceptUrl: string, expiresDays?: number, appUrl?: string }} p
 */
export function buildAdminInviteEmail(p) {
  const brand = String(p.brand || 'QareFi Billing').trim();
  const inviteeName = String(p.inviteeName || '').trim() || 'there';
  const orgName = String(p.orgName || 'your organisation').trim();
  const acceptUrl = String(p.acceptUrl || '').trim();
  const expiresDays = Number(p.expiresDays) || 7;
  const appUrl = String(p.appUrl || '').trim();

  const subject = `${brand} — you're invited to ${orgName}`;

  const text = [
    `${brand}`,
    '',
    `Hi ${inviteeName},`,
    '',
    `You have been invited to manage ${orgName} on ${brand}.`,
    '',
    `Accept your invite and set a password:`,
    acceptUrl,
    '',
    `This link expires in ${expiresDays} days.`,
    appUrl ? `\nDashboard: ${appUrl}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const innerHtml = `
    <p style="margin:0 0 12px;">Hi <strong style="color:#e2e8f0;">${escapeHtml(inviteeName)}</strong>,</p>
    <p style="margin:0 0 16px;">You have been invited to manage <strong style="color:#e2e8f0;">${escapeHtml(orgName)}</strong> on ${escapeHtml(brand)}.</p>
    <p style="margin:0 0 20px;text-align:center;">
      <a href="${escapeHtml(acceptUrl)}" style="display:inline-block;padding:12px 22px;background:#4f46e5;color:#fff;text-decoration:none;border-radius:10px;font-weight:600;font-size:14px;">Accept invite &amp; set password</a>
    </p>
    <p style="margin:0;color:#94a3b8;font-size:13px;">Or paste this link into your browser:<br/><span style="word-break:break-all;color:#cbd5e1;">${escapeHtml(acceptUrl)}</span></p>
    <p style="margin:16px 0 0;color:#94a3b8;font-size:13px;">This link expires in <strong style="color:#cbd5e1;">${escapeHtml(String(expiresDays))} days</strong>.</p>
  `.trim();

  const html = wrapTransactionalHtml({
    brand,
    title: 'Organisation invite',
    preheader: `Join ${orgName} on ${brand}`,
    innerHtml,
    footerText: appUrl ? `Dashboard: ${appUrl}` : '',
  });

  return { subject, text, html };
}

/**
 * Admin alert after a customer payment is fulfilled (renewal / voucher).
 * @param {{
 *   brand: string,
 *   kind: string,
 *   amountLabel: string,
 *   customerPhone?: string,
 *   customerName?: string,
 *   packageName?: string,
 *   secretName?: string,
 *   voucherCode?: string,
 *   paidUntilLabel?: string,
 *   clientReference?: string,
 *   providerReference?: string,
 *   appUrl?: string,
 * }} p
 */
export function buildPaymentSuccessAdminEmail(p) {
  const brand = String(p.brand || 'QareFi Billing').trim();
  const kind = String(p.kind || 'payment').trim();
  const kindLabel = kind === 'voucher' ? 'Hotspot voucher' : kind === 'renewal' ? 'PPPoE renewal' : 'Payment';
  const amountLabel = String(p.amountLabel || '').trim() || '—';
  const customerPhone = String(p.customerPhone || '').trim() || '—';
  const customerName = String(p.customerName || '').trim() || '—';
  const packageName = String(p.packageName || '').trim() || '—';
  const secretName = String(p.secretName || '').trim();
  const voucherCode = String(p.voucherCode || '').trim();
  const paidUntilLabel = String(p.paidUntilLabel || '').trim();
  const clientReference = String(p.clientReference || '').trim() || '—';
  const providerReference = String(p.providerReference || '').trim();
  const appUrl = String(p.appUrl || '').trim();

  const subject = `${brand} — ${kindLabel} paid (${amountLabel})`;

  const detailLines = [
    `Type: ${kindLabel}`,
    `Amount: ${amountLabel}`,
    `Customer: ${customerName}`,
    `Phone: ${customerPhone}`,
    `Package: ${packageName}`,
    secretName ? `PPPoE username: ${secretName}` : null,
    voucherCode ? `Voucher code: ${voucherCode}` : null,
    paidUntilLabel ? `Paid until: ${paidUntilLabel}` : null,
    `Client reference: ${clientReference}`,
    providerReference ? `Provider reference: ${providerReference}` : null,
  ].filter(Boolean);

  const text = [`${brand}`, '', 'Payment received and fulfilled.', '', ...detailLines, appUrl ? `\nDashboard: ${appUrl}` : '']
    .filter(Boolean)
    .join('\n');

  const row = (label, value) =>
    `<tr><td style="padding:6px 0;color:#94a3b8;width:42%;vertical-align:top;">${escapeHtml(label)}</td><td style="padding:6px 0;color:#e2e8f0;font-weight:500;">${escapeHtml(value)}</td></tr>`;

  const innerHtml = `
    <p style="margin:0 0 16px;">A customer payment was received and fulfilled.</p>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="font-size:14px;">
      ${row('Type', kindLabel)}
      ${row('Amount', amountLabel)}
      ${row('Customer', customerName)}
      ${row('Phone', customerPhone)}
      ${row('Package', packageName)}
      ${secretName ? row('PPPoE username', secretName) : ''}
      ${voucherCode ? row('Voucher code', voucherCode) : ''}
      ${paidUntilLabel ? row('Paid until', paidUntilLabel) : ''}
      ${row('Client reference', clientReference)}
      ${providerReference ? row('Provider reference', providerReference) : ''}
    </table>
  `.trim();

  const html = wrapTransactionalHtml({
    brand,
    title: `${kindLabel} paid`,
    preheader: `${amountLabel} · ${customerPhone}`,
    innerHtml,
    footerText: appUrl ? `Dashboard: ${appUrl}` : '',
  });

  return { subject, text, html };
}
