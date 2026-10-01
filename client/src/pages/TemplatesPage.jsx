import { useCallback, useEffect, useMemo, useState } from 'react';
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

export function TemplatesPage() {
  const [org, setOrg] = useState(null);
  const [tab, setTab] = useState(/** @type {'login' | 'tickets'} */ ('login'));
  const [portalDesign, setPortalDesign] = useState('midnight');
  const [voucherDesign, setVoucherDesign] = useState('grid');
  const [settings, setSettings] = useState(EMPTY_SETTINGS);
  const [previews, setPreviews] = useState([]);
  const [samplePlans, setSamplePlans] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [routers, setRouters] = useState([]);
  const [routerId, setRouterId] = useState('');
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
    setRouterId((id) => id || list.find((r) => r.portalSlug)?._id || list[0]?._id || '');
    setPortalDesign(o?.billing?.portalDesign || 'midnight');
    setVoucherDesign(o?.billing?.voucherDesign || 'grid');
    setSettings(settingsFromBilling(o?.billing));
  }, []);

  useEffect(() => {
    load()
      .catch((e) => setErr(e.message || 'Could not load organisation'))
      .finally(() => setLoading(false));
  }, [load]);

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
  }, [previewBody, loading, org?.platformScope]);

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
    setPushing(true);
    setErr('');
    setInfo('');
    try {
      await saveBilling();
      const result = await apiFetch(`/api/hotspot/routers/${routerId}/push-captive-portal`, {
        method: 'POST',
        body: '{}',
      });
      const files = (result.files || []).join(', ') || 'the hotspot login page';
      const garden = result.walledGarden?.ok
        ? ''
        : ` Buy links may not open until the walled garden is updated (${result.walledGarden?.error || 'sync failed'}).`;
      setInfo(`Pushed ${files} to ${result.routerName || 'the router'}.${garden}`);
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
              <h3 className="text-sm font-semibold text-white">Plans &amp; footer</h3>
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

            <section className="space-y-3 rounded-2xl border border-emerald-700/40 bg-emerald-950/20 p-4">
              <h3 className="text-sm font-semibold text-white">Push to router</h3>
              <p className="text-xs text-slate-400">
                Saves, then the router downloads the page as its hotspot <span className="font-mono">login.html</span>.
                Plans and prices are copied at push time — push again after changing packages.
              </p>
              <select value={routerId} onChange={(e) => setRouterId(e.target.value)} className={fieldClass}>
                {routers.length === 0 ? <option value="">No routers yet</option> : null}
                {routers.map((r) => (
                  <option key={r._id} value={r._id}>
                    {routerDisplayName(r) || r.host}
                    {r.portalSlug ? '' : ' (no portal slug)'}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={pushing || saving || !routerId}
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
