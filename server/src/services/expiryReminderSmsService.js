import mongoose from 'mongoose';
import {
  ExpiryReminderSmsLog,
  MessageTemplate,
  PppoeAccount,
  RemoteAccessSubscription,
} from '../models/index.js';
import { config } from '../config.js';
import { sendArkeselSms } from '../integrations/arkesel.js';
import { normalizeGhanaMsisdn } from '../utils/phoneGhana.js';
import { renderMessageBody } from './messageTemplateService.js';
import { resolveSmsBranding } from './smsRouterBranding.js';

/** When no active `expiry_reminder_3d` template exists for the organisation. */
export const DEFAULT_EXPIRY_REMINDER_SMS_BODY =
  '{{brand}}: Hi {{name}}, your {{service_type}} plan ({{package}}) ends on {{paidUntil}}. Renew soon to avoid interruption.';

/**
 * @param {{ respectEnabledFlag?: boolean, organizationId?: string }} [options]
 * - `respectEnabledFlag` — when true (default), no-op if `config.expiryReminderSms.enabled` is false (cron uses this).
 * - `organizationId` — limit to one tenant (optional).
 */
export async function runExpiryReminderSmsJob(options = {}) {
  const respectEnabledFlag = options.respectEnabledFlag !== false;
  if (respectEnabledFlag && !config.expiryReminderSms.enabled) {
    return {
      skipped: true,
      reason: 'expiry_reminder_sms_disabled',
      hint: 'Set EXPIRY_REMINDER_SMS_ENABLED=true',
    };
  }

  const days = config.expiryReminderSms.days;
  const now = new Date();
  const windowEnd = new Date(now.getTime() + days * 86400000);

  const filterOrg =
    options.organizationId != null &&
    String(options.organizationId).trim() &&
    mongoose.isValidObjectId(String(options.organizationId).trim())
      ? String(options.organizationId).trim()
      : null;

  const orgMatch = filterOrg ? { organizationId: new mongoose.Types.ObjectId(filterOrg) } : {};

  const summary = {
    windowDays: days,
    windowEnd: windowEnd.toISOString(),
    pppoe: { candidates: 0, sent: 0, skippedNoPhone: 0, skippedAlreadySent: 0, failed: 0 },
    remote: { candidates: 0, sent: 0, skippedNoPhone: 0, skippedAlreadySent: 0, failed: 0 },
  };

  const templateCache = new Map();

  async function bodyForOrg(orgId) {
    const key = String(orgId);
    if (templateCache.has(key)) return templateCache.get(key);
    const t = await MessageTemplate.findOne({
      organizationId: orgId,
      category: 'expiry_reminder_3d',
      isActive: true,
    })
      .sort({ updatedAt: -1 })
      .select('body')
      .lean();
    const body = String(t?.body || '').trim() || DEFAULT_EXPIRY_REMINDER_SMS_BODY;
    templateCache.set(key, body);
    return body;
  }

  async function alreadySent(kind, billingId, periodEnd) {
    const hit = await ExpiryReminderSmsLog.findOne({
      kind,
      billingId,
      periodEnd,
    })
      .select('_id')
      .lean();
    return Boolean(hit);
  }

  const pppoeList = await PppoeAccount.find({
    ...orgMatch,
    disabled: false,
    userId: { $exists: true, $ne: null },
    organizationId: { $exists: true, $ne: null },
    paidUntil: { $gt: now, $lte: windowEnd },
  })
    .populate('userId', 'phone fullName email')
    .populate('packageId', 'name')
    .lean();

  for (const acc of pppoeList) {
    summary.pppoe.candidates += 1;
    const u = acc.userId;
    const phone = u && typeof u === 'object' ? normalizeGhanaMsisdn(u.phone) : '';
    if (!phone) {
      summary.pppoe.skippedNoPhone += 1;
      continue;
    }
    if (await alreadySent('pppoe', acc._id, acc.paidUntil)) {
      summary.pppoe.skippedAlreadySent += 1;
      continue;
    }

    const orgId = acc.organizationId;
    const bodyTemplate = await bodyForOrg(orgId);
    const branding = await resolveSmsBranding(acc.routerId, orgId);
    const name =
      (u && typeof u === 'object' && String(u.fullName || '').trim()) ||
      String(u?.email || '').trim() ||
      'Customer';
    const pkgName = (acc.packageId && acc.packageId.name) || 'your plan';
    const paidUntilStr = new Date(acc.paidUntil).toLocaleDateString();
    const message = renderMessageBody(bodyTemplate, {
      brand: branding.brandName,
      name,
      paidUntil: paidUntilStr,
      package: pkgName,
      secret: String(acc.secretName || '').trim(),
      service_type: 'PPPoE',
    });

    const result = await sendArkeselSms({
      to: phone,
      message,
      senderId: branding.senderId || undefined,
    });

    if (result.ok || result.mock) {
      try {
        await ExpiryReminderSmsLog.create({
          organizationId: orgId,
          kind: 'pppoe',
          billingId: acc._id,
          periodEnd: acc.paidUntil,
          phone,
        });
        summary.pppoe.sent += 1;
      } catch (e) {
        if (e?.code === 11000) {
          summary.pppoe.skippedAlreadySent += 1;
        } else {
          summary.pppoe.failed += 1;
          console.error('[expiry-reminder-sms] pppoe log failed', e?.message || e);
        }
      }
    } else {
      summary.pppoe.failed += 1;
      if (summary.pppoe.failed <= 5) {
        console.error('[expiry-reminder-sms] pppoe send failed', acc.secretName, result.error || result.reason);
      }
    }
  }

  const remoteList = await RemoteAccessSubscription.find({
    ...orgMatch,
    disabled: false,
    phone: { $exists: true, $nin: [null, ''] },
    organizationId: { $exists: true, $ne: null },
    paidUntil: { $gt: now, $lte: windowEnd },
  })
    .populate('packageId', 'name')
    .lean();

  for (const sub of remoteList) {
    summary.remote.candidates += 1;
    const phone = normalizeGhanaMsisdn(sub.phone);
    if (!phone) {
      summary.remote.skippedNoPhone += 1;
      continue;
    }
    if (await alreadySent('remote_access', sub._id, sub.paidUntil)) {
      summary.remote.skippedAlreadySent += 1;
      continue;
    }

    const orgId = sub.organizationId;
    const bodyTemplate = await bodyForOrg(orgId);
    const branding = await resolveSmsBranding(null, orgId);
    const name = String(sub.displayName || '').trim() || 'Customer';
    const pkgName = (sub.packageId && sub.packageId.name) || 'your plan';
    const paidUntilStr = new Date(sub.paidUntil).toLocaleDateString();
    const message = renderMessageBody(bodyTemplate, {
      brand: branding.brandName,
      name,
      paidUntil: paidUntilStr,
      package: pkgName,
      secret: '',
      service_type: 'Remote access',
    });

    const result = await sendArkeselSms({
      to: phone,
      message,
      senderId: branding.senderId || undefined,
    });

    if (result.ok || result.mock) {
      try {
        await ExpiryReminderSmsLog.create({
          organizationId: orgId,
          kind: 'remote_access',
          billingId: sub._id,
          periodEnd: sub.paidUntil,
          phone,
        });
        summary.remote.sent += 1;
      } catch (e) {
        if (e?.code === 11000) {
          summary.remote.skippedAlreadySent += 1;
        } else {
          summary.remote.failed += 1;
          console.error('[expiry-reminder-sms] remote log failed', e?.message || e);
        }
      }
    } else {
      summary.remote.failed += 1;
      if (summary.remote.failed <= 5) {
        console.error('[expiry-reminder-sms] remote send failed', phone, result.error || result.reason);
      }
    }
  }

  return summary;
}
