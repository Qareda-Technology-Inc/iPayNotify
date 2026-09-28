import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../api.js';

function IconRefresh({ className }) {
  return (
    <svg className={className} width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 12a8 8 0 0113.657-5.657M20 12a8 8 0 01-13.657 5.657M4 12H1m19 0h-3M4 12l2-2m14 2l-2-2"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ActiveUsersPage() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [routerFilter, setRouterFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('all'); // all | hotspot | ppp
  const [search, setSearch] = useState('');
  const [autoRefresh, setAutoRefresh] = useState(true);

  const load = useCallback(async ({ soft = false } = {}) => {
    setErr('');
    if (soft) setRefreshing(true);
    else setLoading(true);
    try {
      const d = await apiFetch('/api/routers/active-sessions');
      setData(d);
    } catch (e) {
      setErr(e.message || 'Could not load sessions');
      if (!soft) setData(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!autoRefresh) return undefined;
    const id = setInterval(() => {
      load({ soft: true });
    }, 45000);
    return () => clearInterval(id);
  }, [autoRefresh, load]);

  const allRouters = data?.routers || [];
  const allErrored =
    allRouters.length > 0 && allRouters.every((r) => Boolean(r.error));

  const routers = useMemo(() => {
    let list = allRouters;
    if (routerFilter) list = list.filter((r) => r.routerId === routerFilter);
    const q = search.trim().toLowerCase();
    return list.map((r) => {
      let hotspot = r.hotspotActive || [];
      let ppp = r.pppActive || [];
      if (typeFilter === 'hotspot') ppp = [];
      if (typeFilter === 'ppp') hotspot = [];
      if (q) {
        hotspot = hotspot.filter((row) =>
          String(row.user || '')
            .toLowerCase()
            .includes(q)
        );
        ppp = ppp.filter((row) =>
          String(row.secret || '')
            .toLowerCase()
            .includes(q)
        );
      }
      return { ...r, hotspotActive: hotspot, pppActive: ppp };
    });
  }, [allRouters, routerFilter, typeFilter, search]);

  const filteredTotals = useMemo(() => {
    let hotspot = 0;
    let ppp = 0;
    for (const r of routers) {
      hotspot += r.hotspotActive?.length || 0;
      ppp += r.pppActive?.length || 0;
    }
    return { hotspot, ppp, all: hotspot + ppp };
  }, [routers]);

  const totals = data?.totals;

  return (
    <div className="mx-auto max-w-6xl">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">Active users</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-400">
            Live Hotspot and PPPoE sessions from each site. Refresh keeps the last snapshot visible.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex items-center gap-2 text-xs text-slate-400">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
            />
            Auto-refresh
          </label>
          <button
            type="button"
            disabled={loading || refreshing}
            onClick={() => load({ soft: Boolean(data) })}
            className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-slate-600/80 bg-slate-800/50 px-4 py-2.5 text-sm font-medium text-slate-200 transition hover:border-slate-500 hover:bg-slate-800 disabled:opacity-50"
          >
            <IconRefresh
              className={loading || refreshing ? 'animate-spin text-slate-400' : 'text-slate-400'}
            />
            {refreshing ? 'Refreshing…' : loading ? 'Loading…' : 'Refresh live'}
          </button>
        </div>
      </div>

      {err && (
        <p
          className="mt-6 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200"
          role="alert"
        >
          {err}
        </p>
      )}

      {allErrored && !err ? (
        <p className="mt-6 rounded-xl border border-amber-500/35 bg-amber-950/25 px-4 py-3 text-sm text-amber-100">
          Every site returned an error — check router credentials or VPN, then refresh.
        </p>
      ) : null}

      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        <label className="block text-sm text-slate-400">
          Site
          <select
            value={routerFilter}
            onChange={(e) => setRouterFilter(e.target.value)}
            className="mt-1 block w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-200 sm:w-48"
          >
            <option value="">All sites</option>
            {allRouters.map((r) => (
              <option key={r.routerId} value={r.routerId}>
                {r.routerName}
              </option>
            ))}
          </select>
        </label>
        <div className="flex gap-1 rounded-xl bg-slate-950 p-1">
          {[
            { id: 'all', label: 'All' },
            { id: 'hotspot', label: 'Hotspot' },
            { id: 'ppp', label: 'PPPoE' },
          ].map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTypeFilter(t.id)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
                typeFilter === t.id ? 'bg-slate-700 text-white' : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <label className="block min-w-0 flex-1 text-sm text-slate-400 sm:max-w-xs">
          Search user
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter username…"
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-white"
          />
        </label>
      </div>

      {(data || loading) && (
        <div className="mt-6">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-slate-600/60 bg-slate-900/60 px-4 py-3">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                {search || typeFilter !== 'all' || routerFilter ? 'Matching' : 'Total live'}
              </p>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-white">
                {data
                  ? search || typeFilter !== 'all' || routerFilter
                    ? filteredTotals.all
                    : totals?.all ?? filteredTotals.all
                  : '—'}
              </p>
            </div>
            <div className="rounded-xl border border-cyan-500/30 bg-cyan-950/25 px-4 py-3">
              <p className="text-xs font-medium uppercase tracking-wide text-cyan-400/90">Hotspot</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-cyan-100">
                {data
                  ? search || typeFilter !== 'all' || routerFilter
                    ? filteredTotals.hotspot
                    : totals?.hotspot ?? 0
                  : '—'}
              </p>
            </div>
            <div className="rounded-xl border border-violet-500/30 bg-violet-950/25 px-4 py-3">
              <p className="text-xs font-medium uppercase tracking-wide text-violet-400/90">PPPoE</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-violet-100">
                {data
                  ? search || typeFilter !== 'all' || routerFilter
                    ? filteredTotals.ppp
                    : totals?.ppp ?? 0
                  : '—'}
              </p>
            </div>
          </div>
          {data?.at && (
            <p className="mt-2 text-xs text-slate-500">
              Snapshot: {new Date(data.at).toLocaleString()}
              {refreshing ? ' · updating…' : ''}
            </p>
          )}
        </div>
      )}

      <div className="mt-8 space-y-6">
        {loading && !data ? (
          <div className="space-y-3">
            {[0, 1].map((i) => (
              <div
                key={i}
                className="h-40 animate-pulse rounded-2xl border border-slate-800 bg-slate-900/40"
              />
            ))}
          </div>
        ) : (
          routers.map((r) => (
            <section
              key={r.routerId}
              className="overflow-hidden rounded-2xl border border-slate-800/90 bg-slate-900/40 shadow-lg shadow-black/20"
            >
              <div className="border-b border-slate-800 bg-slate-900/80 px-4 py-4 sm:px-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="truncate text-lg font-medium text-white">{r.routerName}</h2>
                    <p className="mt-0.5 truncate font-mono text-xs text-slate-500">{r.host}</p>
                  </div>
                  <div className="grid w-full grid-cols-3 gap-2 sm:w-auto sm:min-w-[22rem]">
                    {[
                      ['Identity', r.details?.identity],
                      ['Version', r.details?.version],
                      ['Uptime', r.details?.uptime],
                    ].map(([label, value]) => (
                      <div
                        key={label}
                        className="h-14 overflow-auto rounded-lg border border-slate-800 bg-slate-950/50 px-2.5 py-1.5"
                      >
                        <span className="text-[10px] uppercase tracking-wide text-slate-600">{label}</span>
                        <p className="whitespace-nowrap text-xs font-medium text-slate-200">
                          {value && value !== '—' ? value : '—'}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
                {r.error && (
                  <p className="mt-2 rounded-lg border border-amber-500/35 bg-amber-950/30 px-3 py-2 text-sm text-amber-200">
                    {r.error}
                  </p>
                )}
                {!r.error &&
                  (r.hotspotActive?.length ?? 0) === 0 &&
                  (r.pppActive?.length ?? 0) === 0 && (
                    <p className="mt-2 text-xs text-slate-500">
                      No matching live Hotspot or PPPoE sessions.
                    </p>
                  )}
              </div>

              <div
                className={`grid items-stretch gap-4 p-4 sm:p-5 ${
                  typeFilter === 'all' ? 'lg:grid-cols-2' : 'grid-cols-1'
                }`}
              >
                {typeFilter !== 'ppp' ? (
                  <div className="flex min-h-0 min-w-0 flex-col">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-cyan-500/90">
                      Hotspot active ({r.hotspotActive?.length ?? 0})
                    </h3>
                    <div className="mt-2 h-72 overflow-auto rounded-xl border border-slate-800">
                      <table className="w-full table-fixed text-left text-sm">
                        <thead className="sticky top-0 z-10 border-b border-slate-800 bg-slate-950 text-xs text-slate-500">
                          <tr>
                            <th className="w-1/3 px-3 py-2">User</th>
                            <th className="w-1/3 px-3 py-2">Uptime</th>
                            <th className="w-1/3 px-3 py-2">Quota</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/80 text-slate-300">
                          {(r.hotspotActive || []).length === 0 ? (
                            <tr>
                              <td colSpan={3} className="px-3 py-6 text-center text-slate-500">
                                No hotspot sessions
                              </td>
                            </tr>
                          ) : (
                            r.hotspotActive.map((row, i) => (
                              <tr key={row.id || `${row.user}-${row.address}-${i}`}>
                                <td className="px-3 py-2 align-top">
                                  <div className="overflow-x-auto whitespace-nowrap font-mono text-sm text-cyan-200/90">
                                    {row.user || '—'}
                                  </div>
                                </td>
                                <td className="px-3 py-2 align-top">
                                  <div className="overflow-x-auto whitespace-nowrap text-xs text-slate-300">
                                    {row.uptime || '—'}
                                  </div>
                                  {row.timeLeft ? (
                                    <div className="overflow-x-auto whitespace-nowrap text-[11px] text-slate-500">
                                      left {row.timeLeft}
                                    </div>
                                  ) : null}
                                </td>
                                <td className="px-3 py-2 align-top">
                                  <div className="overflow-x-auto whitespace-nowrap font-mono text-xs text-slate-300">
                                    {row.quota || '—'}
                                  </div>
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : null}

                {typeFilter !== 'hotspot' ? (
                  <div className="flex min-h-0 min-w-0 flex-col">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-violet-500/90">
                      PPPoE active ({r.pppActive?.length ?? 0})
                    </h3>
                    <div className="mt-2 h-72 overflow-auto rounded-xl border border-slate-800">
                      <table className="w-full table-fixed text-left text-sm">
                        <thead className="sticky top-0 z-10 border-b border-slate-800 bg-slate-950 text-xs text-slate-500">
                          <tr>
                            <th className="w-1/3 px-3 py-2">Username</th>
                            <th className="w-1/3 px-3 py-2">IP</th>
                            <th className="w-1/3 px-3 py-2">Uptime</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/80 text-slate-300">
                          {(r.pppActive || []).length === 0 ? (
                            <tr>
                              <td colSpan={3} className="px-3 py-6 text-center text-slate-500">
                                No PPPoE sessions
                              </td>
                            </tr>
                          ) : (
                            r.pppActive.map((row, i) => (
                              <tr key={row.id || `${row.secret}-${i}`}>
                                <td className="px-3 py-2 align-top">
                                  <div className="overflow-x-auto whitespace-nowrap font-mono text-sm text-violet-200/90">
                                    {row.secret || '—'}
                                  </div>
                                </td>
                                <td className="px-3 py-2 align-top">
                                  <div className="overflow-x-auto whitespace-nowrap font-mono text-xs">
                                    {row.address || '—'}
                                  </div>
                                </td>
                                <td className="px-3 py-2 align-top">
                                  <div className="overflow-x-auto whitespace-nowrap text-xs text-slate-400">
                                    {row.uptime || '—'}
                                  </div>
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : null}
              </div>
            </section>
          ))
        )}

        {!loading && routers.length === 0 && !err && (
          <p className="text-center text-sm text-slate-500">
            No routers configured. Add one under Network → Routers.
          </p>
        )}
      </div>
    </div>
  );
}
