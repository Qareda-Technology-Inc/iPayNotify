import { useEffect, useState } from 'react';
import { apiFetch } from '../../api.js';
import { presetMessages, useMessage } from '../../messages/index.js';
import { money } from './common.js';

function planLabel(p) {
  return `${p.name}${p.priceCents != null ? ` · ${money(p.priceCents)}` : ''}${p.isActive === false ? ' (inactive)' : ''}`;
}

export function TicketTypesPage() {
  const { showSuccess } = useMessage();
  const [me, setMe] = useState(null);
  const [sites, setSites] = useState([]);
  const [types, setTypes] = useState([]);
  const [packages, setPackages] = useState([]);
  const [siteId, setSiteId] = useState('');
  const [label, setLabel] = useState('1 day');
  const [durationDays, setDurationDays] = useState(1);
  const [priceGhs, setPriceGhs] = useState('5');
  const [packageId, setPackageId] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [savingId, setSavingId] = useState('');

  const canEdit = ['super_admin', 'org_admin'].includes(me?.admin?.role || '');
  const siteById = new Map(sites.map((s) => [String(s._id), s]));

  async function load() {
    setErr('');
    try {
      const [m, s, t, opts] = await Promise.all([
        apiFetch('/api/auth/me'),
        apiFetch('/api/ticket-sales/sites'),
        apiFetch('/api/ticket-sales/types'),
        apiFetch('/api/ticket-sales/link-options').catch(() => null),
      ]);
      setMe(m);
      const ss = Array.isArray(s) ? s : [];
      setSites(ss);
      setTypes(Array.isArray(t) ? t : []);
      setPackages(Array.isArray(opts?.packages) ? opts.packages : []);
      if (!siteId && ss.length > 0) setSiteId(String(ss[0]._id));
    } catch (e) {
      setErr(e.message || 'Could not load ticket types');
    }
  }

  useEffect(() => {
    load();
  }, []);

  function pickPlan(id) {
    setPackageId(id);
    const p = packages.find((x) => String(x._id) === id);
    if (!p) return;
    setLabel(p.name);
    if (p.priceCents != null) setPriceGhs((p.priceCents / 100).toFixed(2));
    const seconds = Number(p.elapsedSeconds || p.pausedSeconds || 0);
    if (seconds) setDurationDays(Math.max(1, Math.round(seconds / 86400)));
  }

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
          packageId: packageId || null,
        }),
      });
      showSuccess(presetMessages.ticketTypeCreated);
      setPackageId('');
      await load();
    } catch (e2) {
      setErr(e2.message || 'Could not create ticket type');
    } finally {
      setBusy(false);
    }
  }

  async function patchType(t, body, okMessage) {
    setSavingId(String(t._id));
    setErr('');
    try {
      await apiFetch(`/api/ticket-sales/types/${t._id}`, { method: 'PATCH', body: JSON.stringify(body) });
      showSuccess(okMessage);
      await load();
    } catch (e2) {
      setErr(e2.message || 'Could not update ticket type');
    } finally {
      setSavingId('');
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-white">Ticket types</h1>
        <p className="mt-1 text-sm text-slate-400">
          Configure durations and prices per site. Link a type to a hotspot plan to hand sellers real codes from the Tickets
          page; sellers then owe for each code a customer uses. Without a plan, the type is count only.
        </p>
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
          <label className="text-sm text-slate-300">Hotspot plan (optional)
            <select value={packageId} onChange={(e) => pickPlan(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2">
              <option value="">None — count only</option>
              {packages.map((p) => <option key={p._id} value={p._id}>{planLabel(p)}</option>)}
            </select>
          </label>
          <label className="text-sm text-slate-300">Label
            <input value={label} onChange={(e) => setLabel(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2" />
          </label>
          <label className="text-sm text-slate-300">Duration (days)
            <input type="number" min={1} value={durationDays} onChange={(e) => setDurationDays(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2" />
          </label>
          <label className="text-sm text-slate-300">Price to seller (GHS)
            <input type="number" min={0} step="0.01" value={priceGhs} onChange={(e) => setPriceGhs(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2" />
          </label>
          {packageId && siteId && !siteById.get(String(siteId))?.routerId ? (
            <p className="self-end text-xs text-amber-300">
              This site has no router linked yet. Link one under Ticket sites so codes can be issued.
            </p>
          ) : null}
          <button type="submit" disabled={busy || !siteId} className="sm:col-span-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm text-white disabled:opacity-50">Add ticket type</button>
        </form>
      )}
      <section className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5">
        <h2 className="text-lg text-white">Configured ticket types</h2>
        <ul className="mt-3 space-y-2">
          {types.map((t) => {
            const site = siteById.get(String(t.siteId));
            const linkedReady = t.packageId && site?.routerId;
            return (
              <li key={t._id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-800 px-3 py-2 text-sm text-slate-300">
                <span className={t.active === false ? 'opacity-50' : ''}>
                  <span className="font-medium text-white">{t.label}</span> · {t.durationDays} day(s) ·{' '}
                  <span className="text-emerald-300">{money(t.priceCents)}</span>
                  <span className="ml-2 text-xs text-slate-500">Site: {site?.name || 'Unknown site'}</span>
                  <span className={`ml-2 text-xs ${linkedReady ? 'text-emerald-400' : t.packageId ? 'text-amber-300' : 'text-slate-500'}`}>
                    {linkedReady ? 'Issues real codes' : t.packageId ? 'Plan linked, site has no router' : 'Count only'}
                  </span>
                </span>
                {canEdit ? (
                  <span className="flex flex-wrap items-center gap-2">
                    <select
                      value={t.packageId ? String(t.packageId) : ''}
                      disabled={savingId === String(t._id)}
                      onChange={(e) => patchType(t, { packageId: e.target.value || null }, 'Ticket type updated.')}
                      className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-xs"
                    >
                      <option value="">No plan (count only)</option>
                      {packages.map((p) => <option key={p._id} value={p._id}>{planLabel(p)}</option>)}
                    </select>
                    <button
                      type="button"
                      disabled={savingId === String(t._id)}
                      onClick={() =>
                        patchType(t, { active: t.active === false }, t.active === false ? 'Ticket type enabled.' : 'Ticket type disabled.')
                      }
                      className="text-xs text-slate-400 hover:text-white"
                    >
                      {t.active === false ? 'Enable' : 'Disable'}
                    </button>
                  </span>
                ) : null}
              </li>
            );
          })}
          {types.length === 0 && <li className="text-sm text-slate-500">No ticket types yet.</li>}
        </ul>
      </section>
    </div>
  );
}
