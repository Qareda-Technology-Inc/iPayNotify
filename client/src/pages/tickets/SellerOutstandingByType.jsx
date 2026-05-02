import { money } from './common.js';

/**
 * Outstanding cash per ticket type at a site for one seller (sums open issued batches).
 * @param {Array<{ _id?: string, label?: string, priceCents?: number, active?: boolean }>} typesAtSite
 * @param {Array<{ ticketTypeId?: { _id?: unknown }, remainingCents?: number }>} openIssueRows from GET /issues/open
 */
export function sellerOutstandingByTicketType(typesAtSite, openIssueRows) {
  const sums = new Map();
  for (const row of openIssueRows || []) {
    const tid =
      row.ticketTypeId != null && typeof row.ticketTypeId === 'object' && row.ticketTypeId._id != null
        ? String(row.ticketTypeId._id)
        : '';
    sums.set(tid, (sums.get(tid) || 0) + Number(row.remainingCents || 0));
  }
  const list = (typesAtSite || [])
    .filter((t) => t.active !== false)
    .map((t) => {
      const id = String(t._id || '');
      const remainingCents = sums.get(id) ?? 0;
      const price = Number(t.priceCents || 0);
      const remainingQtyApprox = price > 0 ? Number((remainingCents / price).toFixed(2)) : null;
      return {
        ticketTypeId: id,
        label: t.label || '—',
        remainingCents,
        remainingQtyApprox,
      };
    })
    .sort((a, b) => String(a.label).localeCompare(String(b.label)));

  return { rows: list };
}

export function SellerOutstandingByTypePanel({
  heading,
  contextLine,
  placeholder,
  breakdown,
  loading,
}) {
  const rows = breakdown?.rows || [];
  const total = rows.reduce((s, r) => s + Number(r.remainingCents || 0), 0);

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-3 text-sm sm:col-span-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{heading}</p>
      {!contextLine && placeholder ? <p className="mt-2 text-slate-500">{placeholder}</p> : null}
      {contextLine ? <p className="mt-1 text-xs text-slate-400">{contextLine}</p> : null}
      {contextLine && loading ? <p className="mt-2 text-slate-500">Loading balances…</p> : null}
      {contextLine && !loading && rows.length === 0 ? (
        <p className="mt-2 text-slate-500">No active ticket types for this site.</p>
      ) : null}
      {contextLine && !loading && rows.length > 0 ? (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[280px] text-left text-xs text-slate-300">
            <thead>
              <tr className="border-b border-slate-800 text-slate-500">
                <th className="py-1.5 pr-2 font-medium">Ticket type</th>
                <th className="py-1.5 pr-2 font-medium">Qty left</th>
                <th className="py-1.5 font-medium text-right">Remaining</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80">
              {rows.map((r) => (
                <tr key={r.ticketTypeId || r.label}>
                  <td className="py-1.5 pr-2 text-slate-200">{r.label}</td>
                  <td className="py-1.5 pr-2 font-mono text-slate-400">
                    {r.remainingQtyApprox != null ? r.remainingQtyApprox : '—'}
                  </td>
                  <td className={`py-1.5 text-right ${r.remainingCents > 0 ? 'font-medium text-amber-300' : 'text-slate-600'}`}>
                    {money(r.remainingCents)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 border-t border-slate-800 pt-2 text-xs text-slate-400">
            Total outstanding{' '}
            <strong className={total > 0 ? 'text-amber-200' : 'text-slate-500'}>{money(total)}</strong>
          </p>
        </div>
      ) : null}
    </div>
  );
}
