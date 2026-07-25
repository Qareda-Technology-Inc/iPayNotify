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

/** Fallback when no org template exists for a tier. */
export const DEFAULT_EXPIRY_REMINDER_SMS_BODY =
  '{{brand}}: Hi {{name}}, your {{service_type}} plan ({{package}}) ends in {{days_left}} day(s) on {{paidUntil}}. Renew soon to avoid interruption.';

const TIER_TEMPLATE_CATEGORY = {
  7: 'expiry_reminder_7d',
  3: 'expiry_reminder_3d',
  1: 'expiry_reminder_1d',
};

function daysLeftFloat(paidUntil, now) {
  return (new Date(paidUntil).getTime() - now.getTime()) / 86400000;
}

/**
 * Pick the most urgent unsent tier for this remaining time.
 * Order over the life of a subscription: 7 → 3 → 1 as expiry approaches.
 * On catch-up (e.g. first run with 2 days left), send the tightest matching tier first.
 *
 * @param {number} daysLeft
 * @param {number[]} thresholds sorted descending e.g. [7,3,1]
 * @param {Set<number>} alreadySentTiers
 */
export function pickExpiryReminderTier(daysLeft, thresholds, alreadySentTiers) {
  if (!(daysLeft > 0)) return null;
  const applicable = thresholds.filter((t) => daysLeft <= t && !alreadySentTiers.has(t));
  if (!applicable.length) return null;
  // Most urgent = smallest threshold still applicable
  return Math.min(...applicable);
}

/**
 * @param {{ respectEnabledFlag?: boolean, organizationId?: string }} [options]
 */
export async function runExpiryReminderSmsJob(options = {}) {
  const respectEnabledFlag = options.respectEnabledFlag !== false;
  if (respectEnabledFlag && !config.expiryReminderSms.enabled) {
    return {
      skipped: true,
      reason: 'expiry_reminder_sms_disabled',
      hint: 'Set EXPIRY_REMINDER_SMS_ENABLED=false to disable; enabled by default.',
    };
  }

  const thresholds = config.expiryReminderSms.daysThresholds;
  const maxDays = Math.max(...thresholds);
  const now = new Date();
  const windowEnd = new Date(now.getTime() + maxDays * 86400000);

  const filterOrg =
    options.organizationId != null &&
    String(options.organizationId).trim() &&
    mongoose.isValidObjectId(String(options.organizationId).trim())
      ? String(options.organizationId).trim()
      : null;

  const orgMatch = filterOrg ? { organizationId: new mongoose.Types.ObjectId(filterOrg) } : {};

  const summary = {
    thresholds,
    windowDays: maxDays,
    windowEnd: windowEnd.toISOString(),
    pppoe: { candidates: 0, sent: 0, skippedNoPhone: 0, skippedAlreadySent: 0, failed: 0 },
    remote: { candidates: 0, sent: 0, skippedNoPhone: 0, skippedAlreadySent: 0, failed: 0 },
    byTier: { 7: 0, 3: 0, 1: 0 },
  };

  const templateCache = new Map();

  async function bodyForOrgTier(orgId, daysBefore) {
    const key = `${orgId}:${daysBefore}`;
    if (templateCache.has(key)) return templateCache.get(key);

    const categories = [
      TIER_TEMPLATE_CATEGORY[daysBefore],
      daysBefore !== 3 ? 'expiry_reminder_3d' : null,
      'expiry_notice',
    ].filter(Boolean);

    let body = '';
    for (const category of categories) {
      const t = await MessageTemplate.findOne({
        organizationId: orgId,
        category,
        isActive: true,
      })
        .sort({ updatedAt: -1 })
        .select('body')
        .lean();
      const raw = String(t?.body || '').trim();
      if (raw) {
        body = raw;
        break;
      }
    }
    if (!body) body = DEFAULT_EXPIRY_REMINDER_SMS_BODY;
    templateCache.set(key, body);
    return body;
  }

  async function sentTiersFor(kind, billingId, periodEnd) {
    const rows = await ExpiryReminderSmsLog.find({
      kind,
      billingId,
      periodEnd,
    })
      .select('daysBefore')
      .lean();
    return new Set(rows.map((r) => Number(r.daysBefore)).filter((n) => Number.isFinite(n)));
  }

  async function notifyOne({
    kind,
    bucket,
    orgId,
    billingId,
    periodEnd,
    phone,
    routerId,
    name,
    pkgName,
    secret,
    serviceType,
  }) {
    const daysLeft = daysLeftFloat(periodEnd, now);
    const already = await sentTiersFor(kind, billingId, periodEnd);
    const tier = pickExpiryReminderTier(daysLeft, thresholds, already);
    if (tier == null) {
      summary[bucket].skippedAlreadySent += 1;
      return;
    }

    const bodyTemplate = await bodyForOrgTier(orgId, tier);
    const branding = await resolveSmsBranding(routerId || null, orgId);
    const paidUntilStr = new Date(periodEnd).toLocaleDateString();
    const daysLeftLabel = String(Math.max(1, Math.ceil(daysLeft)));
    const message = renderMessageBody(bodyTemplate, {
      brand: branding.brandName,
      name,
      paidUntil: paidUntilStr,
      package: pkgName,
      secret: String(secret || '').trim(),
      service_type: serviceType,
      days_left: daysLeftLabel,
      days_before: String(tier),
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
          kind,
          billingId,
          periodEnd,
          daysBefore: tier,
          phone,
        });
        summary[bucket].sent += 1;
        if (summary.byTier[tier] != null) summary.byTier[tier] += 1;
      } catch (e) {
        if (e?.code === 11000) {
          summary[bucket].skippedAlreadySent += 1;
        } else {
          summary[bucket].failed += 1;
          console.error(`[expiry-reminder-sms] ${kind} log failed`, e?.message || e);
        }
      }
    } else {
      summary[bucket].failed += 1;
      if (summary[bucket].failed <= 5) {
        console.error(
          `[expiry-reminder-sms] ${kind} send failed`,
          billingId,
          result.error || result.reason
        );
      }
    }
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
    const name =
      (u && typeof u === 'object' && String(u.fullName || '').trim()) ||
      String(u?.email || '').trim() ||
      'Customer';
    await notifyOne({
      kind: 'pppoe',
      bucket: 'pppoe',
      orgId: acc.organizationId,
      billingId: acc._id,
      periodEnd: acc.paidUntil,
      phone,
      routerId: acc.routerId,
      name,
      pkgName: (acc.packageId && acc.packageId.name) || 'your plan',
      secret: acc.secretName,
      serviceType: 'PPPoE',
    });
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
    await notifyOne({
      kind: 'remote_access',
      bucket: 'remote',
      orgId: sub.organizationId,
      billingId: sub._id,
      periodEnd: sub.paidUntil,
      phone,
      routerId: null,
      name: String(sub.displayName || '').trim() || 'Customer',
      pkgName: (sub.packageId && sub.packageId.name) || 'your plan',
      secret: '',
      serviceType: 'Remote access',
    });
  }

  return summary;
}
