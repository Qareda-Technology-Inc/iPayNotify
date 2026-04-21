import mongoose from 'mongoose';
import { Organization } from '../models/index.js';
import { config } from '../config.js';

/** MoMo + merchant labels for a tenant (falls back to platform `config`). */
export async function resolveOrgBilling(organizationId) {
  let org = null;
  if (
    organizationId != null &&
    String(organizationId).trim() &&
    mongoose.isValidObjectId(String(organizationId).trim())
  ) {
    org = await Organization.findById(String(organizationId).trim()).select('billing').lean();
  }
  const b = org?.billing || {};

  const merchantDisplayName =
    String(b.merchantDisplayName || '').trim() || config.merchant.displayName;

  const smsBrandName = String(b.smsBrandName || '').trim();

  const useOrgMomo =
    Boolean(b.useCustomMomo) &&
    String(b.mtnMomoSubscriptionKey || '').trim() &&
    String(b.mtnMomoApiUser || '').trim() &&
    String(b.mtnMomoApiKey || '').trim();

  const mtnMomo = {
    subscriptionKey: useOrgMomo
      ? String(b.mtnMomoSubscriptionKey).trim()
      : config.mtnMomo.subscriptionKey,
    apiUser: useOrgMomo ? String(b.mtnMomoApiUser).trim() : config.mtnMomo.apiUser,
    apiKey: useOrgMomo ? String(b.mtnMomoApiKey).trim() : config.mtnMomo.apiKey,
    targetEnvironment: useOrgMomo
      ? String(b.mtnMomoTargetEnvironment || '').trim() || config.mtnMomo.targetEnvironment
      : config.mtnMomo.targetEnvironment,
    baseUrl: (
      useOrgMomo
        ? String(b.mtnMomoBaseUrl || '').trim() || config.mtnMomo.baseUrl
        : config.mtnMomo.baseUrl
    ).replace(/\/$/, ''),
    callbackUrl: useOrgMomo
      ? String(b.mtnMomoCallbackUrl || '').trim() || config.mtnMomo.callbackUrl
      : config.mtnMomo.callbackUrl,
    mockRequest: config.mtnMomo.mockRequest,
  };

  return {
    merchantDisplayName,
    smsBrandName,
    mtnMomo,
    useOrgMomoCredentials: useOrgMomo,
  };
}

/** API response: billing without raw MTN secrets. */
export function sanitizeBillingForClient(billing) {
  if (!billing || typeof billing !== 'object') {
    return {
      merchantDisplayName: '',
      smsBrandName: '',
      useCustomMomo: false,
      mtnMomoApiUser: '',
      mtnMomoBaseUrl: '',
      mtnMomoTargetEnvironment: '',
      mtnMomoCallbackUrl: '',
      mtnMomoSubscriptionKeySet: false,
      mtnMomoApiKeySet: false,
    };
  }
  return {
    merchantDisplayName: String(billing.merchantDisplayName || '').trim(),
    smsBrandName: String(billing.smsBrandName || '').trim(),
    useCustomMomo: Boolean(billing.useCustomMomo),
    mtnMomoApiUser: String(billing.mtnMomoApiUser || '').trim(),
    mtnMomoBaseUrl: String(billing.mtnMomoBaseUrl || '').trim(),
    mtnMomoTargetEnvironment: String(billing.mtnMomoTargetEnvironment || '').trim(),
    mtnMomoCallbackUrl: String(billing.mtnMomoCallbackUrl || '').trim(),
    mtnMomoSubscriptionKeySet: Boolean(String(billing.mtnMomoSubscriptionKey || '').trim()),
    mtnMomoApiKeySet: Boolean(String(billing.mtnMomoApiKey || '').trim()),
  };
}
