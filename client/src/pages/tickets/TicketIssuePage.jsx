import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../../api.js';
import { presetMessages, useMessage } from '../../messages/index.js';
import { VOUCHER_DESIGNS } from '../../portal/designs.js';
import { downloadVouchersPdf, sheetOptions } from '../../utils/exportVouchersPdf.js';
import { money } from './common.js';
import {
  SellerOutstandingByTypePanel,
  sellerOutstandingByTicketType,
} from './SellerOutstandingByType.jsx';

function batchLabel(b) {
  const when = b.createdAt ? new Date(b.createdAt).toLocaleDateString() : '';
  return `${b.batchId || 'No batch'}${when ? ` · ${when}` : ''} · ${b.available} left`;
}

export function TicketIssuePage() {
  const { showSuccess } = useMessage();
  const [stock, setStock] = useState(null);
  const [stockLoading, setStockLoading] = useState(false);
  const [batchId, setBatchId] = useState('');
  const [wholeBatch, setWholeBatch] = useState(false);
  const [lastIssue, setLastIssue] = useState(null);
  const [printDesign, setPrintDesign] = useState('grid');
  const [printTitle, setPrintTitle] = useState('');
  const [printSheet, setPrintSheet] = useState('auto');
  const [printBusy, setPrintBusy] = useState('');
  const [sites, setSites] = useState([]);
  const [types, setTypes] = useState([]);
  const [sales, setSales] = useState([]);
  const [siteSellers, setSiteSellers] = useState([]);
  const [saleSiteId, setSaleSiteId] = useState('');
  const [sellTypeId, setSellTypeId] = useState('');
  /** 'saved' = pick from TicketSiteSeller; 'legacy' = free-text name (no site seller row). */
  const [sellerMode, setSellerMode] = useState('saved');
  const [ticketSiteSellerId, setTicketSiteSellerId] = useState('');
  const [sellerName, setSellerName] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [sellerPhone, setSellerPhone] = useState('');
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [sellerOpenIssues, setSellerOpenIssues] = useState([]);
  const [outstandingLoading, setOutstandingLoading] = useState(false);

  async function load() {
    setErr('');
    try {
      const [s, t, issued] = await Promise.all([
        apiFetch('/api/ticket-sales/sites'),
        apiFetch('/api/ticket-sales/types'),
        apiFetch('/api/ticket-sales/sales?kind=issued&limit=60'),
      ]);
      const ss = Array.isArray(s) ? s : [];
      setSites(ss);
      setTypes(Array.isArray(t) ? t : []);
      setSales(Array.isArray(issued) ? issued : []);
      if (!saleSiteId && ss.length > 0) setSaleSiteId(String(ss[0]._id));
    } catch (e) {
      setErr(e.message || 'Could not load issue form');
    }
  }

  async function loadSiteSellers(siteId) {
    if (!siteId) {
      setSiteSellers([]);
      return;
    }
    try {
      const rows = await apiFetch(`/api/ticket-sales/sites/${encodeURIComponent(siteId)}/sellers`);
      const list = Array.isArray(rows) ? rows : [];
      setSiteSellers(list);
      const active = list.filter((x) => x.active !== false);
      if (active.length === 0) {
        setSellerMode('legacy');
        setTicketSiteSellerId('');
        return;
      }
      if (!ticketSiteSellerId || !active.some((x) => String(x._id) === String(ticketSiteSellerId))) {
        const first = active[0];
        setTicketSiteSellerId(String(first._id));
        setSellerPhone(String(first.phone || '').trim());
      }
    } catch {
      setSiteSellers([]);
      setSellerMode('legacy');
      setTicketSiteSellerId('');
    }
  }

  useEffect(() => {
    load();
    apiFetch('/api/organization')
      .then((o) => {
        const id = o?.billing?.voucherDesign;
        if (VOUCHER_DESIGNS.some((d) => d.id === id)) setPrintDesign(id);
        setPrintTitle(String(o?.billing?.voucherTitle || '').trim());
        setPrintSheet(o?.billing?.voucherSheet || 'auto');
      })
      .catch(() => {});
  }, []);

  async function loadStock(typeId) {
    if (!typeId) {
      setStock(null);
      return;
    }
    setStockLoading(true);
    try {
      setStock(await apiFetch(`/api/ticket-sales/types/${encodeURIComponent(typeId)}/stock`));
    } catch {
      setStock(null);
    } finally {
      setStockLoading(false);
    }
  }

  useEffect(() => {
    setBatchId('');
    setWholeBatch(false);
    loadStock(sellTypeId);
  }, [sellTypeId]);

  function printCodes(codes, label) {
    setErr('');
    try {
      const { printed, skipped } = downloadVouchersPdf(codes, {
        title: printTitle || 'Wi‑Fi Access',
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

  useEffect(() => {
    if (!saleSiteId) return;
    loadSiteSellers(saleSiteId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saleSiteId]);

  const options = useMemo(
    () => types.filter((t) => t.active && (!saleSiteId || String(t.siteId) === String(saleSiteId))),
    [types, saleSiteId]
  );
  const sellType = useMemo(() => types.find((t) => String(t._id) === String(sellTypeId)), [types, sellTypeId]);
  const linked = Boolean(stock?.linked);
  const namedBatches = useMemo(() => (stock?.batches || []).filter((b) => b.batchId), [stock]);
  const selectedBatch = useMemo(() => namedBatches.find((b) => b.batchId === batchId), [namedBatches, batchId]);
  const issueQty = linked && wholeBatch && selectedBatch ? selectedBatch.available : Number(quantity || 0);
  const available = linked ? (selectedBatch ? selectedBatch.available : Number(stock?.available || 0)) : null;
  const shortStock = linked && issueQty > available;
  const activeSiteSellers = useMemo(() => siteSellers.filter((x) => x.active !== false), [siteSellers]);
  const selectedSiteSeller = useMemo(
    () => activeSiteSellers.find((x) => String(x._id) === String(ticketSiteSellerId)),
    [activeSiteSellers, ticketSiteSellerId]
  );
  const effectiveSellerName =
    sellerMode === 'saved' && selectedSiteSeller
      ? String(selectedSiteSeller.name || '').trim()
      : String(sellerName || '').trim();

  const outstandingBreakdown = useMemo(
    () => sellerOutstandingByTicketType(options, sellerOpenIssues),
    [options, sellerOpenIssues]
  );

  useEffect(() => {
    let cancelled = false;
    const site = String(saleSiteId || '').trim();
    const seller = String(effectiveSellerName || '').trim();
    if (!site || !seller) {
      setSellerOpenIssues([]);
      setOutstandingLoading(false);
      return undefined;
    }
    setOutstandingLoading(true);
    const qs = new URLSearchParams({ siteId: site, sellerName: seller });
    apiFetch(`/api/ticket-sales/issues/open?${qs}`)
      .then((rows) => {
        if (!cancelled) setSellerOpenIssues(Array.isArray(rows) ? rows : []);
      })
      .catch(() => {
        if (!cancelled) setSellerOpenIssues([]);
      })
      .finally(() => {
        if (!cancelled) setOutstandingLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [saleSiteId, effectiveSellerName]);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      const body = {
        ticketTypeId: sellTypeId,
        quantity: linked && wholeBatch && selectedBatch ? selectedBatch.available : Number(quantity),
        note: note.trim() || undefined,
      };
      if (linked && batchId) body.batchId = batchId;
      if (sellerMode === 'saved' && ticketSiteSellerId) {
        body.ticketSiteSellerId = ticketSiteSellerId;
        if (sellerPhone.trim()) body.sellerPhone = sellerPhone.trim();
      } else {
        body.sellerName = String(sellerName || '').trim();
        if (sellerPhone.trim()) body.sellerPhone = sellerPhone.trim();
      }
      const issued = await apiFetch('/api/ticket-sales/sales', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      showSuccess(presetMessages.ticketsIssued);
      setLastIssue({ ...issued, typeLabel: sellType?.label || 'Ticket' });
      setSellerName('');
      setQuantity(1);
      setSellerPhone('');
      setNote('');
      setWholeBatch(false);
      await Promise.all([load(), loadSiteSellers(saleSiteId), loadStock(sellTypeId)]);
    } catch (e2) {
      setErr(e2.message || 'Could not save issued tickets');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-white">Issue tickets</h1>
        <p className="mt-1 text-sm text-slate-400">
          Record ticket batches issued to sellers. Manage{' '}
          <Link to="/tickets/sites" className="text-emerald-400 underline hover:text-emerald-300">
            sellers per site
          </Link>{' '}
          under Ticket sites.
        </p>
      </div>
      {err && <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">{err}</p>}
      <form onSubmit={submit} className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5 grid gap-3 sm:grid-cols-2">
        <label className="text-sm text-slate-300">
          Site
          <select
            value={saleSiteId}
            onChange={(e) => {
              setSaleSiteId(e.target.value);
              setSellTypeId('');
            }}
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
          >
            <option value="">Select site…</option>
            {sites.filter((s) => s.active !== false).map((s) => (
              <option key={s._id} value={s._id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm text-slate-300">
          Ticket type
          <select value={sellTypeId} onChange={(e) => setSellTypeId(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2">
            <option value="">Select ticket…</option>
            {options.map((t) => (
              <option key={t._id} value={t._id}>
                {t.label} - {money(t.priceCents)}
              </option>
            ))}
          </select>
        </label>
        <div className="text-sm text-slate-300 sm:col-span-2">
          Receiver / seller
          <div className="mt-1 grid gap-2 sm:grid-cols-2">
            <label className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2">
              <input
                type="radio"
                name="sellerMode"
                checked={sellerMode === 'saved'}
                onChange={() => setSellerMode('saved')}
                disabled={activeSiteSellers.length === 0}
              />
              <span>Saved seller for this site</span>
            </label>
            <label className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2">
              <input type="radio" name="sellerMode" checked={sellerMode === 'legacy'} onChange={() => setSellerMode('legacy')} />
              <span>One-off name (not saved)</span>
            </label>
          </div>
          {sellerMode === 'saved' ? (
            <select
              value={ticketSiteSellerId}
              onChange={(e) => {
                const id = e.target.value;
                setTicketSiteSellerId(id);
                const row = activeSiteSellers.find((x) => String(x._id) === id);
                setSellerPhone(String(row?.phone || '').trim());
              }}
              disabled={activeSiteSellers.length === 0}
              className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 disabled:opacity-60"
            >
              {activeSiteSellers.length === 0 ? (
                <option value="">No sellers for this site yet — add under Ticket sites</option>
              ) : (
                activeSiteSellers.map((row) => (
                  <option key={row._id} value={row._id}>
                    {row.name}
                    {row.phone ? ` · ${row.phone}` : ''}
                  </option>
                ))
              )}
            </select>
          ) : (
            <input
              value={sellerName}
              onChange={(e) => setSellerName(e.target.value)}
              required={sellerMode === 'legacy'}
              placeholder="Enter receiver name"
              className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
            />
          )}
        </div>
        <SellerOutstandingByTypePanel
          heading="Outstanding by ticket type (this seller)"
          contextLine={
            saleSiteId && String(effectiveSellerName || '').trim()
              ? `${String(effectiveSellerName).trim()} · ${sites.find((s) => String(s._id) === String(saleSiteId))?.name || 'Site'}`
              : ''
          }
          placeholder="Select site and receiver to see remaining quantity and amount for each ticket type."
          breakdown={outstandingBreakdown}
          loading={outstandingLoading}
        />
        {sellTypeId ? (
          <div
            className={`sm:col-span-2 rounded-lg border px-3 py-2 text-sm ${
              linked ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-100' : 'border-slate-700 bg-slate-950 text-slate-400'
            }`}
          >
            {stockLoading ? (
              'Checking ticket stock…'
            ) : linked ? (
              <>
                <strong>{stock.available}</strong> unused hotspot code{stock.available === 1 ? '' : 's'} ready to hand out. The
                seller owes for each code once a customer uses it.
                {stock.available === 0 ? (
                  <>
                    {' '}
                    <Link to="/hotspot" className="text-emerald-300 underline">
                      Generate tickets
                    </Link>{' '}
                    for this plan first.
                  </>
                ) : null}
              </>
            ) : (
              <>
                Count only: no hotspot codes are attached, so the seller owes for every ticket issued. To hand out real codes, link
                this type to a hotspot plan under{' '}
                <Link to="/tickets/types" className="text-emerald-400 underline">
                  Ticket types
                </Link>{' '}
                and the site to a router under{' '}
                <Link to="/tickets/sites" className="text-emerald-400 underline">
                  Ticket sites
                </Link>
                .
              </>
            )}
          </div>
        ) : null}
        {linked && namedBatches.length > 0 ? (
          <label className="text-sm text-slate-300">
            Print batch
            <select
              value={batchId}
              onChange={(e) => {
                setBatchId(e.target.value);
                if (!e.target.value) setWholeBatch(false);
              }}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
            >
              <option value="">Any (oldest codes first)</option>
              {namedBatches.map((b) => (
                <option key={b.batchId} value={b.batchId}>
                  {batchLabel(b)}
                </option>
              ))}
            </select>
            {selectedBatch ? (
              <span className="mt-1 flex items-center gap-2 text-xs text-slate-400">
                <input type="checkbox" checked={wholeBatch} onChange={(e) => setWholeBatch(e.target.checked)} />
                Issue the whole batch ({selectedBatch.available})
              </span>
            ) : null}
          </label>
        ) : null}
        <label className="text-sm text-slate-300">
          Quantity
          <input
            type="number"
            min={1}
            value={linked && wholeBatch && selectedBatch ? selectedBatch.available : quantity}
            disabled={linked && wholeBatch && Boolean(selectedBatch)}
            onChange={(e) => setQuantity(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 disabled:opacity-60"
          />
          {shortStock ? (
            <span className="mt-1 block text-xs text-amber-300">Only {available} in stock.</span>
          ) : null}
        </label>
        <label className="text-sm text-slate-300 sm:col-span-2">
          Receiver mobile (Ghana SMS, optional — overrides saved seller phone when using saved seller)
          <input
            value={sellerPhone}
            onChange={(e) => setSellerPhone(e.target.value)}
            placeholder="e.g. 054… or 233…"
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
          />
          <span className="mt-1 block text-xs text-slate-500">SMS includes quantity and total amount issued.</span>
        </label>
        <label className="text-sm text-slate-300 sm:col-span-2">
          Note (optional)
          <input value={note} onChange={(e) => setNote(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2" />
        </label>
        <div className="sm:col-span-2 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-300">
          Face value: <strong className="text-white">{money((sellType?.priceCents || 0) * issueQty)}</strong>
          {linked ? <span className="text-slate-500"> · owed as codes get used</span> : null}
        </div>
        <button
          type="submit"
          disabled={
            busy ||
            !sellTypeId ||
            stockLoading ||
            shortStock ||
            issueQty < 1 ||
            (sellerMode === 'saved' && (!ticketSiteSellerId || activeSiteSellers.length === 0)) ||
            (sellerMode === 'legacy' && !String(sellerName || '').trim())
          }
          className="sm:col-span-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          {busy ? 'Issuing…' : linked ? `Issue ${issueQty || ''} code${issueQty === 1 ? '' : 's'}` : 'Save issued tickets'}
        </button>
      </form>
      {lastIssue ? (
        <section className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg text-white">
                Issued {lastIssue.quantity} × {lastIssue.typeLabel} to {lastIssue.sellerName}
              </h2>
              <p className="mt-1 text-sm text-slate-400">
                {lastIssue.linked
                  ? 'Print these codes and hand them over. They are now reserved for this seller.'
                  : 'Count-only issue recorded.'}
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
                  onClick={() => printCodes(lastIssue.codes, `${lastIssue.sellerName}-${lastIssue.typeLabel}`)}
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
        <h2 className="text-lg text-white">Recent issued batches</h2>
        <ul className="mt-3 space-y-2 text-sm text-slate-300">
          {sales.map((s) => (
            <li key={s._id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-800 px-3 py-2">
              <span>
                {new Date(s.soldAt || s.createdAt).toLocaleDateString()} · {s.siteId?.name || 'Site'} ·{' '}
                {s.ticketTypeId?.label || 'Ticket'} · {s.sellerName || '—'} · Qty {s.quantity} · {money(s.amountCents)}
                {s.linked ? (
                  <span className="ml-2 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[11px] text-emerald-300">codes</span>
                ) : null}
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
          {sales.length === 0 && <li className="text-slate-500">No issued entries yet.</li>}
        </ul>
      </section>
    </div>
  );
}
