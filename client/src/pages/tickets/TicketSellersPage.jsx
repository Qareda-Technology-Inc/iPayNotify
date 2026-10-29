import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../../api.js';
import { money } from './common.js';
import { inputCls, useTicketOps } from './useTicketOps.js';

function AddSellerForm({ routerId, onAdded }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      await apiFetch(`/api/ticket-sales/ops/routers/${routerId}/sellers`, {
        method: 'POST',
        body: JSON.stringify({ name, phone }),
      });
      setName('');
      setPhone('');
      onAdded();
    } catch (e2) {
      setErr(e2.message || 'Could not add the seller');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-3 flex flex-wrap items-end gap-2 border-t border-slate-800 pt-3">
      <label className="min-w-[10rem] flex-1 text-xs text-slate-400">
        New seller
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name, e.g. Kofi" className={inputCls} />
      </label>
      <label className="min-w-[10rem] flex-1 text-xs text-slate-400">
        Phone (for SMS)
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="024 123 4567"
          inputMode="tel"
          className={inputCls}
        />
      </label>
      <button
        type="submit"
        disabled={busy || !name.trim()}
        className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
      >
        {busy ? 'Adding…' : 'Add seller'}
      </button>
      {err ? <p className="w-full text-xs text-red-300">{err}</p> : null}
    </form>
  );
}

function SellerRow({ seller, routerId, onChanged }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(seller.name);
  const [phone, setPhone] = useState(seller.phone);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function save(patch) {
    setBusy(true);
    setErr('');
    try {
      await apiFetch(`/api/ticket-sales/sites/${seller.siteId}/sellers/${seller._id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
      setEditing(false);
      onChanged();
    } catch (e) {
      setErr(e.message || 'Could not save');
    } finally {
      setBusy(false);
    }
  }

  const owes = seller.balanceCents;
  if (editing) {
    return (
      <li className="flex flex-wrap items-end gap-2 py-2.5">
        <label className="min-w-[8rem] flex-1 text-xs text-slate-400">
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
        </label>
        <label className="min-w-[8rem] flex-1 text-xs text-slate-400">
          Phone
          <input value={phone} onChange={(e) => setPhone(e.target.value)} className={inputCls} />
        </label>
        <button
          type="button"
          disabled={busy || !name.trim()}
          onClick={() => save({ name, phone })}
          className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
        >
          Save
        </button>
        <button type="button" onClick={() => setEditing(false)} className="px-2 py-2 text-xs text-slate-400 hover:text-white">
          Cancel
        </button>
        {err ? <p className="w-full text-xs text-red-300">{err}</p> : null}
      </li>
    );
  }
  return (
    <li className={`flex flex-col gap-2 py-2.5 sm:flex-row sm:items-center sm:justify-between ${seller.active ? '' : 'opacity-60'}`}>
      <div className="min-w-0">
        <p className="text-sm text-white">
          {seller.name}
          {seller.phone ? <span className="ml-2 font-mono text-xs text-slate-500">{seller.phone}</span> : null}
          {!seller.active ? (
            <span className="ml-2 rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400">
              {seller.unsaved ? 'old entry' : 'inactive'}
            </span>
          ) : null}
        </p>
        <p className="mt-0.5 text-xs text-slate-400">
          Holding <span className="text-slate-200">{seller.holdingQty}</span> · Sold{' '}
          <span className="text-slate-200">{seller.usedQty}</span> ·{' '}
          {owes > 0 ? (
            <span className="font-semibold text-amber-300">Owes {money(owes)}</span>
          ) : owes < 0 ? (
            <span className="text-emerald-300">Paid ahead {money(-owes)}</span>
          ) : (
            <span className="text-emerald-300">Nothing owed</span>
          )}
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap gap-1.5 text-xs">
        {seller.active && routerId ? (
          <Link
            to={`/tickets/issue?router=${routerId}&seller=${seller._id}`}
            className="rounded-lg border border-emerald-600/50 px-2.5 py-1.5 font-semibold text-emerald-200 hover:bg-emerald-950/40"
          >
            Issue
          </Link>
        ) : null}
        {owes > 0 || seller.holdingQty > 0 ? (
          <Link
            to={`/tickets/collections?seller=${encodeURIComponent(seller.sellerKey)}`}
            className="rounded-lg border border-amber-500/50 px-2.5 py-1.5 font-semibold text-amber-100 hover:bg-amber-950/40"
          >
            Collect
          </Link>
        ) : null}
        {seller._id ? (
          <>
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="rounded-lg border border-slate-700 px-2.5 py-1.5 text-slate-300 hover:bg-slate-800"
            >
              Edit
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => save({ active: !seller.active })}
              className="rounded-lg border border-slate-700 px-2.5 py-1.5 text-slate-300 hover:bg-slate-800 disabled:opacity-50"
            >
              {seller.active ? 'Deactivate' : 'Activate'}
            </button>
          </>
        ) : null}
      </div>
      {err ? <p className="text-xs text-red-300">{err}</p> : null}
    </li>
  );
}

/** Sellers grouped by site. Every router is a site; a site can have many sellers. */
export function TicketSellersPage() {
  const { sites, loading, err, reload } = useTicketOps();
  const [q, setQ] = useState('');

  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return sites;
    return sites
      .map((s) =>
        s.name.toLowerCase().includes(term)
          ? s
          : { ...s, sellers: s.sellers.filter((x) => `${x.name} ${x.phone}`.toLowerCase().includes(term)) }
      )
      .filter((s) => s.sellers.length || s.name.toLowerCase().includes(term));
  }, [sites, q]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-white">Sellers</h1>
          <p className="mt-1 text-sm text-slate-400">Each router is a site. Add the people who sell tickets there.</p>
        </div>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search site or seller"
          className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white sm:w-64"
        />
      </div>
      {err ? <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">{err}</p> : null}
      {loading ? <p className="text-sm text-slate-400">Loading…</p> : null}
      {!loading && !sites.length ? (
        <p className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5 text-sm text-slate-400">
          No routers yet. <Link to="/devices/routers" className="text-emerald-400 underline">Add a router</Link> first: each router
          becomes a ticket site.
        </p>
      ) : null}
      {shown.map((site) => (
        <section key={site.key} className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-base font-semibold text-white">
              {site.name}
              {site.legacy ? (
                <span className="ml-2 rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-normal text-slate-400">
                  old site, no router
                </span>
              ) : null}
            </h2>
            <p className="text-xs text-slate-400">
              {site.sellers.filter((s) => s.active).length} seller{site.sellers.filter((s) => s.active).length === 1 ? '' : 's'} ·
              holding {site.totals.holdingQty} ·{' '}
              <span className={site.totals.balanceCents > 0 ? 'text-amber-300' : ''}>owed {money(site.totals.balanceCents)}</span>
            </p>
          </div>
          {site.sellers.length ? (
            <ul className="mt-2 divide-y divide-slate-800">
              {site.sellers.map((s) => (
                <SellerRow key={s.sellerKey} seller={s} routerId={site.routerId} onChanged={reload} />
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-slate-500">No sellers at this site yet.</p>
          )}
          {site.routerId ? <AddSellerForm routerId={site.routerId} onAdded={reload} /> : null}
        </section>
      ))}
    </div>
  );
}
