import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { apiFetch } from '../api.js';
import { setActingOrganizationId } from '../authStorage.js';

const STATUSES = ['active', 'trial', 'past_due', 'suspended'];

export function SuperAdminOrganizationsPage() {
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setErr('');
    setLoading(true);
    try {
      const list = await apiFetch('/api/super-admin/organizations');
      setRows(Array.isArray(list) ? list : []);
    } catch (e) {
      setErr(e.message || 'Failed to load organisations');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function createOrg(e) {
    e.preventDefault();
    setCreating(true);
    setErr('');
    try {
      await apiFetch('/api/super-admin/organizations', {
        method: 'POST',
        body: JSON.stringify({
          name: name.trim(),
          slug: slug.trim().toLowerCase().replace(/\s+/g, '-'),
        }),
      });
      setName('');
      setSlug('');
      await load();
    } catch (e) {
      setErr(e.message || 'Create failed');
    } finally {
      setCreating(false);
    }
  }

  async function patchStatus(id, status) {
    setErr('');
    try {
      await apiFetch(`/api/super-admin/organizations/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      await load();
    } catch (e) {
      setErr(e.message || 'Update failed');
    }
  }

  async function removeOrg(id) {
    if (!window.confirm('Delete this organisation? Routers and org admins must be removed first.')) return;
    setErr('');
    try {
      await apiFetch(`/api/super-admin/organizations/${id}`, { method: 'DELETE' });
      await load();
    } catch (e) {
      setErr(e.message || 'Delete failed');
    }
  }

  function openDashboardAsOrg(org) {
    setActingOrganizationId(org._id, org.name);
    navigate('/');
  }

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-white">Organisations</h1>
        <p className="mt-1 text-sm text-slate-400">
          Create tenants and open their billing dashboard using <strong className="text-slate-300">Open dashboard</strong>{' '}
          (sets which organisation normal admin APIs use for this browser).
        </p>
      </div>

      {err && (
        <p className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">{err}</p>
      )}

      <section className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
        <h2 className="text-lg font-medium text-white">New organisation</h2>
        <form onSubmit={createOrg} className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="block text-sm text-slate-300 sm:col-span-2">
            Display name
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
              placeholder="e.g. Acme ISP"
            />
          </label>
          <label className="block text-sm text-slate-300 sm:col-span-2">
            Slug (unique)
            <input
              required
              value={slug}
              onChange={(e) =>
                setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))
              }
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm"
              placeholder="acme-isp"
            />
          </label>
          <button
            type="submit"
            disabled={creating || !name.trim() || !slug.trim()}
            className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50 sm:col-span-2"
          >
            {creating ? 'Creating…' : 'Create organisation'}
          </button>
        </form>
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
        <h2 className="text-lg font-medium text-white">All organisations</h2>
        {loading ? (
          <p className="mt-4 text-sm text-slate-500">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="mt-4 text-sm text-slate-500">None yet — create one above.</p>
        ) : (
          <ul className="mt-4 divide-y divide-slate-800">
            {rows.map((o) => (
              <li key={o._id} className="flex flex-wrap items-center justify-between gap-3 py-4">
                <div>
                  <p className="font-medium text-white">{o.name}</p>
                  <p className="font-mono text-xs text-slate-500">{o.slug}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={o.status || 'active'}
                    onChange={(e) => patchStatus(o._id, e.target.value)}
                    className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-200"
                  >
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => openDashboardAsOrg(o)}
                    className="rounded-lg border border-emerald-700/50 bg-emerald-950/40 px-3 py-1.5 text-xs font-medium text-emerald-200 hover:bg-emerald-950/70"
                  >
                    Open dashboard
                  </button>
                  <Link
                    to={`/super/organizations/${o._id}/admins`}
                    className="rounded-lg border border-slate-600 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
                  >
                    Admins
                  </Link>
                  <button
                    type="button"
                    onClick={() => removeOrg(o._id)}
                    className="rounded-lg border border-red-500/40 px-3 py-1.5 text-xs text-red-300 hover:bg-red-950/30"
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
