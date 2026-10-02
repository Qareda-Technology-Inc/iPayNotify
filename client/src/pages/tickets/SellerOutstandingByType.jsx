import { money } from './common.js';

/**
 * One seller's position per ticket type at a site (sums their open issues).
 * @param {Array<{ _id?: string, label?: string, priceCents?: number, active?: boolean }>} typesAtSite
 * @param {Array<{ ticketTypeId?: { _id?: unknown }, balanceCents?: number, holdingQty?: number }>} openIssueRows from GET /issues/open
 */
export function sellerOutstandingByTicketType(typesAtSite, openIssueRows) {
  const sums = new Map();
  for (const row of openIssueRows || []) {
    const tid =
      row.ticketTypeId != null && typeof row.ticketTypeId === 'object' && row.ticketTypeId._id != null
        ? String(row.ticketTypeId._id)
        : '';
    const cur = sums.get(tid) || { owedCents: 0, creditCents: 0, holdingQty: 0 };
    const bal = Number(row.balanceCents ?? row.remainingCents ?? 0);
    if (bal > 0) cur.owedCents += bal;
    else cur.creditCents += -bal;
    cur.holdingQty += Number(row.holdingQty || 0);
    sums.set(tid, cur);
  }
  const list = (typesAtSite || [])
    .filter((t) => t.active !== false)
    .map((t) => {
      const id = String(t._id || '');
      const s = sums.get(id) || { owedCents: 0, creditCents: 0, holdingQty: 0 };
      return { ticketTypeId: id, label: t.label || '—', ...s };
    })
    .sort((a, b) => String(a.label).localeCompare(String(b.label)));

  return { rows: list };
}

export function SellerOutstandingByTypePanel({ heading, contextLine, placeholder, breakdown, loading }) {
  const rows = breakdown?.rows || [];
  const owed = rows.reduce((s, r) => s + r.owedCents, 0);
  const credit = rows.reduce((s, r) => s + r.creditCents, 0);
  const holding = rows.reduce((s, r) => s + r.holdingQty, 0);

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
                <th className="py-1.5 pr-2 font-medium">Still holding</th>
                <th className="py-1.5 text-right font-medium">Owes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80">
              {rows.map((r) => (
                <tr key={r.ticketTypeId || r.label}>
                  <td className="py-1.5 pr-2 text-slate-200">{r.label}</td>
                  <td className="py-1.5 pr-2 font-mono text-slate-400">{r.holdingQty || '—'}</td>
                  <td className={`py-1.5 text-right ${r.owedCents > 0 ? 'font-medium text-amber-300' : 'text-slate-600'}`}>
                    {money(r.owedCents)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 border-t border-slate-800 pt-2 text-xs text-slate-400">
            Owes <strong className={owed > 0 ? 'text-amber-200' : 'text-slate-500'}>{money(owed)}</strong>
            {' · '}holding {holding} ticket{holding === 1 ? '' : 's'}
            {credit > 0 ? (
              <>
                {' · '}paid ahead <strong className="text-emerald-300">{money(credit)}</strong>
              </>
            ) : null}
          </p>
        </div>
      ) : null}
    </div>
  );
}
