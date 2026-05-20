import { useEffect, useState } from 'react';
import { apiFetch } from '../../api.js';
import { presetMessages, useMessage } from '../../messages/index.js';
import { money } from './common.js';

export function TicketTypesPage() {
  const { showSuccess } = useMessage();
  const [me, setMe] = useState(null);
  const [sites, setSites] = useState([]);
  const [types, setTypes] = useState([]);
  const [siteId, setSiteId] = useState('');
  const [label, setLabel] = useState('1 day');
  const [durationDays, setDurationDays] = useState(1);
  const [priceGhs, setPriceGhs] = useState('5');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const canEdit = ['super_admin', 'org_admin'].includes(me?.admin?.role || '');
  const siteNameById = new Map(sites.map((s) => [String(s._id), s.name]));

  async function load() {
    setErr('');
    try {
      const [m, s, t] = await Promise.all([
        apiFetch('/api/auth/me'),
        apiFetch('/api/ticket-sales/sites'),
        apiFetch('/api/ticket-sales/types'),
      ]);
      setMe(m);
      const ss = Array.isArray(s) ? s : [];
      setSites(ss);
      setTypes(Array.isArray(t) ? t : []);
      if (!siteId && ss.length > 0) setSiteId(String(ss[0]._id));
    } catch (e) {
      setErr(e.message || 'Could not load ticket types');
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function createType(e) {
    e.preventDefault();
    if (!canEdit) return;
    setBusy(true);
    setErr('');
    try {
      await apiFetch('/api/ticket-sales/types', {
        method: 'POST',
        body: JSON.stringify({
          siteId,
          label: label.trim(),
          durationDays: Number(durationDays),
          priceCents: Math.round(Number(priceGhs || 0) * 100),
        }),
      });
      showSuccess(presetMessages.ticketTypeCreated);
      await load();
    } catch (e2) {
      setErr(e2.message || 'Could not create ticket type');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-white">Ticket types</h1>
        <p className="mt-1 text-sm text-slate-400">Configure durations and prices per site.</p>
      </div>
      {err && <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">{err}</p>}
      {canEdit && (
        <form onSubmit={createType} className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5 grid gap-3 sm:grid-cols-2">
          <label className="text-sm text-slate-300">Site
            <select value={siteId} onChange={(e) => setSiteId(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2">
              <option value="">Select site…</option>
              {sites.filter((s) => s.active !== false).map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}
            </select>
          </label>
          <label className="text-sm text-slate-300">Label
            <input value={label} onChange={(e) => setLabel(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2" />
          </label>
          <label className="text-sm text-slate-300">Duration (days)
            <input type="number" min={1} value={durationDays} onChange={(e) => setDurationDays(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2" />
          </label>
          <label className="text-sm text-slate-300">Price (GHS)
            <input type="number" min={0} step="0.01" value={priceGhs} onChange={(e) => setPriceGhs(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2" />
          </label>
          <button type="submit" disabled={busy || !siteId} className="sm:col-span-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm text-white disabled:opacity-50">Add ticket type</button>
        </form>
      )}
      <section className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5">
        <h2 className="text-lg text-white">Configured ticket types</h2>
        <ul className="mt-3 space-y-2">
          {types.map((t) => (
            <li key={t._id} className="rounded-lg border border-slate-800 px-3 py-2 text-sm text-slate-300">
              <span className="font-medium text-white">{t.label}</span> · {t.durationDays} day(s) ·{' '}
              <span className="text-emerald-300">{money(t.priceCents)}</span>
              <span className="ml-2 text-xs text-slate-500">
                Site: {siteNameById.get(String(t.siteId)) || 'Unknown site'}
              </span>
            </li>
          ))}
          {types.length === 0 && <li className="text-sm text-slate-500">No ticket types yet.</li>}
        </ul>
      </section>
    </div>
  );
}

