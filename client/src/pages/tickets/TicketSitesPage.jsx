import { useEffect, useState } from 'react';
import { apiFetch } from '../../api.js';
import { presetMessages, useMessage } from '../../messages/index.js';

export function TicketSitesPage() {
  const { showSuccess } = useMessage();
  const [me, setMe] = useState(null);
  const [sites, setSites] = useState([]);
  const [name, setName] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const [expandedSiteId, setExpandedSiteId] = useState('');
  const [sellersBySiteId, setSellersBySiteId] = useState({});
  const [sellersLoadingSiteId, setSellersLoadingSiteId] = useState('');
  const [newSeller, setNewSeller] = useState({ name: '', phone: '', notes: '' });
  const [editingSeller, setEditingSeller] = useState(null);

  const role = me?.admin?.role || '';
  const canManageSites = ['super_admin', 'org_admin'].includes(role);
  const canManageSellers = ['super_admin', 'org_admin', 'ticket_manager'].includes(role);

  async function load() {
    setErr('');
    try {
      const [m, s] = await Promise.all([apiFetch('/api/auth/me'), apiFetch('/api/ticket-sales/sites')]);
      setMe(m);
      setSites(Array.isArray(s) ? s : []);
    } catch (e) {
      setErr(e.message || 'Could not load sites');
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function loadSellersForSite(siteId) {
    setSellersLoadingSiteId(siteId);
    setErr('');
    try {
      const rows = await apiFetch(`/api/ticket-sales/sites/${siteId}/sellers`);
      setSellersBySiteId((prev) => ({
        ...prev,
        [siteId]: Array.isArray(rows) ? rows : [],
      }));
    } catch (e) {
      setErr(e.message || 'Could not load sellers for this site');
    } finally {
      setSellersLoadingSiteId('');
    }
  }

  function toggleSellersPanel(siteId) {
    if (expandedSiteId === siteId) {
      setExpandedSiteId('');
      setEditingSeller(null);
      return;
    }
    setExpandedSiteId(siteId);
    setEditingSeller(null);
    setNewSeller({ name: '', phone: '', notes: '' });
    loadSellersForSite(siteId);
  }

  async function createSeller(e, siteId) {
    e.preventDefault();
    if (!canManageSellers) return;
    const nm = newSeller.name.trim();
    if (!nm) return;
    setBusy(true);
    setErr('');
    try {
      await apiFetch(`/api/ticket-sales/sites/${siteId}/sellers`, {
        method: 'POST',
        body: JSON.stringify({
          name: nm,
          ...(newSeller.phone.trim() ? { phone: newSeller.phone.trim() } : {}),
          ...(newSeller.notes.trim() ? { notes: newSeller.notes.trim() } : {}),
        }),
      });
      setNewSeller({ name: '', phone: '', notes: '' });
      showSuccess(presetMessages.sellerAdded);
      await loadSellersForSite(siteId);
    } catch (e2) {
      setErr(e2.message || 'Could not add seller');
    } finally {
      setBusy(false);
    }
  }

  async function patchSeller(siteId, seller, patch) {
    if (!canManageSellers) return;
    setBusy(true);
    setErr('');
    try {
      await apiFetch(`/api/ticket-sales/sites/${siteId}/sellers/${seller._id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
      showSuccess(presetMessages.sellerUpdated);
      await loadSellersForSite(siteId);
      setEditingSeller(null);
    } catch (e) {
      setErr(e.message || 'Could not update seller');
    } finally {
      setBusy(false);
    }
  }

  async function deleteSeller(siteId, seller) {
    if (!canManageSellers) return;
    if (!window.confirm(`Remove seller "${seller.name}" from this site?`)) return;
    setBusy(true);
    setErr('');
    try {
      await apiFetch(`/api/ticket-sales/sites/${siteId}/sellers/${seller._id}`, { method: 'DELETE' });
      showSuccess(presetMessages.sellerRemoved);
      await loadSellersForSite(siteId);
      setEditingSeller(null);
    } catch (e) {
      setErr(e.message || 'Could not delete seller');
    } finally {
      setBusy(false);
    }
  }

  async function createSite(e) {
    e.preventDefault();
    if (!canManageSites) return;
    setBusy(true);
    setErr('');
    try {
      await apiFetch('/api/ticket-sales/sites', {
        method: 'POST',
        body: JSON.stringify({ name: name.trim() }),
      });
      setName('');
      showSuccess(presetMessages.siteCreated);
      await load();
    } catch (e2) {
      setErr(e2.message || 'Could not create site');
    } finally {
      setBusy(false);
    }
  }

  async function patchSite(site, patch) {
    setBusy(true);
    setErr('');
    try {
      await apiFetch(`/api/ticket-sales/sites/${site._id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
      showSuccess(presetMessages.siteUpdated);
      await load();
    } catch (e) {
      setErr(e.message || 'Could not update site');
    } finally {
      setBusy(false);
    }
  }

  async function deleteSite(site) {
    if (!window.confirm(`Delete site "${site.name}"?`)) return;
    setBusy(true);
    setErr('');
    try {
      await apiFetch(`/api/ticket-sales/sites/${site._id}`, { method: 'DELETE' });
      if (expandedSiteId === String(site._id)) {
        setExpandedSiteId('');
      }
      showSuccess(presetMessages.siteDeleted);
      await load();
    } catch (e) {
      setErr(e.message || 'Could not delete site');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-white">Ticket sites</h1>
        <p className="mt-1 text-sm text-slate-400">
          Manage site names and the list of sellers at each site. Issuing tickets can reference these sellers (name, phone, notes) per site.
        </p>
      </div>
      {err && <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">{err}</p>}
      {canManageSites ? (
        <form onSubmit={createSite} className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5">
          <label className="text-sm text-slate-300">
            New site name
            <input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2" />
          </label>
          <button type="submit" disabled={busy || !name.trim()} className="mt-3 rounded-lg bg-emerald-600 px-4 py-2 text-sm text-white disabled:opacity-50">
            Add site
          </button>
        </form>
      ) : (
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
          Only super admins and organisation admins can create or rename sites.
        </p>
      )}
      <section className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5">
        <h2 className="text-lg text-white">Sites and sellers</h2>
        <ul className="mt-3 space-y-2">
          {sites.map((s) => {
            const sid = String(s._id);
            const expanded = expandedSiteId === sid;
            const rows = sellersBySiteId[sid] || [];
            return (
              <li key={s._id} className="rounded-lg border border-slate-800 text-sm text-slate-300">
                <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-white">{s.name}</span>
                    <span className={`rounded px-1.5 py-0.5 text-[10px] ${s.active ? 'bg-emerald-900/40 text-emerald-300' : 'bg-slate-800 text-slate-500'}`}>
                      {s.active ? 'active' : 'inactive'}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => toggleSellersPanel(sid)}
                      className="rounded border border-slate-600 px-2 py-0.5 text-xs text-emerald-200 hover:bg-slate-800"
                    >
                      {expanded ? 'Hide sellers' : 'Sellers'}
                    </button>
                    <button type="button" onClick={() => patchSite(s, { active: !s.active })} disabled={!canManageSites || busy} className="rounded border border-slate-700 px-2 py-0.5 text-xs disabled:opacity-50">
                      {s.active ? 'Disable' : 'Enable'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const next = window.prompt('New site name', s.name || '');
                        if (next && next.trim()) patchSite(s, { name: next.trim() });
                      }}
                      disabled={!canManageSites || busy}
                      className="rounded border border-slate-700 px-2 py-0.5 text-xs disabled:opacity-50"
                    >
                      Rename
                    </button>
                    <button type="button" onClick={() => deleteSite(s)} disabled={!canManageSites || busy} className="rounded border border-red-700/50 px-2 py-0.5 text-xs text-red-300 disabled:opacity-50">
                      Delete
                    </button>
                  </div>
                </div>
                {expanded && (
                  <div className="border-t border-slate-800 bg-slate-950/40 px-3 py-3">
                    {sellersLoadingSiteId === sid ? (
                      <p className="text-xs text-slate-500">Loading sellers…</p>
                    ) : (
                      <>
                        {rows.length === 0 ? (
                          <p className="text-xs text-slate-500">No sellers registered for this site yet.</p>
                        ) : (
                          <ul className="mb-3 space-y-2">
                            {rows.map((row) => {
                              const isEdit = editingSeller && String(editingSeller._id) === String(row._id);
                              return (
                                <li key={row._id} className="rounded border border-slate-800 bg-slate-900/60 px-3 py-2">
                                  {isEdit ? (
                                    <form
                                      className="grid gap-2 sm:grid-cols-2"
                                      onSubmit={(e) => {
                                        e.preventDefault();
                                        patchSeller(sid, row, {
                                          name: editingSeller.name.trim(),
                                          phone: editingSeller.phone.trim(),
                                          notes: editingSeller.notes.trim(),
                                        });
                                      }}
                                    >
                                      <label className="text-xs text-slate-400 sm:col-span-2">
                                        Name
                                        <input
                                          value={editingSeller.name}
                                          onChange={(ev) => setEditingSeller((prev) => ({ ...prev, name: ev.target.value }))}
                                          className="mt-0.5 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-white"
                                          required
                                        />
                                      </label>
                                      <label className="text-xs text-slate-400">
                                        Phone
                                        <input
                                          value={editingSeller.phone}
                                          onChange={(ev) => setEditingSeller((prev) => ({ ...prev, phone: ev.target.value }))}
                                          className="mt-0.5 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-white"
                                        />
                                      </label>
                                      <label className="text-xs text-slate-400 sm:col-span-2">
                                        Notes
                                        <input
                                          value={editingSeller.notes}
                                          onChange={(ev) => setEditingSeller((prev) => ({ ...prev, notes: ev.target.value }))}
                                          className="mt-0.5 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-white"
                                        />
                                      </label>
                                      <div className="flex flex-wrap gap-2 sm:col-span-2">
                                        <button type="submit" disabled={busy} className="rounded bg-emerald-700 px-2 py-1 text-xs text-white disabled:opacity-50">
                                          Save
                                        </button>
                                        <button type="button" onClick={() => setEditingSeller(null)} className="rounded border border-slate-600 px-2 py-1 text-xs">
                                          Cancel
                                        </button>
                                      </div>
                                    </form>
                                  ) : (
                                    <div className="flex flex-wrap items-start justify-between gap-2">
                                      <div>
                                        <div className="text-white">{row.name}</div>
                                        {row.phone ? <div className="text-xs text-slate-400">{row.phone}</div> : null}
                                        {row.notes ? <div className="mt-1 text-xs text-slate-500">{row.notes}</div> : null}
                                        <span className={`mt-1 inline-block rounded px-1.5 py-0.5 text-[10px] ${row.active !== false ? 'bg-emerald-900/30 text-emerald-300' : 'bg-slate-800 text-slate-500'}`}>
                                          {row.active !== false ? 'active' : 'inactive'}
                                        </span>
                                      </div>
                                      {canManageSellers ? (
                                        <div className="flex flex-wrap gap-1">
                                          <button
                                            type="button"
                                            onClick={() => patchSeller(sid, row, { active: row.active === false })}
                                            disabled={busy}
                                            className="rounded border border-slate-700 px-2 py-0.5 text-[10px] disabled:opacity-50"
                                          >
                                            {row.active === false ? 'Enable' : 'Disable'}
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() =>
                                              setEditingSeller({
                                                _id: row._id,
                                                name: row.name || '',
                                                phone: row.phone || '',
                                                notes: row.notes || '',
                                              })
                                            }
                                            disabled={busy}
                                            className="rounded border border-slate-700 px-2 py-0.5 text-[10px] disabled:opacity-50"
                                          >
                                            Edit
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => deleteSeller(sid, row)}
                                            disabled={busy}
                                            className="rounded border border-red-800/50 px-2 py-0.5 text-[10px] text-red-300 disabled:opacity-50"
                                          >
                                            Remove
                                          </button>
                                        </div>
                                      ) : null}
                                    </div>
                                  )}
                                </li>
                              );
                            })}
                          </ul>
                        )}
                        {canManageSellers ? (
                          <form onSubmit={(e) => createSeller(e, sid)} className="grid gap-2 border-t border-slate-800 pt-3 sm:grid-cols-2">
                            <p className="text-xs uppercase tracking-wide text-slate-500 sm:col-span-2">Add seller at this site</p>
                            <label className="text-xs text-slate-400">
                              Name
                              <input
                                value={newSeller.name}
                                onChange={(ev) => setNewSeller((prev) => ({ ...prev, name: ev.target.value }))}
                                className="mt-0.5 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-white"
                                placeholder="e.g. Kofi"
                              />
                            </label>
                            <label className="text-xs text-slate-400">
                              Phone (optional)
                              <input
                                value={newSeller.phone}
                                onChange={(ev) => setNewSeller((prev) => ({ ...prev, phone: ev.target.value }))}
                                className="mt-0.5 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-white"
                              />
                            </label>
                            <label className="text-xs text-slate-400 sm:col-span-2">
                              Notes (optional)
                              <input
                                value={newSeller.notes}
                                onChange={(ev) => setNewSeller((prev) => ({ ...prev, notes: ev.target.value }))}
                                className="mt-0.5 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-white"
                              />
                            </label>
                            <button type="submit" disabled={busy || !newSeller.name.trim()} className="rounded bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50 sm:col-span-2">
                              Add seller
                            </button>
                          </form>
                        ) : (
                          <p className="border-t border-slate-800 pt-2 text-xs text-slate-500">Ticket managers and admins can add or edit sellers.</p>
                        )}
                      </>
                    )}
                  </div>
                )}
              </li>
            );
          })}
          {sites.length === 0 && <li className="text-sm text-slate-500">No sites yet.</li>}
        </ul>
      </section>
    </div>
  );
}
