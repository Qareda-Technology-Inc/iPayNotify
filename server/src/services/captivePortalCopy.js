import { PORTAL_DESIGN_IDS } from '../utils/portalDesigns.js';

const DEFAULTS = {
  midnight: {
    headline: 'Connect to Wi-Fi',
    subtitle: 'Type the code from your voucher.',
  },
  sunrise: {
    headline: 'Get online',
    subtitle: 'Enter the code on your voucher.',
  },
  signal: {
    headline: 'Enter your code',
    subtitle: 'The number printed on your voucher.',
  },
};

export function portalCopy(designId, custom = {}) {
  const id = PORTAL_DESIGN_IDS.includes(designId) ? designId : 'midnight';
  const base = DEFAULTS[id];
  const pick = (value, fallback) => {
    const text = String(value || '').trim();
    return text || fallback;
  };
  return {
    designId: id,
    headline: pick(custom.headline, base.headline),
    subtitle: pick(custom.subtitle, base.subtitle),
    buttonLabel: pick(custom.buttonLabel, 'Connect'),
    buyLabel: pick(custom.buyLabel, 'Buy a code'),
    voucherTitle: pick(custom.voucherTitle, 'Wi-Fi Access'),
  };
}
