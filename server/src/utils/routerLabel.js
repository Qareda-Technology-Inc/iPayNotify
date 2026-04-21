/** Friendly router label: `comment` is the router name when non-empty, else `name`. */
export function routerDisplayName(doc) {
  if (!doc) return '';
  if (doc.comment != null) {
    const c = String(doc.comment).trim();
    if (c) return c;
  }
  return String(doc.name || '').trim() || '';
}
