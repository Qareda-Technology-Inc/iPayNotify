import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../api.js';
import { routerDisplayName } from '../utils/routerDisplayName.js';
import { downloadVouchersPdf, sheetOptions } from '../utils/exportVouchersPdf.js';
import { VOUCHER_DESIGNS } from '../portal/designs.js';

const PAGE_SIZE = 50;

const STATUS_TABS = [
  { id: 'unused', label: 'Unused' },
  { id: 'active', label: 'In use' },
  { id: 'expired', label: 'Expired' },
  { id: '', label: 'All' },
];

const STATUS_STYLE = {
  unused: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30',
  active: 'bg-sky-500/15 text-sky-300 ring-sky-500/30',
  expired: 'bg-slate-700/40 text-slate-400 ring-slate-600/40',
};

const STATUS_LABEL = { unused: 'Unused', active: 'In use', expired: 'Expired' };

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
  if ((pkg.ticketDurationType || 'elapsed') === 'paused') {
    return `Online ${formatSession(pkg.pausedSeconds ?? pkg.timeLimitSeconds)}`;
  }
  return `Valid ${formatSession(pkg.elapsedSeconds)}`;
}

function ticketStatus(v) {
  if (v.validUntil && new Date(v.validUntil).getTime() < Date.now()) return 'expired';
  if (v.usedAt) return 'active';
  return 'unused';
}

function formatDate(d) {
  return d ? new Date(d).toLocaleString() : '—';
}

function slug(s) {
  return String(s || 'tickets')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
}

function qs(params) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== '' && v != null) p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

const inputCls =
  'w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-slate-100 outline-none ring-emerald-500/40 focus:ring-2';
const smallSelectCls =
  'rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-xs text-slate-200 outline-none focus:border-slate-500';

export function TicketsPage() {
  const [routers, setRouters] = useState([]);
  const [packages, setPackages] = useState([]);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  const [printDesign, setPrintDesign] = useState('grid');
  const [printTitle, setPrintTitle] = useState('');
  const [printSheet, setPrintSheet] = useState('auto');

  const [view, setView] = useState(/** @type {'tickets' | 'batches'} */ ('tickets'));
  const [showGenerate, setShowGenerate] = useState(false);

  const [status, setStatus] = useState('unused');
  const [filterRouter, setFilterRouter] = useState('');
  const [filterPackage, setFilterPackage] = useState('');
  const [batch, setBatch] = useState(null);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);

  const [list, setList] = useState({ items: [], total: 0 });
  const [listLoading, setListLoading] = useState(false);
  const [stats, setStats] = useState(null);
  const [batches, setBatches] = useState([]);
  const [selected, setSelected] = useState(() => new Set());
  const [busy, setBusy] = useState('');

  const filters = useMemo(
    () => ({
      routerId: filterRouter,
      packageId: filterPackage,
      batch: batch?.id || '',
      q: query,
    }),
    [filterRouter, filterPackage, batch, query]
  );

  useEffect(() => {
    Promise.all([apiFetch('/api/routers'), apiFetch('/api/packages?all=1')])
      .then(([r, pk]) => {
        setRouters(Array.isArray(r) ? r : []);
        setPackages((Array.isArray(pk) ? pk : []).filter((x) => x.kind === 'hotspot'));
      })
      .catch((e) => setError(e.message));
    apiFetch('/api/organization')
      .then((o) => {
        const id = o?.billing?.voucherDesign;
        if (VOUCHER_DESIGNS.some((d) => d.id === id)) setPrintDesign(id);
        setPrintTitle(String(o?.billing?.voucherTitle || '').trim());
        setPrintSheet(o?.billing?.voucherSheet || 'auto');
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setQuery(search.replace(/\D/g, '')), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    setPage(1);
    setSelected(new Set());
  }, [status, filters]);

  const loadTickets = useCallback(async () => {
    setListLoading(true);
    try {
      const [l, s] = await Promise.all([
        apiFetch(`/api/hotspot/vouchers${qs({ ...filters, status, page, limit: PAGE_SIZE })}`),
        apiFetch(`/api/hotspot/vouchers/stats${qs(filters)}`).catch(() => null),
      ]);
      setList({ items: Array.isArray(l?.items) ? l.items : [], total: Number(l?.total) || 0 });
      setStats(s);
    } catch (e) {
      setError(e.message);
    } finally {
      setListLoading(false);
    }
  }, [filters, status, page]);

  const loadBatches = useCallback(async () => {
    try {
      const b = await apiFetch('/api/hotspot/vouchers/batches');
      setBatches(Array.isArray(b) ? b : []);
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    loadTickets();
  }, [loadTickets]);

  useEffect(() => {
    if (view === 'batches') loadBatches();
  }, [view, loadBatches]);

  const refreshAll = useCallback(async () => {
    await loadTickets();
    if (view === 'batches') await loadBatches();
  }, [loadTickets, loadBatches, view]);

  function printRows(rows, label) {
    setError('');
    setInfo('');
    try {
      const { printed, skipped } = downloadVouchersPdf(rows, {
        title: printTitle || 'Wi‑Fi Access',
        design: printDesign,
        sheet: printSheet,
        filename: `tickets-${slug(label)}-${printDesign}-${Date.now()}.pdf`,
      });
      setInfo(
        `Downloaded ${printed} ticket${printed === 1 ? '' : 's'} as PDF` +
          (skipped ? ` (${skipped} used or expired skipped).` : '.')
      );
    } catch (e) {
      setError(e.message || 'Could not create PDF');
    }
  }

  async function printUnused(extra = {}, label = 'unused') {
    setBusy('print');
    setError('');
    try {
      const data = await apiFetch(`/api/hotspot/vouchers/export${qs({ ...filters, ...extra, status: 'unused' })}`);
      const rows = Array.isArray(data?.items) ? data.items : [];
      if (!rows.length) {
        setError('No unused tickets match — nothing to print.');
        return;
      }
      printRows(rows, label);
      if (data.truncated) setInfo((m) => `${m} Only the first ${rows.length} were included.`);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy('');
    }
  }

  async function deleteIds(ids) {
    if (!ids.length) return;
    if (!window.confirm(`Delete ${ids.length} ticket${ids.length === 1 ? '' : 's'}? They are removed from the router too.`)) {
      return;
    }
    setBusy('delete');
    setError('');
    setInfo('');
    try {
      const r = await apiFetch('/api/hotspot/vouchers/bulk-delete', {
        method: 'POST',
        body: JSON.stringify({ ids }),
      });
      setSelected(new Set());
      setInfo(
        `Deleted ${r.deleted} ticket${r.deleted === 1 ? '' : 's'}.` +
          (r.routerErrors?.length ? ` ${r.routerErrors.length} could not be removed from the router.` : '')
      );
      await refreshAll();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy('');
    }
  }

  async function clearExpired(extra = {}) {
    const n = extra.count ?? stats?.expired ?? 0;
    if (!n) return;
    if (!window.confirm(`Delete ${n} expired ticket${n === 1 ? '' : 's'}? This cannot be undone.`)) return;
    setBusy('delete');
    setError('');
    setInfo('');
    try {
      const { count: _c, ...rest } = extra;
      const r = await apiFetch('/api/hotspot/vouchers/bulk-delete', {
        method: 'POST',
        body: JSON.stringify({ ...filters, ...rest, status: 'expired' }),
      });
      setInfo(`Cleared ${r.deleted} expired ticket${r.deleted === 1 ? '' : 's'}.`);
      await refreshAll();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy('');
    }
  }

  async function syncUsage() {
    setBusy('sync');
    setError('');
    setInfo('');
    try {
      const s = await apiFetch('/api/hotspot/vouchers/reconcile', { method: 'POST', body: '{}' });
      setInfo(
        `Usage synced — newly used: ${s.markedUsed ?? 0}, data updated: ${s.updatedBytes ?? 0}, ` +
          `ended: ${(s.kicked ?? 0) + (s.exhausted ?? 0)}.`
      );
      await refreshAll();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy('');
    }
  }

  function openBatch(b) {
    setBatch(b);
    setFilterRouter('');
    setFilterPackage('');
    setSearch('');
    setStatus('');
    setView('tickets');
  }

  const items = list.items;
  const pageCount = Math.max(1, Math.ceil(list.total / PAGE_SIZE));
  const allOnPageSelected = items.length > 0 && items.every((v) => selected.has(String(v._id)));
  const selectedRows = items.filter((v) => selected.has(String(v._id)));
  const selectedPrintable = selectedRows.filter((v) => ticketStatus(v) === 'unused').length;

  function toggleAll() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allOnPageSelected) items.forEach((v) => next.delete(String(v._id)));
      else items.forEach((v) => next.add(String(v._id)));
      return next;
    });
  }

  function toggleOne(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const statCards = [
    { id: 'unused', label: 'Unused', hint: 'Ready to sell', value: stats?.unused, accent: 'text-emerald-300' },
    { id: 'active', label: 'In use', hint: 'Logged in, time left', value: stats?.active, accent: 'text-sky-300' },
    { id: 'expired', label: 'Expired', hint: 'Time or data used up', value: stats?.expired, accent: 'text-slate-300' },
    { id: '', label: 'Total', hint: 'All tickets', value: stats?.total, accent: 'text-white' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">Tickets</h2>
          <p className="mt-1 max-w-2xl text-sm text-slate-400">
            Hotspot access codes. Generate a batch for a router and plan, print the unused ones, and track
            them as they are used. Login page and ticket designs live under{' '}
            <Link to="/hotspot/portal" className="text-indigo-300 hover:text-indigo-200">
              Templates &amp; designs
            </Link>
            .
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <button
            type="button"
            disabled={busy === 'sync'}
            onClick={syncUsage}
            className="rounded-lg border border-slate-600 px-4 py-2.5 text-sm text-slate-200 hover:bg-slate-800 disabled:opacity-50"
          >
            {busy === 'sync' ? 'Syncing…' : 'Sync usage'}
          </button>
          <button
            type="button"
            onClick={() => setShowGenerate((v) => !v)}
            className="rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-emerald-900/30 hover:bg-emerald-500"
          >
            {showGenerate ? 'Close' : 'Generate tickets'}
          </button>
        </div>
      </div>

      {error && (
        <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200" role="alert">
          {error}
        </p>
      )}
      {info && (
        <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
          {info}
        </p>
      )}

      {showGenerate && (
        <GeneratePanel
          routers={routers}
          packages={packages}
          onError={setError}
          onInfo={setInfo}
          onCreated={async (rows) => {
            await refreshAll();
            return rows;
          }}
          onPrint={(rows, label) => printRows(rows, label)}
          onViewBatch={(b) => {
            setShowGenerate(false);
            openBatch(b);
          }}
        />
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {statCards.map((c) => {
          const on = view === 'tickets' && status === c.id;
          return (
            <button
              key={c.label}
              type="button"
              onClick={() => {
                setView('tickets');
                setStatus(c.id);
              }}
              className={`rounded-xl border px-4 py-3 text-left transition ${
                on
                  ? 'border-emerald-500/50 bg-emerald-500/10'
                  : 'border-slate-800 bg-slate-900/40 hover:border-slate-700'
              }`}
            >
              <p className="text-xs uppercase tracking-wide text-slate-500">{c.label}</p>
              <p className={`mt-1 text-2xl font-semibold ${c.accent}`}>{c.value ?? '—'}</p>
              <p className="mt-0.5 text-[11px] text-slate-500">{c.hint}</p>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800">
        <div className="flex gap-1">
          {[
            { id: 'tickets', label: 'Tickets' },
            { id: 'batches', label: 'Batches' },
          ].map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setView(t.id)}
              className={`-mb-px border-b-2 px-4 py-2.5 text-sm font-medium ${
                view === t.id
                  ? 'border-emerald-500 text-white'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="mb-2 flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-slate-400">
            Print design
            <select value={printDesign} onChange={(e) => setPrintDesign(e.target.value)} className={smallSelectCls}>
              {VOUCHER_DESIGNS.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-xs text-slate-400">
            Per page
            <select value={printSheet} onChange={(e) => setPrintSheet(e.target.value)} className={smallSelectCls}>
              {sheetOptions(printSheet).map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {view === 'tickets' ? (
        <section className="space-y-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex rounded-lg border border-slate-700 bg-slate-950 p-0.5">
                {STATUS_TABS.map((t) => (
                  <button
                    key={t.label}
                    type="button"
                    onClick={() => setStatus(t.id)}
                    className={`rounded-md px-3 py-1.5 text-xs font-medium ${
                      status === t.id ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              <input
                type="search"
                inputMode="numeric"
                placeholder="Search code…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-36 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-200 outline-none focus:border-slate-500"
              />
              <select value={filterRouter} onChange={(e) => setFilterRouter(e.target.value)} className={smallSelectCls}>
                <option value="">All routers</option>
                {routers.map((r) => (
                  <option key={r._id} value={r._id}>
                    {routerDisplayName(r)}
                  </option>
                ))}
              </select>
              <select value={filterPackage} onChange={(e) => setFilterPackage(e.target.value)} className={smallSelectCls}>
                <option value="">All plans</option>
                {packages.map((p) => (
                  <option key={p._id} value={p._id}>
                    {p.name}
                  </option>
                ))}
              </select>
              {batch && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-indigo-500/40 bg-indigo-500/10 px-3 py-1 text-xs text-indigo-200">
                  Batch: {batch.packageName || 'plan'} · {formatDate(batch.createdAt)}
                  <button
                    type="button"
                    onClick={() => setBatch(null)}
                    className="text-indigo-300 hover:text-white"
                    aria-label="Clear batch filter"
                  >
                    ✕
                  </button>
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {status === 'expired' && (stats?.expired ?? 0) > 0 && (
                <button
                  type="button"
                  disabled={busy === 'delete'}
                  onClick={() => clearExpired()}
                  className="rounded-lg border border-red-700/50 px-3 py-2 text-xs text-red-200 hover:bg-red-950/40 disabled:opacity-50"
                >
                  Clear {stats.expired} expired
                </button>
              )}
              <button
                type="button"
                disabled={busy === 'print' || !(stats?.unused > 0)}
                onClick={() => printUnused({}, batch ? `batch-${batch.packageName}` : 'unused')}
                className="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-40"
                title="Prints unused tickets matching the router, plan, batch and search filters"
              >
                {busy === 'print' ? 'Preparing…' : `Print ${stats?.unused ?? 0} unused`}
              </button>
            </div>
          </div>

          {selected.size > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-700 bg-slate-900/80 px-4 py-2.5 text-sm">
              <span className="text-slate-300">
                {selected.size} selected
                {selectedPrintable < selectedRows.length ? (
                  <span className="text-slate-500"> · {selectedPrintable} printable</span>
                ) : null}
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={!selectedPrintable}
                  onClick={() => printRows(selectedRows, 'selected')}
                  className="rounded-lg border border-indigo-500/50 px-3 py-1.5 text-xs text-indigo-200 hover:bg-indigo-950/40 disabled:opacity-40"
                >
                  Print selected
                </button>
                <button
                  type="button"
                  disabled={busy === 'delete'}
                  onClick={() => deleteIds([...selected])}
                  className="rounded-lg border border-red-700/50 px-3 py-1.5 text-xs text-red-200 hover:bg-red-950/40 disabled:opacity-50"
                >
                  Delete selected
                </button>
                <button
                  type="button"
                  onClick={() => setSelected(new Set())}
                  className="rounded-lg px-2 py-1.5 text-xs text-slate-400 hover:text-white"
                >
                  Clear
                </button>
              </div>
            </div>
          )}

          <div className="overflow-x-auto rounded-xl border border-slate-800">
            <table className="w-full min-w-[860px] text-left text-sm">
              <thead className="bg-slate-900 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="w-10 px-4 py-3">
                    <input
                      type="checkbox"
                      checked={allOnPageSelected}
                      onChange={toggleAll}
                      aria-label="Select all on this page"
                      className="rounded border-slate-600"
                    />
                  </th>
                  <th className="px-3 py-3 font-medium">Code</th>
                  <th className="px-3 py-3 font-medium">Plan</th>
                  <th className="px-3 py-3 font-medium">Router</th>
                  <th className="px-3 py-3 font-medium">Status</th>
                  <th className="px-3 py-3 font-medium">Usage</th>
                  <th className="px-3 py-3 font-medium">Valid until</th>
                  <th className="px-3 py-3 font-medium">Created</th>
                  <th className="px-3 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 bg-slate-950/50">
                {items.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-10 text-center text-slate-500">
                      {listLoading
                        ? 'Loading…'
                        : status === 'unused'
                          ? 'No unused tickets. Use “Generate tickets” to create a batch.'
                          : 'No tickets match these filters.'}
                    </td>
                  </tr>
                ) : (
                  items.map((v) => {
                    const st = ticketStatus(v);
                    const id = String(v._id);
                    return (
                      <tr key={id} className={`text-slate-300 ${selected.has(id) ? 'bg-slate-800/40' : ''}`}>
                        <td className="px-4 py-2">
                          <input
                            type="checkbox"
                            checked={selected.has(id)}
                            onChange={() => toggleOne(id)}
                            aria-label={`Select ${v.code}`}
                            className="rounded border-slate-600"
                          />
                        </td>
                        <td className="px-3 py-2 font-mono text-base tracking-wider text-emerald-400">{v.code}</td>
                        <td className="px-3 py-2">
                          <span className="text-slate-200">{v.packageId?.name || v.profileName || '—'}</span>
                          <span className="block text-[11px] text-slate-500">
                            {v.elapsedSeconds ? formatSession(v.elapsedSeconds) : formatSession(v.timeLimitSeconds)}
                            {v.dataLimitBytes ? ` · ${formatBytes(v.dataLimitBytes)}` : ''}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-xs">
                          <span className="text-slate-300">{routerDisplayName(v.routerId) || '—'}</span>
                          {v.hotspotServer ? (
                            <span className="block text-[11px] text-slate-500">{v.hotspotServer}</span>
                          ) : null}
                        </td>
                        <td className="px-3 py-2">
                          <span className={`rounded-md px-2 py-0.5 text-xs ring-1 ${STATUS_STYLE[st]}`}>
                            {STATUS_LABEL[st]}
                          </span>
                          {v.lockedMac ? (
                            <span className="mt-0.5 block font-mono text-[10px] text-slate-500">{v.lockedMac}</span>
                          ) : null}
                        </td>
                        <td className="px-3 py-2 text-xs text-slate-500">
                          {v.bytesIn || v.bytesOut
                            ? `↓ ${formatBytes(v.bytesIn)} · ↑ ${formatBytes(v.bytesOut)}`
                            : '—'}
                        </td>
                        <td className="px-3 py-2 text-xs text-slate-500">
                          {v.validUntil ? formatDate(v.validUntil) : st === 'unused' ? 'Starts at first login' : '—'}
                        </td>
                        <td className="px-3 py-2 text-xs text-slate-500">{formatDate(v.createdAt)}</td>
                        <td className="px-3 py-2 text-right">
                          <button
                            type="button"
                            disabled={busy === 'delete'}
                            onClick={() => deleteIds([id])}
                            className="text-xs text-red-300/80 hover:text-red-200 disabled:opacity-50"
                          >
                            Delete
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>
              {list.total
                ? `${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, list.total)} of ${list.total}`
                : '0 tickets'}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={page <= 1 || listLoading}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="rounded-lg border border-slate-700 px-3 py-1.5 text-slate-300 hover:bg-slate-800 disabled:opacity-40"
              >
                Previous
              </button>
              <span className="px-1 py-1.5">
                Page {page} / {pageCount}
              </span>
              <button
                type="button"
                disabled={page >= pageCount || listLoading}
                onClick={() => setPage((p) => p + 1)}
                className="rounded-lg border border-slate-700 px-3 py-1.5 text-slate-300 hover:bg-slate-800 disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        </section>
      ) : (
        <section className="overflow-x-auto rounded-xl border border-slate-800">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead className="bg-slate-900 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Created</th>
                <th className="px-3 py-3 font-medium">Plan</th>
                <th className="px-3 py-3 font-medium">Router</th>
                <th className="px-3 py-3 font-medium text-right">Total</th>
                <th className="px-3 py-3 font-medium text-right">Unused</th>
                <th className="px-3 py-3 font-medium text-right">In use</th>
                <th className="px-3 py-3 font-medium text-right">Expired</th>
                <th className="px-3 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800 bg-slate-950/50">
              {batches.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-slate-500">
                    No batches yet.
                  </td>
                </tr>
              ) : (
                batches.map((b) => (
                  <tr key={b.id} className="text-slate-300">
                    <td className="px-4 py-2.5 text-xs text-slate-400">{formatDate(b.createdAt)}</td>
                    <td className="px-3 py-2.5 text-slate-200">{b.packageName || '—'}</td>
                    <td className="px-3 py-2.5 text-xs">
                      {b.routerName || '—'}
                      {b.hotspotServer ? <span className="block text-[11px] text-slate-500">{b.hotspotServer}</span> : null}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{b.total}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-emerald-300">{b.unused}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-sky-300">{b.active}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-500">{b.expired}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right text-xs">
                      <button
                        type="button"
                        disabled={!b.unused || busy === 'print'}
                        onClick={() =>
                          printUnused(
                            { batch: b.id, routerId: '', packageId: '', q: '' },
                            `batch-${b.packageName}`
                          )
                        }
                        className="text-indigo-300 hover:text-indigo-200 disabled:opacity-40"
                      >
                        Print {b.unused} unused
                      </button>
                      <button
                        type="button"
                        onClick={() => openBatch(b)}
                        className="ml-3 text-slate-300 hover:text-white"
                      >
                        View
                      </button>
                      {b.expired > 0 && (
                        <button
                          type="button"
                          disabled={busy === 'delete'}
                          onClick={() =>
                            clearExpired({ batch: b.id, routerId: '', packageId: '', q: '', count: b.expired })
                          }
                          className="ml-3 text-red-300/80 hover:text-red-200 disabled:opacity-50"
                        >
                          Clear expired
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}

function GeneratePanel({ routers, packages, onError, onInfo, onCreated, onPrint, onViewBatch }) {
  const [routerId, setRouterId] = useState('');
  const [servers, setServers] = useState([]);
  const [serversLoading, setServersLoading] = useState(false);
  const [hotspotServer, setHotspotServer] = useState('');
  const [packageId, setPackageId] = useState('');
  const [count, setCount] = useState(10);
  const [preview, setPreview] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [created, setCreated] = useState(null);

  useEffect(() => {
    setRouterId((id) => id || (routers[0]?._id ? String(routers[0]._id) : ''));
  }, [routers]);

  useEffect(() => {
    setPackageId((pid) =>
      pid && packages.some((p) => String(p._id) === pid) ? pid : packages[0]?._id ? String(packages[0]._id) : ''
    );
  }, [packages]);

  useEffect(() => {
    if (!routerId) {
      setServers([]);
      setHotspotServer('');
      return undefined;
    }
    let cancelled = false;
    setServersLoading(true);
    apiFetch(`/api/hotspot/routers/${routerId}/servers`)
      .then((data) => {
        if (cancelled) return;
        const list = Array.isArray(data?.servers) ? data.servers : [];
        setServers(list);
        setHotspotServer((cur) => {
          if (cur && list.some((s) => s.name === cur)) return cur;
          return (list.find((s) => !s.disabled) || list[0])?.name || '';
        });
      })
      .catch((e) => {
        if (cancelled) return;
        setServers([]);
        setHotspotServer('');
        onError(e.message || 'Could not load hotspot servers');
      })
      .finally(() => {
        if (!cancelled) setServersLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [routerId, onError]);

  useEffect(() => {
    setPreview(null);
  }, [routerId, hotspotServer, packageId, count]);

  const selectedPkg = packages.find((p) => String(p._id) === String(packageId));
  const selectedRouter = routers.find((r) => String(r._id) === String(routerId));
  const canPreview = Boolean(routerId && packageId && hotspotServer) && !serversLoading;

  async function onPreview(e) {
    e.preventDefault();
    onError('');
    onInfo('');
    setCreated(null);
    setPreviewing(true);
    try {
      const data = await apiFetch('/api/hotspot/vouchers/preview', {
        method: 'POST',
        body: JSON.stringify({ count: Number(count) || 1, packageId, routerId, hotspotServer }),
      });
      setPreview(data);
    } catch (err) {
      onError(err.message);
      setPreview(null);
    } finally {
      setPreviewing(false);
    }
  }

  async function onCreate() {
    if (!preview?.codes?.length) return;
    onError('');
    onInfo('');
    setCreating(true);
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
      const printable = rows.map((r) => ({
        ...r,
        packageId: { _id: packageId, name: selectedPkg?.name || r.profileName },
        routerId: selectedRouter || null,
      }));
      setCreated({
        rows: printable,
        batch: {
          id: rows[0]?.batchId || '',
          packageName: selectedPkg?.name || '',
          createdAt: new Date().toISOString(),
        },
      });
      setPreview(null);
      onInfo(
        `Created ${rows.length} ticket${rows.length === 1 ? '' : 's'} for ${selectedPkg?.name || 'the plan'} on “${hotspotServer}”.`
      );
      await onCreated(rows);
    } catch (err) {
      onError(err.message);
    } finally {
      setCreating(false);
    }
  }

  async function onInstallScheduler() {
    if (!routerId) return;
    onError('');
    onInfo('');
    setInstalling(true);
    try {
      const r = await apiFetch(`/api/hotspot/routers/${routerId}/sync-expiry-scheduler`, {
        method: 'POST',
        body: '{}',
      });
      onInfo(`Expiry scheduler installed on ${r.routerName || 'router'} — runs every ${r.interval || '1m'}.`);
    } catch (err) {
      onError(err.message);
    } finally {
      setInstalling(false);
    }
  }

  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5 shadow-xl">
      <form onSubmit={onPreview} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block text-sm">
            <span className="mb-1.5 block font-medium text-slate-300">Router</span>
            <select className={inputCls} value={routerId} onChange={(e) => setRouterId(e.target.value)} required>
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
              className={inputCls}
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
            <span className="mb-1.5 block font-medium text-slate-300">Plan</span>
            <select className={inputCls} value={packageId} onChange={(e) => setPackageId(e.target.value)} required>
              {packages.length === 0 ? (
                <option value="">No hotspot plans — add one under Packages</option>
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
                {packageClockLabel(selectedPkg)} · data {formatBytes(selectedPkg.dataLimitBytes)}
                {selectedPkg.usersPerTicket > 1 ? ` · ${selectedPkg.usersPerTicket} devices` : ''}
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
              className={inputCls}
            />
            <span className="mt-1.5 block text-xs text-slate-500">Up to 100 unique 6-digit codes</span>
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="submit"
            disabled={previewing || creating || !canPreview}
            className="rounded-lg border border-emerald-600/60 bg-emerald-950/40 px-5 py-2.5 text-sm font-semibold text-emerald-100 hover:bg-emerald-900/50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {previewing ? 'Previewing…' : 'Preview codes'}
          </button>
          <button
            type="button"
            disabled={creating || !preview?.codes?.length}
            onClick={onCreate}
            className="rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {creating ? 'Creating…' : `Create ${preview?.codes?.length || ''} tickets`}
          </button>
          <button
            type="button"
            disabled={installing || !routerId}
            onClick={onInstallScheduler}
            className="ml-auto text-xs text-amber-300/90 hover:text-amber-200 disabled:opacity-50"
            title="Installs a small script on the router that removes expired tickets every minute"
          >
            {installing ? 'Installing…' : 'Install expiry scheduler on this router'}
          </button>
        </div>
      </form>

      {preview?.codes?.length > 0 && (
        <div className="mt-4 rounded-xl border border-dashed border-emerald-700/50 bg-emerald-950/20 p-4">
          <p className="mb-3 text-xs text-slate-400">
            Preview — {preview.codes.length} codes for {preview.package?.name || selectedPkg?.name} (not created yet)
          </p>
          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-6 lg:grid-cols-10">
            {preview.codes.map((code) => (
              <li
                key={code}
                className="rounded-md border border-slate-700 bg-slate-950/80 px-2 py-1.5 text-center font-mono text-sm tracking-widest text-emerald-300"
              >
                {code}
              </li>
            ))}
          </ul>
        </div>
      )}

      {created?.rows?.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-600/40 bg-emerald-950/30 px-4 py-3">
          <p className="text-sm text-emerald-100">
            {created.rows.length} new ticket{created.rows.length === 1 ? '' : 's'} ready to print.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => onPrint(created.rows, `batch-${created.batch.packageName}`)}
              className="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-500"
            >
              Print these tickets
            </button>
            {created.batch.id ? (
              <button
                type="button"
                onClick={() => onViewBatch(created.batch)}
                className="rounded-lg border border-slate-600 px-3 py-2 text-xs text-slate-200 hover:bg-slate-800"
              >
                View batch
              </button>
            ) : null}
          </div>
        </div>
      )}
    </section>
  );
}
