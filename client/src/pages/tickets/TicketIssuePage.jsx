import { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../../api.js';
import { money } from './common.js';
import {
  SellerOutstandingByTypePanel,
  sellerOutstandingByTicketType,
} from './SellerOutstandingByType.jsx';

export function TicketIssuePage() {
  const [sites, setSites] = useState([]);
  const [types, setTypes] = useState([]);
  const [sales, setSales] = useState([]);
  const [knownSellerNames, setKnownSellerNames] = useState([]);
  const [saleSiteId, setSaleSiteId] = useState('');
  const [sellTypeId, setSellTypeId] = useState('');
  const [useExistingSeller, setUseExistingSeller] = useState(true);
  const [existingSellerName, setExistingSellerName] = useState('');
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

  async function loadSellerNames(site) {
    try {
      const qs = site ? `?siteId=${encodeURIComponent(site)}` : '';
      const names = await apiFetch(`/api/ticket-sales/seller-names${qs}`);
      const normalized = Array.isArray(names) ? names : [];
      setKnownSellerNames(normalized);
      if (normalized.length > 0 && !normalized.some((n) => n === existingSellerName)) {
        setExistingSellerName(normalized[0]);
      }
      if (normalized.length === 0) {
        setUseExistingSeller(false);
        setExistingSellerName('');
      }
    } catch {
      setKnownSellerNames([]);
      setUseExistingSeller(false);
      setExistingSellerName('');
    }
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (!saleSiteId) return;
    loadSellerNames(saleSiteId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saleSiteId]);

  const options = useMemo(
    () => types.filter((t) => t.active && (!saleSiteId || String(t.siteId) === String(saleSiteId))),
    [types, saleSiteId]
  );
  const sellType = useMemo(() => types.find((t) => String(t._id) === String(sellTypeId)), [types, sellTypeId]);
  const effectiveSellerName = useExistingSeller ? existingSellerName : sellerName;

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
      await apiFetch('/api/ticket-sales/sales', {
        method: 'POST',
        body: JSON.stringify({
          ticketTypeId: sellTypeId,
          sellerName: String(effectiveSellerName || '').trim(),
          quantity: Number(quantity),
          ...(sellerPhone.trim() ? { sellerPhone: sellerPhone.trim() } : {}),
          note: note.trim() || undefined,
        }),
      });
      setSellerName('');
      setQuantity(1);
      setSellerPhone('');
      setNote('');
      await load();
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
        <p className="mt-1 text-sm text-slate-400">Record ticket batches issued to sellers.</p>
      </div>
      {err && <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">{err}</p>}
      <form onSubmit={submit} className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5 grid gap-3 sm:grid-cols-2">
        <label className="text-sm text-slate-300">Site
          <select value={saleSiteId} onChange={(e) => { setSaleSiteId(e.target.value); setSellTypeId(''); }} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2">
            <option value="">Select site…</option>
            {sites.filter((s) => s.active !== false).map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}
          </select>
        </label>
        <label className="text-sm text-slate-300">Ticket type
          <select value={sellTypeId} onChange={(e) => setSellTypeId(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2">
            <option value="">Select ticket…</option>
            {options.map((t) => <option key={t._id} value={t._id}>{t.label} - {money(t.priceCents)}</option>)}
          </select>
        </label>
        <div className="text-sm text-slate-300 sm:col-span-2">
          Receiver / seller
          <div className="mt-1 grid gap-2 sm:grid-cols-2">
            <label className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2">
              <input
                type="radio"
                name="sellerMode"
                checked={useExistingSeller}
                onChange={() => setUseExistingSeller(true)}
                disabled={knownSellerNames.length === 0}
              />
              <span>Select existing person</span>
            </label>
            <label className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2">
              <input
                type="radio"
                name="sellerMode"
                checked={!useExistingSeller}
                onChange={() => setUseExistingSeller(false)}
              />
              <span>Enter new person</span>
            </label>
          </div>
          {useExistingSeller ? (
            <select
              value={existingSellerName}
              onChange={(e) => setExistingSellerName(e.target.value)}
              disabled={knownSellerNames.length === 0}
              className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 disabled:opacity-60"
            >
              {knownSellerNames.length === 0 ? (
                <option value="">No existing names for this site yet</option>
              ) : (
                knownSellerNames.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))
              )}
            </select>
          ) : (
            <input
              value={sellerName}
              onChange={(e) => setSellerName(e.target.value)}
              required={!useExistingSeller}
              placeholder="Enter receiver name"
              className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
            />
          )}
        </div>
        <SellerOutstandingByTypePanel
          heading="Outstanding by ticket type (this seller)"
          contextLine={
            saleSiteId && String(effectiveSellerName || '').trim()
              ? `${String(effectiveSellerName).trim()} · ${
                  sites.find((s) => String(s._id) === String(saleSiteId))?.name || 'Site'
                }`
              : ''
          }
          placeholder="Select site and receiver name to see remaining quantity and amount for each ticket type."
          breakdown={outstandingBreakdown}
          loading={outstandingLoading}
        />
        <label className="text-sm text-slate-300">Quantity
          <input type="number" min={1} value={quantity} onChange={(e) => setQuantity(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2" />
        </label>
        <label className="text-sm text-slate-300 sm:col-span-2">
          Receiver mobile (Ghana SMS, optional)
          <input
            value={sellerPhone}
            onChange={(e) => setSellerPhone(e.target.value)}
            placeholder="e.g. 054… or 233…"
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
          />
          <span className="mt-1 block text-xs text-slate-500">SMS includes quantity and total amount issued.</span>
        </label>
        <label className="text-sm text-slate-300 sm:col-span-2">Note (optional)
          <input value={note} onChange={(e) => setNote(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2" />
        </label>
        <div className="sm:col-span-2 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-300">
          Total: <strong className="text-white">{money((sellType?.priceCents || 0) * Number(quantity || 0))}</strong>
        </div>
        <button
          type="submit"
          disabled={busy || !sellTypeId || !String(effectiveSellerName || '').trim()}
          className="sm:col-span-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          Save issued tickets
        </button>
      </form>
      <section className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5">
        <h2 className="text-lg text-white">Recent issued batches</h2>
        <ul className="mt-3 space-y-2 text-sm text-slate-300">
          {sales.map((s) => (
            <li key={s._id} className="rounded-lg border border-slate-800 px-3 py-2">
              {s.siteId?.name || 'Site'} · {s.ticketTypeId?.label || 'Ticket'} · {s.sellerName || '—'} · Qty {s.quantity} · {money(s.amountCents)}
            </li>
          ))}
          {sales.length === 0 && <li className="text-slate-500">No issued entries yet.</li>}
        </ul>
      </section>
    </div>
  );
}

