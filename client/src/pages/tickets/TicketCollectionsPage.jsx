import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../../api.js';
import { money } from './common.js';
import {
  SellerOutstandingByTypePanel,
  sellerOutstandingByTicketType,
} from './SellerOutstandingByType.jsx';

function idOf(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value._id) return String(value._id);
  return String(value);
}

function issuesQueryString({ siteId, ticketTypeId }) {
  const q = new URLSearchParams();
  if (siteId) q.set('siteId', siteId);
  if (ticketTypeId) q.set('ticketTypeId', ticketTypeId);
  const s = q.toString();
  return s ? `?${s}` : '';
}

export function TicketCollectionsPage() {
  const [sites, setSites] = useState([]);
  const [types, setTypes] = useState([]);
  const [openIssues, setOpenIssues] = useState([]);
  const [collections, setCollections] = useState([]);
  const [filterSiteId, setFilterSiteId] = useState('');
  const [filterTicketTypeId, setFilterTicketTypeId] = useState('');
  const [issueId, setIssueId] = useState('');
  const [amountGhs, setAmountGhs] = useState('');
  const [handoverByOther, setHandoverByOther] = useState(false);
  const [receivedFromName, setReceivedFromName] = useState('');
  const [receivedFromPhone, setReceivedFromPhone] = useState('');
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [sellerOpenAllTypes, setSellerOpenAllTypes] = useState([]);
  const [sellerOutstandingLoading, setSellerOutstandingLoading] = useState(false);

  const typesForSite = useMemo(() => {
    if (!filterSiteId) return [];
    return types.filter(
      (t) => t.active !== false && idOf(t.siteId) === String(filterSiteId)
    );
  }, [types, filterSiteId]);

  const siteNameById = useMemo(() => new Map(sites.map((s) => [String(s._id), s.name])), [sites]);

  const loadCatalog = useCallback(async () => {
    const [s, t] = await Promise.all([
      apiFetch('/api/ticket-sales/sites'),
      apiFetch('/api/ticket-sales/types'),
    ]);
    setSites(Array.isArray(s) ? s : []);
    setTypes(Array.isArray(t) ? t : []);
  }, []);

  const loadCollections = useCallback(async () => {
    const rows = await apiFetch('/api/ticket-sales/sales?kind=collected&limit=60');
    setCollections(Array.isArray(rows) ? rows : []);
  }, []);

  const loadOpenIssues = useCallback(
    async (siteId, ticketTypeId) => {
      const suffix = issuesQueryString({ siteId, ticketTypeId });
      const issues = await apiFetch(`/api/ticket-sales/issues/open${suffix}`);
      const list = Array.isArray(issues) ? issues : [];
      setOpenIssues(list);
      setIssueId((prev) => {
        if (prev && list.some((i) => String(i._id) === String(prev))) return prev;
        return list.length > 0 ? String(list[0]._id) : '';
      });
    },
    []
  );

  const bootstrap = useCallback(async () => {
    setErr('');
    try {
      await loadCatalog();
      await loadCollections();
    } catch (e) {
      setErr(e.message || 'Could not load collections');
    }
  }, [loadCatalog, loadCollections]);

  useEffect(() => {
    bootstrap();
  }, [bootstrap]);

  useEffect(() => {
    const active = sites.filter((s) => s.active !== false);
    if (!filterSiteId && active.length > 0) {
      setFilterSiteId(String(active[0]._id));
    }
  }, [sites, filterSiteId]);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      setBusy(true);
      setErr('');
      try {
        if (!filterSiteId) {
          setOpenIssues([]);
          setIssueId('');
          return;
        }
        await loadOpenIssues(filterSiteId, filterTicketTypeId);
      } catch (e) {
        if (!cancelled) setErr(e.message || 'Could not refresh open batches');
      } finally {
        if (!cancelled) setBusy(false);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [filterSiteId, filterTicketTypeId, loadOpenIssues]);

  const selected = useMemo(
    () => openIssues.find((i) => String(i._id) === String(issueId)),
    [openIssues, issueId]
  );

  const selectedTypeLabel = selected?.ticketTypeId?.label || '—';

  const sellerOutstandingBreakdown = useMemo(
    () => sellerOutstandingByTicketType(typesForSite, sellerOpenAllTypes),
    [typesForSite, sellerOpenAllTypes]
  );

  useEffect(() => {
    let cancelled = false;
    const site = String(filterSiteId || '').trim();
    const seller = String(selected?.sellerName || '').trim();
    if (!site || !seller) {
      setSellerOpenAllTypes([]);
      setSellerOutstandingLoading(false);
      return undefined;
    }
    setSellerOutstandingLoading(true);
    const qs = new URLSearchParams({ siteId: site, sellerName: seller });
    apiFetch(`/api/ticket-sales/issues/open?${qs}`)
      .then((rows) => {
        if (!cancelled) setSellerOpenAllTypes(Array.isArray(rows) ? rows : []);
      })
      .catch(() => {
        if (!cancelled) setSellerOpenAllTypes([]);
      })
      .finally(() => {
        if (!cancelled) setSellerOutstandingLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    filterSiteId,
    selected?._id,
    selected?.sellerName,
  ]);

  async function submit(e) {
    e.preventDefault();
    if (handoverByOther && !receivedFromName.trim()) {
      setErr('Enter the name of the person who handed over the cash.');
      return;
    }
    setBusy(true);
    setErr('');
    try {
      await apiFetch('/api/ticket-sales/collections', {
        method: 'POST',
        body: JSON.stringify({
          issueSaleId: issueId,
          amountCents: Math.round(Number(amountGhs || 0) * 100),
          ...(handoverByOther && receivedFromName.trim()
            ? {
                receivedFromName: receivedFromName.trim(),
                ...(receivedFromPhone.trim() ? { receivedFromPhone: receivedFromPhone.trim() } : {}),
              }
            : {}),
          note: note.trim() || undefined,
        }),
      });
      setAmountGhs('');
      setHandoverByOther(false);
      setReceivedFromName('');
      setReceivedFromPhone('');
      setNote('');
      await loadCollections();
      await loadOpenIssues(filterSiteId, filterTicketTypeId);
    } catch (e2) {
      setErr(e2.message || 'Could not save collection');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-white">Cash collections</h1>
        <p className="mt-1 text-sm text-slate-400">
          Filter by site and ticket type, then record cash against the correct issued batch.
        </p>
      </div>
      {err && <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">{err}</p>}
      <form onSubmit={submit} className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5 grid gap-3 sm:grid-cols-2">
        <label className="text-sm text-slate-300 sm:col-span-2">
          Site (optional filter)
          <select
            value={filterSiteId}
            onChange={(e) => {
              const v = e.target.value;
              setFilterSiteId(v);
              setFilterTicketTypeId('');
              setIssueId('');
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
        <label className="text-sm text-slate-300 sm:col-span-2">
          Ticket type
          <select
            value={filterTicketTypeId}
            onChange={(e) => {
              setFilterTicketTypeId(e.target.value);
              setIssueId('');
            }}
            disabled={!filterSiteId}
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
          >
            <option value="">
              {filterSiteId ? 'All types in selected site' : 'Select site first'}
            </option>
            {typesForSite.map((t) => (
              <option key={t._id} value={t._id}>
                {siteNameById.get(idOf(t.siteId)) || 'Site'} — {t.label} ({money(t.priceCents)})
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm text-slate-300 sm:col-span-2">
          Issued batch (must match the type above)
          <select
            value={issueId}
            onChange={(e) => setIssueId(e.target.value)}
            disabled={busy}
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 disabled:opacity-50"
          >
            <option value="">Select issued batch…</option>
            {openIssues.map((i) => (
              <option key={i._id} value={i._id}>
                {i.ticketTypeId?.label || 'Ticket'} · {i.siteId?.name || 'Site'} · {i.sellerName} · remaining{' '}
                {money(i.remainingCents)}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm text-slate-300">
          Amount collected (GHS)
          <input
            type="number"
            min={0}
            step="0.01"
            required
            value={amountGhs}
            onChange={(e) => setAmountGhs(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
          />
        </label>
        <div className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-300">
          <div>
            Ticket type: <strong className="text-white">{selectedTypeLabel}</strong>
          </div>
          <div>
            Issued to (seller): <strong className="text-white">{selected?.sellerName || '—'}</strong>
          </div>
          <div>
            Remaining on this batch:{' '}
            <strong className="text-amber-300">{money(selected?.remainingCents || 0)}</strong>
          </div>
        </div>
        <SellerOutstandingByTypePanel
          heading="This seller · all ticket types at site"
          contextLine={
            filterSiteId && selected?.sellerName
              ? `${String(selected.sellerName).trim()} · ${siteNameById.get(String(filterSiteId)) || 'Site'}`
              : ''
          }
          placeholder="Select site and an issued batch to see this seller's remaining quantity and amount for every ticket type."
          breakdown={sellerOutstandingBreakdown}
          loading={sellerOutstandingLoading}
        />
        <div className="sm:col-span-2 space-y-2 rounded-lg border border-slate-800 bg-slate-950/50 px-3 py-3">
          <label className="flex cursor-pointer items-start gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={handoverByOther}
              onChange={(e) => {
                setHandoverByOther(e.target.checked);
                if (!e.target.checked) {
                  setReceivedFromName('');
                  setReceivedFromPhone('');
                }
              }}
              className="mt-1 rounded border-slate-600"
            />
            <span>
              Someone else handed over the cash (not the seller in person). If checked, enter who gave you the money.
            </span>
          </label>
          {handoverByOther && (
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="block text-sm text-slate-300 sm:col-span-2">
                Received cash from
                <input
                  value={receivedFromName}
                  onChange={(e) => setReceivedFromName(e.target.value)}
                  placeholder="e.g. brother, shop assistant, neighbour"
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
                  required={handoverByOther}
                />
              </label>
              <label className="block text-sm text-slate-300 sm:col-span-2">
                Their mobile for SMS (optional, Ghana)
                <input
                  value={receivedFromPhone}
                  onChange={(e) => setReceivedFromPhone(e.target.value)}
                  placeholder="Separate SMS to courier with qty and amount"
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
                />
              </label>
            </div>
          )}
        </div>
        <label className="text-sm text-slate-300 sm:col-span-2">
          Note (optional)
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
          />
        </label>
        <button
          type="submit"
          disabled={busy || !issueId}
          className="sm:col-span-2 rounded-lg bg-amber-600 px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          Save collected cash
        </button>
      </form>
      <section className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5">
        <h2 className="text-lg text-white">Recent collections</h2>
        <ul className="mt-3 space-y-2 text-sm text-slate-300">
          {collections.map((s) => (
            <li key={s._id} className="rounded-lg border border-slate-800 px-3 py-2">
              {s.ticketTypeId?.label ? `${s.ticketTypeId.label} · ` : ''}
              {s.siteId?.name || 'Site'} · batch seller {s.sellerName || '—'}
              {s.receivedFromName ? ` · handed over by ${s.receivedFromName}` : ''} · {money(s.amountCents)} ·{' '}
              {new Date(s.soldAt || s.createdAt).toLocaleString()}
            </li>
          ))}
          {collections.length === 0 && <li className="text-slate-500">No collections yet.</li>}
        </ul>
      </section>
    </div>
  );
}
