import { escapeHtml } from './htmlEscape.js';

/**
 * Shared transactional layout — table-based for broad client support.
 * @param {{ brand: string, title: string, preheader?: string, innerHtml: string, footerText?: string }} p
 */
export function wrapTransactionalHtml({ brand, title, preheader = '', innerHtml, footerText = '' }) {
  const pre = escapeHtml(preheader);
  const b = escapeHtml(brand);
  const t = escapeHtml(title);
  const foot = footerText ? escapeHtml(footerText) : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${t}</title>
</head>
<body style="margin:0;padding:0;background:#0f172a;font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  ${pre ? `<div style="display:none;max-height:0;overflow:hidden;">${pre}</div>` : ''}
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#0f172a;padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:480px;background:#1e293b;border-radius:12px;overflow:hidden;border:1px solid #334155;">
          <tr>
            <td style="padding:20px 24px;background:linear-gradient(135deg,#4f46e5 0%,#6366f1 100%);">
              <p style="margin:0;font-size:11px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:rgba(255,255,255,0.85);">${b}</p>
              <h1 style="margin:8px 0 0;font-size:18px;font-weight:600;color:#ffffff;">${t}</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:24px;color:#e2e8f0;font-size:15px;line-height:1.55;">
              ${innerHtml}
            </td>
          </tr>
          ${
            foot
              ? `<tr><td style="padding:0 24px 20px;font-size:12px;line-height:1.5;color:#64748b;">${foot.replace(/\n/g, '<br/>')}</td></tr>`
              : ''
          }
        </table>
        <p style="margin:16px 0 0;font-size:11px;color:#475569;">This message was sent by ${b}.</p>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
