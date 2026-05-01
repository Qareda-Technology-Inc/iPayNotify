import { useEffect, useState } from 'react';
import { apiFetch } from '../../api.js';

export function TicketSitesPage() {
  const [me, setMe] = useState(null);
  const [sites, setSites] = useState([]);
  const [name, setName] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const canManageSites = ['super_admin', 'org_admin'].includes(me?.admin?.role || '');

  async function load() {
    setErr('');
    try {
      const [m, s] = await Promise.all([apiFetch('/api/auth/me'), apiFetch('/api/ticket-sales/sites')]);
      setMe(m);
      setSites(Array.isArray(s) ? s : []);
    } catch (e) {
      setErr(e.message || 'Could not load sites');
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function createSite(e) {
    e.preventDefault();
    if (!canManageSites) return;
    setBusy(true);
    setErr('');
    try {
      await apiFetch('/api/ticket-sales/sites', {
        method: 'POST',
        body: JSON.stringify({ name: name.trim() }),
      });
      setName('');
      await load();
    } catch (e2) {
      setErr(e2.message || 'Could not create site');
    } finally {
      setBusy(false);
    }
  }

  async function patchSite(site, patch) {
    setBusy(true);
    setErr('');
    try {
      await apiFetch(`/api/ticket-sales/sites/${site._id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
      await load();
    } catch (e) {
      setErr(e.message || 'Could not update site');
    } finally {
      setBusy(false);
    }
  }

  async function deleteSite(site) {
    if (!window.confirm(`Delete site "${site.name}"?`)) return;
    setBusy(true);
    setErr('');
    try {
      await apiFetch(`/api/ticket-sales/sites/${site._id}`, { method: 'DELETE' });
      await load();
    } catch (e) {
      setErr(e.message || 'Could not delete site');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-white">Ticket sites</h1>
        <p className="mt-1 text-sm text-slate-400">Manage site names used for ticket operations.</p>
      </div>
      {err && <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">{err}</p>}
      {canManageSites ? (
        <form onSubmit={createSite} className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5">
          <label className="text-sm text-slate-300">
            New site name
            <input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2" />
          </label>
          <button type="submit" disabled={busy || !name.trim()} className="mt-3 rounded-lg bg-emerald-600 px-4 py-2 text-sm text-white disabled:opacity-50">
            Add site
          </button>
        </form>
      ) : (
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">Only super admins and organisation admins can create/edit sites.</p>
      )}
      <section className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5">
        <h2 className="text-lg text-white">Existing sites</h2>
        <ul className="mt-3 space-y-2">
          {sites.map((s) => (
            <li key={s._id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-800 px-3 py-2 text-sm text-slate-300">
              <span>{s.name}</span>
              <div className="flex gap-2">
                <button type="button" onClick={() => patchSite(s, { active: !s.active })} disabled={!canManageSites || busy} className="rounded border border-slate-700 px-2 py-0.5 text-xs disabled:opacity-50">
                  {s.active ? 'Disable' : 'Enable'}
                </button>
                <button type="button" onClick={() => {
                  const next = window.prompt('New site name', s.name || '');
                  if (next && next.trim()) patchSite(s, { name: next.trim() });
                }} disabled={!canManageSites || busy} className="rounded border border-slate-700 px-2 py-0.5 text-xs disabled:opacity-50">
                  Rename
                </button>
                <button type="button" onClick={() => deleteSite(s)} disabled={!canManageSites || busy} className="rounded border border-red-700/50 px-2 py-0.5 text-xs text-red-300 disabled:opacity-50">
                  Delete
                </button>
              </div>
            </li>
          ))}
          {sites.length === 0 && <li className="text-sm text-slate-500">No sites yet.</li>}
        </ul>
      </section>
    </div>
  );
}

