import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../api.js';
import { routerDisplayName } from '../utils/routerDisplayName.js';
import { Modal, btnPrimary, btnSecondary } from '../components/Modal.jsx';
import {
  SHEET_PRESETS,
  downloadVouchersPdf,
  parseSheet,
  renderSheetSvg,
  renderTicketSvg,
  sheetGeometry,
  sheetSummary,
} from '../utils/exportVouchersPdf.js';
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

function LoginPreviewCard({ design, selected, onSelect, onView }) {
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
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onView();
          }}
          onKeyDown={(e) => e.stopPropagation()}
          className="absolute bottom-3 right-3 rounded-lg bg-slate-950/85 px-3 py-1.5 text-xs font-semibold text-white shadow-lg ring-1 ring-white/15 backdrop-blur hover:bg-slate-900"
        >
          View full page
        </button>
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

const PREVIEW_DEVICES = [
  { id: 'phone', label: 'Phone', width: 375 },
  { id: 'tablet', label: 'Tablet', width: 768 },
  { id: 'desktop', label: 'Desktop', width: 1180 },
];

/** Full-size login page preview with device sizes and prev/next through the designs. */
function LoginPreviewModal({ designs, index, selectedId, onIndex, onUse, onClose }) {
  const [device, setDevice] = useState('phone');
  const frameBox = useRef(null);
  const [boxWidth, setBoxWidth] = useState(0);
  const design = designs[index];

  useEffect(() => {
    const el = frameBox.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(([entry]) => setBoxWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [design]);

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'ArrowLeft') onIndex((index - 1 + designs.length) % designs.length);
      if (e.key === 'ArrowRight') onIndex((index + 1) % designs.length);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, designs.length, onIndex]);

  if (!design) return null;
  const width = PREVIEW_DEVICES.find((d) => d.id === device)?.width || 375;
  /* Render at the real device width, then shrink to fit the dialog when it is narrower. */
  const scale = boxWidth && width > boxWidth ? boxWidth / width : 1;
  const height = 720;
  const isSelected = design.id === selectedId;

  return (
    <Modal
      open
      size="xl"
      title={`${design.name} — login page preview`}
      subtitle={`${design.blurb} Shown with your branding, wording and plans.`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btnSecondary} onClick={onClose}>
            Close
          </button>
          <button
            type="button"
            className={btnPrimary}
            disabled={isSelected}
            onClick={() => {
              onUse(design.id);
              onClose();
            }}
          >
            {isSelected ? 'Selected design' : 'Use this design'}
          </button>
        </>
      }
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex rounded-lg border border-slate-700 p-0.5" role="group" aria-label="Preview size">
          {PREVIEW_DEVICES.map((d) => (
            <button
              key={d.id}
              type="button"
              aria-pressed={device === d.id}
              onClick={() => setDevice(d.id)}
              className={`rounded-md px-3 py-1 text-xs font-medium ${
                device === d.id ? 'bg-emerald-600 text-white' : 'text-slate-300 hover:text-white'
              }`}
            >
              {d.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <button
            type="button"
            aria-label="Previous design"
            onClick={() => onIndex((index - 1 + designs.length) % designs.length)}
            className="rounded-lg border border-slate-700 px-2.5 py-1 text-slate-200 hover:border-slate-500"
          >
            ‹
          </button>
          <span>
            {index + 1} / {designs.length}
          </span>
          <button
            type="button"
            aria-label="Next design"
            onClick={() => onIndex((index + 1) % designs.length)}
            className="rounded-lg border border-slate-700 px-2.5 py-1 text-slate-200 hover:border-slate-500"
          >
            ›
          </button>
        </div>
      </div>
      <div ref={frameBox} className="flex justify-center overflow-hidden rounded-xl bg-slate-950/60 p-0">
        <div style={{ width: width * scale, height: height * scale }} className="relative">
          <iframe
            key={`${design.id}-${device}`}
            title={`${design.name} full preview`}
            srcDoc={design.html}
            sandbox=""
            style={{ width, height, transform: `scale(${scale})` }}
            className={`absolute left-0 top-0 origin-top-left border-0 bg-white ${
              device === 'phone' ? 'rounded-[28px] ring-8 ring-slate-800' : 'rounded-lg'
            }`}
          />
        </div>
      </div>
      <p className="mt-2 text-center text-[11px] text-slate-500">
        Scroll inside the page to see plans and the footer. Use ← → to switch designs. Buttons here do not log in.
      </p>
    </Modal>
  );
}

function TicketPreviewCard({ design, svg, selected, onSelect, sheetText }) {
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
      <p className="mt-0.5 text-xs text-slate-400">{sheetText || design.blurb}</p>
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
        These are your plans and their usual price at every site. To charge a different price at one site, set it under
        Push to router → Plans at this site. Untick to stop selling a plan online at every site.
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

/**
 * Which hotspot plans one site offers (login page, buy page, checkout), and at what price.
 * No plans chosen = every active plan, so existing sites keep working until someone picks.
 * A blank site price = the plan's own price from Plans & prices.
 */
function SitePlansPicker({ router, onSaved, plansVersion }) {
  const [plans, setPlans] = useState([]);
  const [state, setState] = useState(/** @type {'loading' | 'idle' | 'error'} */ ('loading'));
  const [onlySelected, setOnlySelected] = useState(false);
  const [selected, setSelected] = useState(/** @type {string[]} */ ([]));
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [prices, setPrices] = useState(/** @type {Record<string, string>} */ ({}));

  useEffect(() => {
    apiFetch('/api/packages?kind=hotspot')
      .then((list) => {
        const rows = (Array.isArray(list) ? list : [])
          .filter((p) => p.isActive !== false)
          .sort((a, b) => Number(a.priceCents || 0) - Number(b.priceCents || 0) || String(a.name).localeCompare(String(b.name)));
        setPlans(rows);
        setState('idle');
      })
      .catch((e) => {
        setMsg(e.message || 'Could not load plans');
        setState('error');
      });
  }, [plansVersion]);

  const routerKey = router?._id || '';
  const savedIds = useMemo(() => (router?.portalPackageIds || []).map(String), [router?.portalPackageIds]);
  const savedPrices = useMemo(() => {
    const out = /** @type {Record<string, string>} */ ({});
    for (const x of router?.portalPrices || []) out[String(x.packageId)] = (Number(x.priceCents) / 100).toFixed(2);
    return out;
  }, [router?.portalPrices]);
  useEffect(() => {
    setSelected(savedIds);
    setOnlySelected(savedIds.length > 0);
    setMsg('');
  }, [routerKey, savedIds]);
  useEffect(() => {
    setPrices(savedPrices);
  }, [routerKey, savedPrices]);

  /* What customers at this site can buy right now (saved choice, active, ticked in Plans & prices). */
  const soldCount = plans.filter(
    (p) => p.showOnPortal !== false && (savedIds.length === 0 || savedIds.includes(String(p._id)))
  ).length;
  let nothingSoldReason = '';
  if (state === 'idle' && soldCount === 0) {
    if (plans.length === 0) {
      nothingSoldReason = 'There are no active hotspot plans. Add one under All plan settings.';
    } else if (savedIds.length > 0 && !plans.some((p) => savedIds.includes(String(p._id)))) {
      nothingSoldReason =
        'The plans chosen for this site have been switched off or deleted. Choose All plans, or tick the plans this site sells.';
    } else {
      nothingSoldReason = 'Every plan offered here is unticked in Plans & prices above. Tick the plans to sell online.';
    }
  }

  async function savePrice(id) {
    const raw = String(prices[id] ?? '').trim();
    if (raw === (savedPrices[id] ?? '')) return;
    const value = raw === '' ? null : Number(raw);
    if (value !== null && (!Number.isFinite(value) || value <= 0)) {
      setMsg('Enter a price above 0, or leave it blank for the plan price.');
      return;
    }
    const next = { ...savedPrices };
    if (value === null) delete next[id];
    else next[id] = value.toFixed(2);
    const body = Object.entries(next).map(([packageId, v]) => ({ packageId, priceCents: Math.round(Number(v) * 100) }));
    setSaving(true);
    setMsg('');
    try {
      const updated = await apiFetch(`/api/routers/${routerKey}`, {
        method: 'PATCH',
        body: JSON.stringify({ portalPrices: body }),
      });
      onSaved(routerKey, { portalPrices: updated?.portalPrices || body });
    } catch (e) {
      setMsg(e.message || 'Could not save the price for this site');
    } finally {
      setSaving(false);
    }
  }

  async function save(ids) {
    if (!routerKey) return;
    setSaving(true);
    setMsg('');
    try {
      const updated = await apiFetch(`/api/routers/${routerKey}`, {
        method: 'PATCH',
        body: JSON.stringify({ portalPackageIds: ids }),
      });
      onSaved(routerKey, { portalPackageIds: (updated?.portalPackageIds || ids).map(String) });
    } catch (e) {
      setMsg(e.message || 'Could not save plans for this site');
    } finally {
      setSaving(false);
    }
  }

  function chooseAll() {
    setOnlySelected(false);
    setSelected([]);
    if (savedIds.length) save([]);
  }

  function toggle(id, on) {
    const next = on ? [...new Set([...selected, id])] : selected.filter((x) => x !== id);
    setSelected(next);
    /* An empty list means "all plans", so only save once at least one plan is ticked. */
    if (next.length) save(next);
    else setMsg('Tick at least one plan, or choose "All plans".');
  }

  if (!routerKey) return null;
  return (
    <div className="space-y-2 rounded-xl border border-slate-800 bg-slate-950/40 p-3">
      <p className="text-xs font-medium text-slate-300">Plans at this site</p>
      {nothingSoldReason ? (
        <div role="alert" className="rounded-lg border border-amber-500/40 bg-amber-950/30 px-3 py-2 text-xs text-amber-100">
          <p className="font-semibold">Customers at this site can&apos;t buy anything right now.</p>
          <p className="mt-0.5 text-amber-200/90">{nothingSoldReason}</p>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-4 text-xs text-slate-300">
        <label className="flex items-center gap-1.5">
          <input type="radio" checked={!onlySelected} disabled={saving} onChange={chooseAll} />
          All plans
        </label>
        <label className="flex items-center gap-1.5">
          <input type="radio" checked={onlySelected} disabled={saving} onChange={() => setOnlySelected(true)} />
          Only selected plans
        </label>
      </div>
      {state === 'loading' ? (
        <p className="text-xs text-slate-500">Loading plans…</p>
      ) : plans.length === 0 ? (
        <p className="text-xs text-slate-400">No active hotspot plans yet.</p>
      ) : (
        <ul className="max-h-64 space-y-1 overflow-y-auto">
          {plans.map((p) => {
            const id = String(p._id);
            const offered = !onlySelected || selected.includes(id);
            const planPrice = (Number(p.priceCents || 0) / 100).toFixed(2);
            return (
              <li key={p._id} className="flex items-center gap-2 text-sm text-slate-200">
                {onlySelected ? (
                  <input
                    type="checkbox"
                    aria-label={`Sell ${p.name} at this site`}
                    className="rounded border-slate-600"
                    checked={selected.includes(id)}
                    disabled={saving}
                    onChange={(e) => toggle(id, e.target.checked)}
                  />
                ) : null}
                <span className={`min-w-0 flex-1 truncate ${offered ? '' : 'text-slate-500'}`}>{p.name}</span>
                <label className="flex shrink-0 items-center gap-1 text-xs text-slate-500">
                  {p.currency || 'GHS'}
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0.01"
                    step="0.01"
                    aria-label={`Price of ${p.name} at this site`}
                    value={prices[id] ?? ''}
                    placeholder={planPrice}
                    disabled={saving || !offered}
                    onChange={(e) => setPrices((m) => ({ ...m, [id]: e.target.value }))}
                    onBlur={() => savePrice(id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') e.currentTarget.blur();
                    }}
                    className="w-20 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-right text-sm text-slate-100 placeholder:text-slate-500 disabled:opacity-50"
                  />
                </label>
              </li>
            );
          })}
        </ul>
      )}
      <p className="text-[11px] text-slate-500">
        Prices here are for this site only; leave one blank to use the plan&apos;s own price. Applies to the login page,
        the buy page and checkout at this site. Push again to update the router&apos;s login page.
      </p>
      {saving ? <p className="text-xs text-slate-400">Saving…</p> : null}
      {msg ? <p className="text-xs text-amber-300">{msg}</p> : null}
    </div>
  );
}

export function TemplatesPage() {
  const [org, setOrg] = useState(null);
  const [tab, setTab] = useState(/** @type {'login' | 'tickets'} */ ('login'));
  const [portalDesign, setPortalDesign] = useState('midnight');
  const [voucherDesign, setVoucherDesign] = useState('grid');
  const [voucherSheet, setVoucherSheet] = useState('auto');
  const [settings, setSettings] = useState(EMPTY_SETTINGS);
  const [previews, setPreviews] = useState([]);
  const [samplePlans, setSamplePlans] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [viewIndex, setViewIndex] = useState(/** @type {number | null} */ (null));
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
    setVoucherSheet(o?.billing?.voucherSheet || 'auto');
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
      routerId: routerId || undefined,
    }),
    [settings, routerId]
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

  const sheetGrid = parseSheet(voucherSheet);
  const selectedSheet = useMemo(() => sheetSummary(voucherDesign, voucherSheet), [voucherDesign, voucherSheet]);
  const sheetSvg = useMemo(
    () => (tab === 'tickets' ? renderSheetSvg(voucherDesign, { sheet: voucherSheet, title: ticketTitle, venue: brandName }) : ''),
    [tab, voucherDesign, voucherSheet, ticketTitle, brandName]
  );

  function setGrid(key, value) {
    const n = Math.round(Number(value));
    if (!value || !Number.isFinite(n) || n < 1) {
      setVoucherSheet('auto');
      return;
    }
    const g = sheetGeometry(voucherDesign, voucherSheet);
    const next = { cols: Math.min(12, g.cols), rows: Math.min(12, g.rows), [key]: Math.min(12, n) };
    setVoucherSheet(`${next.cols}x${next.rows}`);
  }

  function downloadSample() {
    const sample = Array.from({ length: selectedSheet.perPage }, (_, i) => ({
      code: String(100000 + ((i * 7919 + 4421) % 900000)),
      packageId: { name: 'Daily pass', priceCents: 500, currency: 'GHS' },
      elapsedSeconds: 86400,
      dataLimitBytes: 1073741824,
    }));
    downloadVouchersPdf(sample, {
      title: ticketTitle,
      venue: brandName,
      design: voucherDesign,
      sheet: voucherSheet,
      filename: `sample-${voucherDesign}-${voucherSheet}.pdf`,
    });
  }

  async function saveBilling() {
    const updated = await apiFetch('/api/organization', {
      method: 'PATCH',
      body: JSON.stringify({ billing: { portalDesign, voucherDesign, voucherSheet, ...settings } }),
    });
    setOrg(updated);
    setPortalDesign(updated?.billing?.portalDesign || portalDesign);
    setVoucherDesign(updated?.billing?.voucherDesign || voucherDesign);
    setVoucherSheet(updated?.billing?.voucherSheet || voucherSheet);
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
              <SitePlansPicker
                plansVersion={plansVersion}
                router={routers.find((r) => r._id === routerId)}
                onSaved={(id, patch) => {
                  setRouters((list) => list.map((r) => (r._id === id ? { ...r, ...patch } : r)));
                  setPlansVersion((v) => v + 1);
                }}
              />
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
              {previews.map((d, i) => (
                <LoginPreviewCard
                  key={d.id}
                  design={d}
                  selected={portalDesign === d.id}
                  onSelect={() => setPortalDesign(d.id)}
                  onView={() => setViewIndex(i)}
                />
              ))}
            </div>
            {viewIndex != null && previews[viewIndex] ? (
              <LoginPreviewModal
                designs={previews}
                index={viewIndex}
                selectedId={portalDesign}
                onIndex={setViewIndex}
                onUse={setPortalDesign}
                onClose={() => setViewIndex(null)}
              />
            ) : null}
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
          <section className="grid gap-5 rounded-2xl border border-slate-800 bg-slate-900/40 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-semibold text-white">Page layout</h3>
                <p className="mt-1 text-xs text-slate-500">
                  How many tickets fit on one A4 sheet. Custom grids shrink or enlarge the design to fit and turn the page
                  sideways when that gives bigger tickets.
                </p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {SHEET_PRESETS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setVoucherSheet(p.id)}
                    className={`rounded-lg border px-2.5 py-1.5 text-xs ${
                      voucherSheet === p.id
                        ? 'border-emerald-500 bg-emerald-500/15 text-emerald-200'
                        : 'border-slate-700 text-slate-400 hover:text-white'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap items-end gap-2 text-xs text-slate-400">
                <label>
                  Rows
                  <input
                    type="number"
                    min={1}
                    max={12}
                    value={sheetGrid?.rows ?? ''}
                    placeholder="auto"
                    onChange={(e) => setGrid('rows', e.target.value)}
                    className="mt-1 block w-20 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-white"
                  />
                </label>
                <span className="pb-2">×</span>
                <label>
                  Columns
                  <input
                    type="number"
                    min={1}
                    max={12}
                    value={sheetGrid?.cols ?? ''}
                    placeholder="auto"
                    onChange={(e) => setGrid('cols', e.target.value)}
                    className="mt-1 block w-20 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-white"
                  />
                </label>
              </div>
              <div className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 text-xs text-slate-300">
                <p>
                  <span className="font-medium text-white">{selectedTicket?.name}</span> · {selectedSheet.text}
                </p>
                {selectedSheet.scale < 0.75 ? (
                  <p className="mt-1 text-amber-300">
                    Tickets are printed at {Math.round(selectedSheet.scale * 100)}% of this design&apos;s normal size. Codes
                    may be hard to read; try a design marked &quot;Mini&quot; or &quot;Pocket&quot;, or fewer columns.
                  </p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={downloadSample}
                className="rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-200 hover:border-emerald-500 hover:text-white"
              >
                Download a sample page (PDF)
              </button>
              <p className="text-xs text-slate-500">
                Saved as the default for printing from Tickets and Issue tickets. Press Save at the top to keep it.
              </p>
            </div>
            <div>
              <p className="mb-2 text-xs text-slate-500">Print preview · sample codes</p>
              <div
                className={`mx-auto overflow-hidden rounded border border-slate-700 bg-white shadow-lg ${
                  selectedSheet.orientation === 'landscape' ? 'max-w-full' : 'max-w-md'
                }`}
                dangerouslySetInnerHTML={{ __html: sheetSvg }}
              />
            </div>
          </section>
          <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(220px,1fr))]">
            {VOUCHER_DESIGNS.map((d) => (
              <TicketPreviewCard
                key={d.id}
                design={d}
                svg={ticketSvgs[d.id]}
                selected={voucherDesign === d.id}
                onSelect={() => setVoucherDesign(d.id)}
                sheetText={sheetGrid ? sheetSummary(d.id, voucherSheet).text : ''}
              />
            ))}
          </div>
        </div>
      )}
    </form>
  );
}
