import { sendArkeselSms } from '../integrations/arkesel.js';
import { sendSmtpMail } from '../integrations/mail.js';
import { Admin, TicketSale } from '../models/index.js';

function money(cents) {
  return `GHS ${(Number(cents || 0) / 100).toFixed(2)}`;
}

function uniqueBy(arr, keyFn) {
  const seen = new Set();
  const out = [];
  for (const item of arr) {
    const k = keyFn(item);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out;
}

export async function notifyTicketTransactionUpdate({
  organizationId,
  actorAdminId,
  eventKind,
  saleId,
}) {
  try {
    if (!organizationId || !saleId) return;

    const [sale, actor, orgAdmins] = await Promise.all([
      TicketSale.findById(saleId).populate('siteId', 'name').populate('ticketTypeId', 'label').lean(),
      Admin.findById(actorAdminId).select('email').lean(),
      Admin.find({
        organizationId,
        role: { $in: ['org_admin', 'org_staff'] },
      })
        .select('email phone')
        .lean(),
    ]);
    if (!sale) return;

    const recipients = uniqueBy(
      [...orgAdmins, { email: actor?.email || '', phone: '' }],
      (r) => String(r.email || '').trim().toLowerCase() || `p:${String(r.phone || '').trim()}`
    );
    if (recipients.length === 0) return;

    const who = sale.receivedFromName?.trim()
      ? `${sale.sellerName} (cash handed over by ${sale.receivedFromName.trim()})`
      : sale.sellerName;
    const title = eventKind === 'issued' ? 'Ticket issued update' : 'Ticket collection update';
    const line = `${eventKind === 'issued' ? 'Issued' : 'Collected'} ${money(sale.amountCents)} · ${
      sale.ticketTypeId?.label || 'Ticket'
    } · ${sale.siteId?.name || 'Site'} · Seller ${who}.`;
    const actorLine = `Recorded by ${actor?.email || 'admin'}.`;
    const textBody = `${title}\n\n${line}\n${actorLine}`;

    await Promise.allSettled(
      recipients.map(async (r) => {
        const email = String(r.email || '').trim();
        const phone = String(r.phone || '').trim();
        if (email) {
          await sendSmtpMail({
            to: email,
            subject: title,
            text: textBody,
          });
        }
        if (phone) {
          await sendArkeselSms({
            to: phone,
            message: `${title}: ${line}`,
          });
        }
      })
    );
  } catch {
    // Non-blocking notification path; never fail ticket transaction due to notify errors.
  }
}

