import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatRemainingFromPaidUntil } from '../utils/remainingTime.js';
import { publicFetch } from '../api.js';
import { usePortalContext } from './usePortalContext.js';
import { DraftCheckoutPrompt } from './DraftCheckoutPrompt.jsx';
import { HubtelCheckout } from './HubtelCheckout.jsx';

export function RenewPage() {
  const navigate = useNavigate();
  const { ctx, loading: ctxLoading, error: ctxError, slug } = usePortalContext();
  const [secretName, setSecretName] = useState('');
  const [routerId, setRouterId] = useState('');
  const [hintRouterId, setHintRouterId] = useState('');
  const [routers, setRouters] = useState([]);
  const [quote, setQuote] = useState(null);
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState('lookup');
  const [draftCheckout, setDraftCheckout] = useState(null);
  const [hubtelSession, setHubtelSession] = useState(null);

  useEffect(() => {
    if (ctxLoading || !ctx?.resolved || !ctx.router?.id) return;
    const id = ctx.router.id;
    setHintRouterId(id);
    setRouterId(id);
  }, [ctx, ctxLoading]);

  async function doQuote(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    setQuote(null);
    try {
      const data = await publicFetch('/api/public/renew/quote', {
        method: 'POST',
        body: JSON.stringify({
          secretName: secretName.trim(),
          routerId: hintRouterId || routerId || undefined,
        }),
      });
      if (data.needRouterSelection) {
        setRouters(data.routers || []);
        setStep('pickRouter');
        return;
      }
      if (data.needsPrice) {
        setError(
          'This line has no renewal price. Ask your ISP to link a PPPoE package with a price.'
        );
        return;
      }
      setQuote(data);
      setStep('pay');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function doPay(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const data = await publicFetch('/api/public/renew/checkout', {
        method: 'POST',
        body: JSON.stringify({
          secretName: secretName.trim(),
          routerId: quote?.routerId || hintRouterId || routerId || undefined,
          customerMsisdn: phone.replace(/\s/g, ''),
          customerName: name || undefined,
        }),
      });
      if (data.mode === 'draft_hubtel' || data.mode === 'draft_momo') {
        setDraftCheckout(data);
        return;
      }
      if (data.mode === 'hubtel_checkout' && data.purchaseInfo && data.hubtelConfig) {
        setHubtelSession(data);
        return;
      }
      if (!data.checkoutUrl) {
        setError('No payment session returned. Try again or contact support.');
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
      <DraftCheckoutPrompt
        open={!!draftCheckout}
        payload={draftCheckout}
        onClose={() => setDraftCheckout(null)}
        onComplete={(ref) =>
          navigate(`/portal/pay/return?ref=${encodeURIComponent(ref)}`)
        }
      />
      <HubtelCheckout
        open={!!hubtelSession}
        purchaseInfo={hubtelSession?.purchaseInfo}
        hubtelConfig={hubtelSession?.hubtelConfig}
        onClose={() => setHubtelSession(null)}
        onFailure={() => {
          setError('Payment was not completed. You can try again.');
          setHubtelSession(null);
        }}
        onSuccess={() => {
          const ref = hubtelSession?.clientReference;
          setHubtelSession(null);
          if (ref) navigate(`/portal/pay/return?ref=${encodeURIComponent(ref)}`);
        }}
      />
      <h1 className="text-xl font-semibold text-white">Renew your internet</h1>
      <p className="mt-2 text-sm text-slate-400">
        Enter your PPPoE username (same as you use on the router). After Hubtel payment
        succeeds, your line is extended automatically.
      </p>

      {ctxError && (
        <p className="mt-4 rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
          {ctxError}
        </p>
      )}
      {ctx?.resolved && (
        <p className="mt-4 rounded-lg border border-emerald-500/30 bg-emerald-950/40 px-3 py-2 text-sm text-emerald-200">
          Site: <strong>{ctx.router?.name}</strong>
          {ctx.match === 'slug' && slug && (
            <span className="block text-xs text-emerald-400/90">?r={slug}</span>
          )}
        </p>
      )}

      {step === 'lookup' && (
        <form onSubmit={doQuote} className="mt-8 space-y-4">
          <label className="block text-sm">
            <span className="text-slate-300">PPPoE username</span>
            <input
              required
              value={secretName}
              onChange={(e) => setSecretName(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 font-mono outline-none ring-emerald-500/40 focus:ring-2"
            />
          </label>
          {error && (
            <p className="rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-emerald-600 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            {loading ? 'Checking…' : 'Continue'}
          </button>
        </form>
      )}

      {step === 'pickRouter' && (
        <div className="mt-8 space-y-4">
          <p className="text-sm text-slate-400">Choose your site / router:</p>
          <select
            required
            value={routerId}
            onChange={(e) => setRouterId(e.target.value)}
            className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5"
          >
            <option value="">Select…</option>
            {routers.map((r) => (
              <option key={r._id || r.id} value={r._id || r.id}>
                {r.name} ({r.host})
              </option>
            ))}
          </select>
          {error && (
            <p className="rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
              {error}
            </p>
          )}
          <button
            type="button"
            disabled={loading || !routerId}
            onClick={async () => {
              setError('');
              setLoading(true);
              try {
                const data = await publicFetch('/api/public/renew/quote', {
                  method: 'POST',
                  body: JSON.stringify({
                    secretName: secretName.trim(),
                    routerId,
                  }),
                });
                if (data.needsPrice) {
                  setError('No renewal price configured for this account.');
                  return;
                }
                setQuote(data);
                setStep('pay');
              } catch (err) {
                setError(err.message);
              } finally {
                setLoading(false);
              }
            }}
            className="w-full rounded-lg bg-emerald-600 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            {loading ? 'Checking…' : 'Continue'}
          </button>
        </div>
      )}

      {step === 'pay' && quote && (
        <form onSubmit={doPay} className="mt-8 space-y-4">
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 text-sm">
            <p>
              <span className="text-slate-500">Package</span>{' '}
              <span className="text-white">{quote.packageName}</span>
            </p>
            <p className="mt-2">
              <span className="text-slate-500">Amount</span>{' '}
              <span className="text-lg font-semibold text-emerald-400">
                {(quote.amountCents / 100).toFixed(2)} {quote.currency}
              </span>
            </p>
            {quote.paidUntil && (
              <>
                <p className="mt-2 text-slate-500">
                  Current valid until: {new Date(quote.paidUntil).toLocaleString()}
                </p>
                <p className="mt-1 text-slate-400">
                  {formatRemainingFromPaidUntil(quote.paidUntil)}
                </p>
              </>
            )}
          </div>
          <label className="block text-sm">
            <span className="text-slate-300">Mobile money number</span>
            <input
              required
              placeholder="e.g. 024xxxxxxx"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 outline-none ring-emerald-500/40 focus:ring-2"
            />
          </label>
          <label className="block text-sm">
            <span className="text-slate-300">Your name (optional)</span>
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
            disabled={loading}
            className="w-full rounded-lg bg-emerald-600 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            {loading ? 'Starting payment…' : 'Pay with Hubtel'}
          </button>
          <button
            type="button"
            onClick={() => {
              setStep('lookup');
              setQuote(null);
            }}
            className="w-full text-sm text-slate-500"
          >
            Back
          </button>
        </form>
      )}
    </div>
  );
}
