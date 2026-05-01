export function money(cents) {
  return new Intl.NumberFormat('en-GH', { style: 'currency', currency: 'GHS' }).format((Number(cents) || 0) / 100);
}

