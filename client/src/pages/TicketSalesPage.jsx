import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../api.js';

function money(cents) {
  return new Intl.NumberFormat('en-GH', { style: 'currency', currency: 'GHS' }).format((Number(cents) || 0) / 100);
}

export function TicketSalesPage() {
  const [me, setMe] = useState(null);
  const [sites, setSites] = useState([]);
  const [types, setTypes] = useState([]);
  const [openIssues, setOpenIssues] = useState([]);
  const [sales, setSales] = useState([]);
  const [summary, setSummary] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const [siteId, setSiteId] = useState('');
  const [siteName, setSiteName] = useState('');
  const [label, setLabel] = useState('1 day');
  const [durationDays, setDurationDays] = useState(1);
  const [priceGhs, setPriceGhs] = useState('5');

  const [sellTypeId, setSellTypeId] = useState('');
  const [saleSiteId, setSaleSiteId] = useState('');
  const [issueSellerName, setIssueSellerName] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [note, setNote] = useState('');
  const [collectionIssueId, setCollectionIssueId] = useState('');
  const [collectionAmountGhs, setCollectionAmountGhs] = useState('');
  const [collectionNote, setCollectionNote] = useState('');

  const isCatalogEditor = ['super_admin', 'org_admin'].includes(me?.admin?.role || '');
  const isSuperAdmin = me?.admin?.role === 'super_admin';

  async function loadAll() {
    setErr('');
    try {
      const [m, sitesRes, t, issues, s, sum] = await Promise.all([
        apiFetch('/api/auth/me'),
        apiFetch('/api/ticket-sales/sites'),
        apiFetch('/api/ticket-sales/types'),
        apiFetch('/api/ticket-sales/issues/open'),
        apiFetch('/api/ticket-sales/sales?limit=80'),
        apiFetch('/api/ticket-sales/summary'),
      ]);
      setMe(m);
      const ss = Array.isArray(sitesRes) ? sitesRes : [];
      setSites(ss);
      setTypes(Array.isArray(t) ? t : []);
      setOpenIssues(Array.isArray(issues) ? issues : []);
      setSales(Array.isArray(s) ? s : []);
      setSummary(sum || null);
      if (!siteId && ss.length > 0) setSiteId(String(ss[0]._id));
      if (!saleSiteId && ss.length > 0) setSaleSiteId(String(ss[0]._id));
      if (!collectionIssueId && Array.isArray(issues) && issues.length > 0) {
        setCollectionIssueId(String(issues[0]._id));
      }
    } catch (e) {
      setErr(e.message || 'Could not load ticket sales data');
    }
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sellType = useMemo(() => {
    return types.find((t) => String(t._id) === String(sellTypeId));
  }, [types, sellTypeId]);
  const saleTypeOptions = useMemo(() => {
    return types.filter(
      (t) =>
        t.active &&
        (!saleSiteId || String(t.siteId) === String(saleSiteId))
    );
  }, [types, saleSiteId]);
  const selectedIssue = useMemo(
    () => openIssues.find((i) => String(i._id) === String(collectionIssueId)),
    [openIssues, collectionIssueId]
  );

  async function createType(e) {
    e.preventDefault();
    if (!isCatalogEditor) return;
    setBusy(true);
    setErr('');
    try {
      const cents = Math.round(Number(priceGhs || 0) * 100);
      await apiFetch('/api/ticket-sales/types', {
        method: 'POST',
        body: JSON.stringify({
          siteId,
          label: label.trim(),
          durationDays: Number(durationDays),
          priceCents: cents,
        }),
      });
      setLabel('1 day');
      setDurationDays(1);
      setPriceGhs('5');
      await loadAll();
    } catch (e2) {
      setErr(e2.message || 'Could not create ticket type');
    } finally {
      setBusy(false);
    }
  }

  async function createSite(e) {
    e.preventDefault();
    if (!isSuperAdmin) return;
    setBusy(true);
    setErr('');
    try {
      await apiFetch('/api/ticket-sales/sites', {
        method: 'POST',
        body: JSON.stringify({ name: siteName.trim() }),
      });
      setSiteName('');
      await loadAll();
    } catch (e2) {
      setErr(e2.message || 'Could not create site');
    } finally {
      setBusy(false);
    }
  }

  async function renameSite(site) {
    if (!isSuperAdmin) return;
    const next = window.prompt('New site name', site.name || '');
    if (!next || !next.trim()) return;
    setBusy(true);
    setErr('');
    try {
      await apiFetch(`/api/ticket-sales/sites/${site._id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: next.trim() }),
      });
      await loadAll();
    } catch (e) {
      setErr(e.message || 'Could not rename site');
    } finally {
      setBusy(false);
    }
  }

  async function toggleSite(site) {
    if (!isSuperAdmin) return;
    setBusy(true);
    setErr('');
    try {
      await apiFetch(`/api/ticket-sales/sites/${site._id}`, {
        method: 'PATCH',
        body: JSON.stringify({ active: !site.active }),
      });
      await loadAll();
    } catch (e) {
      setErr(e.message || 'Could not update site');
    } finally {
      setBusy(false);
    }
  }

  async function deleteSite(site) {
    if (!isSuperAdmin) return;
    if (!window.confirm(`Delete site "${site.name}"?`)) return;
    setBusy(true);
    setErr('');
    try {
      await apiFetch(`/api/ticket-sales/sites/${site._id}`, { method: 'DELETE' });
      await loadAll();
    } catch (e) {
      setErr(e.message || 'Could not delete site');
    } finally {
      setBusy(false);
    }
  }

  async function recordSale(e) {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      await apiFetch('/api/ticket-sales/sales', {
        method: 'POST',
        body: JSON.stringify({
          ticketTypeId: sellTypeId,
          sellerName: issueSellerName.trim(),
          quantity: Number(quantity),
          note: note.trim() || undefined,
        }),
      });
      setQuantity(1);
      setIssueSellerName('');
      setNote('');
      await loadAll();
    } catch (e2) {
      setErr(e2.message || 'Could not record sale');
    } finally {
      setBusy(false);
    }
  }

  async function recordCollection(e) {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      await apiFetch('/api/ticket-sales/collections', {
        method: 'POST',
        body: JSON.stringify({
          issueSaleId: collectionIssueId,
          amountCents: Math.round(Number(collectionAmountGhs || 0) * 100),
          note: collectionNote.trim() || undefined,
        }),
      });
      setCollectionAmountGhs('');
      setCollectionNote('');
      setCollectionIssueId('');
      await loadAll();
    } catch (e2) {
      setErr(e2.message || 'Could not record collection');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-white">Ticket sales control</h1>
        <p className="mt-1 text-sm text-slate-400">
          Track 1-day / 2-day / 1-week / 1-month ticket sales per site and per seller.
        </p>
      </div>
      {isSuperAdmin && (
        <div className="rounded-lg border border-indigo-500/30 bg-indigo-950/20 px-4 py-3 text-sm text-indigo-100">
          Create ticket-manager users from{' '}
          <Link to="/super/organizations" className="underline">
            Super admin → All organisations
          </Link>{' '}
          then open an organisation and click <strong>Admins</strong>.
        </div>
      )}
      {err && <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">{err}</p>}

      {isCatalogEditor && (
        <section className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5">
          {isSuperAdmin && (
            <>
              <form onSubmit={createSite} className="mb-4 grid gap-3 sm:grid-cols-[1fr_auto]">
                <label className="text-sm text-slate-300">
                  Create site
                  <input value={siteName} onChange={(e) => setSiteName(e.target.value)} placeholder="e.g. East Legon" className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2" />
                </label>
                <button type="submit" disabled={busy || !siteName.trim()} className="self-end rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
                  Add site
                </button>
              </form>
              <div className="mb-5 rounded-xl border border-slate-800 bg-slate-950/40 p-3">
                <p className="text-xs uppercase tracking-wide text-slate-500">Sites (CRUD by super admin)</p>
                <ul className="mt-2 space-y-2">
                  {sites.map((s) => (
                    <li key={s._id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-800 px-3 py-2 text-sm text-slate-300">
                      <span>
                        {s.name}{' '}
                        <span className={`ml-2 rounded px-1.5 py-0.5 text-[10px] ${s.active ? 'bg-emerald-900/40 text-emerald-300' : 'bg-slate-800 text-slate-500'}`}>
                          {s.active ? 'active' : 'inactive'}
                        </span>
                      </span>
                      <div className="flex gap-2">
                        <button type="button" onClick={() => renameSite(s)} className="rounded border border-slate-700 px-2 py-0.5 text-xs hover:bg-slate-800">Rename</button>
                        <button type="button" onClick={() => toggleSite(s)} className="rounded border border-slate-700 px-2 py-0.5 text-xs hover:bg-slate-800">
                          {s.active ? 'Disable' : 'Enable'}
                        </button>
                        <button type="button" onClick={() => deleteSite(s)} className="rounded border border-red-700/50 px-2 py-0.5 text-xs text-red-300 hover:bg-red-950/40">Delete</button>
                      </div>
                    </li>
                  ))}
                  {sites.length === 0 && <li className="text-xs text-slate-500">No sites yet.</li>}
                </ul>
              </div>
            </>
          )}
          <h2 className="text-lg text-white">Ticket products (per site)</h2>
          <form onSubmit={createType} className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="text-sm text-slate-300">
              Site
              <select value={siteId} onChange={(e) => setSiteId(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2">
                <option value="">Select site…</option>
                {sites.filter((s) => s.active !== false).map((s) => (
                  <option key={s._id} value={s._id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm text-slate-300">
              Label
              <input value={label} onChange={(e) => setLabel(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2" />
            </label>
            <label className="text-sm text-slate-300">
              Duration (days)
              <input type="number" min={1} value={durationDays} onChange={(e) => setDurationDays(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2" />
            </label>
            <label className="text-sm text-slate-300">
              Price (GHS)
              <input type="number" min={0} step="0.01" value={priceGhs} onChange={(e) => setPriceGhs(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2" />
            </label>
            <button type="submit" disabled={busy || !siteId} className="sm:col-span-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
              Add ticket type
            </button>
          </form>
        </section>
      )}

      <section className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5">
        <h2 className="text-lg text-white">Issue tickets to seller</h2>
        <form onSubmit={recordSale} className="mt-4 grid gap-3 sm:grid-cols-2">
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
              {saleTypeOptions.map((t) => (
                <option key={t._id} value={t._id}>
                  {t.label} - {money(t.priceCents)}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm text-slate-300">
            Seller name
            <input
              required
              value={issueSellerName}
              onChange={(e) => setIssueSellerName(e.target.value)}
              placeholder="e.g. Kofi, Ama"
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
            />
          </label>
          <label className="text-sm text-slate-300">
            Quantity
            <input type="number" min={1} value={quantity} onChange={(e) => setQuantity(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2" />
          </label>
          <label className="text-sm text-slate-300 sm:col-span-2">
            Note (optional)
            <input value={note} onChange={(e) => setNote(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2" />
          </label>
          <div className="sm:col-span-2 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-300">
            Total: <strong className="text-white">{money((sellType?.priceCents || 0) * Number(quantity || 0))}</strong>
          </div>
          <button type="submit" disabled={busy || !sellTypeId || !issueSellerName.trim()} className="sm:col-span-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
            Save issued tickets
          </button>
        </form>
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5">
        <h2 className="text-lg text-white">Record money collected from seller</h2>
        <form onSubmit={recordCollection} className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="text-sm text-slate-300">
            Issued batch (strict)
            <select value={collectionIssueId} onChange={(e) => setCollectionIssueId(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2">
              <option value="">Select issued batch…</option>
              {openIssues.map((i) => (
                <option key={i._id} value={i._id}>
                  {i.siteId?.name || 'Site'} · {i.sellerName} · {i.ticketTypeId?.label || 'Ticket'} · remaining {money(i.remainingCents)}
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
              value={collectionAmountGhs}
              onChange={(e) => setCollectionAmountGhs(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
            />
          </label>
          <div className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-300">
            <div>
              Seller: <strong className="text-white">{selectedIssue?.sellerName || '—'}</strong>
            </div>
            <div>
              Remaining: <strong className="text-amber-300">{money(selectedIssue?.remainingCents || 0)}</strong>
            </div>
          </div>
          <label className="text-sm text-slate-300">
            Note (optional)
            <input
              value={collectionNote}
              onChange={(e) => setCollectionNote(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
            />
          </label>
          <button type="submit" disabled={busy || !collectionIssueId} className="sm:col-span-2 rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
            Save collected cash
          </button>
        </form>
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
                  <strong className={r.varianceCents > 0 ? 'text-red-300' : 'text-emerald-300'}>
                    Gap {money(r.varianceCents)}
                  </strong>
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
                <span>
                  {r.sellerName}
                  <span className="ml-2 text-xs text-slate-500">({r.siteName})</span>
                </span>
                <span>
                  Issued {money(r.issuedCents)} · Collected {money(r.collectedCents)} ·{' '}
                  <strong className={r.varianceCents > 0 ? 'text-red-300' : 'text-emerald-300'}>
                    Gap {money(r.varianceCents)}
                  </strong>
                </span>
              </li>
            ))}
            {(summary?.bySeller || []).length === 0 && <li className="text-slate-500">No sales yet today.</li>}
          </ul>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5">
        <h3 className="text-base font-medium text-white">Recent ticket sales</h3>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="text-slate-500">
              <tr>
                <th className="px-2 py-2">Time</th>
                <th className="px-2 py-2">Site</th>
                <th className="px-2 py-2">Type</th>
                <th className="px-2 py-2">Qty</th>
                <th className="px-2 py-2">Seller name</th>
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
                  <td className="px-2 py-2">{s.quantity}</td>
                  <td className="px-2 py-2">{s.sellerName || '—'}</td>
                  <td className="px-2 py-2">
                    <span className={`rounded px-2 py-0.5 text-xs ${s.kind === 'collected' ? 'bg-amber-900/40 text-amber-200' : 'bg-emerald-900/40 text-emerald-200'}`}>
                      {s.kind === 'collected' ? 'Collected' : 'Issued'}
                    </span>
                  </td>
                  <td className="px-2 py-2">{s.sellerAdminId?.email || '—'}</td>
                  <td className="px-2 py-2 font-semibold text-emerald-300">{money(s.amountCents)}</td>
                </tr>
              ))}
              {sales.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-2 py-6 text-center text-slate-500">
                    No issued/collected entries recorded yet.
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
