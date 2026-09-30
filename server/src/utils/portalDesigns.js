export const PORTAL_DESIGN_IDS = ['midnight', 'sunrise', 'signal'];
export const VOUCHER_DESIGN_IDS = ['grid', 'ticket', 'strip', 'mini', 'classic', 'badge'];

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
  voucherTitle: 32,
};

export function clipPortalCopy(field, value) {
  const max = COPY_LIMITS[field] || 60;
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}
