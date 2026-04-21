import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { publicFetch } from '../api.js';
import { usePortalContext } from './usePortalContext.js';
import { DraftMomoPrompt } from './DraftMomoPrompt.jsx';

export function HotspotBuyPage() {
  const navigate = useNavigate();
  const { ctx, loading: ctxLoading, error: ctxError, slug } = usePortalContext();
  const [routers, setRouters] = useState([]);
  const [packages, setPackages] = useState([]);
  const [routerId, setRouterId] = useState('');
  const [routerLocked, setRouterLocked] = useState(false);
  const [packageId, setPackageId] = useState('');
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [draftMomo, setDraftMomo] = useState(null);

  useEffect(() => {
    Promise.all([
      publicFetch('/api/public/routers'),
      publicFetch('/api/public/packages/hotspot'),
    ])
      .then(([r, p]) => {
        setRouters(r);
        setPackages(p);
        if (p[0]) setPackageId(p[0]._id);
      })
      .catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (ctxLoading || !ctx) return;
    if (ctx.resolved && ctx.router?.id) {
      setRouterId(ctx.router.id);
      setRouterLocked(true);
    } else if (routers.length && !routerId) {
      setRouterId(routers[0]._id || routers[0].id);
    }
  }, [ctx, ctxLoading, routers, routerId]);

  async function onPay(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const data = await publicFetch('/api/public/hotspot/checkout', {
        method: 'POST',
        body: JSON.stringify({
          packageId,
          routerId,
          customerMsisdn: phone.replace(/\s/g, ''),
          customerName: name || undefined,
        }),
      });
      if (data.mode === 'draft_momo') {
        setDraftMomo(data);
        return;
      }
      if (!data.checkoutUrl) {
        setError('No payment link returned. Try again or contact support.');
        return;
      }
      window.location.href = data.checkoutUrl;
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-md px-4 py-10">
      <DraftMomoPrompt
        open={!!draftMomo}
        payload={draftMomo}
        onClose={() => setDraftMomo(null)}
        onComplete={(ref) =>
          navigate(`/portal/pay/return?ref=${encodeURIComponent(ref)}`)
        }
      />
      <h1 className="text-xl font-semibold text-white">Buy hotspot access</h1>
      <p className="mt-2 text-sm text-slate-400">
        Pay with mobile money. When payment completes, your voucher code appears on the next
        screen (and by SMS when configured).
      </p>

      {ctxError && (
        <p className="mt-4 rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
          {ctxError}
        </p>
      )}
      {ctx?.resolved && (
        <p className="mt-4 rounded-lg border border-emerald-500/30 bg-emerald-950/40 px-3 py-2 text-sm text-emerald-200">
          Site: <strong>{ctx.router?.name}</strong>
          {ctx.match === 'ip' && (
            <span className="block text-xs text-emerald-400/90">
              Detected from your connection (same as Nettportal-style captive sites).
            </span>
          )}
          {ctx.match === 'slug' && slug && (
            <span className="block text-xs text-emerald-400/90">Link: ?r={slug}</span>
          )}
        </p>
      )}
      {!ctxLoading && ctx && !ctx.resolved && !slug && (
        <p className="mt-4 rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 text-xs text-slate-400">
          Choose your location below, or open the pay link from your WiFi login page (
          <span className="font-mono text-slate-300">?r=yoursite</span>) so the correct site is
          selected automatically.
        </p>
      )}
      {!ctxLoading && ctx && !ctx.resolved && slug && (
        <p className="mt-4 rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
          Unknown site link. Pick your location below or ask your provider for the correct link.
        </p>
      )}

      <form onSubmit={onPay} className="mt-8 space-y-4">
        <label className="block text-sm">
          <span className="text-slate-300">Router / location</span>
          <select
            required
            disabled={routerLocked}
            value={routerId}
            onChange={(e) => setRouterId(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 disabled:cursor-not-allowed disabled:opacity-80"
          >
            {routers.map((r) => (
              <option key={r._id || r.id} value={r._id || r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="text-slate-300">Package</span>
          <select
            required
            value={packageId}
            onChange={(e) => setPackageId(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5"
          >
            {packages.map((p) => (
              <option key={p._id} value={p._id}>
                {p.name} — {(p.priceCents / 100).toFixed(2)} {p.currency}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="text-slate-300">Mobile money number</span>
          <input
            required
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 outline-none ring-emerald-500/40 focus:ring-2"
          />
        </label>
        <label className="block text-sm">
          <span className="text-slate-300">Name (optional)</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 outline-none ring-emerald-500/40 focus:ring-2"
          />
        </label>
        {error && (
          <p className="rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={loading || !routers.length || !packages.length}
          className="w-full rounded-lg bg-emerald-600 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {loading ? 'Starting…' : 'Pay now'}
        </button>
      </form>
    </div>
  );
}
