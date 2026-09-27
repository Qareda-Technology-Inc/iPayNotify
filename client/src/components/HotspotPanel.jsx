import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../api.js';
import { routerDisplayName } from '../utils/routerDisplayName.js';

function formatBytes(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return '—';
  if (v < 1024) return `${v} B`;
  if (v < 1048576) return `${(v / 1024).toFixed(1)} KB`;
  if (v < 1073741824) return `${(v / 1048576).toFixed(1)} MB`;
  return `${(v / 1073741824).toFixed(2)} GB`;
}

function formatSession(seconds) {
  const n = Number(seconds);
  if (!Number.isFinite(n) || n <= 0) return '—';
  if (n < 3600) return `${Math.round(n / 60)} min`;
  if (n < 86400) return `${(n / 3600).toFixed(n % 3600 === 0 ? 0 : 1)} hr`;
  return `${(n / 86400).toFixed(n % 86400 === 0 ? 0 : 1)} day`;
}

function voucherStatus(v) {
  const now = Date.now();
  if (v.validUntil && new Date(v.validUntil).getTime() < now) return 'expired';
  if (v.usedAt) return 'used';
  return 'unused';
}

export function HotspotPanel() {
  const [routers, setRouters] = useState([]);
  const [packages, setPackages] = useState([]);
  const [routerId, setRouterId] = useState('');
  const [packageId, setPackageId] = useState('');
  const [count, setCount] = useState(5);
  const [loading, setLoading] = useState(false);
  const [reconciling, setReconciling] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [generated, setGenerated] = useState([]);
  const [recent, setRecent] = useState([]);
  const [stats, setStats] = useState(null);
  const [statusFilter, setStatusFilter] = useState('');

  const loadMeta = useCallback(async () => {
    const statusQs = statusFilter ? `?status=${encodeURIComponent(statusFilter)}` : '';
    const [r, allPkgs, v, s] = await Promise.all([
      apiFetch('/api/routers'),
      apiFetch('/api/packages?all=1'),
      apiFetch(`/api/hotspot/vouchers${statusQs}`).catch(() => []),
      apiFetch('/api/hotspot/vouchers/stats').catch(() => null),
    ]);
    const p = (Array.isArray(allPkgs) ? allPkgs : []).filter((x) => x.kind === 'hotspot');
    setRouters(r);
    setPackages(p);
    setRecent(Array.isArray(v) ? v.slice(0, 80) : []);
    setStats(s);
    setRouterId((id) => id || (r[0]?._id ?? ''));
    setPackageId((pid) => {
      const sid = pid ? String(pid) : '';
      if (sid && p.some((x) => String(x._id) === sid)) return sid;
      return p[0]?._id ? String(p[0]._id) : '';
    });
  }, [statusFilter]);

  useEffect(() => {
    loadMeta().catch((e) => setError(e.message));
  }, [loadMeta]);

  async function onGenerate(e) {
    e.preventDefault();
    setError('');
    setInfo('');
    setLoading(true);
    setGenerated([]);
    try {
      const rows = await apiFetch('/api/hotspot/vouchers/generate', {
        method: 'POST',
        body: JSON.stringify({
          count: Number(count) || 1,
          packageId,
          routerId: routerId || undefined,
          pushToRouter: true,
        }),
      });
      setGenerated(rows);
      setInfo(`Generated ${rows.length} voucher${rows.length === 1 ? '' : 's'} and pushed to the router.`);
      await loadMeta();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function onReconcile() {
    setError('');
    setInfo('');
    setReconciling(true);
    try {
      const s = await apiFetch('/api/hotspot/vouchers/reconcile', { method: 'POST', body: '{}' });
      setInfo(
        `Usage synced — marked used: ${s.markedUsed ?? 0}, bytes updated: ${s.updatedBytes ?? 0}, exhausted removed: ${s.exhausted ?? 0}.`
      );
      await loadMeta();
    } catch (err) {
      setError(err.message);
    } finally {
      setReconciling(false);
    }
  }

  function exportCodes(rows) {
    const lines = ['code,profile,validUntil,status,dataLimit,sessionLimit,bytesIn,bytesOut,usedAt'];
    for (const v of rows) {
      lines.push(
        [
          v.code,
          v.profileName || '',
          v.validUntil || '',
          voucherStatus(v),
          v.dataLimitBytes ?? '',
          v.timeLimitSeconds ?? '',
          v.bytesIn ?? 0,
          v.bytesOut ?? 0,
          v.usedAt || '',
        ].join(',')
      );
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `hotspot-vouchers-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const selectedPkg = packages.find((p) => String(p._id) === String(packageId));

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-lg font-semibold text-white">Hotspot & vouchers</h2>
        <p className="mt-1 max-w-2xl text-sm text-slate-400">
          Launch branded hotspot experiences for cafés, campuses, communities and events. Generate
          time / volume packages, sync codes to MikroTik, and track usage from live sessions.
        </p>
      </div>

      {stats && (
        <div className="grid gap-3 sm:grid-cols-4">
          {[
            { label: 'Total', value: stats.total },
            { label: 'Unused', value: stats.unused },
            { label: 'Used', value: stats.used },
            { label: 'Expired', value: stats.expired },
          ].map((c) => (
            <div
              key={c.label}
              className="rounded-xl border border-slate-800 bg-slate-900/40 px-4 py-3"
            >
              <p className="text-xs uppercase tracking-wide text-slate-500">{c.label}</p>
              <p className="mt-1 text-2xl font-semibold text-white">{c.value ?? 0}</p>
            </div>
          ))}
        </div>
      )}

      <form
        onSubmit={onGenerate}
        className="space-y-5 rounded-2xl border border-slate-800 bg-slate-900/50 p-6 shadow-xl"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="mb-1.5 block font-medium text-slate-300">Router / venue</span>
            <select
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-slate-100 outline-none ring-emerald-500/40 focus:ring-2"
              value={routerId}
              onChange={(e) => setRouterId(e.target.value)}
              required
            >
              {routers.map((r) => (
                <option key={r._id} value={r._id}>
                  {routerDisplayName(r)} ({r.host})
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="mb-1.5 block font-medium text-slate-300">Hotspot package</span>
            <select
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-slate-100 outline-none ring-emerald-500/40 focus:ring-2"
              value={packageId}
              onChange={(e) => setPackageId(e.target.value)}
              required
            >
              {packages.length === 0 ? (
                <option value="">No packages — create one under Packages</option>
              ) : (
                packages.map((p) => (
                  <option key={p._id} value={p._id}>
                    {p.name} — {p.activeProfile}
                  </option>
                ))
              )}
            </select>
            {selectedPkg && (
              <span className="mt-1.5 block text-xs text-slate-500">
                Validity {selectedPkg.durationAmount ?? selectedPkg.durationDays ?? '—'}{' '}
                {selectedPkg.durationUnit || 'day'}
                {' · '}
                data {formatBytes(selectedPkg.dataLimitBytes)}
                {' · '}
                session {formatSession(selectedPkg.timeLimitSeconds)}
              </span>
            )}
          </label>
        </div>

        <label className="block text-sm">
          <span className="mb-1.5 block font-medium text-slate-300">How many codes</span>
          <input
            type="number"
            min={1}
            max={100}
            value={count}
            onChange={(e) => setCount(e.target.value)}
            className="w-full max-w-xs rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 outline-none ring-emerald-500/40 focus:ring-2"
          />
        </label>

        {error && (
          <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
            {error}
          </p>
        )}
        {info && (
          <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
            {info}
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          <button
            type="submit"
            disabled={loading || !routers.length || !packages.length}
            className="rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-emerald-900/30 transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? 'Generating…' : 'Generate & push to router'}
          </button>
          <button
            type="button"
            disabled={reconciling}
            onClick={onReconcile}
            className="rounded-lg border border-slate-600 px-4 py-2.5 text-sm text-slate-200 hover:bg-slate-800 disabled:opacity-50"
          >
            {reconciling ? 'Syncing usage…' : 'Sync usage from routers'}
          </button>
        </div>
      </form>

      {generated.length > 0 && (
        <section>
          <div className="mb-3 flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
              New codes
            </h3>
            <button
              type="button"
              onClick={() => exportCodes(generated)}
              className="text-xs text-indigo-300 hover:text-indigo-200"
            >
              Export CSV
            </button>
          </div>
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {generated.map((row) => (
              <li
                key={row.id}
                className="rounded-lg border border-slate-800 bg-slate-900/80 px-4 py-3 font-mono text-sm text-emerald-300"
              >
                {row.code}
                {row.validUntil && (
                  <span className="mt-1 block text-xs font-sans text-slate-500">
                    valid until {new Date(row.validUntil).toLocaleString()}
                  </span>
                )}
                {(row.dataLimitBytes || row.timeLimitSeconds) && (
                  <span className="mt-1 block text-xs font-sans text-slate-500">
                    {formatBytes(row.dataLimitBytes)} · {formatSession(row.timeLimitSeconds)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Vouchers
          </h3>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-300"
            >
              <option value="">All</option>
              <option value="unused">Unused</option>
              <option value="used">Used</option>
              <option value="expired">Expired</option>
            </select>
            <button
              type="button"
              onClick={() => exportCodes(recent)}
              disabled={!recent.length}
              className="text-xs text-indigo-300 hover:text-indigo-200 disabled:opacity-40"
            >
              Export CSV
            </button>
          </div>
        </div>
        <div className="overflow-x-auto rounded-xl border border-slate-800">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="bg-slate-900 text-slate-400">
              <tr>
                <th className="px-4 py-3 font-medium">Code</th>
                <th className="px-4 py-3 font-medium">Package</th>
                <th className="px-4 py-3 font-medium">Limits</th>
                <th className="px-4 py-3 font-medium">Usage</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Valid until</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800 bg-slate-950/50">
              {recent.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-slate-500">
                    No vouchers yet.
                  </td>
                </tr>
              ) : (
                recent.map((v) => {
                  const st = voucherStatus(v);
                  return (
                    <tr key={v._id} className="text-slate-300">
                      <td className="px-4 py-2 font-mono text-emerald-400">{v.code}</td>
                      <td className="px-4 py-2 text-slate-400">
                        {v.packageId?.name || v.profileName || '—'}
                      </td>
                      <td className="px-4 py-2 text-xs text-slate-500">
                        {formatBytes(v.dataLimitBytes)} · {formatSession(v.timeLimitSeconds)}
                      </td>
                      <td className="px-4 py-2 text-xs text-slate-500">
                        ↓ {formatBytes(v.bytesIn)} · ↑ {formatBytes(v.bytesOut)}
                      </td>
                      <td className="px-4 py-2">
                        <span
                          className={`rounded-md px-2 py-0.5 text-xs ${
                            st === 'unused'
                              ? 'bg-emerald-950 text-emerald-300'
                              : st === 'used'
                                ? 'bg-indigo-950 text-indigo-300'
                                : 'bg-slate-800 text-slate-400'
                          }`}
                        >
                          {st}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-slate-500">
                        {v.validUntil ? new Date(v.validUntil).toLocaleString() : '—'}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
