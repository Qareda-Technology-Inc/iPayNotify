import { loginThemeById } from './captiveTemplates.js';

export function portalCopy(designId, custom = {}) {
  const theme = loginThemeById(designId);
  const pick = (value, fallback) => {
    const text = String(value || '').trim();
    return text || fallback;
  };
  return {
    designId: theme.id,
    headline: pick(custom.headline, theme.headline),
    subtitle: pick(custom.subtitle, theme.subtitle),
    buttonLabel: pick(custom.buttonLabel, 'Connect'),
    buyLabel: pick(custom.buyLabel, 'Buy a code'),
    voucherTitle: pick(custom.voucherTitle, 'Wi-Fi Access'),
  };
}
