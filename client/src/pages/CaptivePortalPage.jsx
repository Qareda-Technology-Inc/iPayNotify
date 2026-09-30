import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../api.js';
import { routerDisplayName } from '../utils/routerDisplayName.js';
import { CaptiveLoginView } from '../portal/CaptiveLoginView.jsx';
import { PORTAL_DESIGNS, VOUCHER_DESIGNS, portalCopy } from '../portal/designs.js';

const EMPTY_COPY = {
  portalHeadline: '',
  portalSubtitle: '',
  portalButtonLabel: '',
  portalBuyLabel: '',
  voucherTitle: '',
};

function VoucherMock({ designId, title }) {
  const heading = title || 'Wi‑Fi Access';
  const frame = 'rounded-md border border-dashed border-slate-300 bg-white text-slate-900';
  let card;
  if (designId === 'ticket') {
    card = (
      <div className={`flex h-[90px] w-[192px] overflow-hidden ${frame}`}>
        <div className="flex w-7 items-center justify-center bg-orange-600 text-[8px] font-bold uppercase tracking-widest text-white [writing-mode:vertical-rl] rotate-180">
          {heading}
        </div>
        <div className="ml-1 border-l border-dashed border-orange-200 pl-2 pt-2">
          <p className="text-[7px] font-bold uppercase tracking-wide text-slate-400">Access code</p>
          <p className="font-mono text-lg font-bold tracking-[0.15em] text-orange-600">482 193</p>
          <p className="text-[9px] font-semibold text-slate-800">Daily pass</p>
          <p className="text-[8px] text-slate-500">1d · 1 GB</p>
        </div>
      </div>
    );
  } else if (designId === 'strip') {
    card = (
      <div className={`flex h-[54px] w-[240px] overflow-hidden ${frame}`}>
        <div className="flex w-16 items-center bg-slate-900 px-2 text-[9px] font-semibold leading-tight text-white">
          {heading}
        </div>
        <div className="flex flex-1 items-center justify-between px-2">
          <div>
            <p className="text-[7px] font-bold uppercase text-slate-400">Code</p>
            <p className="font-mono text-base font-bold tracking-[0.12em] text-emerald-600">482 193</p>
          </div>
          <div className="text-right">
            <p className="text-[8px] font-semibold text-slate-800">Daily pass</p>
            <p className="text-[8px] text-slate-500">1d · 1 GB</p>
          </div>
        </div>
      </div>
    );
  } else if (designId === 'mini') {
    card = (
      <div className={`flex h-[48px] w-[90px] flex-col items-center justify-center ${frame}`}>
        <p className="text-[6px] font-bold uppercase text-slate-500">{heading}</p>
        <p className="font-mono text-sm font-bold text-slate-900">482 193</p>
        <p className="text-[6px] text-slate-500">1d · 1 GB</p>
      </div>
    );
  } else if (designId === 'classic') {
    card = (
      <div className={`h-[84px] w-[138px] p-1 ${frame}`}>
        <div className="flex h-full flex-col items-center rounded border-[1.5px] border-slate-900 px-2 pt-1">
          <p className="text-[9px] font-bold text-slate-900">{heading}</p>
          <div className="mt-1 w-full border-t border-slate-200" />
          <p className="mt-1 w-full rounded bg-slate-100 py-0.5 text-center font-mono text-sm font-bold text-slate-900">
            482 193
          </p>
          <p className="mt-1 text-[7px] text-slate-500">Daily pass · 1d · 1 GB</p>
        </div>
      </div>
    );
  } else if (designId === 'badge') {
    card = (
      <div className="h-[81px] w-[138px] rounded-lg bg-indigo-600 p-2 text-white">
        <p className="text-[7px] font-bold uppercase tracking-wide text-indigo-200">{heading}</p>
        <p className="mt-1 rounded bg-white py-0.5 text-center font-mono text-sm font-bold text-indigo-600">
          482 193
        </p>
        <p className="mt-1 text-[8px] font-semibold">Daily pass</p>
        <p className="text-[7px] text-indigo-100">1d · 1 GB</p>
      </div>
    );
  } else {
    card = (
      <div className={`h-[60px] w-[114px] overflow-hidden ${frame}`}>
        <div className="bg-slate-900 px-1.5 py-0.5 text-[7px] font-semibold text-white">{heading}</div>
        <p className="mt-1 text-center font-mono text-sm font-bold text-emerald-600">482 193</p>
        <p className="text-center text-[7px] text-slate-500">Daily pass · 1d · 1 GB</p>
      </div>
    );
  }
  return (
    <div className="flex h-28 items-center justify-center rounded-lg border border-slate-800 bg-slate-100/95">
      {card}
    </div>
  );
}

export function CaptivePortalPage() {
  const [org, setOrg] = useState(null);
  const [portalDesign, setPortalDesign] = useState('midnight');
  const [voucherDesign, setVoucherDesign] = useState('grid');
  const [copy, setCopy] = useState(EMPTY_COPY);
  const [routers, setRouters] = useState([]);
  const [routerId, setRouterId] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [err, setErr] = useState('');
  const [info, setInfo] = useState('');

  const load = useCallback(async () => {
    setErr('');
    const [o, routersRes] = await Promise.all([
      apiFetch('/api/organization'),
      apiFetch('/api/routers').catch(() => []),
    ]);
    setOrg(o);
    const list = Array.isArray(routersRes) ? routersRes : [];
    setRouters(list);
    setRouterId((id) => id || list.find((r) => r.portalSlug)?._id || list[0]?._id || '');
    setPortalDesign(o?.billing?.portalDesign || 'midnight');
    setVoucherDesign(o?.billing?.voucherDesign || 'grid');
    const b = o?.billing || {};
    setCopy({
      portalHeadline: b.portalHeadline || '',
      portalSubtitle: b.portalSubtitle || '',
      portalButtonLabel: b.portalButtonLabel || '',
      portalBuyLabel: b.portalBuyLabel || '',
      voucherTitle: b.voucherTitle || '',
    });
  }, []);

  useEffect(() => {
    load()
      .catch((e) => setErr(e.message || 'Could not load organisation'))
      .finally(() => setLoading(false));
  }, [load]);

  async function saveBilling() {
    const updated = await apiFetch('/api/organization', {
      method: 'PATCH',
      body: JSON.stringify({
        billing: { portalDesign, voucherDesign, ...copy },
      }),
    });
    setOrg(updated);
    setPortalDesign(updated?.billing?.portalDesign || portalDesign);
    setVoucherDesign(updated?.billing?.voucherDesign || voucherDesign);
    const b = updated?.billing || {};
    setCopy({
      portalHeadline: b.portalHeadline || '',
      portalSubtitle: b.portalSubtitle || '',
      portalButtonLabel: b.portalButtonLabel || '',
      portalBuyLabel: b.portalBuyLabel || '',
      voucherTitle: b.voucherTitle || '',
    });
    return updated;
  }

  async function onSave(e) {
    e.preventDefault();
    setSaving(true);
    setErr('');
    setInfo('');
    try {
      await saveBilling();
      setInfo('Saved. Push to a router when you want guests to see this login page.');
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
        : ` Buy-a-code may not open until the walled garden is updated (${result.walledGarden?.error || 'sync failed'}).`;
      setInfo(`Pushed ${files} on ${result.routerName || 'the router'}.${garden}`);
    } catch (e2) {
      setErr(e2.message || 'Could not push the login page');
    } finally {
      setPushing(false);
    }
  }

  if (loading) return <p className="text-sm text-slate-500">Loading portal designs…</p>;

  if (org?.platformScope) {
    return (
      <div className="mx-auto max-w-xl rounded-2xl border border-slate-800 bg-slate-900/50 p-6">
        <h2 className="text-lg font-semibold text-white">Captive portal</h2>
        <p className="mt-2 text-sm text-slate-400">
          Pick an organisation in the header, then choose its login page and voucher print design.
        </p>
      </div>
    );
  }

  const brandName = String(org?.billing?.merchantDisplayName || org?.name || 'Wi‑Fi').trim();
  const logoUrl = String(org?.billing?.logoUrl || '').trim();
  const printTitle = portalCopy('midnight', { voucherTitle: copy.voucherTitle }).voucherTitle;
  const fieldClass =
    'mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none ring-emerald-500/40 focus:ring-2';

  function setField(key, value) {
    setCopy((current) => ({ ...current, [key]: value }));
  }

  return (
    <form onSubmit={onSave} className="mx-auto max-w-6xl space-y-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">Captive portal</h2>
          <p className="mt-1 max-w-2xl text-sm text-slate-400">
            This is the page guests see on the router when they join the Wi‑Fi. Pick the look, then
            push it. It replaces <span className="font-mono text-slate-300">login.html</span> in the
            hotspot folder.
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

      <section className="space-y-4 rounded-2xl border border-emerald-700/40 bg-emerald-950/20 p-5">
        <h3 className="text-sm font-semibold text-white">Push to router</h3>
        <p className="text-sm text-slate-400">
          Choose the site, then send the selected design. The router downloads it over HTTPS and
          stores it as the hotspot login page. The router needs a portal slug under Network → Routers.
        </p>
        <label className="block text-sm text-slate-300">
          Router
          <select
            value={routerId}
            onChange={(e) => setRouterId(e.target.value)}
            className={fieldClass}
          >
            {routers.length === 0 ? <option value="">No routers yet</option> : null}
            {routers.map((r) => (
              <option key={r._id} value={r._id}>
                {routerDisplayName(r) || r.host}
                {r.portalSlug ? '' : ' (no portal slug)'}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          disabled={pushing || saving || !routerId}
          onClick={onPush}
          className="rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
        >
          {pushing ? 'Pushing…' : 'Save and push to router'}
        </button>
      </section>

      <section className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900/40 p-5">
        <h3 className="text-sm font-semibold text-white">Wording</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm text-slate-300">
            Login headline
            <input
              value={copy.portalHeadline}
              onChange={(e) => setField('portalHeadline', e.target.value)}
              maxLength={60}
              placeholder="Connect to Wi‑Fi"
              className={fieldClass}
            />
          </label>
          <label className="block text-sm text-slate-300">
            Login subtitle
            <input
              value={copy.portalSubtitle}
              onChange={(e) => setField('portalSubtitle', e.target.value)}
              maxLength={120}
              placeholder="Type the code from your voucher."
              className={fieldClass}
            />
          </label>
          <label className="block text-sm text-slate-300">
            Connect button
            <input
              value={copy.portalButtonLabel}
              onChange={(e) => setField('portalButtonLabel', e.target.value)}
              maxLength={24}
              placeholder="Connect"
              className={fieldClass}
            />
          </label>
          <label className="block text-sm text-slate-300">
            Buy link
            <input
              value={copy.portalBuyLabel}
              onChange={(e) => setField('portalBuyLabel', e.target.value)}
              maxLength={32}
              placeholder="Buy a code"
              className={fieldClass}
            />
          </label>
          <label className="block text-sm text-slate-300 sm:col-span-2">
            Voucher title
            <input
              value={copy.voucherTitle}
              onChange={(e) => setField('voucherTitle', e.target.value)}
              maxLength={32}
              placeholder="Wi‑Fi Access"
              className={fieldClass}
            />
            <span className="mt-1 block text-xs text-slate-500">
              Printed at the top of each voucher. Plan name and limits still come from the package.
            </span>
          </label>
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-white">Login page</h3>
        <div className="grid gap-4 lg:grid-cols-3">
          {PORTAL_DESIGNS.map((d) => {
            const selected = portalDesign === d.id;
            const previewCopy = portalCopy(d.id, {
              headline: copy.portalHeadline,
              subtitle: copy.portalSubtitle,
              buttonLabel: copy.portalButtonLabel,
              buyLabel: copy.portalBuyLabel,
            });
            return (
              <div
                key={d.id}
                role="button"
                tabIndex={0}
                onClick={() => setPortalDesign(d.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setPortalDesign(d.id);
                  }
                }}
                className={`overflow-hidden rounded-2xl border text-left ${
                  selected ? 'border-emerald-500 ring-2 ring-emerald-500/40' : 'border-slate-800'
                }`}
              >
                <div className="relative h-[300px] overflow-hidden bg-slate-950">
                  <div className="pointer-events-none absolute left-0 top-0 w-[156%] origin-top-left scale-[0.64]">
                    <CaptiveLoginView
                      designId={d.id}
                      brandName={brandName}
                      logoUrl={logoUrl}
                      siteName="Sample site"
                      compact
                      preview
                      code="482193"
                      headline={previewCopy.headline}
                      subtitle={previewCopy.subtitle}
                      buttonLabel={previewCopy.buttonLabel}
                      buyLabel={previewCopy.buyLabel}
                    />
                  </div>
                </div>
                <div className="border-t border-slate-800 bg-slate-900/80 px-3 py-3">
                  <p className="text-sm font-medium text-white">
                    {d.name}
                    {selected ? <span className="ml-2 text-xs text-emerald-300">Selected</span> : null}
                  </p>
                  <p className="mt-1 text-xs text-slate-400">{d.blurb}</p>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-white">Voucher printout</h3>
        <div className="grid gap-4 lg:grid-cols-3">
          {VOUCHER_DESIGNS.map((d) => {
            const selected = voucherDesign === d.id;
            return (
              <div
                key={d.id}
                role="button"
                tabIndex={0}
                onClick={() => setVoucherDesign(d.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setVoucherDesign(d.id);
                  }
                }}
                className={`rounded-2xl border bg-slate-900/50 p-4 text-left ${
                  selected ? 'border-emerald-500 ring-2 ring-emerald-500/40' : 'border-slate-800'
                }`}
              >
                <VoucherMock designId={d.id} title={printTitle} />
                <p className="mt-3 text-sm font-medium text-white">
                  {d.name}
                  {selected ? <span className="ml-2 text-xs text-emerald-300">Selected</span> : null}
                </p>
                <p className="mt-1 text-xs text-slate-400">{d.blurb}</p>
              </div>
            );
          })}
        </div>
      </section>
    </form>
  );
}
