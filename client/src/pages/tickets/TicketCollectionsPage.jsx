import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch } from '../../api.js';
import { presetMessages, useMessage } from '../../messages/index.js';
import { money } from './common.js';

const inputCls = 'mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2';

function owingTone(days) {
  if (days > 14) return 'text-red-300';
  if (days > 7) return 'text-amber-300';
  return 'text-slate-400';
}

/** One line per cash hand-over (a hand-over split over several issues shares collectionGroupId). */
function groupCollections(rows) {
  const out = [];
  const byGroup = new Map();
  for (const r of rows) {
    const g = r.collectionGroupId;
    if (g && byGroup.has(g)) {
      const cur = byGroup.get(g);
      cur.amountCents += Number(r.amountCents || 0);
      cur.parts += 1;
      continue;
    }
    const row = { ...r, amountCents: Number(r.amountCents || 0), parts: 1 };
    if (g) byGroup.set(g, row);
    out.push(row);
  }
  return out;
}

export function TicketCollectionsPage() {
  const { showSuccess } = useMessage();
  const [sites, setSites] = useState([]);
  const [siteId, setSiteId] = useState('');
  const [sellers, setSellers] = useState([]);
  const [sellersLoading, setSellersLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [sellerKey, setSellerKey] = useState('');
  const [issues, setIssues] = useState([]);
  const [issuesLoading, setIssuesLoading] = useState(false);
  const [collections, setCollections] = useState([]);
  const [amountGhs, setAmountGhs] = useState('');
  const [handoverByOther, setHandoverByOther] = useState(false);
  const [receivedFromName, setReceivedFromName] = useState('');
  const [receivedFromPhone, setReceivedFromPhone] = useState('');
  const [note, setNote] = useState('');
  const [returnFor, setReturnFor] = useState('');
  const [returnQty, setReturnQty] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const collectRef = useRef(null);

  const loadSellers = useCallback(async (site) => {
    setSellersLoading(true);
    try {
      const qs = site ? `?siteId=${encodeURIComponent(site)}` : '';
      const rows = await apiFetch(`/api/ticket-sales/seller-balances${qs}`);
      setSellers(Array.isArray(rows) ? rows : []);
    } catch (e) {
      setErr(e.message || 'Could not load sellers');
    } finally {
      setSellersLoading(false);
    }
  }, []);

  const loadIssues = useCallback(async (key) => {
    if (!key) {
      setIssues([]);
      return;
    }
    setIssuesLoading(true);
    try {
      const rows = await apiFetch(`/api/ticket-sales/seller-balances/${encodeURIComponent(key)}/issues`);
      setIssues(Array.isArray(rows) ? rows : []);
    } catch (e) {
      setErr(e.message || 'Could not load this seller');
    } finally {
      setIssuesLoading(false);
    }
  }, []);

  const loadCollections = useCallback(async () => {
    try {
      const rows = await apiFetch('/api/ticket-sales/sales?kind=collected&limit=120');
      setCollections(groupCollections(Array.isArray(rows) ? rows : []).slice(0, 40));
    } catch {
      setCollections([]);
    }
  }, []);

  useEffect(() => {
    apiFetch('/api/ticket-sales/sites')
      .then((s) => setSites(Array.isArray(s) ? s : []))
      .catch((e) => setErr(e.message || 'Could not load sites'));
    loadCollections();
  }, [loadCollections]);

  useEffect(() => {
    loadSellers(siteId);
  }, [siteId, loadSellers]);

  useEffect(() => {
    setAmountGhs('');
    setReturnFor('');
    loadIssues(sellerKey);
  }, [sellerKey, loadIssues]);

  const seller = useMemo(() => sellers.find((s) => s.sellerKey === sellerKey), [sellers, sellerKey]);
  const visibleSellers = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = q
      ? sellers.filter((s) => `${s.sellerName} ${s.siteName} ${s.sellerPhone}`.toLowerCase().includes(q))
      : sellers.filter((s) => s.balanceCents !== 0 || s.holdingQty > 0);
    return rows;
  }, [sellers, search]);
  const hiddenSettled = sellers.length - visibleSellers.length;
  const pickerSellers = useMemo(
    () =>
      [...sellers].sort(
        (a, b) =>
          Number(b.balanceCents > 0) - Number(a.balanceCents > 0) ||
          a.sellerName.localeCompare(b.sellerName)
      ),
    [sellers]
  );

  useEffect(() => {
    if (sellerKey && sellers.some((s) => s.sellerKey === sellerKey)) return;
    const top = sellers.find((s) => s.balanceCents > 0);
    setSellerKey(top ? top.sellerKey : '');
  }, [sellers, sellerKey]);

  function chooseSeller(key) {
    setSellerKey(key);
    collectRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  const openIssues = useMemo(
    () => issues.filter((i) => i.balanceCents !== 0 || i.holdingQty > 0 || i.maxCollectCents > 0),
    [issues]
  );
  const owedCents = Math.max(0, seller?.balanceCents || 0);
  const maxCents = issues.reduce((n, i) => n + Number(i.maxCollectCents || 0), 0);
  const amountCents = Math.round(Number(amountGhs || 0) * 100);
  const advanceCents = Math.max(0, amountCents - owedCents);

  async function refreshAfterChange() {
    await Promise.all([loadSellers(siteId), loadIssues(sellerKey), loadCollections()]);
  }

  async function collect(e) {
    e.preventDefault();
    if (handoverByOther && !receivedFromName.trim()) {
      setErr('Enter the name of the person who handed over the cash.');
      return;
    }
    setBusy(true);
    setErr('');
    try {
      const r = await apiFetch('/api/ticket-sales/collections', {
        method: 'POST',
        body: JSON.stringify({
          sellerKey,
          amountCents,
          ...(handoverByOther && receivedFromName.trim()
            ? {
                receivedFromName: receivedFromName.trim(),
                ...(receivedFromPhone.trim() ? { receivedFromPhone: receivedFromPhone.trim() } : {}),
              }
            : {}),
          note: note.trim() || undefined,
        }),
      });
      showSuccess(
        r?.allocatedTo > 1
          ? `${presetMessages.collectionRecorded} Spread over ${r.allocatedTo} issues, oldest first.`
          : presetMessages.collectionRecorded
      );
      setAmountGhs('');
      setHandoverByOther(false);
      setReceivedFromName('');
      setReceivedFromPhone('');
      setNote('');
      await refreshAfterChange();
    } catch (e2) {
      setErr(e2.message || 'Could not save collection');
    } finally {
      setBusy(false);
    }
  }

  async function submitReturn(issue) {
    setBusy(true);
    setErr('');
    try {
      await apiFetch('/api/ticket-sales/returns', {
        method: 'POST',
        body: JSON.stringify({ issueSaleId: issue._id, quantity: Number(returnQty) }),
      });
      showSuccess(
        issue.linked
          ? `${returnQty} unused code${Number(returnQty) === 1 ? '' : 's'} back in stock.`
          : `Return of ${returnQty} ticket${Number(returnQty) === 1 ? '' : 's'} recorded.`
      );
      setReturnFor('');
      setReturnQty('');
      await refreshAfterChange();
    } catch (e2) {
      setErr(e2.message || 'Could not record the return');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-white">Cash collections</h1>
        <p className="mt-1 text-sm text-slate-400">
          Choose the seller who is paying and enter the cash they handed over. It clears their oldest tickets first. Sellers
          with hotspot codes owe for each code a customer has used, and can also pay ahead for codes they still hold.
        </p>
      </div>
      {err && <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">{err}</p>}

      <section ref={collectRef} className="space-y-4 rounded-2xl border border-amber-500/30 bg-slate-900/40 p-5">
        <div className="flex flex-wrap items-end gap-3">
          <h2 className="w-full text-lg font-medium text-white">Collect money</h2>
          <label className="min-w-[240px] flex-1 text-sm text-slate-300">
            Seller
            <select value={sellerKey} onChange={(e) => setSellerKey(e.target.value)} className={inputCls}>
              <option value="">{sellersLoading ? 'Loading sellers…' : sellers.length ? 'Choose the seller…' : 'No tickets issued yet'}</option>
              {pickerSellers.map((s) => (
                <option key={s.sellerKey} value={s.sellerKey}>
                  {s.sellerName} · {s.siteName || 'Site'}
                  {s.balanceCents > 0 ? ` · owes ${money(s.balanceCents)}` : s.balanceCents < 0 ? ' · paid ahead' : ' · settled'}
                </option>
              ))}
            </select>
          </label>
        </div>
      {seller ? (
        <>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-lg text-white">
              {seller.sellerName} <span className="text-sm text-slate-500">· {seller.siteName}</span>
            </h2>
            <p className="text-sm text-slate-400">
              Owes <strong className="text-amber-300">{money(owedCents)}</strong> · holding {seller.holdingQty} ticket
              {seller.holdingQty === 1 ? '' : 's'}
              {seller.usedQty ? ` · ${seller.usedQty} used by customers` : ''}
              {seller.balanceCents < 0 ? (
                <>
                  {' '}
                  · paid ahead <strong className="text-emerald-300">{money(-seller.balanceCents)}</strong>
                </>
              ) : null}
            </p>
          </div>

          <form onSubmit={collect} className="grid gap-3 rounded-xl border border-slate-800 bg-slate-950/40 p-4 sm:grid-cols-2">
            <label className="text-sm text-slate-300">
              Amount received (GHS)
              <input
                type="number"
                min={0}
                step="0.01"
                required
                value={amountGhs}
                onChange={(e) => setAmountGhs(e.target.value)}
                className={inputCls}
              />
              <span className="mt-1 flex flex-wrap gap-3 text-xs">
                {owedCents > 0 ? (
                  <button type="button" className="text-emerald-400 hover:text-emerald-300" onClick={() => setAmountGhs((owedCents / 100).toFixed(2))}>
                    All owed ({money(owedCents)})
                  </button>
                ) : null}
                {maxCents > owedCents ? (
                  <span className="text-slate-500">Up to {money(maxCents)} including tickets held</span>
                ) : null}
              </span>
            </label>
            <div className="rounded-lg border border-slate-800 px-3 py-2 text-sm text-slate-400">
              {amountCents > 0 ? (
                amountCents > maxCents ? (
                  <span className="text-red-300">More than this seller can owe ({money(maxCents)}).</span>
                ) : (
                  <>
                    {money(Math.min(amountCents, owedCents))} clears what is owed
                    {advanceCents > 0 ? (
                      <>
                        , <span className="text-emerald-300">{money(advanceCents)}</span> paid ahead for tickets they hold
                      </>
                    ) : null}
                    {amountCents < owedCents ? (
                      <>
                        ; <span className="text-amber-300">{money(owedCents - amountCents)}</span> still owed after this
                      </>
                    ) : null}
                    .
                  </>
                )
              ) : (
                'Enter the cash handed over.'
              )}
            </div>
            <div className="space-y-2 sm:col-span-2">
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
                <span>Someone else handed over the cash</span>
              </label>
              {handoverByOther && (
                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="block text-sm text-slate-300">
                    Received cash from
                    <input
                      value={receivedFromName}
                      onChange={(e) => setReceivedFromName(e.target.value)}
                      placeholder="e.g. shop assistant"
                      className={inputCls}
                      required
                    />
                  </label>
                  <label className="block text-sm text-slate-300">
                    Their mobile for SMS (optional)
                    <input value={receivedFromPhone} onChange={(e) => setReceivedFromPhone(e.target.value)} className={inputCls} />
                  </label>
                </div>
              )}
            </div>
            <label className="text-sm text-slate-300 sm:col-span-2">
              Note (optional)
              <input value={note} onChange={(e) => setNote(e.target.value)} className={inputCls} />
            </label>
            <button
              type="submit"
              disabled={busy || amountCents <= 0 || amountCents > maxCents}
              className="rounded-lg bg-amber-600 px-4 py-2 text-sm text-white disabled:opacity-50 sm:col-span-2"
            >
              {busy ? 'Saving…' : 'Save collected cash'}
            </button>
          </form>

          <div className="overflow-x-auto">
            <h3 className="mb-2 text-sm font-medium text-slate-300">Open issues (oldest first)</h3>
            {issuesLoading ? <p className="text-sm text-slate-500">Loading…</p> : null}
            <table className="w-full min-w-[720px] text-left text-xs text-slate-300">
              <thead>
                <tr className="border-b border-slate-800 text-slate-500">
                  <th className="py-1.5 pr-2 font-medium">Issued</th>
                  <th className="py-1.5 pr-2 font-medium">Ticket</th>
                  <th className="py-1.5 pr-2 text-right font-medium">Qty</th>
                  <th className="py-1.5 pr-2 text-right font-medium">Used</th>
                  <th className="py-1.5 pr-2 text-right font-medium">Holding</th>
                  <th className="py-1.5 pr-2 text-right font-medium">Returned</th>
                  <th className="py-1.5 pr-2 text-right font-medium">Owed</th>
                  <th className="py-1.5 pr-2 text-right font-medium">Paid</th>
                  <th className="py-1.5 pr-2 text-right font-medium">Balance</th>
                  <th className="py-1.5 font-medium" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80">
                {openIssues.map((i) => (
                  <tr key={i._id}>
                    <td className="py-1.5 pr-2">{new Date(i.soldAt || i.createdAt).toLocaleDateString()}</td>
                    <td className="py-1.5 pr-2 text-slate-200">
                      {i.ticketTypeId?.label || 'Ticket'}
                      <span className="ml-1 text-slate-500">{i.linked ? '· codes' : '· count only'}</span>
                    </td>
                    <td className="py-1.5 pr-2 text-right">{i.issuedQty}</td>
                    <td className="py-1.5 pr-2 text-right">{i.linked ? i.usedQty : '—'}</td>
                    <td className="py-1.5 pr-2 text-right">
                      {i.holdingQty}
                      {i.expiredQty ? <span className="ml-1 text-slate-500">({i.expiredQty} expired)</span> : null}
                    </td>
                    <td className="py-1.5 pr-2 text-right">{i.returnedQty || ''}</td>
                    <td className="py-1.5 pr-2 text-right">{money(i.owedCents)}</td>
                    <td className="py-1.5 pr-2 text-right">{money(i.collectedCents)}</td>
                    <td
                      className={`py-1.5 pr-2 text-right ${
                        i.balanceCents > 0 ? 'text-amber-300' : i.balanceCents < 0 ? 'text-emerald-300' : 'text-slate-500'
                      }`}
                    >
                      {i.balanceCents < 0 ? `${money(-i.balanceCents)} ahead` : money(i.balanceCents)}
                    </td>
                    <td className="py-1.5 text-right">
                      {i.holdingQty > 0 && returnFor !== String(i._id) ? (
                        <button
                          type="button"
                          onClick={() => {
                            setReturnFor(String(i._id));
                            setReturnQty(String(i.holdingQty));
                          }}
                          className="text-emerald-400 hover:text-emerald-300"
                        >
                          Return
                        </button>
                      ) : null}
                      {returnFor === String(i._id) ? (
                        <span className="inline-flex items-center gap-1">
                          <input
                            type="number"
                            min={1}
                            max={i.holdingQty}
                            value={returnQty}
                            onChange={(e) => setReturnQty(e.target.value)}
                            className="w-16 rounded border border-slate-700 bg-slate-950 px-1.5 py-0.5"
                          />
                          <button
                            type="button"
                            disabled={busy || !(Number(returnQty) >= 1 && Number(returnQty) <= i.holdingQty)}
                            onClick={() => submitReturn(i)}
                            className="rounded bg-emerald-600 px-2 py-0.5 text-white disabled:opacity-50"
                          >
                            Save
                          </button>
                          <button type="button" onClick={() => setReturnFor('')} className="text-slate-500 hover:text-white">
                            ✕
                          </button>
                        </span>
                      ) : null}
                    </td>
                  </tr>
                ))}
                {!issuesLoading && openIssues.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="py-3 text-slate-500">
                      Nothing open for this seller.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <p className="text-sm text-slate-500">
          {sellers.length
            ? 'Choose the seller who is paying. You will see what they owe, then enter the amount.'
            : 'Issue tickets to a seller first; they will appear here to collect from.'}
        </p>
      )}
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5">
        <h2 className="mb-3 text-lg text-white">Who owes</h2>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm text-slate-300">
            Site
            <select value={siteId} onChange={(e) => setSiteId(e.target.value)} className={inputCls}>
              <option value="">All sites</option>
              {sites.map((s) => (
                <option key={s._id} value={s._id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="min-w-[200px] flex-1 text-sm text-slate-300">
            Find seller
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Name, site or phone"
              className={inputCls}
            />
          </label>
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm text-slate-300">
            <thead>
              <tr className="border-b border-slate-800 text-xs text-slate-500">
                <th className="py-2 pr-3 font-medium">Seller</th>
                <th className="py-2 pr-3 font-medium">Site</th>
                <th className="py-2 pr-3 text-right font-medium">Owes</th>
                <th className="py-2 pr-3 text-right font-medium">Holding</th>
                <th className="py-2 pr-3 text-right font-medium">Paid ahead</th>
                <th className="py-2 pr-3 text-right font-medium">Owing for</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80">
              {visibleSellers.map((s) => (
                <tr
                  key={s.sellerKey}
                  onClick={() => chooseSeller(s.sellerKey)}
                  className={`cursor-pointer hover:bg-slate-800/40 ${s.sellerKey === sellerKey ? 'bg-emerald-500/10' : ''}`}
                >
                  <td className="py-2 pr-3 text-white">
                    {s.sellerName}
                    {s.sellerPhone ? <span className="ml-2 text-xs text-slate-500">{s.sellerPhone}</span> : null}
                  </td>
                  <td className="py-2 pr-3">{s.siteName || '—'}</td>
                  <td className={`py-2 pr-3 text-right ${s.balanceCents > 0 ? 'font-medium text-amber-300' : 'text-slate-500'}`}>
                    {money(Math.max(0, s.balanceCents))}
                  </td>
                  <td className="py-2 pr-3 text-right">{s.holdingQty}</td>
                  <td className="py-2 pr-3 text-right text-emerald-300">
                    {s.balanceCents < 0 ? money(-s.balanceCents) : ''}
                  </td>
                  <td className={`py-2 pr-3 text-right ${owingTone(s.daysOwing)}`}>
                    {s.balanceCents > 0 ? `${s.daysOwing} day${s.daysOwing === 1 ? '' : 's'}` : '—'}
                  </td>
                  <td className="py-2 text-right">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        chooseSeller(s.sellerKey);
                      }}
                      className="rounded bg-amber-600 px-2.5 py-1 text-xs text-white hover:bg-amber-500"
                    >
                      Collect
                    </button>
                  </td>
                </tr>
              ))}
              {!sellersLoading && visibleSellers.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-4 text-slate-500">
                    {sellers.length ? 'Everyone is settled.' : 'No tickets issued yet.'}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
          {sellersLoading ? <p className="mt-2 text-sm text-slate-500">Loading sellers…</p> : null}
          {!search && hiddenSettled > 0 ? (
            <p className="mt-2 text-xs text-slate-500">
              {hiddenSettled} settled seller{hiddenSettled === 1 ? '' : 's'} hidden. Search to find them.
            </p>
          ) : null}
        </div>
      </section>


      <section className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5">
        <h2 className="text-lg text-white">Recent collections</h2>
        <ul className="mt-3 space-y-2 text-sm text-slate-300">
          {collections.map((s) => (
            <li key={s._id} className="rounded-lg border border-slate-800 px-3 py-2">
              {new Date(s.soldAt || s.createdAt).toLocaleString()} · {s.sellerName || '—'} · {s.siteId?.name || 'Site'} ·{' '}
              <strong className="text-white">{money(s.amountCents)}</strong>
              {s.parts > 1 ? <span className="text-slate-500"> (over {s.parts} issues)</span> : null}
              {s.receivedFromName ? ` · handed over by ${s.receivedFromName}` : ''}
            </li>
          ))}
          {collections.length === 0 && <li className="text-slate-500">No collections yet.</li>}
        </ul>
      </section>
    </div>
  );
}
