export function routerDisplayName(r) {
  if (!r) return '';
  if (r.comment != null) {
    const c = String(r.comment).trim();
    if (c) return c;
  }
  return r.name || '';
}
