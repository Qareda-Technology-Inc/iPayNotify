import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { apiFetch } from '../../api.js';
import { presetMessages, useMessage } from '../../messages/index.js';
import { VOUCHER_DESIGNS } from '../../portal/designs.js';
import { downloadVouchersPdf, sheetOptions } from '../../utils/exportVouchersPdf.js';
import { money } from './common.js';
import { inputCls, useTicketOps } from './useTicketOps.js';

function batchLabel(b) {
  const when = b.createdAt ? new Date(b.createdAt).toLocaleDateString() : '';
  return `${b.batchId}${when ? ` · ${when}` : ''} · ${b.available} left`;
}

function Choice({ active, onClick, title, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl border px-3 py-2.5 text-left transition ${
        active ? 'border-emerald-500 bg-emerald-500/10' : 'border-slate-700 bg-slate-950 hover:border-slate-500'
      }`}
    >
      <span className="block text-sm font-semibold text-white">{title}</span>
      {children ? <span className="mt-0.5 block text-xs text-slate-400">{children}</span> : null}
    </button>
  );
}

/**
 * Issue tickets: site (router) → seller → source → plan and quantity.
 * System codes are reserved for the seller and owed as customers use them; external tickets
 * (made on another platform for the same router) are owed in full when issued.
 */
export function TicketIssuePage() {
  const { showSuccess } = useMessage();
  const [params] = useSearchParams();
  const { sites, loading, reload: reloadSites } = useTicketOps();
  const [routerId, setRouterId] = useState(params.get('router') || '');
  const [sellerId, setSellerId] = useState(params.get('seller') || '');
  const [source, setSource] = useState('system');
  const [plans, setPlans] = useState([]);
  const [packageId, setPackageId] = useState('');
  const [batchId, setBatchId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [price, setPrice] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [lastIssue, setLastIssue] = useState(null);
  const [recent, setRecent] = useState([]);
  const [printDesign, setPrintDesign] = useState('grid');
  const [printSheet, setPrintSheet] = useState('auto');
  const [printBusy, setPrintBusy] = useState('');

  const routerSites = useMemo(() => sites.filter((s) => s.routerId), [sites]);
  const site = routerSites.find((s) => s.routerId === routerId);
  const sellers = useMemo(() => (site?.sellers || []).filter((s) => s.active && s._id), [site]);
  const seller = sellers.find((s) => s._id === sellerId);
  const plan = plans.find((p) => p._id === packageId);
  const batches = plan?.batches || [];
  const batch = batches.find((b) => b.batchId === batchId);
  const qty = Math.max(0, Math.round(Number(quantity) || 0));
  const unitCents = source === 'external' ? Math.round((Number(price) || 0) * 100) : plan?.priceCents || 0;
  const available = batch ? batch.available : plan?.available || 0;
  const shortStock = source === 'system' && plan && qty > available;

  useEffect(() => {
    if (!routerId && routerSites.length === 1) setRouterId(routerSites[0].routerId);
  }, [routerSites, routerId]);

  useEffect(() => {
    /* Keep a seller from the link (?seller=) until the site's sellers have loaded. */
    if (!site) return;
    if (sellerId && !sellers.some((s) => s._id === sellerId)) setSellerId('');
    if (!sellerId && sellers.length === 1) setSellerId(sellers[0]._id);
  }, [sellers, sellerId]);

  async function loadPlans(id) {
    if (!id) {
      setPlans([]);
      return;
    }
    try {
      const d = await apiFetch(`/api/ticket-sales/ops/routers/${id}/plans`);
      setPlans(Array.isArray(d?.plans) ? d.plans : []);
    } catch (e) {
      setErr(e.message || 'Could not load plans');
    }
  }

  async function loadRecent() {
    try {
      const rows = await apiFetch('/api/ticket-sales/sales?kind=issued&limit=15');
      setRecent(Array.isArray(rows) ? rows : []);
    } catch {
      /* the list is a convenience */
    }
  }

  useEffect(() => {
    loadPlans(routerId);
    setPackageId('');
  }, [routerId]);

  useEffect(() => {
    loadRecent();
  }, []);

  useEffect(() => {
    setBatchId('');
    if (plan) setPrice((plan.priceCents / 100).toFixed(2));
  }, [packageId]); // eslint-disable-line react-hooks/exhaustive-deps

  function printCodes(codes, label) {
    setErr('');
    try {
      const { printed, skipped } = downloadVouchersPdf(codes, {
        title: 'Wi‑Fi Access',
        design: printDesign,
        sheet: printSheet,
        filename: `issued-${String(label || 'tickets').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${Date.now()}.pdf`,
      });
      showSuccess(`Downloaded ${printed} ticket${printed === 1 ? '' : 's'}${skipped ? ` (${skipped} used or expired skipped)` : ''}.`);
    } catch (e) {
      setErr(e.message || 'Could not make the PDF');
    }
  }

  async function reprint(sale) {
    setPrintBusy(String(sale._id));
    try {
      const row = await apiFetch(`/api/ticket-sales/issues/${sale._id}`);
      printCodes(row.codes || [], `${row.sellerName}-${row.ticketTypeId?.label || ''}`);
    } catch (e) {
      setErr(e.message || 'Could not load the codes');
    } finally {
      setPrintBusy('');
    }
  }

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      const issued = await apiFetch('/api/ticket-sales/ops/issue', {
        method: 'POST',
        body: JSON.stringify({
          routerId,
          sellerId,
          packageId,
          quantity: qty,
          source,
          ...(source === 'external' ? { unitPriceCents: unitCents } : batchId ? { batchId } : {}),
          note: note.trim() || undefined,
        }),
      });
      showSuccess(presetMessages.ticketsIssued);
      setLastIssue({ ...issued, planName: plan?.name || 'Ticket' });
      setQuantity('');
      setNote('');
      await Promise.all([loadPlans(routerId), loadRecent(), reloadSites()]);
    } catch (e2) {
      setErr(e2.message || 'Could not issue the tickets');
    } finally {
      setBusy(false);
    }
  }

  const canIssue = Boolean(routerId && seller && plan && qty > 0 && !shortStock && (source === 'system' || unitCents >= 0));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-white">Issue tickets</h1>
        <p className="mt-1 text-sm text-slate-400">Give tickets to a seller at a site. The seller gets an SMS with what they received.</p>
      </div>
      {err ? <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">{err}</p> : null}

      <form onSubmit={submit} className="space-y-5 rounded-2xl border border-slate-800 bg-slate-900/40 p-5">
        <label className="block text-sm text-slate-300">
          1. Site
          <select value={routerId} onChange={(e) => setRouterId(e.target.value)} className={inputCls}>
            <option value="">{loading ? 'Loading…' : 'Choose a site…'}</option>
            {routerSites.map((s) => (
              <option key={s.routerId} value={s.routerId}>
                {s.name}
              </option>
            ))}
          </select>
        </label>

        {routerId ? (
          <div className="text-sm text-slate-300">
            2. Seller
            {sellers.length ? (
              <div className="mt-2 flex flex-wrap gap-2">
                {sellers.map((s) => (
                  <Choice key={s._id} active={s._id === sellerId} onClick={() => setSellerId(s._id)} title={s.name}>
                    holding {s.holdingQty}
                    {s.balanceCents > 0 ? ` · owes ${money(s.balanceCents)}` : ''}
                  </Choice>
                ))}
              </div>
            ) : (
              <p className="mt-2 text-sm text-slate-500">
                No sellers at this site yet.{' '}
                <Link to="/tickets/sellers" className="text-emerald-400 underline">
                  Add a seller
                </Link>
              </p>
            )}
          </div>
        ) : null}

        {seller ? (
          <div className="text-sm text-slate-300">
            3. Tickets
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <Choice active={source === 'system'} onClick={() => setSource('system')} title="Codes from this system">
                Printed from here. The seller pays for each one a customer uses.
              </Choice>
              <Choice active={source === 'external'} onClick={() => setSource('external')} title="External tickets">
                Made on another platform for this router. The seller owes for all of them now.
              </Choice>
            </div>
          </div>
        ) : null}

        {seller ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm text-slate-300">
              4. Plan
              <select value={packageId} onChange={(e) => setPackageId(e.target.value)} className={inputCls}>
                <option value="">Choose a plan…</option>
                {plans.map((p) => (
                  <option key={p._id} value={p._id}>
                    {p.name} · {money(p.priceCents)}
                    {source === 'system' ? ` · ${p.available} ready` : ''}
                  </option>
                ))}
              </select>
              {source === 'system' && plan && !plan.available ? (
                <span className="mt-1 block text-xs text-amber-300">
                  No unused codes for this plan on this router.{' '}
                  <Link to="/hotspot" className="underline">
                    Generate tickets
                  </Link>{' '}
                  first.
                </span>
              ) : null}
            </label>
            {source === 'system' && batches.length ? (
              <label className="text-sm text-slate-300">
                Print batch (optional)
                <select value={batchId} onChange={(e) => setBatchId(e.target.value)} className={inputCls}>
                  <option value="">Any, oldest codes first</option>
                  {batches.map((b) => (
                    <option key={b.batchId} value={b.batchId}>
                      {batchLabel(b)}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {source === 'external' && plan ? (
              <label className="text-sm text-slate-300">
                Price per ticket (GHS)
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  className={inputCls}
                />
              </label>
            ) : null}
            <label className="text-sm text-slate-300">
              Quantity
              <input
                type="number"
                min="1"
                inputMode="numeric"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                placeholder={source === 'system' && plan ? `up to ${available}` : 'e.g. 50'}
                className={inputCls}
              />
              {shortStock ? <span className="mt-1 block text-xs text-amber-300">Only {available} ready.</span> : null}
              {source === 'system' && batch && !shortStock ? (
                <button
                  type="button"
                  onClick={() => setQuantity(String(batch.available))}
                  className="mt-1 text-xs text-emerald-400 hover:text-emerald-300"
                >
                  Whole batch ({batch.available})
                </button>
              ) : null}
            </label>
            <label className="text-sm text-slate-300">
              Note (optional)
              <input value={note} onChange={(e) => setNote(e.target.value)} className={inputCls} />
            </label>
          </div>
        ) : null}

        {seller && plan && qty > 0 ? (
          <div className="rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-slate-300">
            <strong className="text-white">{seller.name}</strong> receives {qty} × {plan.name} ({money(unitCents)} each,{' '}
            {money(unitCents * qty)} in total).{' '}
            {source === 'system' ? (
              <span className="text-slate-400">They owe as customers use the codes.</span>
            ) : (
              <span className="text-amber-200">They owe {money(unitCents * qty)} now.</span>
            )}
          </div>
        ) : null}

        <button
          type="submit"
          disabled={busy || !canIssue}
          className="w-full rounded-lg bg-emerald-600 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50 sm:w-auto sm:px-6"
        >
          {busy ? 'Issuing…' : qty > 0 ? `Issue ${qty} ticket${qty === 1 ? '' : 's'}` : 'Issue tickets'}
        </button>
      </form>

      {lastIssue ? (
        <section className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg text-white">
                Issued {lastIssue.quantity} × {lastIssue.planName} to {lastIssue.sellerName}
              </h2>
              <p className="mt-1 text-sm text-slate-400">
                {lastIssue.codes?.length
                  ? 'Print these codes and hand them over. They are now reserved for this seller.'
                  : `External tickets recorded. ${lastIssue.sellerName} owes ${money(lastIssue.amountCents)}.`}
              </p>
            </div>
            <button type="button" onClick={() => setLastIssue(null)} className="text-sm text-slate-400 hover:text-white">
              Close
            </button>
          </div>
          {lastIssue.codes?.length ? (
            <>
              <div className="mt-3 flex flex-wrap items-end gap-2">
                <label className="text-xs text-slate-400">
                  Design
                  <select
                    value={printDesign}
                    onChange={(e) => setPrintDesign(e.target.value)}
                    className="mt-1 block rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-200"
                  >
                    {VOUCHER_DESIGNS.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs text-slate-400">
                  Per page
                  <select
                    value={printSheet}
                    onChange={(e) => setPrintSheet(e.target.value)}
                    className="mt-1 block rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-200"
                  >
                    {sheetOptions(printSheet).map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  onClick={() => printCodes(lastIssue.codes, `${lastIssue.sellerName}-${lastIssue.planName}`)}
                  className="rounded-lg bg-emerald-600 px-3 py-2 text-sm text-white hover:bg-emerald-500"
                >
                  Download PDF
                </button>
              </div>
              <div className="mt-3 flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
                {lastIssue.codes.map((c) => (
                  <span key={c._id} className="rounded bg-slate-950 px-2 py-0.5 font-mono text-xs text-slate-200">
                    {c.code}
                  </span>
                ))}
              </div>
            </>
          ) : null}
        </section>
      ) : null}

      <section className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5">
        <h2 className="text-lg text-white">Recently issued</h2>
        <ul className="mt-3 divide-y divide-slate-800 text-sm text-slate-300">
          {recent.map((s) => (
            <li key={s._id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>
                {new Date(s.soldAt || s.createdAt).toLocaleDateString()} · {s.siteId?.name || 'Site'} · {s.sellerName} ·{' '}
                {s.quantity} × {s.ticketTypeId?.label || 'Ticket'} · {money(s.amountCents)}
                <span
                  className={`ml-2 rounded px-1.5 py-0.5 text-[11px] ${
                    s.linked ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-200'
                  }`}
                >
                  {s.linked ? 'system codes' : s.external ? 'external' : 'count only'}
                </span>
              </span>
              {s.linked ? (
                <button
                  type="button"
                  onClick={() => reprint(s)}
                  disabled={printBusy === String(s._id)}
                  className="text-xs text-emerald-400 hover:text-emerald-300 disabled:opacity-50"
                >
                  {printBusy === String(s._id) ? 'Preparing…' : 'Print codes'}
                </button>
              ) : null}
            </li>
          ))}
          {!recent.length ? <li className="py-2 text-slate-500">Nothing issued yet.</li> : null}
        </ul>
      </section>
    </div>
  );
}
