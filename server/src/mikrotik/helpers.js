export function normalizePrintRows(result) {
  if (result == null) return [];
  if (Array.isArray(result)) return result.filter(Boolean);
  if (typeof result === 'object') return [result];
  return [];
}
