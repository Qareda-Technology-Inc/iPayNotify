import nodemailer from 'nodemailer';
import { config } from '../config.js';

/**
 * True when host + from are set (password optional for relay).
 * SMTP_MOCK=true logs only, no outbound SMTP.
 */
export function isSmtpConfigured() {
  const { host, from } = config.smtp;
  return Boolean(String(host || '').trim() && String(from || '').trim());
}

export function smtpReadyForSend() {
  if (!isSmtpConfigured()) return false;
  const { mock, user, pass } = config.smtp;
  if (mock) return true;
  if (user && !pass) return false;
  return true;
}

let cachedTransport = null;
let cachedKey = '';

function transportKey() {
  const s = config.smtp;
  const port = Number(s.port) || 587;
  const secure = resolveSmtpImplicitTls(port, s.secure);
  return [s.host, port, secure, s.user, s.mock].join('|');
}

/**
 * `secure: true` = TLS from the first byte (SMTPS), usually **port 465**.
 * **Port 587** uses plain connect + **STARTTLS** → must use `secure: false` or OpenSSL returns
 * `tls_validate_record_header:wrong version number`.
 */
function resolveSmtpImplicitTls(portRaw, secureFromEnv) {
  const port = Number(portRaw) || 587;
  const wants = Boolean(secureFromEnv);
  if (port === 465) {
    return true;
  }
  if ((port === 587 || port === 2525 || port === 25 || port === 2587) && wants) {
    console.warn(
      `[SMTP] Port ${port} expects STARTTLS, not implicit TLS. Use SMTP_SECURE=false (remove SMTP_SECURE=true). ` +
        `For implicit TLS use port 465.`
    );
    return false;
  }
  return wants;
}

function getTransport() {
  if (!isSmtpConfigured()) return null;
  const k = transportKey();
  if (cachedTransport && cachedKey === k) return cachedTransport;
  cachedKey = k;
  const { host, port: portRaw, secure: secureEnv, user, pass, mock } = config.smtp;
  if (mock) {
    cachedTransport = null;
    return null;
  }
  const port = Number(portRaw) || 587;
  const secure = resolveSmtpImplicitTls(port, secureEnv);
  cachedTransport = nodemailer.createTransport({
    host: String(host).trim(),
    port,
    secure,
    auth:
      user && String(user).trim()
        ? { user: String(user).trim(), pass: String(pass || '') }
        : undefined,
  });
  return cachedTransport;
}

/**
 * @param {{ to: string, subject: string, text: string, html?: string }} opts
 * @returns {Promise<{ ok: boolean, mock?: boolean, skipped?: boolean, reason?: string, error?: string }>}
 */
export async function sendSmtpMail({ to, subject, text, html }) {
  const addr = String(to || '').trim();
  const subj = String(subject || '').trim();
  const body = String(text || '').trim();
  if (!addr || !subj || !body) {
    return { ok: false, error: 'missing_to_subject_or_body' };
  }
  if (!isSmtpConfigured()) {
    return { ok: false, skipped: true, reason: 'smtp_not_configured' };
  }
  if (!smtpReadyForSend()) {
    return { ok: false, skipped: true, reason: 'smtp_incomplete_auth' };
  }

  if (config.smtp.mock) {
    console.log('[SMTP mock]', { to: addr, subject: subj, snippet: body.slice(0, 200) });
    return { ok: true, mock: true };
  }

  const transport = getTransport();
  if (!transport) {
    return { ok: false, error: 'no_transport' };
  }

  try {
    await transport.sendMail({
      from: String(config.smtp.from).trim(),
      to: addr,
      subject: subj,
      text: body,
      ...(html ? { html: String(html) } : {}),
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message || 'send_failed' };
  }
}
