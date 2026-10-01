import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../api.js';
import { routerDisplayName } from '../utils/routerDisplayName.js';
import { renderTicketSvg } from '../utils/exportVouchersPdf.js';
import { VOUCHER_DESIGNS } from '../portal/designs.js';

const EMPTY_SETTINGS = {
  portalHeadline: '',
  portalSubtitle: '',
  portalButtonLabel: '',
  portalBuyLabel: '',
  portalFooter: '',
  portalSupportPhone: '',
  portalShowPlans: true,
  voucherTitle: '',
};

function settingsFromBilling(b = {}) {
  return {
    portalHeadline: b.portalHeadline || '',
    portalSubtitle: b.portalSubtitle || '',
    portalButtonLabel: b.portalButtonLabel || '',
    portalBuyLabel: b.portalBuyLabel || '',
    portalFooter: b.portalFooter || '',
    portalSupportPhone: b.portalSupportPhone || '',
    portalShowPlans: b.portalShowPlans !== false,
    voucherTitle: b.voucherTitle || '',
  };
}

const fieldClass =
  'mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none ring-emerald-500/40 focus:ring-2';

function Selectable({ selected, onSelect, children, className = '' }) {
  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      }}
      className={`cursor-pointer overflow-hidden rounded-2xl border text-left transition ${
        selected ? 'border-emerald-500 ring-2 ring-emerald-500/40' : 'border-slate-800 hover:border-slate-600'
      } ${className}`}
    >
      {children}
    </div>
  );
}

function LoginPreviewCard({ design, selected, onSelect }) {
  return (
    <Selectable selected={selected} onSelect={onSelect}>
      <div className="relative h-[360px] overflow-hidden bg-slate-950">
        <iframe
          title={`${design.name} preview`}
          srcDoc={design.html}
          sandbox=""
          tabIndex={-1}
          className="pointer-events-none absolute left-0 top-0 h-[600px] w-[390px] origin-top-left scale-[0.6] border-0"
        />
      </div>
      <div className="border-t border-slate-800 bg-slate-900/80 px-3 py-2.5">
        <p className="text-sm font-medium text-white">
          {design.name}
          {selected ? <span className="ml-2 text-xs text-emerald-300">Selected</span> : null}
        </p>
        <p className="mt-0.5 text-xs text-slate-400">{design.blurb}</p>
      </div>
    </Selectable>
  );
}

function TicketPreviewCard({ design, svg, selected, onSelect }) {
  return (
    <Selectable selected={selected} onSelect={onSelect} className="bg-slate-900/50 p-3">
      <div
        className="flex h-32 items-center justify-center rounded-lg bg-slate-100 p-2 [&>svg]:h-auto [&>svg]:max-h-full [&>svg]:max-w-full"
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      <p className="mt-2.5 text-sm font-medium text-white">
        {design.name}
        {selected ? <span className="ml-2 text-xs text-emerald-300">Selected</span> : null}
      </p>
      <p className="mt-0.5 text-xs text-slate-400">{design.blurb}</p>
    </Selectable>
  );
}

function planDraft(p) {
  return {
    name: p.name || '',
    price: p.priceCents != null ? String(Number(p.priceCents) / 100) : '0',
    showOnPortal: p.showOnPortal !== false,
  };
}

function PlansEditor({ onChanged }) {
  const [plans, setPlans] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [state, setState] = useState(/** @type {'loading' | 'idle' | 'error'} */ ('loading'));
  const [savingId, setSavingId] = useState('');
  const [msg, setMsg] = useState('');

  useEffect(() => {
    apiFetch('/api/packages?kind=hotspot')
      .then((list) => {
        const rows = (Array.isArray(list) ? list : []).sort(
          (a, b) => Number(a.priceCents || 0) - Number(b.priceCents || 0) || String(a.name).localeCompare(String(b.name))
        );
        setPlans(rows);
        setDrafts(Object.fromEntries(rows.map((p) => [p._id, planDraft(p)])));
        setState('idle');
      })
      .catch((e) => {
        setMsg(e.message || 'Could not load plans');
        setState('error');
      });
  }, []);

  function setDraft(id, key, value) {
    setDrafts((d) => ({ ...d, [id]: { ...d[id], [key]: value } }));
  }

  function isDirty(p) {
    const d = drafts[p._id];
    const base = planDraft(p);
    return d && (d.name.trim() !== base.name || Number(d.price) !== Number(base.price) || d.showOnPortal !== base.showOnPortal);
  }

  async function save(p, overrides = {}) {
    const d = { ...drafts[p._id], ...overrides };
    const name = d.name.trim();
    const price = Number(d.price);
    if (!name) return setMsg('Plan name cannot be empty.');
    if (!Number.isFinite(price) || price < 0) return setMsg('Enter a valid price.');
    setSavingId(p._id);
    setMsg('');
    try {
      const updated = await apiFetch(`/api/packages/${p._id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name, priceCents: Math.round(price * 100), showOnPortal: d.showOnPortal }),
      });
      setPlans((list) => list.map((x) => (x._id === p._id ? { ...x, ...updated } : x)));
      setDrafts((all) => ({ ...all, [p._id]: planDraft(updated) }));
      onChanged();
    } catch (e) {
      setMsg(e.message || 'Could not save plan');
    } finally {
      setSavingId('');
    }
  }

  return (
    <section className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900/40 p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-white">Plans &amp; prices</h3>
        <Link to="/finance/packages" className="text-xs text-indigo-300 hover:text-indigo-200">
          All plan settings
        </Link>
      </div>
      <p className="text-xs text-slate-500">
        These are your real plans — a new price is what customers pay when buying. Untick to hide a plan from the login
        page only.
      </p>
      {state === 'loading' ? <p className="text-xs text-slate-500">Loading plans…</p> : null}
      {state === 'idle' && plans.length === 0 ? (
        <p className="text-xs text-slate-400">
          No hotspot plans yet.{' '}
          <Link to="/finance/packages" className="text-indigo-300 hover:text-indigo-200">
            Create one
          </Link>
          .
        </p>
      ) : null}
      <ul className="space-y-2">
        {plans.map((p) => {
          const d = drafts[p._id] || planDraft(p);
          const dirty = isDirty(p);
          return (
            <li key={p._id} className="flex items-center gap-2">
              <input
                type="checkbox"
                title="Show on login page"
                checked={d.showOnPortal}
                disabled={savingId === p._id}
                onChange={(e) => {
                  setDraft(p._id, 'showOnPortal', e.target.checked);
                  if (!dirty) save(p, { showOnPortal: e.target.checked });
                }}
                className="rounded border-slate-600"
              />
              <input
                value={d.name}
                onChange={(e) => setDraft(p._id, 'name', e.target.value)}
                className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-white outline-none focus:ring-2 focus:ring-emerald-500/40"
                aria-label="Plan name"
              />
              <div className="flex w-24 items-center rounded-lg border border-slate-700 bg-slate-950 focus-within:ring-2 focus-within:ring-emerald-500/40">
                <span className="pl-2 text-[11px] text-slate-500">{p.currency || 'GHS'}</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={d.price}
                  onChange={(e) => setDraft(p._id, 'price', e.target.value)}
                  className="w-full min-w-0 bg-transparent px-1.5 py-1.5 text-sm text-white outline-none"
                  aria-label="Price"
                />
              </div>
              <button
                type="button"
                disabled={!dirty || savingId === p._id}
                onClick={() => save(p)}
                className="rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-30"
              >
                {savingId === p._id ? '…' : 'Save'}
              </button>
            </li>
          );
        })}
      </ul>
      {msg ? <p className="text-xs text-red-300">{msg}</p> : null}
    </section>
  );
}

export function TemplatesPage() {
  const [org, setOrg] = useState(null);
  const [tab, setTab] = useState(/** @type {'login' | 'tickets'} */ ('login'));
  const [portalDesign, setPortalDesign] = useState('midnight');
  const [voucherDesign, setVoucherDesign] = useState('grid');
  const [settings, setSettings] = useState(EMPTY_SETTINGS);
  const [previews, setPreviews] = useState([]);
  const [samplePlans, setSamplePlans] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [plansVersion, setPlansVersion] = useState(0);
  const [routers, setRouters] = useState([]);
  const [routerId, setRouterId] = useState('');
  const routersRef = useRef([]);
  routersRef.current = routers;
  const [servers, setServers] = useState([]);
  const [serverName, setServerName] = useState('');
  const [serversState, setServersState] = useState(/** @type {'idle' | 'loading' | 'error'} */ ('idle'));
  const [serversError, setServersError] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [err, setErr] = useState('');
  const [info, setInfo] = useState('');

  const load = useCallback(async () => {
    const [o, routersRes] = await Promise.all([apiFetch('/api/organization'), apiFetch('/api/routers').catch(() => [])]);
    setOrg(o);
    const list = Array.isArray(routersRes) ? routersRes : [];
    setRouters(list);
    setRouterId((id) => id || list[0]?._id || '');
    setPortalDesign(o?.billing?.portalDesign || 'midnight');
    setVoucherDesign(o?.billing?.voucherDesign || 'grid');
    setSettings(settingsFromBilling(o?.billing));
  }, []);

  useEffect(() => {
    load()
      .catch((e) => setErr(e.message || 'Could not load organisation'))
      .finally(() => setLoading(false));
  }, [load]);

  useEffect(() => {
    setServers([]);
    setServerName('');
    setServersError('');
    if (!routerId) {
      setServersState('idle');
      return undefined;
    }
    let cancelled = false;
    setServersState('loading');
    apiFetch(`/api/hotspot/routers/${routerId}/servers`)
      .then((r) => {
        if (cancelled) return;
        const list = Array.isArray(r?.servers) ? r.servers : [];
        setServers(list);
        const enabled = list.filter((s) => !s.disabled);
        const lastServer = routersRef.current.find((x) => x._id === routerId)?.captivePortal?.hotspotServer;
        if (lastServer && list.some((s) => s.name === lastServer)) setServerName(lastServer);
        else if (enabled.length === 1) setServerName(enabled[0].name);
        setServersState('idle');
      })
      .catch((e) => {
        if (cancelled) return;
        setServersError(e.message || 'Could not read hotspot servers from the router');
        setServersState('error');
      });
    return () => {
      cancelled = true;
    };
  }, [routerId]);

  const previewBody = useMemo(
    () => ({
      portalHeadline: settings.portalHeadline,
      portalSubtitle: settings.portalSubtitle,
      portalButtonLabel: settings.portalButtonLabel,
      portalBuyLabel: settings.portalBuyLabel,
      portalFooter: settings.portalFooter,
      portalSupportPhone: settings.portalSupportPhone,
      portalShowPlans: settings.portalShowPlans,
    }),
    [settings]
  );

  useEffect(() => {
    if (loading || org?.platformScope) return undefined;
    const t = setTimeout(() => {
      setPreviewLoading(true);
      apiFetch('/api/organization/portal-previews', { method: 'POST', body: JSON.stringify(previewBody) })
        .then((r) => {
          setPreviews(Array.isArray(r?.designs) ? r.designs : []);
          setSamplePlans(Boolean(r?.samplePlans));
        })
        .catch((e) => setErr(e.message || 'Could not load previews'))
        .finally(() => setPreviewLoading(false));
    }, 450);
    return () => clearTimeout(t);
  }, [previewBody, plansVersion, loading, org?.platformScope]);

  const brandName = String(org?.billing?.merchantDisplayName || org?.name || 'Wi-Fi').trim();
  const ticketTitle = settings.voucherTitle.trim() || 'Wi-Fi Access';
  const ticketSvgs = useMemo(
    () => Object.fromEntries(VOUCHER_DESIGNS.map((d) => [d.id, renderTicketSvg(d.id, { title: ticketTitle, venue: brandName })])),
    [ticketTitle, brandName]
  );

  async function saveBilling() {
    const updated = await apiFetch('/api/organization', {
      method: 'PATCH',
      body: JSON.stringify({ billing: { portalDesign, voucherDesign, ...settings } }),
    });
    setOrg(updated);
    setPortalDesign(updated?.billing?.portalDesign || portalDesign);
    setVoucherDesign(updated?.billing?.voucherDesign || voucherDesign);
    setSettings(settingsFromBilling(updated?.billing));
    return updated;
  }

  async function onSave(e) {
    e?.preventDefault();
    setSaving(true);
    setErr('');
    setInfo('');
    try {
      await saveBilling();
      setInfo(
        tab === 'login'
          ? 'Saved. Push to a router so guests see the new login page.'
          : 'Saved. New ticket PDFs use this design by default.'
      );
    } catch (e2) {
      setErr(e2.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function onPush() {
    if (!routerId) {
      setErr('Select a router first.');
      return;
    }
    if (!serverName) {
      setErr('Select the hotspot server to push to.');
      return;
    }
    setPushing(true);
    setErr('');
    setInfo('');
    try {
      await saveBilling();
      const result = await apiFetch(`/api/hotspot/routers/${routerId}/push-captive-portal`, {
        method: 'POST',
        body: JSON.stringify({ hotspotServer: serverName }),
      });
      const file = result.files?.[0] || `${result.htmlDirectory}/login.html`;
      const size = result.fileSize ? ` (${(result.fileSize / 1024).toFixed(1)} KB)` : '';
      const dirNote = result.htmlDirectorySet
        ? ` Profile "${result.profile}" had no html directory, so it now uses ${result.htmlDirectory}.`
        : ` Profile "${result.profile}" uses ${result.htmlDirectory}.`;
      const shared = result.sharedWith?.length
        ? ` Servers ${result.sharedWith.join(', ')} use the same folder, so they show this page too.`
        : '';
      const garden = result.walledGarden?.ok
        ? ''
        : ` Buy links may not open until the walled garden is updated (${result.walledGarden?.error || 'sync failed'}).`;
      setInfo(
        `Uploaded ${file}${size} for hotspot server "${result.hotspotServer || serverName}" on ${result.routerName || 'the router'}.${dirNote}${shared}${garden}`
      );
      setRouters((list) =>
        list.map((r) =>
          r._id === routerId
            ? {
                ...r,
                captivePortal: {
                  hotspotServer: result.hotspotServer,
                  profile: result.profile,
                  htmlDirectory: result.htmlDirectory,
                  file,
                  pushedAt: result.pushedAt,
                },
              }
            : r
        )
      );
    } catch (e2) {
      setErr(e2.message || 'Could not push the login page');
    } finally {
      setPushing(false);
    }
  }

  if (loading) return <p className="text-sm text-slate-500">Loading designs…</p>;

  if (org?.platformScope) {
    return (
      <div className="mx-auto max-w-xl rounded-2xl border border-slate-800 bg-slate-900/50 p-6">
        <h2 className="text-lg font-semibold text-white">Templates &amp; designs</h2>
        <p className="mt-2 text-sm text-slate-400">
          Pick an organisation in the header, then choose its login page and ticket print design.
        </p>
      </div>
    );
  }

  function setField(key, value) {
    setSettings((current) => ({ ...current, [key]: value }));
  }

  const selectedLogin = previews.find((d) => d.id === portalDesign);
  const selectedTicket = VOUCHER_DESIGNS.find((d) => d.id === voucherDesign);

  return (
    <form onSubmit={onSave} className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">Templates &amp; designs</h2>
          <p className="mt-1 max-w-2xl text-sm text-slate-400">
            The Wi‑Fi login page guests see on your routers, and the look of printed tickets.
          </p>
        </div>
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>

      {err ? (
        <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200" role="alert">
          {err}
        </p>
      ) : null}
      {info ? (
        <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
          {info}
        </p>
      ) : null}

      <div className="flex gap-1 border-b border-slate-800">
        {[
          { id: 'login', label: `Login page (${previews.length || 20})` },
          { id: 'tickets', label: `Ticket printout (${VOUCHER_DESIGNS.length})` },
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`-mb-px border-b-2 px-4 py-2.5 text-sm font-medium ${
              tab === t.id ? 'border-emerald-500 text-white' : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'login' ? (
        <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
          <aside className="space-y-5 lg:sticky lg:top-4 lg:self-start">
            <section className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900/40 p-4">
              <h3 className="text-sm font-semibold text-white">Wording</h3>
              <label className="block text-xs text-slate-400">
                Headline
                <input
                  value={settings.portalHeadline}
                  onChange={(e) => setField('portalHeadline', e.target.value)}
                  maxLength={60}
                  placeholder="Design default"
                  className={fieldClass}
                />
              </label>
              <label className="block text-xs text-slate-400">
                Subtitle
                <input
                  value={settings.portalSubtitle}
                  onChange={(e) => setField('portalSubtitle', e.target.value)}
                  maxLength={120}
                  placeholder="Design default"
                  className={fieldClass}
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-xs text-slate-400">
                  Button
                  <input
                    value={settings.portalButtonLabel}
                    onChange={(e) => setField('portalButtonLabel', e.target.value)}
                    maxLength={24}
                    placeholder="Connect"
                    className={fieldClass}
                  />
                </label>
                <label className="block text-xs text-slate-400">
                  Buy link
                  <input
                    value={settings.portalBuyLabel}
                    onChange={(e) => setField('portalBuyLabel', e.target.value)}
                    maxLength={32}
                    placeholder="Buy a code"
                    className={fieldClass}
                  />
                </label>
              </div>
            </section>

            <section className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900/40 p-4">
              <h3 className="text-sm font-semibold text-white">Plan list &amp; footer</h3>
              <label className="flex cursor-pointer items-start gap-2 text-sm text-slate-300">
                <input
                  type="checkbox"
                  checked={settings.portalShowPlans}
                  onChange={(e) => setField('portalShowPlans', e.target.checked)}
                  className="mt-0.5 rounded border-slate-600"
                />
                <span>
                  Show plans and prices
                  <span className="block text-xs text-slate-500">
                    Lists your active hotspot packages. Tapping a plan opens the buy page with it selected.
                  </span>
                </span>
              </label>
              <label className="block text-xs text-slate-400">
                Footer text
                <input
                  value={settings.portalFooter}
                  onChange={(e) => setField('portalFooter', e.target.value)}
                  maxLength={160}
                  placeholder="e.g. Open daily 7am–11pm · Osu, Accra"
                  className={fieldClass}
                />
              </label>
              <label className="block text-xs text-slate-400">
                Support phone
                <input
                  value={settings.portalSupportPhone}
                  onChange={(e) => setField('portalSupportPhone', e.target.value)}
                  maxLength={24}
                  placeholder="e.g. 024 555 0101"
                  className={fieldClass}
                />
              </label>
              <p className="text-xs text-slate-500">The footer always ends with “© year {brandName}”.</p>
            </section>

            {settings.portalShowPlans ? <PlansEditor onChanged={() => setPlansVersion((v) => v + 1)} /> : null}

            <section className="space-y-3 rounded-2xl border border-emerald-700/40 bg-emerald-950/20 p-4">
              <h3 className="text-sm font-semibold text-white">Push to router</h3>
              <p className="text-xs text-slate-400">
                Pick the router and the hotspot server guests connect to. We save your changes, then the router downloads
                the page as <span className="font-mono">login.html</span> into that server&apos;s profile folder. Plans and
                prices are copied at push time — push again after changing packages.
              </p>
              <label className="block text-xs text-slate-400">
                Router
                <select value={routerId} onChange={(e) => setRouterId(e.target.value)} className={fieldClass}>
                  {routers.length === 0 ? <option value="">No routers yet</option> : null}
                  {routers.map((r) => (
                    <option key={r._id} value={r._id}>
                      {routerDisplayName(r) || r.host}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-xs text-slate-400">
                Hotspot server
                <select
                  value={serverName}
                  onChange={(e) => setServerName(e.target.value)}
                  disabled={!routerId || serversState !== 'idle' || servers.length === 0}
                  className={`${fieldClass} disabled:opacity-60`}
                >
                  <option value="">
                    {serversState === 'loading'
                      ? 'Reading servers from router…'
                      : servers.length === 0
                        ? 'No hotspot servers found'
                        : 'Choose a hotspot server'}
                  </option>
                  {servers.map((s) => (
                    <option key={s.name} value={s.name}>
                      {s.name}
                      {s.interface ? ` · ${s.interface}` : ''}
                      {s.profile ? ` · profile ${s.profile}` : ''}
                      {` · folder ${s.htmlDirectory || '(not set)'}`}
                      {s.disabled ? ' (disabled)' : ''}
                    </option>
                  ))}
                </select>
              </label>
              {serversState === 'error' ? <p className="text-xs text-red-300">{serversError}</p> : null}
              {(() => {
                const last = routers.find((r) => r._id === routerId)?.captivePortal;
                if (!last?.pushedAt) return null;
                return (
                  <p className="text-xs text-slate-400">
                    Last pushed {new Date(last.pushedAt).toLocaleString()} to{' '}
                    <span className="font-mono text-slate-300">{last.file || `${last.htmlDirectory}/login.html`}</span>
                    {last.hotspotServer ? ` (server ${last.hotspotServer})` : ''}.
                  </p>
                );
              })()}
              <button
                type="button"
                disabled={pushing || saving || !routerId || !serverName}
                onClick={onPush}
                className="w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                {pushing ? 'Pushing…' : 'Save and push to router'}
              </button>
            </section>
          </aside>

          <section className="min-w-0 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
              <span>
                Selected: <span className="font-medium text-slate-200">{selectedLogin?.name || portalDesign}</span>
                {previewLoading ? ' · updating previews…' : ''}
              </span>
              {samplePlans && settings.portalShowPlans ? (
                <span className="text-amber-300/90">Sample plans shown — add hotspot packages to show yours.</span>
              ) : null}
            </div>
            <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(234px,1fr))]">
              {previews.map((d) => (
                <LoginPreviewCard
                  key={d.id}
                  design={d}
                  selected={portalDesign === d.id}
                  onSelect={() => setPortalDesign(d.id)}
                />
              ))}
            </div>
          </section>
        </div>
      ) : (
        <div className="space-y-5">
          <section className="flex flex-col gap-3 rounded-2xl border border-slate-800 bg-slate-900/40 p-4 sm:flex-row sm:items-end sm:justify-between">
            <label className="block max-w-sm flex-1 text-xs text-slate-400">
              Ticket title
              <input
                value={settings.voucherTitle}
                onChange={(e) => setField('voucherTitle', e.target.value)}
                maxLength={32}
                placeholder="Wi‑Fi Access"
                className={fieldClass}
              />
            </label>
            <p className="max-w-md text-xs text-slate-500">
              Each ticket shows its own plan, price and router name. Selected:{' '}
              <span className="font-medium text-slate-200">{selectedTicket?.name}</span>. You can still pick another
              design when printing from Tickets.
            </p>
          </section>
          <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(220px,1fr))]">
            {VOUCHER_DESIGNS.map((d) => (
              <TicketPreviewCard
                key={d.id}
                design={d}
                svg={ticketSvgs[d.id]}
                selected={voucherDesign === d.id}
                onSelect={() => setVoucherDesign(d.id)}
              />
            ))}
          </div>
        </div>
      )}
    </form>
  );
}
