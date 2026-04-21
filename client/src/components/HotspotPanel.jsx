import { useEffect, useState } from 'react';
import { apiFetch } from '../api.js';
import { routerDisplayName } from '../utils/routerDisplayName.js';

export function HotspotPanel() {
  const [routers, setRouters] = useState([]);
  const [packages, setPackages] = useState([]);
  const [routerId, setRouterId] = useState('');
  const [packageId, setPackageId] = useState('');
  const [count, setCount] = useState(5);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [generated, setGenerated] = useState([]);
  const [recent, setRecent] = useState([]);

  async function loadMeta() {
    const [r, allPkgs, v] = await Promise.all([
      apiFetch('/api/routers'),
      apiFetch('/api/packages?all=1'),
      apiFetch('/api/hotspot/vouchers').catch(() => []),
    ]);
    const p = (Array.isArray(allPkgs) ? allPkgs : []).filter((x) => x.kind === 'hotspot');
    setRouters(r);
    setPackages(p);
    setRecent(Array.isArray(v) ? v.slice(0, 30) : []);
    setRouterId((id) => id || (r[0]?._id ?? ''));
    setPackageId((pid) => {
      const sid = pid ? String(pid) : '';
      if (sid && p.some((x) => String(x._id) === sid)) return sid;
      return p[0]?._id ? String(p[0]._id) : '';
    });
  }

  useEffect(() => {
    loadMeta().catch((e) => setError(e.message));
  }, []);

  async function onGenerate(e) {
    e.preventDefault();
    setError('');
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
      await loadMeta();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
        Hotspot vouchers
      </h2>
      <p className="mb-6 text-sm text-slate-400">
        QareFi keeps vouchers in the database and syncs them to your MikroTik hotspot users.
      </p>

      <form
        onSubmit={onGenerate}
        className="space-y-5 rounded-2xl border border-slate-800 bg-slate-900/50 p-6 shadow-xl"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="mb-1.5 block font-medium text-slate-300">Router</span>
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
                <option value="">No packages — create one via API</option>
              ) : (
                packages.map((p) => (
                  <option key={p._id} value={p._id}>
                    {p.name} — {p.activeProfile}
                  </option>
                ))
              )}
            </select>
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

        <button
          type="submit"
          disabled={loading || !routers.length || !packages.length}
          className="rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-emerald-900/30 transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? 'Generating…' : 'Generate & push to router'}
        </button>
      </form>

      {generated.length > 0 && (
        <section className="mt-10">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
            New codes
          </h3>
          <ul className="grid gap-2 sm:grid-cols-2">
            {generated.map((row) => (
              <li
                key={row.id}
                className="rounded-lg border border-slate-800 bg-slate-900/80 px-4 py-3 font-mono text-sm text-emerald-300"
              >
                {row.code}
                {row.validUntil && (
                  <span className="mt-1 block text-xs font-sans text-slate-500">
                    valid until {new Date(row.validUntil).toLocaleDateString()}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-12">
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Recent vouchers
        </h3>
        <div className="overflow-hidden rounded-xl border border-slate-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-900 text-slate-400">
              <tr>
                <th className="px-4 py-3 font-medium">Code</th>
                <th className="px-4 py-3 font-medium">Profile</th>
                <th className="px-4 py-3 font-medium">Valid until</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800 bg-slate-950/50">
              {recent.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-4 py-6 text-center text-slate-500">
                    No vouchers yet.
                  </td>
                </tr>
              ) : (
                recent.map((v) => (
                  <tr key={v._id} className="text-slate-300">
                    <td className="px-4 py-2 font-mono text-emerald-400">{v.code}</td>
                    <td className="px-4 py-2">{v.profileName}</td>
                    <td className="px-4 py-2 text-slate-500">
                      {v.validUntil ? new Date(v.validUntil).toLocaleString() : '—'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
