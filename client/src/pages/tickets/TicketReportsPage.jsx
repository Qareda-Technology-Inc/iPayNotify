import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../../api.js';
import { useMessage } from '../../messages/index.js';
import { PERIOD_PRESETS as PRESETS, downloadCsv, ghs, isoDate, money, rangeFor, rangeLabel as labelOf } from './common.js';

const KIND_LABEL = { issued: 'Issued', collected: 'Collected', returned: 'Returned' };

function Card({ label, value, tone = 'text-white', sub }) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4">
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-2 text-2xl font-semibold ${tone}`}>{value}</p>
      {sub ? <p className="mt-1 text-xs text-slate-500">{sub}</p> : null}
    </div>
  );
}

function agingBucket(s) {
  if (s.balanceCents <= 0) return '';
  if (s.daysOwing > 14) return '15+ days';
  if (s.daysOwing > 7) return '8–14 days';
  return '0–7 days';
}

export function TicketReportsPage() {
  const { showSuccess } = useMessage();
  const [sites, setSites] = useState([]);
  const [siteId, setSiteId] = useState('');
  const [preset, setPreset] = useState('today');
  const [customFrom, setCustomFrom] = useState(isoDate(new Date()));
  const [customTo, setCustomTo] = useState(isoDate(new Date()));
  const [kind, setKind] = useState('');
  const [showVoided, setShowVoided] = useState(false);
  const [summary, setSummary] = useState(null);
  const [sales, setSales] = useState([]);
  const [role, setRole] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  const range = useMemo(() => rangeFor(preset, customFrom, customTo), [preset, customFrom, customTo]);
  const canVoid = role === 'org_admin' || role === 'super_admin';

  const load = useCallback(async () => {
    setErr('');
    setLoading(true);
    try {
      const q = new URLSearchParams({ from: range.from.toISOString(), to: range.to.toISOString() });
      if (siteId) q.set('siteId', siteId);
      const sq = new URLSearchParams(q);
      sq.set('limit', '2000');
      if (kind) sq.set('kind', kind);
      if (showVoided) sq.set('includeVoided', '1');
      const [sum, rows] = await Promise.all([
        apiFetch(`/api/ticket-sales/summary?${q}`),
        apiFetch(`/api/ticket-sales/sales?${sq}`),
      ]);
      setSummary(sum || null);
      setSales(Array.isArray(rows) ? rows : []);
    } catch (e) {
      setErr(e.message || 'Could not load ticket reports');
    } finally {
      setLoading(false);
    }
  }, [range, siteId, kind, showVoided]);

  useEffect(() => {
    apiFetch('/api/ticket-sales/sites')
      .then((s) => setSites(Array.isArray(s) ? s : []))
      .catch(() => {});
    apiFetch('/api/auth/me')
      .then((m) => setRole(String(m?.admin?.role || '')))
      .catch(() => {});
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function voidRow(s) {
    const reason = window.prompt(
      `Void this ${KIND_LABEL[s.kind]?.toLowerCase() || 'entry'} of ${money(s.amountCents)} for ${s.sellerName}? Give a reason:`
    );
    if (!reason || !reason.trim()) return;
    setErr('');
    try {
      await apiFetch(`/api/ticket-sales/sales/${s._id}/void`, {
        method: 'POST',
        body: JSON.stringify({ reason: reason.trim() }),
      });
      showSuccess('Entry voided.');
      await load();
    } catch (e) {
      setErr(e.message || 'Could not void the entry');
    }
  }

  const inRange = summary?.inRange || {};
  const pos = summary?.position || {};
  const sellers = summary?.sellers || [];
  const owingSellers = sellers.filter((s) => s.balanceCents !== 0 || s.holdingQty > 0);
  const rangeLabel = labelOf(range);
  const fileStamp = `${isoDate(range.from)}_${isoDate(range.to)}`;

  function exportSellers() {
    downloadCsv(
      `ticket-seller-balances-${isoDate(new Date())}.csv`,
      ['Seller', 'Phone', 'Site', 'Issued qty', 'Used', 'Holding', 'Returned', 'Owed GHS', 'Paid GHS', 'Balance GHS', 'Days owing'],
      sellers.map((s) => [
        s.sellerName,
        s.sellerPhone,
        s.siteName,
        s.issuedQty,
        s.usedQty,
        s.holdingQty,
        s.returnedQty,
        ghs(s.owedCents),
        ghs(s.collectedCents),
        ghs(s.balanceCents),
        s.balanceCents > 0 ? s.daysOwing : '',
      ])
    );
  }

  function exportActivity() {
    downloadCsv(
      `ticket-activity-${fileStamp}.csv`,
      ['Time', 'Entry', 'Site', 'Ticket', 'Seller', 'Qty', 'Amount GHS', 'Cash from', 'Recorded by', 'Note', 'Voided', 'Void reason'],
      sales.map((s) => [
        new Date(s.soldAt || s.createdAt).toISOString(),
        KIND_LABEL[s.kind] || s.kind,
        s.siteId?.name || '',
        s.ticketTypeId?.label || '',
        s.sellerName,
        s.quantity,
        ghs(s.amountCents),
        s.receivedFromName || '',
        String(s.sellerAdminId?.fullName || '').trim() || s.sellerAdminId?.email || '',
        s.note || '',
        s.voidedAt ? new Date(s.voidedAt).toISOString() : '',
        s.voidReason || '',
      ])
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-white">Ticket reports</h1>
        <p className="mt-1 text-sm text-slate-400">
          What sellers owe right now, and what was issued, collected and returned in the period you pick.
        </p>
      </div>

      <section className="flex flex-wrap items-end gap-3 rounded-2xl border border-slate-800 bg-slate-900/40 p-4">
        <label className="text-sm text-slate-300">
          Site
          <select
            value={siteId}
            onChange={(e) => setSiteId(e.target.value)}
            className="mt-1 block rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
          >
            <option value="">All sites</option>
            {sites.map((s) => (
              <option key={s._id} value={s._id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <div className="text-sm text-slate-300">
          Period
          <div className="mt-1 flex flex-wrap gap-1">
            {PRESETS.map((p) => (
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
              <input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="mt-1 block rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5"
              />
            </label>
            <label className="text-sm text-slate-300">
              To
              <input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className="mt-1 block rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5"
              />
            </label>
          </>
        ) : null}
        {loading ? <span className="pb-2 text-xs text-slate-500">Loading…</span> : null}
      </section>

      {err && <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">{err}</p>}

      <div>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Right now</h2>
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Card
            label="Owed by sellers"
            value={money(pos.owedCents)}
            tone="text-amber-300"
            sub={`${pos.sellersOwing || 0} seller${pos.sellersOwing === 1 ? '' : 's'} owing`}
          />
          <Card label="Owed over 7 days" value={money(pos.overdueCents)} tone={pos.overdueCents > 0 ? 'text-red-300' : 'text-white'} />
          <Card label="Tickets with sellers" value={Number(pos.holdingQty || 0)} sub="Not yet used or returned" />
          <Card label="Paid ahead" value={money(pos.creditCents)} tone="text-emerald-300" sub="Cash for codes not used yet" />
        </section>
      </div>

      <div>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{rangeLabel}</h2>
        <section className="grid gap-4 sm:grid-cols-3">
          <Card label="Issued" value={Number(inRange.issuedQty || 0)} sub={`Face value ${money(inRange.issuedCents)}`} />
          <Card label="Cash collected" value={money(inRange.collectedCents)} tone="text-emerald-300" />
          <Card label="Returned" value={Number(inRange.returnedQty || 0)} sub={money(inRange.returnedCents)} />
        </section>
      </div>

      <section className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-base font-medium text-white">Seller balances</h3>
          <button
            type="button"
            onClick={exportSellers}
            disabled={!sellers.length}
            className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:text-white disabled:opacity-50"
          >
            Export CSV
          </button>
        </div>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm text-slate-300">
            <thead>
              <tr className="border-b border-slate-800 text-xs text-slate-500">
                <th className="py-2 pr-3 font-medium">Seller</th>
                <th className="py-2 pr-3 font-medium">Site</th>
                <th className="py-2 pr-3 text-right font-medium">Issued</th>
                <th className="py-2 pr-3 text-right font-medium">Used</th>
                <th className="py-2 pr-3 text-right font-medium">Holding</th>
                <th className="py-2 pr-3 text-right font-medium">Owed</th>
                <th className="py-2 pr-3 text-right font-medium">Paid</th>
                <th className="py-2 pr-3 text-right font-medium">Balance</th>
                <th className="py-2 text-right font-medium">Owing for</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80">
              {owingSellers.map((s) => (
                <tr key={s.sellerKey}>
                  <td className="py-2 pr-3 text-white">{s.sellerName}</td>
                  <td className="py-2 pr-3">{s.siteName}</td>
                  <td className="py-2 pr-3 text-right">{s.issuedQty}</td>
                  <td className="py-2 pr-3 text-right">{s.usedQty}</td>
                  <td className="py-2 pr-3 text-right">{s.holdingQty}</td>
                  <td className="py-2 pr-3 text-right">{money(s.owedCents)}</td>
                  <td className="py-2 pr-3 text-right">{money(s.collectedCents)}</td>
                  <td
                    className={`py-2 pr-3 text-right font-medium ${
                      s.balanceCents > 0 ? 'text-amber-300' : s.balanceCents < 0 ? 'text-emerald-300' : 'text-slate-500'
                    }`}
                  >
                    {s.balanceCents < 0 ? `${money(-s.balanceCents)} ahead` : money(s.balanceCents)}
                  </td>
                  <td
                    className={`py-2 text-right text-xs ${
                      s.daysOwing > 14 ? 'text-red-300' : s.daysOwing > 7 ? 'text-amber-300' : 'text-slate-400'
                    }`}
                  >
                    {agingBucket(s) || '—'}
                  </td>
                </tr>
              ))}
              {owingSellers.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-4 text-slate-500">
                    {sellers.length ? 'Everyone is settled.' : 'No tickets issued yet.'}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5">
          <h3 className="text-base font-medium text-white">By site</h3>
          <p className="text-xs text-slate-500">Issued and collected in the period; owed and holding right now.</p>
          <ul className="mt-3 space-y-2 text-sm">
            {(summary?.bySite || []).map((r) => (
              <li key={String(r.siteId)} className="rounded-lg border border-slate-800 px-3 py-2 text-slate-300">
                <div className="flex items-center justify-between">
                  <span className="text-white">{r.siteName}</span>
                  <strong className={r.owedCents > 0 ? 'text-amber-300' : 'text-slate-500'}>Owes {money(r.owedCents)}</strong>
                </div>
                <p className="mt-0.5 text-xs text-slate-500">
                  Issued {r.issuedQty} ({money(r.issuedCents)}) · Collected {money(r.collectedCents)}
                  {r.returnedQty ? ` · Returned ${r.returnedQty}` : ''} · Holding {r.holdingQty}
                </p>
              </li>
            ))}
            {(summary?.bySite || []).length === 0 && <li className="text-slate-500">Nothing yet.</li>}
          </ul>
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5">
          <h3 className="text-base font-medium text-white">Open by ticket type</h3>
          <ul className="mt-3 space-y-2 text-sm">
            {(summary?.remainingByType || []).map((r) => (
              <li
                key={String(r.ticketTypeId)}
                className="flex items-center justify-between rounded-lg border border-slate-800 px-3 py-2 text-slate-300"
              >
                <span>
                  {r.ticketTypeLabel}
                  {r.priceCents ? <span className="ml-2 text-xs text-slate-500">{money(r.priceCents)}</span> : null}
                </span>
                <span className="text-xs">
                  Holding {r.holdingQty} · Owes <strong className="text-amber-300">{money(r.owedCents)}</strong> ·{' '}
                  {r.openBatches} issue{r.openBatches === 1 ? '' : 's'}
                </span>
              </li>
            ))}
            {(summary?.remainingByType || []).length === 0 && <li className="text-slate-500">Nothing open.</li>}
          </ul>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-base font-medium text-white">Activity · {rangeLabel}</h3>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-slate-300"
            >
              <option value="">All entries</option>
              <option value="issued">Issued</option>
              <option value="collected">Collected</option>
              <option value="returned">Returned</option>
            </select>
            <label className="flex items-center gap-1 text-slate-400">
              <input type="checkbox" checked={showVoided} onChange={(e) => setShowVoided(e.target.checked)} />
              Show voided
            </label>
            <button
              type="button"
              onClick={exportActivity}
              disabled={!sales.length}
              className="rounded-lg border border-slate-700 px-3 py-1.5 text-slate-300 hover:text-white disabled:opacity-50"
            >
              Export CSV
            </button>
          </div>
        </div>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead className="text-xs text-slate-500">
              <tr>
                <th className="px-2 py-2">Time</th>
                <th className="px-2 py-2">Entry</th>
                <th className="px-2 py-2">Site</th>
                <th className="px-2 py-2">Ticket</th>
                <th className="px-2 py-2">Seller</th>
                <th className="px-2 py-2 text-right">Qty</th>
                <th className="px-2 py-2 text-right">Amount</th>
                <th className="px-2 py-2">Recorded by</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800 text-slate-300">
              {sales.map((s) => (
                <tr key={s._id} className={s.voidedAt ? 'opacity-50' : ''}>
                  <td className="px-2 py-2 whitespace-nowrap">{new Date(s.soldAt || s.createdAt).toLocaleString()}</td>
                  <td className="px-2 py-2">
                    {KIND_LABEL[s.kind] || s.kind}
                    {s.kind === 'issued' && s.linked ? <span className="ml-1 text-xs text-emerald-400">codes</span> : null}
                    {s.voidedAt ? (
                      <span className="ml-1 text-xs text-red-300" title={s.voidReason}>
                        voided
                      </span>
                    ) : null}
                  </td>
                  <td className="px-2 py-2">{s.siteId?.name || '—'}</td>
                  <td className="px-2 py-2">{s.ticketTypeId?.label || '—'}</td>
                  <td className="px-2 py-2">
                    {s.sellerName || '—'}
                    {s.receivedFromName ? <span className="text-xs text-slate-500"> · via {s.receivedFromName}</span> : null}
                  </td>
                  <td className="px-2 py-2 text-right">{s.quantity}</td>
                  <td
                    className={`px-2 py-2 text-right font-semibold ${
                      s.kind === 'collected' ? 'text-emerald-300' : s.kind === 'returned' ? 'text-slate-400' : 'text-white'
                    }`}
                  >
                    {money(s.amountCents)}
                  </td>
                  <td className="px-2 py-2">{String(s.sellerAdminId?.fullName || '').trim() || s.sellerAdminId?.email || '—'}</td>
                  <td className="px-2 py-2 text-right">
                    {canVoid && !s.voidedAt ? (
                      <button type="button" onClick={() => voidRow(s)} className="text-xs text-red-300 hover:text-red-200">
                        Void
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
              {sales.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-2 py-6 text-center text-slate-500">
                    No entries in this period.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
