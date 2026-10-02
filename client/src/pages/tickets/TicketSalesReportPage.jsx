import { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../../api.js';
import { PERIOD_PRESETS, downloadCsv, ghs, isoDate, money, rangeFor, rangeLabel } from './common.js';

const GROUPS = [
  { id: 'byRouter', label: 'Router', heading: 'All routers' },
  { id: 'bySite', label: 'Site', heading: 'All sites' },
  { id: 'byPlan', label: 'Plan / ticket', heading: 'All plans' },
  { id: 'bySeller', label: 'Seller', heading: 'All sellers' },
  { id: 'byChannel', label: 'Channel', heading: 'All channels' },
  { id: 'byDay', label: 'Day', heading: 'All days' },
];

const CHANNEL_ORDER = ['seller', 'count', 'office', 'online'];
const CHANNEL_TONE = {
  seller: 'bg-amber-400',
  count: 'bg-orange-500',
  office: 'bg-sky-400',
  online: 'bg-emerald-400',
};

const selectCls = 'mt-1 block w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm';

function Card({ label, value, sub, tone = 'text-white' }) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4">
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-2 text-2xl font-semibold ${tone}`}>{value}</p>
      {sub ? <p className="mt-1 text-xs text-slate-500">{sub}</p> : null}
    </div>
  );
}

export function TicketSalesReportPage() {
  const [preset, setPreset] = useState('month');
  const [customFrom, setCustomFrom] = useState(isoDate(new Date()));
  const [customTo, setCustomTo] = useState(isoDate(new Date()));
  const [filters, setFilters] = useState({ routerId: '', siteId: '', packageId: '', ticketTypeId: '', sellerKey: '' });
  const [channels, setChannels] = useState([]);
  const [group, setGroup] = useState('byRouter');
  const [opts, setOpts] = useState({ routers: [], sites: [], packages: [], types: [], sellers: [] });
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  const range = useMemo(() => rangeFor(preset, customFrom, customTo), [preset, customFrom, customTo]);
  const setFilter = (k) => (e) => setFilters((f) => ({ ...f, [k]: e.target.value }));
  const activeFilters = Object.values(filters).filter(Boolean).length + (channels.length ? 1 : 0);

  useEffect(() => {
    Promise.all([
      apiFetch('/api/ticket-sales/link-options').catch(() => null),
      apiFetch('/api/ticket-sales/sites').catch(() => []),
      apiFetch('/api/ticket-sales/types').catch(() => []),
      apiFetch('/api/ticket-sales/seller-balances').catch(() => []),
    ]).then(([lo, sites, types, sellers]) =>
      setOpts({
        routers: lo?.routers || [],
        packages: lo?.packages || [],
        sites: Array.isArray(sites) ? sites : [],
        types: Array.isArray(types) ? types : [],
        sellers: Array.isArray(sellers) ? [...sellers].sort((a, b) => a.sellerName.localeCompare(b.sellerName)) : [],
      })
    );
  }, []);

  useEffect(() => {
    let cancelled = false;
    const q = new URLSearchParams({
      from: range.from.toISOString(),
      to: range.to.toISOString(),
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Africa/Accra',
    });
    for (const [k, v] of Object.entries(filters)) if (v) q.set(k, v);
    if (channels.length) q.set('channel', channels.join(','));
    setLoading(true);
    setErr('');
    apiFetch(`/api/ticket-sales/sales-report?${q}`)
      .then((r) => !cancelled && setReport(r))
      .catch((e) => !cancelled && setErr(e.message || 'Could not load the sales report'))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [range, filters, channels]);

  const channelNames = report?.channels || {};
  const totals = report?.totals || { qty: 0, cents: 0, channels: {} };
  const rows = report?.[group] || [];
  const groupDef = GROUPS.find((g) => g.id === group);
  const shownChannels = CHANNEL_ORDER.filter((c) => (channels.length ? channels.includes(c) : true));
  const foot =
    group === 'bySeller'
      ? rows.reduce(
          (t, r) => {
            t.qty += r.qty;
            t.cents += r.cents;
            for (const c of CHANNEL_ORDER) {
              t.channels[c].qty += r.channels[c].qty;
              t.channels[c].cents += r.channels[c].cents;
            }
            return t;
          },
          { qty: 0, cents: 0, channels: Object.fromEntries(CHANNEL_ORDER.map((c) => [c, { qty: 0, cents: 0 }])) }
        )
      : totals;
  const maxDayCents = Math.max(1, ...(report?.byDay || []).map((d) => d.cents));

  function exportCsv() {
    downloadCsv(
      `ticket-sales-by-${groupDef.label.toLowerCase().replace(/[^a-z]+/g, '-')}-${isoDate(range.from)}_${isoDate(range.to)}.csv`,
      [
        groupDef.label,
        'Tickets sold',
        'Sales GHS',
        ...shownChannels.flatMap((c) => [`${channelNames[c]} qty`, `${channelNames[c]} GHS`]),
      ],
      [
        ...rows.map((r) => [
          r.label,
          r.qty,
          ghs(r.cents),
          ...shownChannels.flatMap((c) => [r.channels[c].qty, ghs(r.channels[c].cents)]),
        ]),
        [
          `TOTAL (${groupDef.heading.toLowerCase()})`,
          foot.qty,
          ghs(foot.cents),
          ...shownChannels.flatMap((c) => [foot.channels[c]?.qty || 0, ghs(foot.channels[c]?.cents)]),
        ],
      ]
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-white">Ticket sales</h1>
        <p className="mt-1 text-sm text-slate-400">
          Tickets sold and money made, per router, site, plan or seller. Seller and printed codes count as sold when a customer
          uses them; count-only seller tickets when issued (less returns); online tickets when paid.
        </p>
      </div>

      <section className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900/40 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="text-sm text-slate-300">
            Period
            <div className="mt-1 flex flex-wrap gap-1">
              {PERIOD_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPreset(p.id)}
                  className={`rounded-lg border px-2.5 py-1.5 text-xs ${
                    preset === p.id
                      ? 'border-emerald-500 bg-emerald-500/15 text-emerald-200'
                      : 'border-slate-700 text-slate-400 hover:text-white'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          {preset === 'custom' ? (
            <>
              <label className="text-sm text-slate-300">
                From
                <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className={selectCls} />
              </label>
              <label className="text-sm text-slate-300">
                To
                <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className={selectCls} />
              </label>
            </>
          ) : null}
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <label className="text-sm text-slate-300">
            Router
            <select value={filters.routerId} onChange={setFilter('routerId')} className={selectCls}>
              <option value="">All routers</option>
              {opts.routers.map((r) => (
                <option key={r._id} value={r._id}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm text-slate-300">
            Site
            <select value={filters.siteId} onChange={setFilter('siteId')} className={selectCls}>
              <option value="">All sites</option>
              {opts.sites.map((s) => (
                <option key={s._id} value={s._id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm text-slate-300">
            Hotspot plan
            <select value={filters.packageId} onChange={setFilter('packageId')} className={selectCls}>
              <option value="">All plans</option>
              {opts.packages.map((p) => (
                <option key={p._id} value={p._id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm text-slate-300">
            Ticket type
            <select value={filters.ticketTypeId} onChange={setFilter('ticketTypeId')} className={selectCls}>
              <option value="">All ticket types</option>
              {opts.types.map((t) => (
                <option key={t._id} value={t._id}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm text-slate-300">
            Seller
            <select value={filters.sellerKey} onChange={setFilter('sellerKey')} className={selectCls}>
              <option value="">All sellers</option>
              {opts.sellers.map((s) => (
                <option key={s.sellerKey} value={s.sellerKey}>
                  {s.sellerName}
                  {s.siteName ? ` · ${s.siteName}` : ''}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
          <span>Channels:</span>
          {CHANNEL_ORDER.map((c) => (
            <label key={c} className="flex items-center gap-1 rounded-lg border border-slate-700 px-2 py-1">
              <input
                type="checkbox"
                checked={channels.includes(c)}
                onChange={(e) =>
                  setChannels((cur) => (e.target.checked ? [...cur, c] : cur.filter((x) => x !== c)))
                }
              />
              <span className={`inline-block h-2 w-2 rounded-full ${CHANNEL_TONE[c]}`} />
              {channelNames[c] || c}
            </label>
          ))}
          <span className="text-slate-500">{channels.length ? '' : '(none ticked = all)'}</span>
          {activeFilters ? (
            <button
              type="button"
              onClick={() => {
                setFilters({ routerId: '', siteId: '', packageId: '', ticketTypeId: '', sellerKey: '' });
                setChannels([]);
              }}
              className="ml-auto text-emerald-400 hover:text-emerald-300"
            >
              Clear filters
            </button>
          ) : null}
        </div>
      </section>

      {err && <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">{err}</p>}

      <div>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          {rangeLabel(range)}
          {loading ? <span className="ml-2 normal-case text-slate-600">loading…</span> : null}
        </h2>
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
          <Card label="Tickets sold" value={totals.qty.toLocaleString()} />
          <Card label="Total sales" value={money(totals.cents)} tone="text-emerald-300" />
          {CHANNEL_ORDER.map((c) => (
            <Card
              key={c}
              label={channelNames[c] || c}
              value={money(totals.channels[c]?.cents)}
              sub={`${(totals.channels[c]?.qty || 0).toLocaleString()} tickets`}
            />
          ))}
        </section>
      </div>

      {(report?.byDay || []).length > 1 ? (
        <section className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5">
          <h3 className="text-base font-medium text-white">Sales per day</h3>
          <div className="mt-4 flex h-40 items-end gap-1 overflow-x-auto">
            {report.byDay.map((d) => (
              <div
                key={d.key}
                className="flex min-w-[14px] flex-1 flex-col-reverse"
                style={{ height: `${Math.max(2, (d.cents / maxDayCents) * 100)}%` }}
                title={`${d.key}: ${d.qty} tickets · ${money(d.cents)}`}
              >
                {CHANNEL_ORDER.map((c) =>
                  d.channels[c].cents > 0 ? (
                    <div key={c} className={CHANNEL_TONE[c]} style={{ height: `${(d.channels[c].cents / d.cents) * 100}%` }} />
                  ) : null
                )}
              </div>
            ))}
          </div>
          <div className="mt-1 flex justify-between text-[11px] text-slate-500">
            <span>{report.byDay[0].key}</span>
            <span>{report.byDay[report.byDay.length - 1].key}</span>
          </div>
        </section>
      ) : null}

      <section className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-1">
            {GROUPS.map((g) => (
              <button
                key={g.id}
                type="button"
                onClick={() => setGroup(g.id)}
                className={`rounded-lg px-3 py-1.5 text-sm ${
                  group === g.id ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                By {g.label.toLowerCase()}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={exportCsv}
            disabled={!rows.length}
            className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:text-white disabled:opacity-50"
          >
            Export CSV
          </button>
        </div>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm text-slate-300">
            <thead>
              <tr className="border-b border-slate-800 text-xs text-slate-500">
                <th className="py-2 pr-3 font-medium">{groupDef.label}</th>
                <th className="py-2 pr-3 text-right font-medium">Tickets sold</th>
                <th className="py-2 pr-3 text-right font-medium">Sales</th>
                <th className="py-2 pr-3 text-right font-medium">Share</th>
                {shownChannels.map((c) => (
                  <th key={c} className="py-2 pr-3 text-right font-medium">
                    <span className={`mr-1 inline-block h-2 w-2 rounded-full ${CHANNEL_TONE[c]}`} />
                    {channelNames[c] || c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80">
              {rows.map((r) => (
                <tr key={r.key || 'none'}>
                  <td className="py-2 pr-3 text-white">{r.label}</td>
                  <td className="py-2 pr-3 text-right">{r.qty.toLocaleString()}</td>
                  <td className="py-2 pr-3 text-right font-medium text-emerald-300">{money(r.cents)}</td>
                  <td className="py-2 pr-3 text-right text-slate-500">
                    {totals.cents > 0 ? `${Math.round((r.cents / totals.cents) * 100)}%` : '—'}
                  </td>
                  {shownChannels.map((c) => (
                    <td key={c} className="py-2 pr-3 text-right text-xs">
                      {r.channels[c].qty ? (
                        <>
                          {money(r.channels[c].cents)}
                          <span className="block text-slate-500">{r.channels[c].qty} tickets</span>
                        </>
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
              {!loading && rows.length === 0 ? (
                <tr>
                  <td colSpan={4 + shownChannels.length} className="py-6 text-center text-slate-500">
                    No tickets sold in this period{activeFilters ? ' with these filters' : ''}.
                  </td>
                </tr>
              ) : null}
            </tbody>
            {rows.length ? (
              <tfoot>
                <tr className="border-t-2 border-slate-700 font-semibold text-white">
                  <td className="py-2 pr-3">Total · {groupDef.heading.toLowerCase()}</td>
                  <td className="py-2 pr-3 text-right">
                    {foot.qty.toLocaleString()}
                  </td>
                  <td className="py-2 pr-3 text-right text-emerald-300">
                    {money(foot.cents)}
                  </td>
                  <td className="py-2 pr-3" />
                  {shownChannels.map((c) => (
                    <td key={c} className="py-2 pr-3 text-right text-xs">
                      {money(foot.channels[c]?.cents)}
                    </td>
                  ))}
                </tr>
              </tfoot>
            ) : null}
          </table>
          {group === 'bySeller' ? (
            <p className="mt-2 text-xs text-slate-500">Only seller channels appear here; printed and online sales have no seller.</p>
          ) : null}
        </div>
      </section>
    </div>
  );
}
