import mongoose from 'mongoose';
import { MessageTemplate, MessageBroadcastLog, Router } from '../models/index.js';
import { config } from '../config.js';
import { sendArkeselSms } from '../integrations/arkesel.js';
import {
  audienceAny,
  collectMessageRecipients,
  collectRecipientsFromPhones,
  collectRecipientsFromUserIds,
  getUserIdsLinkedToRouter,
  intersectRecipientsByAudiencePhones,
  normalizeAudienceFlags,
} from './messageRecipientService.js';
import { renderMessageBody } from './messageTemplateService.js';
import { resolveSmsBranding } from './smsRouterBranding.js';
const MAX_ERROR_ROWS = 40;

/** Allow send-time placeholders (e.g. {{date}}, {{time_window}}). brand/name are always set by the server. */
export function sanitizeBroadcastTemplateVars(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const RESERVED = new Set(['brand', 'name']);
  const out = {};
  let n = 0;
  for (const [k0, v0] of Object.entries(raw)) {
    if (n >= 16) break;
    const k = String(k0 || '').trim().toLowerCase();
    if (!/^[a-z][a-z0-9_]{0,39}$/.test(k) || RESERVED.has(k)) continue;
    const s = v0 == null ? '' : String(v0).trim().slice(0, 240);
    if (s) {
      out[k] = s;
      n++;
    }
  }
  return out;
}

/**
 * @param {{
 *   templateId?: string,
 *   body?: string,
 *   audiences?: { pppoe?: boolean, remote?: boolean, hotspot?: boolean },
 *   userIds?: string[],
 *   phones?: string[] | string,
 *   intersectAudiences?: boolean,
 *   dryRun?: boolean,
 *   routerId?: string,
 *   organizationId: string,
 *   templateVars?: Record<string, string>,
 * }} opts
 */
export async function runMessageBroadcast(opts) {
  const {
    templateId,
    body: rawBody,
    audiences: audiencesRaw,
    dryRun = false,
    intersectAudiences: intersectRaw,
    userIds: userIdsRaw,
    phones: phonesRaw,
    routerId: routerIdOpt,
    organizationId: organizationIdOpt,
    templateVars: templateVarsRaw,
  } = opts;

  const extraVars = sanitizeBroadcastTemplateVars(templateVarsRaw);

  const tenantOrg =
    organizationIdOpt != null &&
    String(organizationIdOpt).trim() &&
    mongoose.isValidObjectId(String(organizationIdOpt).trim())
      ? String(organizationIdOpt).trim()
      : '';
  if (!tenantOrg) {
    const e = new Error('Missing organization context');
    e.status = 500;
    throw e;
  }

  const intersectAudiences =
    intersectRaw === true ||
    intersectRaw === 'true' ||
    intersectRaw === 1 ||
    intersectRaw === '1';

  const userIds = Array.isArray(userIdsRaw)
    ? userIdsRaw.map(String).filter((id) => mongoose.isValidObjectId(id))
    : [];

  let template = null;
  let bodyTemplate = rawBody != null ? String(rawBody).trim() : '';

  if (templateId) {
    template = await MessageTemplate.findOne({
      _id: templateId,
      organizationId: tenantOrg,
    });
    if (!template) {
      const e = new Error('Template not found');
      e.status = 404;
      throw e;
    }
    if (!template.isActive) {
      const e = new Error('Template is inactive');
      e.status = 400;
      throw e;
    }
    bodyTemplate = template.body;
  }

  if (!bodyTemplate) {
    const e = new Error('Provide templateId or body text');
    e.status = 400;
    throw e;
  }

  const audiences = normalizeAudienceFlags(audiencesRaw);
  const routerIdRaw =
    routerIdOpt != null && String(routerIdOpt).trim() ? String(routerIdOpt).trim() : '';
  if (routerIdRaw && !mongoose.isValidObjectId(routerIdRaw)) {
    const e = new Error('Invalid site/router id');
    e.status = 400;
    throw e;
  }
  const routerIdValid = Boolean(routerIdRaw);
  if (routerIdValid) {
    const rOk = await Router.findOne({
      _id: routerIdRaw,
      organizationId: tenantOrg,
    })
      .select('_id')
      .lean();
    if (!rOk) {
      const e = new Error('Router not found');
      e.status = 404;
      throw e;
    }
  }
  const collectOpts = {
    organizationId: tenantOrg,
    ...(routerIdValid ? { routerId: routerIdRaw } : {}),
  };
  const branding = await resolveSmsBranding(
    routerIdValid ? routerIdRaw : null,
    tenantOrg && mongoose.isValidObjectId(String(tenantOrg)) ? String(tenantOrg) : null
  );

  const manualList = await collectRecipientsFromPhones(phonesRaw);
  const phonesAttempt =
    (typeof phonesRaw === 'string' && phonesRaw.trim().length > 0) ||
    (Array.isArray(phonesRaw) && phonesRaw.length > 0);

  if (routerIdValid && phonesAttempt) {
    const e = new Error(
      'Manual phone lists cannot be combined with a site/router filter. Clear the site or use segments or specific customers.'
    );
    e.status = 400;
    throw e;
  }

  const usesSegmentBucket =
    userIds.length === 0 && !phonesAttempt
      ? true
      : userIds.length > 0 && intersectAudiences;
  if (
    routerIdValid &&
    usesSegmentBucket &&
    audiences.remote &&
    !audiences.pppoe &&
    !audiences.hotspot
  ) {
    const e = new Error(
      'Remote access subscribers are not scoped to a site router. Check PPPoE or hotspot, clear the site filter, or choose all sites.'
    );
    e.status = 400;
    throw e;
  }

  let recipients = [];
  let recipientMode = 'audiences';

  if (userIds.length > 0) {
    recipientMode = intersectAudiences ? 'user_ids_filtered' : 'user_ids';
    recipients = await collectRecipientsFromUserIds(userIds, { organizationId: tenantOrg });
    if (intersectAudiences) {
      if (!audienceAny(audiences)) {
        const e = new Error(
          'When filtering selected customers by audience, check at least one segment (PPPoE, remote, or hotspot).'
        );
        e.status = 400;
        throw e;
      }
      const bucket = await collectMessageRecipients(audiences, collectOpts);
      recipients = intersectRecipientsByAudiencePhones(recipients, bucket);
    } else if (routerIdValid) {
      const linked = await getUserIdsLinkedToRouter(routerIdRaw, tenantOrg);
      recipients = recipients.filter((r) => r.userId && linked.has(String(r.userId)));
    }
  } else if (phonesAttempt) {
    recipientMode = 'manual_phones';
    recipients = manualList;
    if (recipients.length === 0 && !dryRun) {
      const e = new Error('No valid phone numbers — use Ghana 0XX…, 233…, or one number per line.');
      e.status = 400;
      throw e;
    }
  } else {
    if (!audienceAny(audiences)) {
      const e = new Error(
        'Select at least one audience, or choose specific customers, or enter phone numbers.'
      );
      e.status = 400;
      throw e;
    }
    recipients = await collectMessageRecipients(audiences, collectOpts);
  }

  const skippedNoPhone = 0;

  if (recipients.length === 0 && !dryRun) {
    const e = new Error('No recipients match your selection (check phones and filters).');
    e.status = 400;
    throw e;
  }

  const bodyPreviewMerged =
    recipients.length > 0
      ? renderMessageBody(bodyTemplate, {
          ...extraVars,
          brand: branding.brandName,
          name: recipients[0].name || '',
        }).slice(0, 500)
      : renderMessageBody(bodyTemplate, {
          ...extraVars,
          brand: branding.brandName,
          name: '',
        }).slice(0, 500);

  const logPayload = {
    templateId: template?._id,
    templateName: template?.name,
    category: template?.category,
    bodyPreview: bodyPreviewMerged,
    ...(Object.keys(extraVars).length ? { templateVars: extraVars } : {}),
    recipientMode,
    intersectAudiences: intersectAudiences && userIds.length > 0,
    audiences: {
      pppoe: audiences.pppoe,
      remote: audiences.remote,
      hotspot: audiences.hotspot,
    },
    dryRun,
    recipientCount: recipients.length,
    sent: 0,
    failed: 0,
    skippedNoPhone,
    failures: [],
    organizationId: new mongoose.Types.ObjectId(tenantOrg),
    ...(routerIdValid
      ? {
          routerId: new mongoose.Types.ObjectId(routerIdRaw),
          smsBrandUsed: branding.brandName,
          smsSenderUsed: branding.senderId,
        }
      : {}),
  };

  if (dryRun) {
    const samples = recipients.slice(0, 5).map((r) => ({
      phone: r.phone,
      message: renderMessageBody(bodyTemplate, {
        ...extraVars,
        brand: branding.brandName,
        name: r.name,
      }).slice(0, 200),
    }));
    const doc = await MessageBroadcastLog.create(logPayload);
    return {
      dryRun: true,
      recipientCount: recipients.length,
      samples,
      logId: doc._id,
      routerId: routerIdValid ? routerIdRaw : undefined,
      smsBrandUsed: routerIdValid ? branding.brandName : undefined,
    };
  }

  let sent = 0;
  let failed = 0;
  const failures = [];
  const conc = config.arkesel.sendConcurrency || 5;

  for (let i = 0; i < recipients.length; i += conc) {
    const slice = recipients.slice(i, i + conc);
    const batch = await Promise.all(
      slice.map(async (r) => {
        const text = renderMessageBody(bodyTemplate, {
          ...extraVars,
          brand: branding.brandName,
          name: r.name,
        });
        const result = await sendArkeselSms({
          to: r.phone,
          message: text,
          senderId: branding.senderId || undefined,
        });
        return { r, result };
      })
    );
    for (const { r, result } of batch) {
      if (result.ok) {
        sent++;
      } else {
        failed++;
        if (failures.length < MAX_ERROR_ROWS) {
          failures.push({
            phone: r.phone,
            error: result.error || result.reason || 'send_failed',
          });
        }
      }
    }
  }

  logPayload.sent = sent;
  logPayload.failed = failed;
  logPayload.failures = failures;

  const doc = await MessageBroadcastLog.create(logPayload);

  return {
    dryRun: false,
    recipientCount: recipients.length,
    sent,
    failed,
    errors: failures,
    logId: doc._id,
    routerId: routerIdValid ? routerIdRaw : undefined,
    smsBrandUsed: routerIdValid ? branding.brandName : undefined,
  };
}

export async function listMessageBroadcastLogs(limit = 30, organizationId) {
  const q =
    organizationId != null &&
    String(organizationId).trim() &&
    mongoose.isValidObjectId(String(organizationId).trim())
      ? { organizationId: String(organizationId).trim() }
      : {};
  return MessageBroadcastLog.find(q)
    .sort({ createdAt: -1 })
    .limit(Math.min(100, Math.max(1, limit)))
    .lean();
}
