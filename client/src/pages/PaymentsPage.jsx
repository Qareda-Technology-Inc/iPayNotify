import { useCallback, useEffect, useState } from 'react';
import { apiFetch, apiDownload } from '../api.js';

function formatMoney(cents, currency = 'GHS') {
  const n = Number(cents) || 0;
  try {
    return new Intl.NumberFormat('en-GH', {
      style: 'currency',
      currency: currency || 'GHS',
      minimumFractionDigits: 2,
    }).format(n / 100);
  } catch {
    return `${(n / 100).toFixed(2)} ${currency || 'GHS'}`;
  }
}

function statusClass(status) {
  switch (status) {
    case 'paid':
      return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200';
    case 'pending':
      return 'border-amber-500/40 bg-amber-500/10 text-amber-200';
    case 'failed':
      return 'border-red-500/40 bg-red-500/10 text-red-200';
    case 'refunded':
      return 'border-slate-500/40 bg-slate-500/10 text-slate-300';
    default:
      return 'border-slate-600 bg-slate-800 text-slate-300';
  }
}

function kindLabel(kind) {
  if (kind === 'renewal') return 'PPPoE renew';
  if (kind === 'voucher') return 'Hotspot';
  if (kind === 'topup') return 'Top-up';
  if (kind === 'subscription') return 'Subscription';
  return kind || '—';
}

export function PaymentsPage() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('');
  const [kind, setKind] = useState('');
  const [q, setQ] = useState('');
  const [qDraft, setQDraft] = useState('');
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);

  const filterParams = useCallback(() => {
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (kind) params.set('kind', kind);
    if (q.trim()) params.set('q', q.trim());
    return params;
  }, [status, kind, q]);

  const load = useCallback(async () => {
    setErr('');
    setLoading(true);
    try {
      const params = filterParams();
      params.set('page', String(page));
      params.set('limit', '40');
      const d = await apiFetch(`/api/transactions?${params}`);
      setData(d);
    } catch (e) {
      setErr(e.message || 'Could not load payments');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [page, filterParams]);

  async function exportCsv() {
    setExporting(true);
    setErr('');
    try {
      const params = filterParams();
      params.set('format', 'csv');
      params.set('limit', '5000');
      const blob = await apiDownload(`/api/transactions?${params}`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'payments-export.csv';
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setErr(e.message || 'Export failed');
    } finally {
      setExporting(false);
    }
  }

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setPage(1);
  }, [status, kind, q]);

  const items = data?.items || [];
  const pages = data?.pages || 1;
  const statusCounts = data?.statusCounts || {};

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">Payments</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-400">
            Hubtel checkout (Qaretech settles). Fee and your net credit are shown for paid sales.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={exportCsv}
            disabled={exporting || loading}
            className="rounded-xl border border-emerald-700/50 bg-emerald-950/30 px-4 py-2.5 text-sm font-medium text-emerald-100 hover:bg-emerald-950/50 disabled:opacity-50"
          >
            {exporting ? 'Exporting…' : 'Export CSV'}
          </button>
          <button
            type="button"
            onClick={() => load()}
            disabled={loading}
            className="rounded-xl border border-slate-600/80 bg-slate-800/50 px-4 py-2.5 text-sm font-medium text-slate-200 hover:bg-slate-800 disabled:opacity-50"
          >
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-3 text-sm">
        <div className="rounded-xl border border-slate-700 bg-slate-900/60 px-4 py-3">
          <p className="text-xs uppercase tracking-wide text-slate-500">Paid (this filter)</p>
          <p className="mt-1 text-lg font-semibold text-emerald-300">
            {formatMoney(data?.paidInFilter?.amountCents)}
            <span className="ml-2 text-xs font-normal text-slate-500">
              {data?.paidInFilter?.count ?? 0} tx
            </span>
          </p>
        </div>
        <div className="rounded-xl border border-slate-700 bg-slate-900/60 px-4 py-3">
          <p className="text-xs uppercase tracking-wide text-slate-500">Pending</p>
          <p className="mt-1 text-lg font-semibold text-amber-200">{statusCounts.pending ?? 0}</p>
        </div>
        <div className="rounded-xl border border-slate-700 bg-slate-900/60 px-4 py-3">
          <p className="text-xs uppercase tracking-wide text-slate-500">Failed</p>
          <p className="mt-1 text-lg font-semibold text-red-200">{statusCounts.failed ?? 0}</p>
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        <label className="block text-sm text-slate-300">
          Status
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="mt-1 block w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 sm:w-40"
          >
            <option value="">All</option>
            <option value="paid">Paid</option>
            <option value="pending">Pending</option>
            <option value="failed">Failed</option>
            <option value="refunded">Refunded</option>
          </select>
        </label>
        <label className="block text-sm text-slate-300">
          Type
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            className="mt-1 block w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 sm:w-44"
          >
            <option value="">All</option>
            <option value="renewal">PPPoE renew</option>
            <option value="voucher">Hotspot</option>
            <option value="subscription">Subscription</option>
            <option value="topup">Top-up</option>
          </select>
        </label>
        <form
          className="flex flex-1 flex-col gap-2 sm:min-w-[220px] sm:flex-row sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            setQ(qDraft);
          }}
        >
          <label className="block flex-1 text-sm text-slate-300">
            Search
            <input
              value={qDraft}
              onChange={(e) => setQDraft(e.target.value)}
              placeholder="Phone, name, client ref…"
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
            />
          </label>
          <button
            type="submit"
            className="rounded-lg bg-slate-100 px-4 py-2 text-sm font-medium text-slate-900"
          >
            Search
          </button>
        </form>
      </div>

      {err && (
        <p className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {err}
        </p>
      )}

      <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-900/40">
        <table className="w-full min-w-[880px] text-left text-sm">
          <thead className="border-b border-slate-800 bg-slate-950/80 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">When</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Customer</th>
              <th className="px-4 py-3">Package</th>
              <th className="px-4 py-3">Gross</th>
              <th className="px-4 py-3">Fee</th>
              <th className="px-4 py-3">Your net</th>
              <th className="px-4 py-3">Reference</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/80">
            {loading && !data ? (
              <tr>
                <td colSpan={9} className="px-4 py-10 text-center text-slate-500">
                  Loading…
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-10 text-center text-slate-500">
                  No payments match these filters.
                </td>
              </tr>
            ) : (
              items.map((t) => (
                <tr key={t.id} className="text-slate-300">
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-400">
                    {t.createdAt ? new Date(t.createdAt).toLocaleString() : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-block rounded-md border px-2 py-0.5 text-xs font-medium capitalize ${statusClass(t.status)}`}
                    >
                      {t.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs">{kindLabel(t.kind)}</td>
                  <td className="px-4 py-3">
                    <div className="text-slate-200">{t.customerName || '—'}</div>
                    <div className="font-mono text-xs text-slate-500">{t.customerPhone || ''}</div>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-400">{t.packageName || '—'}</td>
                  <td className="whitespace-nowrap px-4 py-3 font-medium text-white">
                    {formatMoney(t.amountCents, t.currency)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-amber-200/90">
                    {t.platformFeeCents != null ? formatMoney(t.platformFeeCents, t.currency) : '—'}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-emerald-300/90">
                    {t.orgNetCents != null ? formatMoney(t.orgNetCents, t.currency) : '—'}
                  </td>
                  <td className="px-4 py-3 font-mono text-[11px] text-slate-500">
                    <div className="max-w-[140px] truncate" title={t.clientReference}>
                      {t.clientReference || '—'}
                    </div>
                    {t.providerReference ? (
                      <div className="max-w-[140px] truncate text-slate-600" title={t.providerReference}>
                        {t.providerReference}
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {data && pages > 1 && (
        <div className="flex items-center justify-between text-sm text-slate-400">
          <p>
            Page {data.page} of {pages} · {data.total} total
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={page <= 1 || loading}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="rounded-lg border border-slate-700 px-3 py-1.5 disabled:opacity-40"
            >
              Previous
            </button>
            <button
              type="button"
              disabled={page >= pages || loading}
              onClick={() => setPage((p) => p + 1)}
              className="rounded-lg border border-slate-700 px-3 py-1.5 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
