import mongoose from 'mongoose';
import { Organization } from '../models/index.js';
import { config } from '../config.js';

/** Hubtel + merchant labels for a tenant (falls back to platform `config`). */
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

  const useOrgHubtel =
    Boolean(b.useCustomHubtel) &&
    String(b.hubtelMerchantAccount || '').trim() &&
    String(b.hubtelClientId || '').trim() &&
    String(b.hubtelClientSecret || '').trim();

  const hubtel = {
    merchantAccount: useOrgHubtel
      ? String(b.hubtelMerchantAccount).trim()
      : config.hubtel.merchantAccount,
    clientId: useOrgHubtel ? String(b.hubtelClientId).trim() : config.hubtel.clientId,
    clientSecret: useOrgHubtel ? String(b.hubtelClientSecret).trim() : config.hubtel.clientSecret,
    callbackUrl: useOrgHubtel
      ? String(b.hubtelCallbackUrl || '').trim() || config.hubtel.callbackUrl
      : config.hubtel.callbackUrl,
    mock: config.hubtel.mock,
    allowedChannels: config.hubtel.allowedChannels,
  };

  return {
    merchantDisplayName,
    smsBrandName,
    hubtel,
    useOrgHubtelCredentials: useOrgHubtel,
  };
}

/** API response: billing without raw Hubtel secrets. */
export function sanitizeBillingForClient(billing) {
  if (!billing || typeof billing !== 'object') {
    return {
      merchantDisplayName: '',
      smsBrandName: '',
      useCustomHubtel: false,
      hubtelMerchantAccount: '',
      hubtelClientId: '',
      hubtelCallbackUrl: '',
      hubtelClientSecretSet: false,
    };
  }
  return {
    merchantDisplayName: String(billing.merchantDisplayName || '').trim(),
    smsBrandName: String(billing.smsBrandName || '').trim(),
    useCustomHubtel: Boolean(billing.useCustomHubtel),
    hubtelMerchantAccount: String(billing.hubtelMerchantAccount || '').trim(),
    hubtelClientId: String(billing.hubtelClientId || '').trim(),
    hubtelCallbackUrl: String(billing.hubtelCallbackUrl || '').trim(),
    hubtelClientSecretSet: Boolean(String(billing.hubtelClientSecret || '').trim()),
  };
}
