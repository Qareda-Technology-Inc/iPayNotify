import mongoose from 'mongoose';
import { Organization } from '../models/index.js';
import { config } from '../config.js';
import {
  getDefaultPlatformFeeBps,
  resolvePlatformFeeBps,
} from './platformSettingsService.js';

/**
 * Hubtel + merchant labels for a tenant.
 * Checkout always uses platform Hubtel (Qaretech collects); orgs do not supply their own keys.
 */
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
  const feeBps = await resolvePlatformFeeBps(b);

  const hubtel = {
    merchantAccount: config.hubtel.merchantAccount,
    clientId: config.hubtel.clientId,
    clientSecret: config.hubtel.clientSecret,
    callbackUrl: config.hubtel.callbackUrl,
    statusCheckBaseUrl: config.hubtel.statusCheckBaseUrl,
    mock: config.hubtel.mock,
    allowedChannels: config.hubtel.allowedChannels,
  };

  return {
    merchantDisplayName,
    smsBrandName,
    hubtel,
    useOrgHubtelCredentials: false,
    platformFeeBps: feeBps,
  };
}

/** API response: billing without raw Hubtel secrets. */
export async function sanitizeBillingForClient(billing) {
  const defaultBps = await getDefaultPlatformFeeBps();
  if (!billing || typeof billing !== 'object') {
    return {
      merchantDisplayName: '',
      smsBrandName: '',
      logoUrl: '',
      platformFeeBps: null,
      platformFeePercent: defaultBps / 100,
      defaultPlatformFeePercent: defaultBps / 100,
      payoutMomoNumber: '',
      payoutNote: '',
      settlementsViaPlatform: true,
    };
  }
  const feeBps = await resolvePlatformFeeBps(billing);
  const hasOverride = billing.platformFeeBps != null && Number.isFinite(Number(billing.platformFeeBps));
  return {
    merchantDisplayName: String(billing.merchantDisplayName || '').trim(),
    smsBrandName: String(billing.smsBrandName || '').trim(),
    logoUrl: String(billing.logoUrl || '').trim(),
    platformFeeBps: hasOverride ? feeBps : null,
    platformFeePercent: feeBps / 100,
    defaultPlatformFeePercent: defaultBps / 100,
    payoutMomoNumber: String(billing.payoutMomoNumber || '').trim(),
    payoutNote: String(billing.payoutNote || '').trim(),
    settlementsViaPlatform: true,
  };
}
