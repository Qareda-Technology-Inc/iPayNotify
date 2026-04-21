import crypto from 'crypto';
import { Transaction, PppoeAccount, PlanPackage, User, Router } from '../models/index.js';
import { resolveDefaultOrganizationId } from '../db/defaultOrganizationId.js';
import { normalizeGhanaMsisdn } from '../utils/phoneGhana.js';
import { config } from '../config.js';
import { syncPppoeAccountToRouter } from './pppoeService.js';
import { generateVouchers } from './hotspotService.js';
import { initiateMtnMomoRequestToPay } from '../integrations/mtnMomo.js';
import { extendPaidUntilByPackage } from '../utils/duration.js';
import { notifyTransactionPaidSms } from './paymentSmsService.js';
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

/** Pending tx + payload for in-app draft MoMo UI (test only). */
async function finalizeDraftMomoCheckout(tx, draft) {
  tx.providerReference = 'draft-momo';
  mergeTxMeta(tx, { paymentUi: 'draft_momo' });
  await tx.save();
  return {
    mode: 'draft_momo',
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

export async function findPppoeForRenewal(secretName, routerId) {
  const q = { secretName: String(secretName).trim() };
  if (routerId) q.routerId = routerId;
  return PppoeAccount.find(q).populate('packageId').populate('routerId');
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
    ? await PlanPackage.findById(account.packageId)
    : null;
  const amountCents = pkg?.priceCents ?? 0;
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
    ? await PlanPackage.findById(account.packageId)
    : null;

  const clientReference = newClientReference();
  const orgId =
    account.organizationId ||
    (pkg?._id
      ? (await PlanPackage.findById(pkg._id).select('organizationId').lean())?.organizationId
      : null) ||
    (await resolveDefaultOrganizationId());
  const tx = await Transaction.create({
    ...(orgId ? { organizationId: orgId } : {}),
    userId: account.userId,
    packageId: pkg?._id,
    pppoeAccountId: account._id,
    amountCents: quote.amountCents,
    currency: quote.currency,
    status: 'pending',
    kind: 'renewal',
    clientReference,
    provider: 'mtn_momo',
    customerPhone: customerMsisdn,
    customerName,
    meta: {
      secretName: account.secretName,
      fulfillment: 'pending',
    },
  });

  const amountGhs = quote.amountCents / 100;
  const billing = await resolveOrgBilling(orgId);

  if (config.paymentDraftMomo) {
    return finalizeDraftMomoCheckout(tx, {
      amountGhs,
      amountCents: quote.amountCents,
      currency: quote.currency,
      description: `PPPoE renewal — ${account.secretName}`,
      packageName: quote.packageName,
      merchantName: billing.merchantDisplayName,
      customerMsisdn: customerMsisdn,
      customerName,
    });
  }

  const mtn = await initiateMtnMomoRequestToPay({
    amountGhs,
    currency: quote.currency,
    clientReference,
    description: `PPPoE renewal — ${account.secretName}`,
    customerMsisdn,
    merchantName: billing.merchantDisplayName,
    publicAppBaseUrl: publicBase(),
    mtnMomo: billing.mtnMomo,
  });
  if (!mtn.ok) {
    tx.status = 'failed';
    mergeTxMeta(tx, { mtnError: mtn.error, raw: mtn.raw });
    await tx.save();
    const err = new Error(mtn.error || 'Could not start payment');
    err.status = 502;
    throw err;
  }
  tx.providerReference = mtn.mtnReferenceId;
  mergeTxMeta(tx, { mtnReferenceId: mtn.mtnReferenceId, requestToPay: mtn.raw });
  await tx.save();
  return {
    clientReference,
    checkoutUrl: mtn.checkoutUrl,
    amountCents: quote.amountCents,
    currency: quote.currency,
    packageName: quote.packageName,
  };
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
    provider: 'mtn_momo',
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

  if (config.paymentDraftMomo) {
    return finalizeDraftMomoCheckout(tx, {
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

  const mtn = await initiateMtnMomoRequestToPay({
    amountGhs,
    currency: tx.currency,
    clientReference,
    description: `Hotspot — ${pkg.name}`,
    customerMsisdn,
    merchantName: billing.merchantDisplayName,
    publicAppBaseUrl: publicBase(),
    mtnMomo: billing.mtnMomo,
  });
  if (!mtn.ok) {
    tx.status = 'failed';
    mergeTxMeta(tx, { mtnError: mtn.error, raw: mtn.raw });
    await tx.save();
    const err = new Error(mtn.error || 'Could not start payment');
    err.status = 502;
    throw err;
  }
  tx.providerReference = mtn.mtnReferenceId;
  mergeTxMeta(tx, { mtnReferenceId: mtn.mtnReferenceId, requestToPay: mtn.raw });
  await tx.save();
  return {
    clientReference,
    checkoutUrl: mtn.checkoutUrl,
    amountCents,
    currency: tx.currency,
    packageName: pkg.name,
  };
}

export async function getTransactionByReference(clientReference) {
  return Transaction.findOne({ clientReference }).lean();
}

export async function fulfillPaidTransaction(txDoc) {
  const tx =
    txDoc instanceof Transaction ? txDoc : await Transaction.findById(txDoc._id || txDoc);
  if (!tx || tx.status !== 'paid') return { ok: false, reason: 'not_paid' };
  if (tx.meta?.fulfillment === 'done') return { ok: true, already: true };

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
    await notifyTransactionPaidSms(tx, {
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
    await notifyTransactionPaidSms(tx, {
      kind: 'voucher',
      code: v.code,
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
    providerData.ProviderRef ||
    providerData.providerRef ||
    tx.providerReference ||
    providerData.TransactionId ||
    '';
  mergeTxMeta(tx, { callback: providerData });
  await tx.save();
  const result = await fulfillPaidTransaction(tx);
  return { ok: true, ...result };
}
