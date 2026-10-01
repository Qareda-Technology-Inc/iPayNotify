import { LOGIN_THEME_IDS } from '../services/captiveTemplates.js';

export const PORTAL_DESIGN_IDS = LOGIN_THEME_IDS;

/** Must match `TICKET_DESIGNS` ids in client/src/utils/exportVouchersPdf.js. */
export const VOUCHER_DESIGN_IDS = [
  'grid',
  'ocean',
  'ticket',
  'forest',
  'strip',
  'royal',
  'mini',
  'pocket',
  'classic',
  'gold',
  'badge',
  'sunset',
  'split',
  'carbon',
  'coupon',
  'mint',
  'ribbon',
  'promo',
  'receipt',
  'cafe',
];

export function normalizePortalDesign(value) {
  const id = String(value || '').trim();
  return PORTAL_DESIGN_IDS.includes(id) ? id : 'midnight';
}

export function normalizeVoucherDesign(value) {
  const id = String(value || '').trim();
  return VOUCHER_DESIGN_IDS.includes(id) ? id : 'grid';
}

const COPY_LIMITS = {
  portalHeadline: 60,
  portalSubtitle: 120,
  portalButtonLabel: 24,
  portalBuyLabel: 32,
  portalFooter: 160,
  portalSupportPhone: 24,
  voucherTitle: 32,
};

export function clipPortalCopy(field, value) {
  const max = COPY_LIMITS[field] || 60;
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}
