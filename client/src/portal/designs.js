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
    blurb: '35 compact cards on one A4 sheet. Best for large batches.',
  },
  {
    id: 'ticket',
    name: 'Ticket',
    blurb: 'Larger tear-off tickets, 10 per sheet.',
  },
  {
    id: 'strip',
    name: 'Strip',
    blurb: 'One wide voucher per row, 7 per sheet. Easiest to read.',
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
