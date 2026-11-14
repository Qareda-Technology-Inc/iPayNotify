import { sendArkeselSms } from '../integrations/arkesel.js';
import { sendSmtpMail } from '../integrations/mail.js';
import { config } from '../config.js';
import { Organization } from '../models/index.js';
import { alertRecipients } from './routerMonitorService.js';

const ghs = (cents) => `GHS ${((Number(cents) || 0) / 100).toFixed(2)}`;

const escapeHtml = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/**
 * Tell platform admins (email + SMS) that a vendor withdrawal is waiting for them to pay it.
 * Never throws: a failed alert must not fail the withdrawal.
 */
export async function notifyWithdrawalWaiting(withdrawal, reason = '') {
  try {
    const org = await Organization.findById(withdrawal.organizationId).select('name billing.payoutMomoNumber').lean();
    const orgName = org?.name || 'A vendor';
    const { emails, phones } = await alertRecipients(null);
    const base = String(config.publicAppUrl || '').replace(/\/$/, '');
    const link = base ? `${base}/super/withdrawals` : '';
    const amount = ghs(withdrawal.amountCents);
    const to = withdrawal.payoutMsisdn || org?.billing?.payoutMomoNumber || '';

    const subject = `Withdrawal to pay: ${orgName} ${amount}`;
    const lines = [
      `${orgName} asked to withdraw ${amount}${to ? ` to MoMo ${to}` : ''}.`,
      reason ? `Waiting because: ${reason}` : '',
      'Send the money, then click Mark paid on Vendor withdrawals so it comes off their wallet.',
      link,
    ].filter(Boolean);
    const html = `<p>${lines.map((l) => (l === link ? `<a href="${escapeHtml(link)}">Open Vendor withdrawals</a>` : escapeHtml(l))).join('</p><p>')}</p>`;
    const sms = `QareFi: ${orgName} wants to withdraw ${amount}${to ? ` to ${to}` : ''}. Pay it, then Mark paid on Vendor withdrawals.`;

    const [mail, text] = await Promise.all([
      Promise.allSettled(emails.map((addr) => sendSmtpMail({ to: addr, subject, text: lines.join('\n\n'), html }))),
      Promise.allSettled(phones.map((msisdn) => sendArkeselSms({ to: msisdn, message: sms }))),
    ]);
    const ok = (rs) => rs.filter((r) => r.status === 'fulfilled' && r.value?.ok).length;
    return { emails: ok(mail), sms: ok(text) };
  } catch (e) {
    console.error('[payout] withdrawal alert failed', e?.message || e);
    return { emails: 0, sms: 0 };
  }
}
