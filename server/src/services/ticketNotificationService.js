import { sendArkeselSms } from '../integrations/arkesel.js';
import { sendSmtpMail } from '../integrations/mail.js';
import { normalizeGhanaMsisdn } from '../utils/phoneGhana.js';
import { config } from '../config.js';
import { Admin, TicketSale } from '../models/index.js';
import {
  aggregateSellerOutstandingByTicketType,
  formatSellerOutstandingSms,
} from './ticketSellerOutstanding.js';

function money(cents) {
  return `GHS ${(Number(cents || 0) / 100).toFixed(2)}`;
}

/** Logged-in admin who submitted the ticket row. */
function recordedByLabel(admin) {
  const n = String(admin?.fullName || '').trim();
  if (n) return n;
  const e = String(admin?.email || '').trim().toLowerCase();
  if (e) return e;
  const p = String(admin?.phone || '').trim();
  if (p) return p;
  return 'Admin';
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

async function smsPartyRecipients(entries) {
  const seen = new Set();
  await Promise.allSettled(
    entries.map(async ({ to, message }) => {
      if (!to || seen.has(to)) return;
      seen.add(to);
      await sendArkeselSms({ to, message });
    })
  );
}

async function notifyTicketPartiesSms({ organizationId, sale, eventKind, issueParent, recordedBy }) {
  try {
    if (!sale) return;
    const brand = config.merchant.displayName || 'QareFi Billing';
    const label = sale.ticketTypeId?.label || 'Ticket';
    const siteName = sale.siteId?.name || 'Site';
    const qtyStr = `${sale.quantity}`;
    const amountStr = money(sale.amountCents);

    const siteOid =
      sale.siteId != null && typeof sale.siteId === 'object' && sale.siteId._id != null
        ? sale.siteId._id
        : sale.siteId;
    const sellerForRollup =
      eventKind === 'issued' ? sale.sellerName : issueParent?.sellerName || sale.sellerName;

    let rollupLine = '';
    try {
      if (organizationId && siteOid && sellerForRollup) {
        const rows = await aggregateSellerOutstandingByTicketType(organizationId, siteOid, sellerForRollup);
        rollupLine = formatSellerOutstandingSms(rows);
      }
    } catch {
      rollupLine = '';
    }

    if (eventKind === 'issued') {
      const to = normalizeGhanaMsisdn(sale.sellerPhone);
      if (!to) return;
      const msg = `${brand}: Tickets issued to you (${sale.sellerName}). Qty ${qtyStr}, ${amountStr}. ${label}. ${siteName}.${recordedBy ? ` Issued by: ${recordedBy}.` : ''}${rollupLine}`;
      await smsPartyRecipients([{ to, message: msg }]);
      return;
    }

    if (eventKind === 'collected') {
      const batchName = issueParent?.sellerName || sale.sellerName;
      const receiverTo = normalizeGhanaMsisdn(issueParent?.sellerPhone || '');
      const courierTo = normalizeGhanaMsisdn(sale.receivedFromPhone);
      const fromLine = sale.receivedFromName?.trim() ? ` From: ${sale.receivedFromName.trim()}.` : '';

      const entries = [];

      const receiverMsg = `${brand}: Cash collected (${batchName}). This payment qty ${qtyStr}, ${amountStr}. ${label}. ${siteName}.${fromLine}${
        recordedBy ? ` Collected by: ${recordedBy}.` : ''
      }${rollupLine}`;

      if (receiverTo) {
        entries.push({ to: receiverTo, message: receiverMsg });
      }

      if (courierTo && courierTo !== receiverTo) {
        entries.push({
          to: courierTo,
          message: `${brand}: We recorded qty ${qtyStr}, ${amountStr} collected for ${batchName}'s ticket batch (${label}, ${siteName}).${
            recordedBy ? ` Collected by: ${recordedBy}.` : ''
          }${rollupLine}`,
        });
      }

      if (entries.length === 0) return;
      await smsPartyRecipients(entries);
    }
  } catch {
    /* non-blocking party SMS */
  }
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
      TicketSale.findById(saleId)
        .populate('siteId', 'name')
        .populate('ticketTypeId', 'label')
        .populate({ path: 'issueSaleId', select: 'sellerName sellerPhone' })
        .lean(),
      Admin.findById(actorAdminId).select('email phone fullName').lean(),
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

    if (recipients.length > 0) {
      const who = sale.receivedFromName?.trim()
        ? `${sale.sellerName} (cash handed over by ${sale.receivedFromName.trim()})`
        : sale.sellerName;
      const title = eventKind === 'issued' ? 'Ticket issued update' : 'Ticket collection update';
      const line = `${eventKind === 'issued' ? 'Issued' : 'Collected'} qty ${sale.quantity} · ${money(sale.amountCents)} · ${
        sale.ticketTypeId?.label || 'Ticket'
      } · ${sale.siteId?.name || 'Site'} · Seller ${who}.`;
      const recorder = recordedByLabel(actor);
      const actorLine =
        eventKind === 'issued' ? `Issued by ${recorder}.` : `Collected by ${recorder}.`;
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
              message: `${title}: ${line} ${actorLine}`,
            });
          }
        })
      );
    }

    const issueParent =
      sale.kind === 'collected' && sale.issueSaleId && typeof sale.issueSaleId === 'object'
        ? sale.issueSaleId
        : null;
    await notifyTicketPartiesSms({
      organizationId,
      sale,
      eventKind,
      issueParent,
      recordedBy: recordedByLabel(actor),
    });
  } catch {
    // Non-blocking notification path; never fail ticket transaction due to notify errors.
  }
}

