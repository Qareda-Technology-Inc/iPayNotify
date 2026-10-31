import { useEffect, useState } from 'react';
import { apiFetch } from '../api.js';

/**
 * One click after the customer domain changes: every router gets the new login-page links and
 * walled garden, and the old domain is removed from them.
 */
export function SyncAllRoutersCard({ routerCount }) {
  const [domain, setDomain] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    apiFetch('/api/routers/portal-sync-all')
      .then((d) => setDomain(d?.domain || ''))
      .catch(() => {});
  }, []);

  async function run() {
    if (!window.confirm(`Update all ${routerCount} router${routerCount === 1 ? '' : 's'} to ${domain}? Customers on the old address will be moved to this one.`)) {
      return;
    }
    setBusy(true);
    setErr('');
    setResult(null);
    try {
      setResult(await apiFetch('/api/routers/portal-sync-all', { method: 'POST' }));
    } catch (e) {
      setErr(e.message || 'Could not update the routers');
    } finally {
      setBusy(false);
    }
  }

  if (!routerCount || !domain) return null;
  const failed = result?.routers?.filter((r) => !r.ok) || [];

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 px-3 py-3 sm:px-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-200">Customer site: {domain}</p>
          <p className="mt-0.5 text-xs text-slate-400">
            Puts this address on every router&apos;s login page and walled garden, and removes the old one.
          </p>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={run}
          className="inline-flex h-10 shrink-0 items-center justify-center rounded-xl border border-emerald-600/50 px-4 text-sm font-semibold text-emerald-100 hover:bg-emerald-950/50 disabled:opacity-50"
        >
          {busy ? 'Updating routers…' : 'Update all routers'}
        </button>
      </div>
      {err ? <p className="mt-2 text-xs text-red-300">{err}</p> : null}
      {result ? (
        <div className="mt-3 space-y-1 text-xs">
          <p className={failed.length ? 'text-amber-200' : 'text-emerald-300'}>
            {result.updated} of {result.total} router{result.total === 1 ? '' : 's'} updated to {result.domain}.
          </p>
          <ul className="space-y-0.5 text-slate-400">
            {result.routers.map((r) => (
              <li key={r.routerId} className="break-words">
                <span className={r.ok ? 'text-emerald-300' : 'text-amber-300'}>{r.ok ? '✓' : '✗'}</span> {r.name}
                {r.ok
                  ? r.loginPage === 'updated'
                    ? ' · login page and walled garden updated'
                    : ' · walled garden updated (login page never pushed: push it from Templates)'
                  : ` · ${r.error}`}
              </li>
            ))}
          </ul>
          {failed.length ? (
            <p className="text-slate-500">Bring the failed routers online, then click Update all routers again.</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
