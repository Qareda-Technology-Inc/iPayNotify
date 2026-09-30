export const PORTAL_DESIGNS = [
  {
    id: 'midnight',
    name: 'Midnight',
    blurb: 'Dark page with an emerald connect button.',
  },
  {
    id: 'sunrise',
    name: 'Sunrise',
    blurb: 'Light card on a warm background.',
  },
  {
    id: 'signal',
    name: 'Signal',
    blurb: 'High-contrast code field for a quick login.',
  },
];

export const VOUCHER_DESIGNS = [
  {
    id: 'grid',
    name: 'Grid',
    blurb: 'Dark header card, 38 × 20 mm. 65 per A4 sheet.',
  },
  {
    id: 'ticket',
    name: 'Ticket',
    blurb: 'Tear-off stub with an orange edge, 64 × 30 mm. 27 per sheet.',
  },
  {
    id: 'strip',
    name: 'Strip',
    blurb: 'Wide, easy to read, 92 × 18 mm. 28 per sheet.',
  },
  {
    id: 'mini',
    name: 'Mini',
    blurb: 'Code only, smallest cut, 30 × 16 mm. 96 per sheet.',
  },
  {
    id: 'classic',
    name: 'Classic',
    blurb: 'Framed card with a shaded code box, 46 × 28 mm. 36 per sheet.',
  },
  {
    id: 'badge',
    name: 'Badge',
    blurb: 'Full-colour card with a white code panel, 46 × 27 mm. 40 per sheet.',
  },
];

export function portalDesignById(id) {
  return PORTAL_DESIGNS.find((d) => d.id === id) || PORTAL_DESIGNS[0];
}

export function voucherDesignById(id) {
  return VOUCHER_DESIGNS.find((d) => d.id === id) || VOUCHER_DESIGNS[0];
}

const DESIGN_COPY = {
  midnight: {
    headline: 'Connect to Wi‑Fi',
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

/** Saved wording wins. Blank fields keep the selected design's defaults. */
export function portalCopy(designId, custom = {}) {
  const base = DESIGN_COPY[designId] || DESIGN_COPY.midnight;
  const pick = (value, fallback) => {
    const text = String(value || '').trim();
    return text || fallback;
  };
  return {
    headline: pick(custom.headline, base.headline),
    subtitle: pick(custom.subtitle, base.subtitle),
    buttonLabel: pick(custom.buttonLabel, 'Connect'),
    buyLabel: pick(custom.buyLabel, 'Buy a code'),
    voucherTitle: pick(custom.voucherTitle, 'Wi‑Fi Access'),
  };
}
