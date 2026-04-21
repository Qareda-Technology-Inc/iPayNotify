import mongoose from 'mongoose';
import { Organization, Router } from '../models/index.js';
import { config } from '../config.js';

export function defaultSmsBrandName() {
  return (config.arkesel.brandName || 'QareFi').trim();
}

export function defaultSmsSenderId() {
  return (config.arkesel.senderId || '').trim();
}

async function orgSmsBrandFallback(organizationId) {
  if (
    organizationId == null ||
    !String(organizationId).trim() ||
    !mongoose.isValidObjectId(String(organizationId).trim())
  ) {
    return '';
  }
  const o = await Organization.findById(String(organizationId).trim())
    .select('billing.smsBrandName')
    .lean();
  return String(o?.billing?.smsBrandName || '').trim();
}

/**
 * SMS label line for payment/broadcast when a router is known.
 * Order: router `smsBrandName` → organisation `billing.smsBrandName` → global SMS_BRAND_NAME.
 */
export async function resolveSmsBranding(routerId, organizationId) {
  if (
    routerId == null ||
    String(routerId).trim() === '' ||
    !mongoose.isValidObjectId(String(routerId))
  ) {
    const orgBrand = await orgSmsBrandFallback(organizationId);
    return {
      brandName: orgBrand || defaultSmsBrandName(),
      senderId: defaultSmsSenderId(),
    };
  }
  const r = await Router.findById(routerId)
    .select('smsBrandName smsSenderId name comment')
    .lean();
  if (!r) {
    const orgBrand = await orgSmsBrandFallback(organizationId);
    return {
      brandName: orgBrand || defaultSmsBrandName(),
      senderId: defaultSmsSenderId(),
    };
  }
  const routerBrand = r.smsBrandName != null && String(r.smsBrandName).trim();
  const orgBrand = routerBrand ? '' : await orgSmsBrandFallback(organizationId);
  const brand = routerBrand || orgBrand || defaultSmsBrandName();
  const sender =
    (r.smsSenderId != null && String(r.smsSenderId).trim()) || defaultSmsSenderId();
  return { brandName: brand, senderId: sender };
}
