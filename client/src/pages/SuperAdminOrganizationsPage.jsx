import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { apiFetch } from '../api.js';
import { setActingOrganizationId } from '../authStorage.js';

const STATUSES = ['active', 'trial', 'past_due', 'suspended'];

export function SuperAdminOrganizationsPage() {
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [err, setErr] = useState('');
  const [info, setInfo] = useState('');
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [creating, setCreating] = useState(false);
  const [defaultFeePercent, setDefaultFeePercent] = useState('5');
  const [savingFee, setSavingFee] = useState(false);

  const load = useCallback(async () => {
    setErr('');
    setLoading(true);
    try {
      const [list, settings] = await Promise.all([
        apiFetch('/api/super-admin/organizations'),
        apiFetch('/api/super-admin/platform-settings'),
      ]);
      setRows(Array.isArray(list) ? list : []);
      if (settings?.defaultPlatformFeePercent != null) {
        setDefaultFeePercent(String(settings.defaultPlatformFeePercent));
      }
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

  async function saveDefaultFee(e) {
    e.preventDefault();
    setSavingFee(true);
    setErr('');
    setInfo('');
    try {
      const updated = await apiFetch('/api/super-admin/platform-settings', {
        method: 'PATCH',
        body: JSON.stringify({ defaultPlatformFeePercent: Number(defaultFeePercent) }),
      });
      setDefaultFeePercent(String(updated.defaultPlatformFeePercent));
      setInfo(`Default platform fee saved: ${updated.defaultPlatformFeePercent}%`);
      await load();
    } catch (e2) {
      setErr(e2.message || 'Could not save platform fee');
    } finally {
      setSavingFee(false);
    }
  }

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

  async function patchModule(org, key, enabled) {
    setErr('');
    setInfo('');
    try {
      await apiFetch(`/api/super-admin/organizations/${org._id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          modules: {
            remoteAccess: Boolean(org.modules?.remoteAccess),
            ...(key === 'remoteAccess' ? { remoteAccess: enabled } : {}),
          },
        }),
      });
      await load();
    } catch (e) {
      setErr(e.message || 'Could not update modules');
    }
  }

  async function editLimits(org) {
    const cur = org.limits || {};
    const routers = window.prompt(
      'Max routers (blank = unlimited)',
      cur.maxRouters != null ? String(cur.maxRouters) : ''
    );
    if (routers === null) return;
    const admins = window.prompt(
      'Max team members (blank = unlimited)',
      cur.maxAdmins != null ? String(cur.maxAdmins) : ''
    );
    if (admins === null) return;
    const sms = window.prompt(
      'Max SMS per month (blank = unlimited)',
      cur.maxSmsPerMonth != null ? String(cur.maxSmsPerMonth) : ''
    );
    if (sms === null) return;
    setErr('');
    setInfo('');
    const parse = (v) => {
      const t = String(v).trim();
      if (t === '') return null;
      const n = Math.round(Number(t));
      if (!Number.isFinite(n) || n < 0) throw new Error('Limits must be non-negative numbers');
      return n;
    };
    try {
      await apiFetch(`/api/super-admin/organizations/${org._id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          limits: {
            maxRouters: parse(routers),
            maxAdmins: parse(admins),
            maxSmsPerMonth: parse(sms),
          },
        }),
      });
      setInfo(`Limits updated for ${org.name}`);
      await load();
    } catch (e) {
      setErr(e.message || 'Could not update limits');
    }
  }

  async function editFee(org) {
    const defaultPct =
      org.billing?.defaultPlatformFeePercent != null
        ? org.billing.defaultPlatformFeePercent
        : defaultFeePercent;
    const current =
      org.billing?.platformFeeBps != null
        ? String(org.billing.platformFeePercent)
        : '';
    const raw = window.prompt(
      `Platform fee % for this organisation (blank = platform default ${defaultPct}%)`,
      current
    );
    if (raw === null) return;
    setErr('');
    setInfo('');
    try {
      const trimmed = String(raw).trim();
      const body =
        trimmed === ''
          ? { platformFeeBps: null }
          : { platformFeeBps: Math.round(Number(trimmed) * 100) };
      await apiFetch(`/api/super-admin/organizations/${org._id}/billing`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      await load();
    } catch (e) {
      setErr(e.message || 'Fee update failed');
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
          Create tenants, enable optional modules, and open their dashboard with{' '}
          <strong className="text-slate-300">Open dashboard</strong>.
        </p>
      </div>

      {err && (
        <p className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">{err}</p>
      )}
      {info && (
        <p className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
          {info}
        </p>
      )}

      <section className="rounded-2xl border border-amber-500/25 bg-amber-950/15 p-6">
        <h2 className="text-lg font-medium text-white">Default platform fee</h2>
        <p className="mt-1 text-xs text-slate-400">
          Stored in the database. Applied to every organisation unless you set a per-org override with{' '}
          <strong className="text-slate-300">Fee %</strong>.
        </p>
        <form onSubmit={saveDefaultFee} className="mt-4 flex flex-wrap items-end gap-3">
          <label className="block text-sm text-slate-300">
            Fee %
            <input
              type="number"
              min="0"
              max="100"
              step="0.01"
              required
              value={defaultFeePercent}
              onChange={(e) => setDefaultFeePercent(e.target.value)}
              className="mt-1 w-36 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
            />
          </label>
          <button
            type="submit"
            disabled={savingFee}
            className="rounded-xl bg-amber-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-amber-500 disabled:opacity-50"
          >
            {savingFee ? 'Saving…' : 'Save default fee'}
          </button>
        </form>
      </section>

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
              <li key={o._id} className="space-y-3 py-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-medium text-white">{o.name}</p>
                    <p className="font-mono text-xs text-slate-500">{o.slug}</p>
                    <p className="mt-1 text-xs text-emerald-300/90">
                      Wallet GHS {((Number(o.walletBalanceCents) || 0) / 100).toFixed(2)}
                      {o.billing?.platformFeePercent != null
                        ? ` · fee ${o.billing.platformFeePercent}%`
                        : ''}
                    </p>
                    <p className="mt-1 text-[11px] text-slate-500">
                      Usage: routers {o.usage?.routers ?? 0}
                      {o.limits?.maxRouters != null ? `/${o.limits.maxRouters}` : ''} · team{' '}
                      {o.usage?.admins ?? 0}
                      {o.limits?.maxAdmins != null ? `/${o.limits.maxAdmins}` : ''} · SMS{' '}
                      {o.usage?.smsThisMonth ?? 0}
                      {o.limits?.maxSmsPerMonth != null ? `/${o.limits.maxSmsPerMonth}` : ''}
                    </p>
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
                    <button
                      type="button"
                      onClick={() => editFee(o)}
                      className="rounded-lg border border-slate-600 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
                    >
                      Fee %
                    </button>
                    <button
                      type="button"
                      onClick={() => editLimits(o)}
                      className="rounded-lg border border-slate-600 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
                    >
                      Limits
                    </button>
                    <Link
                      to={`/super/organizations/${o._id}/admins`}
                      className="rounded-lg border border-slate-600 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
                    >
                      Invite team
                    </Link>
                    <button
                      type="button"
                      onClick={() => removeOrg(o._id)}
                      className="rounded-lg border border-red-500/40 px-3 py-1.5 text-xs text-red-300 hover:bg-red-950/30"
                    >
                      Delete
                    </button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-4 rounded-xl border border-slate-800/80 bg-slate-950/40 px-3 py-2.5">
                  <p className="w-full text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                    Modules for this organisation
                  </p>
                  <p className="text-xs text-slate-400">
                    Ticket operations:{' '}
                    {o.modules?.tickets ? (
                      <span className="text-emerald-300">On (this org)</span>
                    ) : (
                      <span className="text-slate-500">
                        Only for slug <span className="font-mono">qaretech-innovative</span>
                      </span>
                    )}
                  </p>
                  <label className="flex items-center gap-2 text-xs text-slate-300">
                    <input
                      type="checkbox"
                      checked={Boolean(o.modules?.remoteAccess)}
                      onChange={(e) => patchModule(o, 'remoteAccess', e.target.checked)}
                      className="rounded border-slate-600"
                    />
                    Remote access
                  </label>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
