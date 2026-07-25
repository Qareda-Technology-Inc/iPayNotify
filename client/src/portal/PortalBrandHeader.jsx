/** Shared white-label header for public renew / hotspot pages. */
export function PortalBrandHeader({ branding, routerName, title, subtitle }) {
  const name = String(branding?.displayName || '').trim();
  const logoUrl = String(branding?.logoUrl || '').trim();
  const site = String(routerName || '').trim();

  return (
    <header className="mb-6">
      {logoUrl ? (
        <img
          src={logoUrl}
          alt={name || 'Logo'}
          className="mb-3 h-12 w-auto max-w-[200px] object-contain"
        />
      ) : null}
      {name ? <p className="text-sm font-medium text-indigo-300">{name}</p> : null}
      <h1 className="mt-1 text-xl font-semibold text-white">{title}</h1>
      {subtitle ? <p className="mt-2 text-sm text-slate-400">{subtitle}</p> : null}
      {site ? (
        <p className="mt-2 text-xs text-slate-500">
          Site: <span className="text-slate-300">{site}</span>
        </p>
      ) : null}
    </header>
  );
}
