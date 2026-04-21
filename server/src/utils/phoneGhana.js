/** Normalize customer input to Arkesel-style Ghana MSISDN: 233XXXXXXXXX (digits only). */
export function normalizeGhanaMsisdn(raw) {
  if (raw == null || raw === '') return null;
  const d = String(raw).replace(/\D/g, '');
  if (!d) return null;
  if (d.startsWith('233')) {
    return d.length >= 12 ? d : null;
  }
  if (d.startsWith('0') && d.length >= 10) {
    return `233${d.slice(1)}`;
  }
  if (d.length === 9) {
    return `233${d}`;
  }
  return null;
}
