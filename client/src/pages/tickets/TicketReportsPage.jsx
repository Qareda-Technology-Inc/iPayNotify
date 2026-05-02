import { useEffect, useState } from 'react';
import { apiFetch } from '../../api.js';
import { money } from './common.js';

export function TicketReportsPage() {
  const [sites, setSites] = useState([]);
  const [siteId, setSiteId] = useState('');
  const [summary, setSummary] = useState(null);
  const [sales, setSales] = useState([]);
  const [err, setErr] = useState('');

  async function load() {
    setErr('');
    try {
      const qs = siteId ? `?siteId=${encodeURIComponent(siteId)}` : '';
      const salesQs = siteId
        ? `?limit=80&siteId=${encodeURIComponent(siteId)}`
        : '?limit=80';
      const [sum, rows, siteRows] = await Promise.all([
        apiFetch(`/api/ticket-sales/summary${qs}`),
        apiFetch(`/api/ticket-sales/sales${salesQs}`),
        apiFetch('/api/ticket-sales/sites'),
      ]);
      setSummary(sum || null);
      setSales(Array.isArray(rows) ? rows : []);
      const normalizedSites = Array.isArray(siteRows) ? siteRows : [];
      setSites(normalizedSites);
      if (siteId && !normalizedSites.some((s) => String(s._id) === String(siteId))) {
        setSiteId('');
      }
    } catch (e) {
      setErr(e.message || 'Could not load ticket reports');
    }
  }

  useEffect(() => {
    load();
  }, [siteId]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-white">Ticket reports</h1>
        <p className="mt-1 text-sm text-slate-400">Issued vs collected reconciliation and recent activity.</p>
      </div>
      <section className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4">
        <label className="text-sm text-slate-300">
          Filter by site
          <select
            value={siteId}
            onChange={(e) => setSiteId(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 sm:max-w-md"
          >
            <option value="">All sites</option>
            {sites.filter((s) => s.active !== false).map((s) => (
              <option key={s._id} value={s._id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      </section>
      {err && <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">{err}</p>}
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Outstanding money</p>
          <p className="mt-2 text-2xl font-semibold text-amber-300">{money(summary?.overview?.overall?.remainingCents || 0)}</p>
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Remaining tickets (open)</p>
          <p className="mt-2 text-2xl font-semibold text-white">{Number(summary?.overview?.overall?.remainingOpenQty || 0)}</p>
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Open batches</p>
          <p className="mt-2 text-2xl font-semibold text-white">{Number(summary?.overview?.overall?.remainingOpenBatches || 0)}</p>
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Total transactions</p>
          <p className="mt-2 text-2xl font-semibold text-cyan-300">{Number(summary?.overview?.overall?.totalTransactions || 0)}</p>
        </div>
      </section>
      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5">
          <h3 className="text-base font-medium text-white">Issued vs collected by site (today)</h3>
          <ul className="mt-3 space-y-2 text-sm">
            {(summary?.bySite || []).map((r) => (
              <li key={String(r.siteId)} className="flex items-center justify-between rounded-lg border border-slate-800 px-3 py-2 text-slate-300">
                <span>{r.siteName}</span>
                <span>
                  Issued {money(r.issuedCents)} · Collected {money(r.collectedCents)} ·{' '}
                  <strong className={r.varianceCents > 0 ? 'text-red-300' : 'text-emerald-300'}>Gap {money(r.varianceCents)}</strong>
                </span>
              </li>
            ))}
            {(summary?.bySite || []).length === 0 && <li className="text-slate-500">No sales yet today.</li>}
          </ul>
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5">
          <h3 className="text-base font-medium text-white">Issued vs collected by seller (today)</h3>
          <ul className="mt-3 space-y-2 text-sm">
            {(summary?.bySeller || []).map((r) => (
              <li key={`${r.siteId || 'none'}-${r.sellerName}`} className="flex items-center justify-between rounded-lg border border-slate-800 px-3 py-2 text-slate-300">
                <span>{r.sellerName} <span className="ml-2 text-xs text-slate-500">({r.siteName})</span></span>
                <span>
                  Issued {money(r.issuedCents)} · Collected {money(r.collectedCents)} ·{' '}
                  <strong className={r.varianceCents > 0 ? 'text-red-300' : 'text-emerald-300'}>Gap {money(r.varianceCents)}</strong>
                </span>
              </li>
            ))}
            {(summary?.bySeller || []).length === 0 && <li className="text-slate-500">No sales yet today.</li>}
          </ul>
        </div>
      </section>
      <section className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5">
        <h3 className="text-base font-medium text-white">Remaining by ticket type</h3>
        <ul className="mt-3 space-y-2 text-sm">
          {(summary?.remainingByType || []).map((r) => (
            <li
              key={String(r.ticketTypeId)}
              className="flex items-center justify-between rounded-lg border border-slate-800 px-3 py-2 text-slate-300"
            >
              <span>
                {r.ticketTypeLabel}
                {r.durationDays > 0 ? (
                  <span className="ml-2 text-xs text-slate-500">({r.durationDays} day)</span>
                ) : null}
              </span>
              <span>
                Remaining tickets {Number(r.remainingQty || 0)} · Money {money(r.remainingCents)} · Batches {Number(r.openBatches || 0)}
              </span>
            </li>
          ))}
          {(summary?.remainingByType || []).length === 0 && (
            <li className="text-slate-500">No remaining open quantities for the selected filter.</li>
          )}
        </ul>
      </section>
      <section className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5">
        <h3 className="text-base font-medium text-white">Recent ticket entries</h3>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="text-slate-500">
              <tr>
                <th className="px-2 py-2">Time</th>
                <th className="px-2 py-2">Site</th>
                <th className="px-2 py-2">Type</th>
                <th className="px-2 py-2">Qty</th>
                <th className="px-2 py-2">Seller (batch)</th>
                <th className="px-2 py-2">Cash from</th>
                <th className="px-2 py-2">Entry</th>
                <th className="px-2 py-2">Recorded by</th>
                <th className="px-2 py-2">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800 text-slate-300">
              {sales.map((s) => (
                <tr key={s._id}>
                  <td className="px-2 py-2">{new Date(s.soldAt || s.createdAt).toLocaleString()}</td>
                  <td className="px-2 py-2">{s.siteId?.name || '—'}</td>
                  <td className="px-2 py-2">{s.ticketTypeId?.label || (s.kind === 'collected' ? 'Cash collection' : '—')}</td>
                  <td className="px-2 py-2">
                    {s.kind === 'collected' && Number(s.ticketTypeId?.priceCents || 0) > 0
                      ? Number(
                          (
                            Number(s.amountCents || 0) /
                            Number(s.ticketTypeId?.priceCents || 1)
                          ).toFixed(2)
                        )
                      : s.quantity}
                  </td>
                  <td className="px-2 py-2">{s.sellerName || '—'}</td>
                  <td className="px-2 py-2">
                    {s.kind === 'collected'
                      ? s.receivedFromName?.trim()
                        ? s.receivedFromName.trim()
                        : 'Seller (same person)'
                      : '—'}
                  </td>
                  <td className="px-2 py-2">{s.kind === 'collected' ? 'Collected' : 'Issued'}</td>
                  <td className="px-2 py-2">
                    {String(s.sellerAdminId?.fullName || '').trim() || s.sellerAdminId?.email || '—'}
                  </td>
                  <td className="px-2 py-2 font-semibold text-emerald-300">{money(s.amountCents)}</td>
                </tr>
              ))}
              {sales.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-2 py-6 text-center text-slate-500">No entries yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

