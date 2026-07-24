import { useCallback, useEffect, useState } from 'react';
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

  const load = useCallback(async () => {
    setErr('');
    setLoading(true);
    try {
      const d = await apiFetch('/api/routers/active-sessions');
      setData(d);
    } catch (e) {
      setErr(e.message || 'Could not load sessions');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const totals = data?.totals;
  const routers = data?.routers || [];

  return (
    <div className="mx-auto max-w-6xl">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">Active users</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-400">
            Live sessions per MikroTik router. <strong className="text-slate-300">Hotspot</strong> uses{' '}
            <span className="font-mono text-slate-500">/ip/hotspot/active</span>;{' '}
            <strong className="text-slate-300">PPP</strong> uses <span className="font-mono text-slate-500">/ppp/active</span>{' '}
            (PPPoE, L2TP, etc.). Hotspot and PPP are queried separately — if Hotspot is not installed or the API user cannot
            read it, PPP sessions can still appear. With transport SSH, long lists use{' '}
            <span className="font-mono text-slate-500">print as-value</span>. Add every site as its own router row to see all customers.
          </p>
        </div>
        <button
          type="button"
          disabled={loading}
          onClick={() => load()}
          className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-slate-600/80 bg-slate-800/50 px-4 py-2.5 text-sm font-medium text-slate-200 transition hover:border-slate-500 hover:bg-slate-800 disabled:opacity-50"
        >
          <IconRefresh className={loading ? 'animate-spin text-slate-400' : 'text-slate-400'} />
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {err && (
        <p className="mt-6 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200" role="alert">
          {err}
        </p>
      )}

      {!loading && data && (
        <div className="mt-6 flex flex-wrap gap-4 text-sm">
          <div className="rounded-xl border border-slate-600/60 bg-slate-900/60 px-4 py-3">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Total live sessions</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-white">
              {totals?.all ?? (Number(totals?.hotspot ?? 0) + Number(totals?.ppp ?? 0))}
            </p>
          </div>
          <div className="rounded-xl border border-cyan-500/30 bg-cyan-950/25 px-4 py-3">
            <p className="text-xs font-medium uppercase tracking-wide text-cyan-400/90">Hotspot online</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-cyan-100">{totals?.hotspot ?? 0}</p>
          </div>
          <div className="rounded-xl border border-violet-500/30 bg-violet-950/25 px-4 py-3">
            <p className="text-xs font-medium uppercase tracking-wide text-violet-400/90">PPP active</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-violet-100">{totals?.ppp ?? 0}</p>
          </div>
          {data.at && (
            <p className="self-end text-xs text-slate-500">
              Snapshot: {new Date(data.at).toLocaleString()}
            </p>
          )}
        </div>
      )}

      <div className="mt-8 space-y-6">
        {loading && !data ? (
          <p className="text-sm text-slate-500">Loading routers…</p>
        ) : (
          routers.map((r) => (
            <section
              key={r.routerId}
              className="overflow-hidden rounded-2xl border border-slate-800/90 bg-slate-900/40 shadow-lg shadow-black/20"
            >
              <div className="border-b border-slate-800 bg-slate-900/80 px-5 py-4">
                <h2 className="text-lg font-medium text-white">{r.routerName}</h2>
                <p className="mt-0.5 font-mono text-xs text-slate-500">{r.host}</p>
                {r.error && (
                  <p className="mt-2 rounded-lg border border-amber-500/35 bg-amber-950/30 px-3 py-2 text-sm text-amber-200">
                    {r.error}
                  </p>
                )}
                {!r.error &&
                  (r.hotspotActive?.length ?? 0) === 0 &&
                  (r.pppActive?.length ?? 0) === 0 && (
                    <p className="mt-2 text-xs text-slate-500">
                      Router reachable — no live Hotspot or PPP sessions right now.
                    </p>
                  )}
              </div>

              <div className="grid gap-6 p-5 lg:grid-cols-2">
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-cyan-500/90">
                    Hotspot active ({r.hotspotActive?.length ?? 0})
                  </h3>
                  <div className="mt-2 overflow-x-auto rounded-xl border border-slate-800">
                    <table className="w-full table-fixed text-left text-sm">
                      <colgroup>
                        <col className="w-[28%]" />
                        <col className="w-[22%]" />
                        <col className="w-[50%]" />
                      </colgroup>
                      <thead className="border-b border-slate-800 bg-slate-950/80 text-xs text-slate-500">
                        <tr>
                          <th className="px-3 py-2">User</th>
                          <th className="px-3 py-2">Uptime</th>
                          <th className="px-3 py-2">Statistics</th>
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
                            <tr key={row.id || `${row.user}-${i}`}>
                              <td className="px-3 py-2 font-mono text-sm text-cyan-200/90">{row.user}</td>
                              <td className="px-3 py-2 text-xs text-slate-400">{row.uptime}</td>
                              <td className="px-3 py-2 font-mono text-xs text-slate-400">{row.statistics}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-violet-500/90">
                    PPP active ({r.pppActive?.length ?? 0})
                  </h3>
                  <div className="mt-2 overflow-x-auto rounded-xl border border-slate-800">
                    <table className="w-full table-fixed text-left text-sm">
                      <colgroup>
                        <col className="w-[32%]" />
                        <col className="w-[28%]" />
                        <col className="w-[40%]" />
                      </colgroup>
                      <thead className="border-b border-slate-800 bg-slate-950/80 text-xs text-slate-500">
                        <tr>
                          <th className="px-3 py-2">Secret</th>
                          <th className="px-3 py-2">Address</th>
                          <th className="px-3 py-2">Uptime</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/80 text-slate-300">
                        {(r.pppActive || []).length === 0 ? (
                          <tr>
                            <td colSpan={3} className="px-3 py-6 text-center text-slate-500">
                              No PPP sessions
                            </td>
                          </tr>
                        ) : (
                          r.pppActive.map((row, i) => (
                            <tr key={row.id || `${row.secret}-${i}`}>
                              <td className="px-3 py-2 font-mono text-sm text-violet-200/90">{row.secret}</td>
                              <td className="px-3 py-2 font-mono text-xs">{row.address}</td>
                              <td className="px-3 py-2 text-xs text-slate-400">{row.uptime}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </section>
          ))
        )}

        {!loading && routers.length === 0 && !err && (
          <p className="text-center text-sm text-slate-500">No routers configured. Add one under Devices → MikroTik.</p>
        )}
      </div>
    </div>
  );
}
