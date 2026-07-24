import crypto from 'crypto';
import { Transaction, PppoeAccount, PlanPackage, User, Router } from '../models/index.js';
import { resolveDefaultOrganizationId } from '../db/defaultOrganizationId.js';
import { normalizeGhanaMsisdn } from '../utils/phoneGhana.js';
import { config } from '../config.js';
import { syncPppoeAccountToRouter } from './pppoeService.js';
import { generateVouchers } from './hotspotService.js';
import { buildHubtelCheckoutSession } from '../integrations/hubtel.js';
import { extendPaidUntilByPackage } from '../utils/duration.js';
import { notifyTransactionPaidSms } from './paymentSmsService.js';
import { notifyTransactionPaidAdminEmail } from './paymentAdminNotifyService.js';
import { resolveOrgBilling } from './orgBillingService.js';

function newClientReference() {
  return `QF-${crypto.randomBytes(12).toString('hex')}`;
}

function publicBase() {
  return config.publicAppUrl.replace(/\/$/, '');
}

function mergeTxMeta(tx, patch) {
  const prev = tx.meta && typeof tx.meta === 'object' ? { ...tx.meta } : {};
  tx.meta = { ...prev, ...patch };
}

/** Pending tx + payload for in-app draft checkout UI (test only). */
async function finalizeDraftCheckout(tx, draft) {
  tx.providerReference = 'draft-hubtel';
  mergeTxMeta(tx, { paymentUi: 'draft_hubtel' });
  await tx.save();
  return {
    mode: 'draft_hubtel',
    clientReference: tx.clientReference,
    amountGhs: draft.amountGhs,
    amountCents: draft.amountCents,
    currency: draft.currency,
    description: draft.description,
    packageName: draft.packageName,
    merchantName: draft.merchantName,
    customerMsisdn: draft.customerMsisdn,
    customerName: draft.customerName || '',
  };
}

function checkoutResponseFromHubtel(tx, session, extras = {}) {
  if (session.mock && session.checkoutUrl) {
    return {
      clientReference: tx.clientReference,
      checkoutUrl: session.checkoutUrl,
      ...extras,
    };
  }
  return {
    mode: 'hubtel_checkout',
    clientReference: tx.clientReference,
    purchaseInfo: session.purchaseInfo,
    hubtelConfig: session.config,
    ...extras,
  };
}

export async function findPppoeForRenewal(secretName, routerId) {
  const q = { secretName: String(secretName).trim() };
  if (routerId) q.routerId = routerId;
  return PppoeAccount.find(q)
    .populate('packageId')
    .populate('routerId')
    .populate('userId', 'fullName phone');
}

export async function quotePppoeRenewal(secretName, routerId) {
  const matches = await findPppoeForRenewal(secretName, routerId);
  if (matches.length === 0) {
    const err = new Error('No PPPoE account found for that username');
    err.status = 404;
    throw err;
  }
  if (matches.length > 1 && !routerId) {
    return {
      needRouterSelection: true,
      routers: matches.map((a) => ({
        id: String(a.routerId?._id || a.routerId),
        name: a.routerId?.name,
        host: a.routerId?.host,
      })),
    };
  }
  const account = matches[0];
  const pkg = account.packageId
    ? account.packageId.priceCents != null
      ? account.packageId
      : await PlanPackage.findById(account.packageId)
    : null;
  const amountCents = pkg?.priceCents ?? 0;
  const linkedUser =
    account.userId && typeof account.userId === 'object' ? account.userId : null;
  const customerName = String(linkedUser?.fullName || '').trim();
  const customerPhone =
    normalizeGhanaMsisdn(linkedUser?.phone) || String(linkedUser?.phone || '').trim() || '';
  return {
    needRouterSelection: false,
    secretName: account.secretName,
    packageName: pkg?.name || 'Custom',
    amountCents,
    currency: pkg?.currency || 'GHS',
    routerId: String(account.routerId?._id || account.routerId),
    routerName: account.routerId?.name,
    paidUntil: account.paidUntil,
    needsPrice: amountCents <= 0,
    customerName: customerName || null,
    customerPhone: customerPhone || null,
    hasLinkedCustomer: Boolean(linkedUser),
  };
}

export async function createPppoeRenewalCheckout({
  secretName,
  routerId,
  customerMsisdn,
  customerName,
}) {
  const quote = await quotePppoeRenewal(secretName, routerId);
  if (quote.needRouterSelection) {
    const err = new Error('This username exists on more than one router — choose your router');
    err.status = 400;
    err.routers = quote.routers;
    throw err;
  }
  if (quote.needsPrice) {
    const err = new Error(
      'This account has no package price — assign a PPPoE package with price in admin'
    );
    err.status = 400;
    throw err;
  }

  const matches = await findPppoeForRenewal(secretName, routerId);
  const account = matches[0];
  const pkg = account.packageId
    ? account.packageId.priceCents != null
      ? account.packageId
      : await PlanPackage.findById(account.packageId)
    : null;

  const linkedUser =
    account.userId && typeof account.userId === 'object' ? account.userId : null;
  const resolvedPhone =
    normalizeGhanaMsisdn(customerMsisdn) ||
    normalizeGhanaMsisdn(quote.customerPhone) ||
    normalizeGhanaMsisdn(linkedUser?.phone) ||
    '';
  const resolvedName =
    String(customerName || '').trim() ||
    String(quote.customerName || '').trim() ||
    String(linkedUser?.fullName || '').trim() ||
    '';

  const clientReference = newClientReference();
  const orgId =
    account.organizationId ||
    (pkg?._id
      ? (await PlanPackage.findById(pkg._id).select('organizationId').lean())?.organizationId
      : null) ||
    (await resolveDefaultOrganizationId());
  const tx = await Transaction.create({
    ...(orgId ? { organizationId: orgId } : {}),
    userId: account.userId?._id || account.userId,
    packageId: pkg?._id,
    pppoeAccountId: account._id,
    amountCents: quote.amountCents,
    currency: quote.currency,
    status: 'pending',
    kind: 'renewal',
    clientReference,
    provider: 'hubtel',
    customerPhone: resolvedPhone,
    customerName: resolvedName || undefined,
    meta: {
      secretName: account.secretName,
      fulfillment: 'pending',
    },
  });

  const amountGhs = quote.amountCents / 100;
  const billing = await resolveOrgBilling(orgId);

  if (config.paymentDraftCheckout) {
    return finalizeDraftCheckout(tx, {
      amountGhs,
      amountCents: quote.amountCents,
      currency: quote.currency,
      description: `PPPoE renewal — ${account.secretName}`,
      packageName: quote.packageName,
      merchantName: billing.merchantDisplayName,
      customerMsisdn: resolvedPhone,
      customerName: resolvedName,
    });
  }

  const session = buildHubtelCheckoutSession({
    amountGhs,
    description: `${billing.merchantDisplayName}: PPPoE renewal — ${account.secretName}`,
    customerMsisdn: resolvedPhone,
    clientReference,
    hubtel: billing.hubtel,
    publicAppBaseUrl: publicBase(),
  });
  if (!session.ok) {
    tx.status = 'failed';
    mergeTxMeta(tx, { hubtelError: session.error });
    await tx.save();
    const err = new Error(session.error || 'Could not start payment');
    err.status = 502;
    throw err;
  }
  mergeTxMeta(tx, { hubtelCheckout: true });
  await tx.save();
  return checkoutResponseFromHubtel(tx, session, {
    amountCents: quote.amountCents,
    currency: quote.currency,
    packageName: quote.packageName,
  });
}

export async function createHotspotPurchaseCheckout({
  packageId,
  routerId,
  customerMsisdn,
  customerName,
}) {
  const pkg = await PlanPackage.findById(packageId);
  if (!pkg || pkg.kind !== 'hotspot') {
    const err = new Error('Invalid hotspot package');
    err.status = 400;
    throw err;
  }
  const amountCents = pkg.priceCents ?? 0;
  if (amountCents <= 0) {
    const err = new Error('Package has no price set');
    err.status = 400;
    throw err;
  }

  const clientReference = newClientReference();
  const routerDoc = await Router.findById(routerId).select('organizationId').lean();
  const orgId =
    routerDoc?.organizationId ||
    pkg.organizationId ||
    (await resolveDefaultOrganizationId());
  const tx = await Transaction.create({
    ...(orgId ? { organizationId: orgId } : {}),
    packageId: pkg._id,
    amountCents,
    currency: pkg.currency || 'GHS',
    status: 'pending',
    kind: 'voucher',
    clientReference,
    provider: 'hubtel',
    customerPhone: customerMsisdn,
    customerName,
    meta: {
      routerId: String(routerId),
      fulfillment: 'pending',
    },
  });

  const norm = normalizeGhanaMsisdn(customerMsisdn);
  const phoneOr = [{ phone: customerMsisdn }];
  if (norm) {
    phoneOr.push({ phone: norm });
    if (norm.startsWith('233') && norm.length >= 12) {
      phoneOr.push({ phone: `0${norm.slice(3)}` });
    }
  }
  const linkedUser = await User.findOne({ $or: phoneOr }).select('_id').lean();
  if (linkedUser) {
    tx.userId = linkedUser._id;
    await tx.save();
  }

  const amountGhs = amountCents / 100;
  const billing = await resolveOrgBilling(orgId);

  if (config.paymentDraftCheckout) {
    return finalizeDraftCheckout(tx, {
      amountGhs,
      amountCents,
      currency: tx.currency,
      description: `Hotspot — ${pkg.name}`,
      packageName: pkg.name,
      merchantName: billing.merchantDisplayName,
      customerMsisdn: customerMsisdn,
      customerName,
    });
  }

  const session = buildHubtelCheckoutSession({
    amountGhs,
    description: `${billing.merchantDisplayName}: Hotspot — ${pkg.name}`,
    customerMsisdn,
    clientReference,
    hubtel: billing.hubtel,
    publicAppBaseUrl: publicBase(),
  });
  if (!session.ok) {
    tx.status = 'failed';
    mergeTxMeta(tx, { hubtelError: session.error });
    await tx.save();
    const err = new Error(session.error || 'Could not start payment');
    err.status = 502;
    throw err;
  }
  mergeTxMeta(tx, { hubtelCheckout: true });
  await tx.save();
  return checkoutResponseFromHubtel(tx, session, {
    amountCents,
    currency: tx.currency,
    packageName: pkg.name,
  });
}

export async function getTransactionByReference(clientReference) {
  return Transaction.findOne({ clientReference }).lean();
}

async function notifyPaidChannels(tx, context) {
  try {
    await notifyTransactionPaidSms(tx, context);
  } catch (e) {
    mergeTxMeta(tx, {
      smsNotification: {
        status: 'failed',
        at: new Date().toISOString(),
        error: e?.message || 'sms_threw',
      },
    });
  }
  try {
    await notifyTransactionPaidAdminEmail(tx, context);
  } catch (e) {
    mergeTxMeta(tx, {
      adminEmailNotification: {
        status: 'failed',
        at: new Date().toISOString(),
        error: e?.message || 'email_threw',
      },
    });
  }
}

function needsPaidNotifications(tx) {
  const sms = tx.meta?.smsNotification?.status;
  const email = tx.meta?.adminEmailNotification?.status;
  return sms !== 'sent' || email !== 'sent';
}

export async function fulfillPaidTransaction(txDoc) {
  const tx =
    txDoc instanceof Transaction ? txDoc : await Transaction.findById(txDoc._id || txDoc);
  if (!tx || tx.status !== 'paid') return { ok: false, reason: 'not_paid' };

  /** Already fulfilled: still retry SMS / admin email if they never succeeded. */
  if (tx.meta?.fulfillment === 'done') {
    if (needsPaidNotifications(tx)) {
      const notifyCtx = {
        kind: tx.kind,
        packageName: undefined,
        secretName: tx.meta?.secretName,
        paidUntil: tx.meta?.renewedUntil,
        voucherCode: tx.meta?.voucherCode,
        code: tx.meta?.voucherCode,
        validUntil: undefined,
        routerId: tx.meta?.routerId,
        customerName: tx.customerName,
      };
      if (tx.kind === 'renewal' && tx.pppoeAccountId) {
        const acc = await PppoeAccount.findById(tx.pppoeAccountId).lean();
        const pkg = tx.packageId ? await PlanPackage.findById(tx.packageId).lean() : null;
        notifyCtx.paidUntil = acc?.paidUntil || notifyCtx.paidUntil;
        notifyCtx.secretName = acc?.secretName || notifyCtx.secretName;
        notifyCtx.routerId = acc?.routerId || notifyCtx.routerId;
        notifyCtx.packageDoc = pkg;
        notifyCtx.packageName = pkg?.name;
        notifyCtx.renewalType = 'pppoe';
      } else if (tx.kind === 'voucher') {
        const pkg = tx.packageId ? await PlanPackage.findById(tx.packageId).lean() : null;
        notifyCtx.packageName = pkg?.name;
        notifyCtx.code = notifyCtx.voucherCode;
      }
      await notifyPaidChannels(tx, notifyCtx);
      await tx.save();
    }
    return { ok: true, already: true };
  }

  if (tx.kind === 'renewal' && tx.pppoeAccountId) {
    const acc = await PppoeAccount.findById(tx.pppoeAccountId);
    if (!acc) {
      mergeTxMeta(tx, { fulfillment: 'failed', reason: 'account_missing' });
      await tx.save();
      return { ok: false, reason: 'account_missing' };
    }
    const pkg = tx.packageId
      ? await PlanPackage.findById(tx.packageId)
      : acc.packageId
        ? await PlanPackage.findById(acc.packageId)
        : null;
    const now = new Date();
    const base = acc.paidUntil > now ? acc.paidUntil : now;
    acc.paidUntil = extendPaidUntilByPackage(base, pkg);
    acc.disabled = false;
    await acc.save();
    await syncPppoeAccountToRouter(acc);
    mergeTxMeta(tx, { fulfillment: 'done', renewedUntil: acc.paidUntil });
    let customerNameForSms = tx.customerName;
    if (!String(customerNameForSms || '').trim() && tx.userId) {
      const u = await User.findById(tx.userId).select('fullName').lean();
      customerNameForSms = u?.fullName;
    }
    await notifyPaidChannels(tx, {
      kind: 'renewal',
      renewalType: 'pppoe',
      paidUntil: acc.paidUntil,
      secretName: acc.secretName,
      routerId: acc.routerId,
      packageDoc: pkg && typeof pkg.toObject === 'function' ? pkg.toObject() : pkg,
      packageName: pkg?.name,
      customerName: customerNameForSms,
    });
    await tx.save();
    return { ok: true, kind: 'renewal', paidUntil: acc.paidUntil };
  }

  if (tx.kind === 'voucher' && tx.packageId && tx.meta?.routerId) {
    const vouchers = await generateVouchers({
      count: 1,
      packageId: tx.packageId,
      routerId: tx.meta.routerId,
      pushToRouter: true,
    });
    const v = vouchers[0];
    tx.hotspotVoucherId = v._id;
    const pkg = await PlanPackage.findById(tx.packageId);
    mergeTxMeta(tx, { fulfillment: 'done', voucherCode: v.code });
    await notifyPaidChannels(tx, {
      kind: 'voucher',
      code: v.code,
      voucherCode: v.code,
      validUntil: v.validUntil,
      packageName: pkg?.name,
    });
    await tx.save();
    return { ok: true, kind: 'voucher', code: v.code };
  }

  mergeTxMeta(tx, { fulfillment: 'skipped', reason: 'unknown_kind' });
  await tx.save();
  return { ok: false, reason: 'unknown_kind' };
}

export async function markTransactionFailedByReference(clientReference, providerData = {}) {
  const tx = await Transaction.findOne({ clientReference });
  if (!tx) return { ok: false, reason: 'not_found' };
  if (tx.status !== 'pending') {
    return { ok: false, reason: 'not_pending', status: tx.status };
  }
  tx.status = 'failed';
  mergeTxMeta(tx, { callback: providerData, paymentFailed: true });
  await tx.save();
  return { ok: true };
}

export async function markTransactionPaidByReference(clientReference, providerData = {}) {
  const tx = await Transaction.findOne({ clientReference });
  if (!tx) return { ok: false, reason: 'not_found' };
  if (tx.status === 'paid') {
    await fulfillPaidTransaction(tx);
    return { ok: true, duplicate: true };
  }
  tx.status = 'paid';
  tx.providerReference =
    providerData.financialTransactionId ||
    providerData.FinancialTransactionId ||
    providerData.TransactionId ||
    providerData.transactionId ||
    providerData.ProviderRef ||
    providerData.providerRef ||
    tx.providerReference ||
    '';
  mergeTxMeta(tx, { callback: providerData });
  await tx.save();
  const result = await fulfillPaidTransaction(tx);
  return { ok: true, ...result };
}
