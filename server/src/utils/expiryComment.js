const PREFIX = 'Exp:';

export function formatExpiryComment(date) {
  const d = date instanceof Date ? date : new Date(date);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${PREFIX} ${y}-${m}-${day}`;
}

export function parseExpiryFromComment(comment) {
  if (!comment || typeof comment !== 'string') return null;
  const m = comment.match(/Exp:\s*(\d{4}-\d{2}-\d{2})/i);
  if (!m) return null;
  const [y, mo, d] = m[1].split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1, d, 23, 59, 59, 999));
}
