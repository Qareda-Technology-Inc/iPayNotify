import crypto from 'crypto';
import mongoose from 'mongoose';
import { Transaction, PppoeAccount, PlanPackage, User, Router } from '../models/index.js';
import { resolveDefaultOrganizationId } from '../db/defaultOrganizationId.js';
import { normalizeGhanaMsisdn } from '../utils/phoneGhana.js';
import { normalizeRenewCode } from '../utils/renewCode.js';
import { config } from '../config.js';
import { syncPppoeAccountToRouter } from './pppoeService.js';
import { generateVouchers } from './hotspotService.js';
import {
  buildHubtelCheckoutSession,
  fetchHubtelTransactionStatus,
  hubtelPaymentSucceeded,
  hubtelProviderReference,
  resolveHubtelCallbackUrl,
} from '../integrations/hubtel.js';
import { extendPaidUntilByPackage } from '../utils/duration.js';
import { notifyTransactionPaidSms } from './paymentSmsService.js';
import { notifyTransactionPaidAdminEmail } from './paymentAdminNotifyService.js';
import { resolveOrgBilling } from './orgBillingService.js';
import { settlePaidTransactionToWallet } from './orgWalletService.js';

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
  const prev = tx.meta && typeof tx.meta === 'object' ? { ...tx.meta } : {};
  tx.providerReference = 'draft-hubtel';
  tx.meta = { ...prev, paymentUi: 'draft_hubtel' };
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

function populateRenewAccount(q) {
  return q.populate('packageId').populate('routerId').populate('userId', 'fullName phone');
}

function phoneLookupVariants(raw) {
  const msisdn = normalizeGhanaMsisdn(raw);
  if (!msisdn) return [];
  const local10 = `0${msisdn.slice(3)}`;
  const nine = msisdn.slice(3);
  const digits = String(raw).replace(/\D/g, '');
  return [...new Set([msisdn, local10, nine, digits].filter(Boolean))];
}

/**
 * Resolve one PPPoE line for public renew.
 * Priority: renewCode (global) → phone (exactly one line) → secretName+routerId (site-bound).
 */
export async function findPppoeForRenewal({ renewCode, phone, secretName, routerId } = {}) {
  const code = normalizeRenewCode(renewCode);
  if (code) {
    const account = await populateRenewAccount(PppoeAccount.findOne({ renewCode: code }));
    return account ? [account] : [];
  }

  const phoneVariants = phoneLookupVariants(phone);
  if (phoneVariants.length) {
    const users = await User.find({ phone: { $in: phoneVariants } })
      .select('_id')
      .lean();
    if (!users.length) return [];
    const userIds = users.map((u) => u._id);
    return populateRenewAccount(PppoeAccount.find({ userId: { $in: userIds }, disabled: false }));
  }

  const secret = String(secretName || '').trim();
  const rid = routerId != null ? String(routerId).trim() : '';
  if (!secret) return [];
  /** Multi-tenant: never search usernames across all orgs without a venue. */
  if (!rid || !mongoose.isValidObjectId(rid)) return [];
  return populateRenewAccount(PppoeAccount.find({ secretName: secret, routerId: rid }));
}

function quoteFromAccount(account, pkg) {
  const amountCents = pkg?.priceCents ?? 0;
  const linkedUser =
    account.userId && typeof account.userId === 'object' ? account.userId : null;
  const customerName = String(linkedUser?.fullName || '').trim();
  const customerPhone =
    normalizeGhanaMsisdn(linkedUser?.phone) || String(linkedUser?.phone || '').trim() || '';
  return {
    needRouterSelection: false,
    renewCode: account.renewCode || null,
    secretName: account.secretName,
    packageName: pkg?.name || 'Custom',
    amountCents,
    currency: pkg?.currency || 'GHS',
    routerId: String(account.routerId?._id || account.routerId),
    routerName: account.routerId?.name || account.routerId?.comment || null,
    paidUntil: account.paidUntil,
    needsPrice: amountCents <= 0,
    customerName: customerName || null,
    customerPhone: customerPhone || null,
    hasLinkedCustomer: Boolean(linkedUser),
    organizationId: account.organizationId ? String(account.organizationId) : null,
  };
}

async function packageForAccount(account) {
  if (!account.packageId) return null;
  if (account.packageId.priceCents != null) return account.packageId;
  return PlanPackage.findById(account.packageId);
}

/**
 * @param {{ renewCode?: string, phone?: string, secretName?: string, routerId?: string }} input
 */
export async function quotePppoeRenewal(input = {}) {
  const { renewCode, phone, secretName, routerId } = input;
  const hasCode = Boolean(normalizeRenewCode(renewCode));
  const hasPhone = Boolean(normalizeGhanaMsisdn(phone) || String(phone || '').replace(/\D/g, '').length >= 9);
  const hasSecret = Boolean(String(secretName || '').trim());

  if (!hasCode && !hasPhone && !hasSecret) {
    const err = new Error('Enter your renew ID, registered phone, or PPPoE username');
    err.status = 400;
    throw err;
  }

  if (hasSecret && !hasCode && !hasPhone) {
    if (!routerId || !mongoose.isValidObjectId(String(routerId))) {
      const err = new Error(
        'PPPoE username needs your ISP renew link (?r=site), or use your renew ID / phone instead.'
      );
      err.status = 400;
      throw err;
    }
  }

  const matches = await findPppoeForRenewal({ renewCode, phone, secretName, routerId });
  if (matches.length === 0) {
    const err = new Error(
      hasCode
        ? 'No account found for that renew ID'
        : hasPhone
          ? 'No account found for that phone number'
          : 'No PPPoE account found for that username at this site'
    );
    err.status = 404;
    throw err;
  }
  if (matches.length > 1) {
    const err = new Error(
      'Several lines match that phone. Use your renew ID from your ISP (or SMS) instead.'
    );
    err.status = 409;
    throw err;
  }

  const account = matches[0];
  const pkg = await packageForAccount(account);
  return quoteFromAccount(account, pkg);
}

export async function createPppoeRenewalCheckout({
  renewCode,
  phone,
  secretName,
  routerId,
  customerMsisdn,
  customerName,
}) {
  const quote = await quotePppoeRenewal({ renewCode, phone, secretName, routerId });
  if (quote.needsPrice) {
    const err = new Error(
      'This account has no package price — assign a PPPoE package with price in admin'
    );
    err.status = 400;
    throw err;
  }

  const matches = await findPppoeForRenewal({ renewCode, phone, secretName, routerId });
  const account = matches[0];
  if (!account) {
    const err = new Error('No PPPoE account found');
    err.status = 404;
    throw err;
  }
  const pkg = await packageForAccount(account);

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
      renewCode: account.renewCode || undefined,
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
  mergeTxMeta(tx, {
    hubtelCheckout: true,
    hubtelCallbackUrl: session.config?.callbackUrl || resolveHubtelCallbackUrl(billing.hubtel),
  });
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

  const routerDoc = await Router.findById(routerId).select('organizationId').lean();
  if (!routerDoc) {
    const err = new Error('Router not found');
    err.status = 404;
    throw err;
  }
  const routerOrg = routerDoc.organizationId ? String(routerDoc.organizationId) : '';
  const pkgOrg = pkg.organizationId ? String(pkg.organizationId) : '';
  if (!routerOrg || !pkgOrg || routerOrg !== pkgOrg) {
    const err = new Error('Package is not available at this site');
    err.status = 400;
    throw err;
  }

  const clientReference = newClientReference();
  const orgId = routerDoc.organizationId || pkg.organizationId || (await resolveDefaultOrganizationId());
  const resolvedPhone =
    normalizeGhanaMsisdn(customerMsisdn) || String(customerMsisdn || '').trim() || '';
  const resolvedName = String(customerName || '').trim() || undefined;
  const tx = await Transaction.create({
    ...(orgId ? { organizationId: orgId } : {}),
    packageId: pkg._id,
    amountCents,
    currency: pkg.currency || 'GHS',
    status: 'pending',
    kind: 'voucher',
    clientReference,
    provider: 'hubtel',
    customerPhone: resolvedPhone || undefined,
    customerName: resolvedName,
    meta: {
      routerId: String(routerId),
      fulfillment: 'pending',
    },
  });

  if (resolvedPhone) {
    const phoneOr = [{ phone: resolvedPhone }];
    if (resolvedPhone.startsWith('233') && resolvedPhone.length >= 12) {
      phoneOr.push({ phone: `0${resolvedPhone.slice(3)}` });
    }
    const linkedUser = await User.findOne({
      organizationId: orgId,
      $or: phoneOr,
    })
      .select('_id')
      .lean();
    if (linkedUser) {
      tx.userId = linkedUser._id;
      await tx.save();
    }
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
      customerMsisdn: resolvedPhone,
      customerName: resolvedName,
    });
  }

  const session = buildHubtelCheckoutSession({
    amountGhs,
    description: `${billing.merchantDisplayName}: Hotspot — ${pkg.name}`,
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
  mergeTxMeta(tx, {
    hubtelCheckout: true,
    hubtelCallbackUrl: session.config?.callbackUrl || resolveHubtelCallbackUrl(billing.hubtel),
  });
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

/**
 * If Hubtel merchant callback is delayed/missing, confirm via Status Check then mark paid.
 * Status Check often 403 until Render egress IP is whitelisted by Hubtel.
 */
export async function reconcilePaymentFromHubtelStatus(clientReference) {
  const ref = String(clientReference || '').trim();
  if (!ref) return { ok: false, reason: 'missing_ref' };

  const tx = await Transaction.findOne({ clientReference: ref });
  if (!tx) return { ok: false, reason: 'not_found' };
  if (tx.status === 'paid') return { ok: true, status: 'paid', alreadyPaid: true };
  if (tx.status !== 'pending') return { ok: false, reason: 'not_pending', status: tx.status };

  const billing = await resolveOrgBilling(tx.organizationId);
  const check = await fetchHubtelTransactionStatus(ref, billing.hubtel);
  mergeTxMeta(tx, {
    statusCheckAt: new Date().toISOString(),
    statusCheckHttp: check.httpStatus,
    statusCheck: check.body,
  });
  await tx.save();

  if (!check.ok) {
    return {
      ok: false,
      reason: check.httpStatus === 403 ? 'status_check_ip_blocked' : 'status_check_failed',
      httpStatus: check.httpStatus,
      status: tx.status,
    };
  }

  const payload = check.body && typeof check.body === 'object' ? check.body : {};
  if (!hubtelPaymentSucceeded(payload)) {
    return { ok: false, reason: 'not_paid_at_hubtel', status: tx.status, httpStatus: check.httpStatus };
  }

  const enriched = {
    ...payload,
    TransactionId: hubtelProviderReference(payload) || undefined,
    reconciledVia: 'hubtel_status_check',
  };
  const result = await markTransactionPaidByReference(ref, enriched);
  console.log('[hubtel.reconcile] marked paid via status check', ref, result);
  return { ok: true, status: 'paid', via: 'status_check', ...result };
}

/**
 * Browser SDK success/failure — always logs on the API host so Render shows activity
 * even when Hubtel's server-to-server callback never arrives.
 */
export async function recordHubtelClientCheckoutEvent({
  clientReference,
  event,
  payload = {},
}) {
  const ref = String(clientReference || '').trim();
  const kind = String(event || 'unknown').trim() || 'unknown';
  console.log('[hubtel.clientEvent]', kind, ref || '(no ref)', 'keys=', Object.keys(payload || {}).slice(0, 15).join(','));

  if (!ref) return { ok: false, reason: 'missing_ref' };
  const tx = await Transaction.findOne({ clientReference: ref });
  if (!tx) return { ok: false, reason: 'not_found' };

  mergeTxMeta(tx, {
    clientCheckoutEvent: {
      at: new Date().toISOString(),
      event: kind,
      payload,
    },
  });
  await tx.save();

  if (kind === 'success' && tx.status === 'pending') {
    const reconciled = await reconcilePaymentFromHubtelStatus(ref);
    return { ok: true, recorded: true, status: (await Transaction.findOne({ clientReference: ref }).lean())?.status, reconciled };
  }

  return { ok: true, recorded: true, status: tx.status };
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
    try {
      await settlePaidTransactionToWallet(tx);
    } catch (e) {
      console.error('[wallet] settle duplicate path failed', e?.message || e);
    }
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
  try {
    await settlePaidTransactionToWallet(tx);
  } catch (e) {
    console.error('[wallet] settle failed', e?.message || e);
  }
  return { ok: true, ...result };
}
