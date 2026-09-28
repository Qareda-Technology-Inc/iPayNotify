import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../api.js';
import { routerDisplayName } from '../utils/routerDisplayName.js';
import { downloadVouchersPdf } from '../utils/exportVouchersPdf.js';
import { VOUCHER_DESIGNS } from '../portal/designs.js';

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

function packageClockLabel(pkg) {
  if (!pkg) return '';
  const type = pkg.ticketDurationType || 'elapsed';
  if (type === 'paused') {
    return `Online ${formatSession(pkg.pausedSeconds ?? pkg.timeLimitSeconds)}`;
  }
  return `Valid ${formatSession(pkg.elapsedSeconds)}`;
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
  const [servers, setServers] = useState([]);
  const [serversLoading, setServersLoading] = useState(false);
  const [routerId, setRouterId] = useState('');
  const [hotspotServer, setHotspotServer] = useState('');
  const [packageId, setPackageId] = useState('');
  const [count, setCount] = useState(10);
  const [preview, setPreview] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [reconciling, setReconciling] = useState(false);
  const [syncingScheduler, setSyncingScheduler] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [generated, setGenerated] = useState([]);
  const [recent, setRecent] = useState([]);
  const [stats, setStats] = useState(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [printDesign, setPrintDesign] = useState('grid');
  const [printTitle, setPrintTitle] = useState('');

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

  useEffect(() => {
    apiFetch('/api/organization')
      .then((o) => {
        const id = o?.billing?.voucherDesign;
        if (VOUCHER_DESIGNS.some((d) => d.id === id)) setPrintDesign(id);
        setPrintTitle(String(o?.billing?.voucherTitle || '').trim());
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!routerId) {
      setServers([]);
      setHotspotServer('');
      return;
    }
    let cancelled = false;
    setServersLoading(true);
    setError('');
    apiFetch(`/api/hotspot/routers/${routerId}/servers`)
      .then((data) => {
        if (cancelled) return;
        const list = Array.isArray(data?.servers) ? data.servers : [];
        setServers(list);
        setHotspotServer((cur) => {
          if (cur && list.some((s) => s.name === cur)) return cur;
          const first = list.find((s) => !s.disabled) || list[0];
          return first?.name || '';
        });
      })
      .catch((e) => {
        if (cancelled) return;
        setServers([]);
        setHotspotServer('');
        setError(e.message || 'Could not load hotspot servers');
      })
      .finally(() => {
        if (!cancelled) setServersLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [routerId]);

  useEffect(() => {
    setPreview(null);
  }, [routerId, hotspotServer, packageId, count]);

  async function onPreview(e) {
    e.preventDefault();
    setError('');
    setInfo('');
    setGenerated([]);
    if (!routerId || !packageId) {
      setError('Select a router and internet plan.');
      return;
    }
    if (!hotspotServer) {
      setError('Select a hotspot server on the router.');
      return;
    }
    setPreviewing(true);
    try {
      const data = await apiFetch('/api/hotspot/vouchers/preview', {
        method: 'POST',
        body: JSON.stringify({
          count: Number(count) || 1,
          packageId,
          routerId,
          hotspotServer,
        }),
      });
      setPreview(data);
      setInfo(`Preview ready — ${data.codes?.length || 0} unique 6-digit codes. Confirm to create.`);
    } catch (err) {
      setError(err.message);
      setPreview(null);
    } finally {
      setPreviewing(false);
    }
  }

  async function onConfirmCreate() {
    if (!preview?.codes?.length) {
      setError('Preview codes first.');
      return;
    }
    setError('');
    setInfo('');
    setLoading(true);
    try {
      const rows = await apiFetch('/api/hotspot/vouchers/generate', {
        method: 'POST',
        body: JSON.stringify({
          count: preview.codes.length,
          packageId,
          routerId,
          hotspotServer,
          codes: preview.codes,
          pushToRouter: true,
        }),
      });
      setGenerated(rows);
      setPreview(null);
      const pushed = rows.filter((r) => r.pushedToRouter).length;
      setInfo(
        `Created ${rows.length} voucher${rows.length === 1 ? '' : 's'} on server “${hotspotServer}”. ` +
          `Package profile “${rows[0]?.profileName || selectedPkg?.name || '—'}” pushed to router. ` +
          `Users pushed: ${pushed}/${rows.length}.`
      );
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
        `Usage synced — marked used: ${s.markedUsed ?? 0}, MAC locked: ${s.macLocked ?? 0}, bytes updated: ${s.updatedBytes ?? 0}, exhausted removed: ${s.exhausted ?? 0}.`
      );
      await loadMeta();
    } catch (err) {
      setError(err.message);
    } finally {
      setReconciling(false);
    }
  }

  async function onSyncExpiryScheduler() {
    if (!routerId) {
      setError('Select a router first.');
      return;
    }
    setError('');
    setInfo('');
    setSyncingScheduler(true);
    try {
      const r = await apiFetch(`/api/hotspot/routers/${routerId}/sync-expiry-scheduler`, {
        method: 'POST',
        body: '{}',
      });
      setInfo(
        `Expiry scheduler installed on ${r.routerName || 'router'} — script “${r.script}” runs every ${r.interval || '1m'}.`
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setSyncingScheduler(false);
    }
  }

  function exportVouchers(rows) {
    setError('');
    try {
      const router = routers.find((r) => String(r._id) === String(routerId));
      const pkg = packages.find((p) => String(p._id) === String(packageId));
      downloadVouchersPdf(rows, {
        title: printTitle || 'Wi‑Fi Access',
        venue: routerDisplayName(router) || '',
        packageName: pkg?.name || '',
        server: hotspotServer || '',
        design: printDesign,
        filename: `vouchers-${printDesign}-${(pkg?.name || 'hotspot').replace(/\s+/g, '-').toLowerCase()}-${Date.now()}.pdf`,
      });
      setInfo(`Downloaded ${rows.length} voucher${rows.length === 1 ? '' : 's'} as PDF.`);
    } catch (err) {
      setError(err.message || 'Could not create PDF');
    }
  }

  const selectedPkg = packages.find((p) => String(p._id) === String(packageId));
  const canPreview =
    Boolean(routerId && packageId && hotspotServer) && !serversLoading && packages.length > 0;

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-lg font-semibold text-white">Hotspot & vouchers</h2>
        <p className="mt-1 max-w-2xl text-sm text-slate-400">
          Pick a router, its hotspot server, an internet plan, and quantity. Preview unique 6-digit
          codes, then create and push them to MikroTik. Login page and print layout live under{' '}
          <Link to="/hotspot/portal" className="text-indigo-300 hover:text-indigo-200">
            Captive portal
          </Link>
          .
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
        onSubmit={onPreview}
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
            <span className="mb-1.5 block font-medium text-slate-300">Hotspot server</span>
            <select
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-slate-100 outline-none ring-emerald-500/40 focus:ring-2"
              value={hotspotServer}
              onChange={(e) => setHotspotServer(e.target.value)}
              required
              disabled={serversLoading || !servers.length}
            >
              {serversLoading ? (
                <option value="">Loading servers…</option>
              ) : servers.length === 0 ? (
                <option value="">No hotspot server on this router</option>
              ) : (
                servers.map((s) => (
                  <option key={s.name} value={s.name} disabled={s.disabled}>
                    {s.name}
                    {s.disabled ? ' (disabled)' : ''}
                  </option>
                ))
              )}
            </select>
          </label>

          <label className="block text-sm">
            <span className="mb-1.5 block font-medium text-slate-300">Internet plan (package)</span>
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
                    {p.name}
                  </option>
                ))
              )}
            </select>
            {selectedPkg && (
              <span className="mt-1.5 block text-xs text-slate-500">
                {packageClockLabel(selectedPkg)}
                {' · '}
                data {formatBytes(selectedPkg.dataLimitBytes)}
                {' · '}
                profile {selectedPkg.activeProfile || selectedPkg.name || 'default'}
                {selectedPkg.usersPerTicket > 1
                  ? ` · ${selectedPkg.usersPerTicket} devices`
                  : ''}
              </span>
            )}
          </label>

          <label className="block text-sm">
            <span className="mb-1.5 block font-medium text-slate-300">Quantity</span>
            <input
              type="number"
              min={1}
              max={100}
              value={count}
              onChange={(e) => setCount(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 outline-none ring-emerald-500/40 focus:ring-2"
            />
            <span className="mt-1.5 block text-xs text-slate-500">
              Unique 6-digit numeric codes (100000–999999)
            </span>
          </label>
        </div>

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
            disabled={previewing || loading || !canPreview}
            className="rounded-lg border border-emerald-600/60 bg-emerald-950/40 px-5 py-2.5 text-sm font-semibold text-emerald-100 transition hover:bg-emerald-900/50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {previewing ? 'Previewing…' : 'Preview codes'}
          </button>
          <button
            type="button"
            disabled={loading || !preview?.codes?.length}
            onClick={onConfirmCreate}
            className="rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-emerald-900/30 transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? 'Creating…' : `Create ${preview?.codes?.length || ''} vouchers`}
          </button>
          <button
            type="button"
            disabled={reconciling}
            onClick={onReconcile}
            className="rounded-lg border border-slate-600 px-4 py-2.5 text-sm text-slate-200 hover:bg-slate-800 disabled:opacity-50"
          >
            {reconciling ? 'Syncing usage…' : 'Sync usage'}
          </button>
          <button
            type="button"
            disabled={syncingScheduler || !routerId}
            onClick={onSyncExpiryScheduler}
            className="rounded-lg border border-amber-600/50 px-4 py-2.5 text-sm text-amber-100 hover:bg-amber-950/40 disabled:opacity-50"
          >
            {syncingScheduler ? 'Installing…' : 'Sync expiry scheduler'}
          </button>
        </div>
      </form>

      {preview?.codes?.length > 0 && (
        <section className="rounded-2xl border border-dashed border-emerald-700/50 bg-emerald-950/20 p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-emerald-200">
              Preview — {preview.codes.length} codes (not created yet)
            </h3>
            <p className="text-xs text-slate-400">
              {preview.package?.name}
              {preview.hotspotServer ? ` · ${preview.hotspotServer}` : ''}
              {preview.router?.name ? ` · ${preview.router.name}` : ''}
            </p>
          </div>
          <ul className="grid gap-2 sm:grid-cols-4 lg:grid-cols-6">
            {preview.codes.map((code) => (
              <li
                key={code}
                className="rounded-lg border border-slate-700 bg-slate-950/80 px-3 py-2 text-center font-mono text-lg tracking-widest text-emerald-300"
              >
                {code}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-slate-500">
            Confirm to save these exact codes and push them to the router under the selected hotspot
            server.
          </p>
        </section>
      )}

      {generated.length > 0 && (
        <section>
          <div className="mb-3 flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
              Created codes
            </h3>
            <button
              type="button"
              onClick={() => exportVouchers(generated)}
              className="text-xs text-indigo-300 hover:text-indigo-200"
            >
              Download PDF vouchers
            </button>
          </div>
          <ul className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {generated.map((row) => (
              <li
                key={row.id}
                className="rounded-lg border border-slate-800 bg-slate-900/80 px-4 py-3 text-center font-mono text-lg tracking-widest text-emerald-300"
              >
                {row.code}
                {row.hotspotServer && (
                  <span className="mt-1 block text-xs font-sans tracking-normal text-slate-500">
                    {row.hotspotServer}
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
            <label className="flex items-center gap-2 text-xs text-slate-400">
              Print design
              <select
                value={printDesign}
                onChange={(e) => setPrintDesign(e.target.value)}
                className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-300"
              >
                {VOUCHER_DESIGNS.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
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
              onClick={() => exportVouchers(recent)}
              disabled={!recent.length}
              className="text-xs text-indigo-300 hover:text-indigo-200 disabled:opacity-40"
            >
              Download PDF vouchers
            </button>
          </div>
        </div>
        <div className="overflow-x-auto rounded-xl border border-slate-800">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="bg-slate-900 text-slate-400">
              <tr>
                <th className="px-4 py-3 font-medium">Code</th>
                <th className="px-4 py-3 font-medium">Server</th>
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
                  <td colSpan={7} className="px-4 py-6 text-center text-slate-500">
                    No vouchers yet.
                  </td>
                </tr>
              ) : (
                recent.map((v) => {
                  const st = voucherStatus(v);
                  return (
                    <tr key={v._id} className="text-slate-300">
                      <td className="px-4 py-2 font-mono text-lg tracking-wider text-emerald-400">
                        {v.code}
                      </td>
                      <td className="px-4 py-2 text-xs text-slate-500">
                        {v.hotspotServer || '—'}
                      </td>
                      <td className="px-4 py-2 text-slate-400">
                        {v.packageId?.name || v.profileName || '—'}
                      </td>
                      <td className="px-4 py-2 text-xs text-slate-500">
                        {formatBytes(v.dataLimitBytes)} ·{' '}
                        {v.elapsedSeconds
                          ? formatSession(v.elapsedSeconds)
                          : formatSession(v.timeLimitSeconds)}
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
