import mongoose from 'mongoose';
import { sendArkeselSms } from '../integrations/arkesel.js';
import { PppoeAccount, PlanPackage, User } from '../models/index.js';
import { defaultRenewalSmsBodyForKind } from '../utils/defaultRenewalSms.js';
import { renderMessageBody } from './messageTemplateService.js';
import { resolveSmsBranding } from './smsRouterBranding.js';

function patchTxMeta(tx, patch) {
  const prev = tx.meta && typeof tx.meta === 'object' ? { ...tx.meta } : {};
  tx.meta = { ...prev, ...patch };
}

async function routerIdForPaymentSms(tx, context) {
  if (context.routerId != null && String(context.routerId).trim()) {
    return String(context.routerId).trim();
  }
  if (tx.kind === 'voucher' && tx.meta?.routerId) {
    return String(tx.meta.routerId).trim();
  }
  if (tx.kind === 'renewal' && tx.pppoeAccountId) {
    const acc = await PppoeAccount.findById(tx.pppoeAccountId).select('routerId').lean();
    if (acc?.routerId) return String(acc.routerId);
  }
  return null;
}

/**
 * After a payment is fulfilled, SMS voucher or renewal details to customerPhone.
 * Idempotent per transaction using meta.smsNotification.status === 'sent'.
 * Uses per-router SMS brand / sender when the transaction is tied to a router.
 */
export async function notifyTransactionPaidSms(tx, context) {
  if (!tx.customerPhone) {
    patchTxMeta(tx, {
      smsNotification: { status: 'skipped', reason: 'no_phone' },
    });
    return { skipped: true, reason: 'no_phone' };
  }

  if (tx.meta?.smsNotification?.status === 'sent') {
    return { skipped: true, reason: 'already_sent' };
  }

  const rid = await routerIdForPaymentSms(tx, context);
  const orgId =
    tx.organizationId != null && mongoose.isValidObjectId(String(tx.organizationId))
      ? String(tx.organizationId)
      : null;
  const branding = await resolveSmsBranding(
    rid && mongoose.isValidObjectId(rid) ? rid : null,
    orgId
  );

  let message = '';
  if (context.kind === 'voucher') {
    const vd = context.validUntil
      ? new Date(context.validUntil).toLocaleDateString()
      : 'per package';
    const pkg = context.packageName || 'Hotspot bundle';
    message = `${branding.brandName}: Payment received. Code: ${context.code}. ${pkg}. Valid: ${vd}. Use as hotspot username & password.`;
  } else if (context.kind === 'renewal') {
    let pkgLean = context.packageDoc;
    if (!pkgLean && tx.packageId) {
      pkgLean = await PlanPackage.findById(tx.packageId).lean();
    }
    const renewalType =
      context.renewalType ||
      (pkgLean?.kind === 'remote_access' ? 'remote_access' : 'pppoe');
    const kindForDefault = pkgLean?.kind || renewalType || 'pppoe';
    const templateRaw = String(pkgLean?.renewalSmsBody || '').trim();
    const bodyTemplate =
      templateRaw || defaultRenewalSmsBodyForKind(kindForDefault);

    let displayName = String(tx.customerName || context.customerName || '').trim();
    if (!displayName && tx.userId) {
      const u = await User.findById(tx.userId).select('fullName').lean();
      displayName = String(u?.fullName || '').trim();
    }
    if (!displayName) displayName = 'customer';

    const paidUntilStr = new Date(context.paidUntil).toLocaleDateString();
    const pkgName =
      pkgLean?.name || context.packageName || 'your plan';
    const secretLine = String(
      context.secretName ?? context.secret ?? ''
    ).trim();
    const phoneLine = String(
      context.remoteAccessPhone ?? tx.customerPhone ?? ''
    ).trim();

    message = renderMessageBody(bodyTemplate, {
      brand: branding.brandName,
      name: displayName,
      package: pkgName,
      paidUntil: paidUntilStr,
      secret: secretLine,
      phone: phoneLine,
    });
  } else {
    patchTxMeta(tx, {
      smsNotification: { status: 'skipped', reason: 'unknown_context' },
    });
    return { skipped: true, reason: 'unknown_context' };
  }

  const result = await sendArkeselSms({
    to: tx.customerPhone,
    message,
    senderId: branding.senderId || undefined,
  });

  if (result.skipped) {
    patchTxMeta(tx, {
      smsNotification: {
        status: 'skipped',
        reason: result.reason || 'provider_not_configured',
      },
    });
    return { skipped: true, ...result };
  }

  patchTxMeta(tx, {
    smsNotification: {
      status: result.ok ? 'sent' : 'failed',
      at: new Date().toISOString(),
      error: result.ok ? null : result.error || 'unknown',
      mock: Boolean(result.mock),
    },
  });

  return result;
}
