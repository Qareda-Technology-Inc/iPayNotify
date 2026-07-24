import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatRemainingFromPaidUntil } from '../utils/remainingTime.js';
import { publicFetch } from '../api.js';
import { usePortalContext } from './usePortalContext.js';
import { DraftCheckoutPrompt } from './DraftCheckoutPrompt.jsx';
import { HubtelCheckout } from './HubtelCheckout.jsx';

function DetailRow({ label, children }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-slate-800/80 py-2.5 last:border-0">
      <span className="shrink-0 text-slate-500">{label}</span>
      <span className="text-right text-slate-100">{children}</span>
    </div>
  );
}

export function RenewPage() {
  const navigate = useNavigate();
  const { ctx, loading: ctxLoading, error: ctxError } = usePortalContext();
  const [secretName, setSecretName] = useState('');
  const [routerId, setRouterId] = useState('');
  const [hintRouterId, setHintRouterId] = useState('');
  const [routers, setRouters] = useState([]);
  const [quote, setQuote] = useState(null);
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

  function applyQuote(data) {
    setQuote(data);
    setStep('review');
  }

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
      applyQuote(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function doCheckout(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const data = await publicFetch('/api/public/renew/checkout', {
        method: 'POST',
        body: JSON.stringify({
          secretName: secretName.trim(),
          routerId: quote?.routerId || hintRouterId || routerId || undefined,
          customerMsisdn: quote?.customerPhone || undefined,
          customerName: quote?.customerName || undefined,
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
      <h1 className="text-xl font-semibold text-white">Renew service</h1>
      {step === 'lookup' && (
        <p className="mt-2 text-sm text-slate-400">Enter your PPPoE username to continue.</p>
      )}

      {ctxError && (
        <p className="mt-4 rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
          {ctxError}
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
            {loading ? 'Looking up…' : 'Look up account'}
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
                applyQuote(data);
              } catch (err) {
                setError(err.message);
              } finally {
                setLoading(false);
              }
            }}
            className="w-full rounded-lg bg-emerald-600 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            {loading ? 'Looking up…' : 'Continue'}
          </button>
        </div>
      )}

      {step === 'review' && quote && (
        <form onSubmit={doCheckout} className="mt-8 space-y-4">
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-1 text-sm">
            <DetailRow label="PPPoE username">
              <span className="font-mono">{quote.secretName}</span>
            </DetailRow>
            {quote.customerName ? (
              <DetailRow label="Customer">{quote.customerName}</DetailRow>
            ) : null}
            <DetailRow label="Package">{quote.packageName}</DetailRow>
            <DetailRow label="Amount">
              <span className="text-lg font-semibold text-emerald-400">
                {(quote.amountCents / 100).toFixed(2)} {quote.currency}
              </span>
            </DetailRow>
            {quote.paidUntil ? (
              <>
                <DetailRow label="Expires">
                  {new Date(quote.paidUntil).toLocaleString()}
                </DetailRow>
                <DetailRow label="Time left">
                  {formatRemainingFromPaidUntil(quote.paidUntil)}
                </DetailRow>
              </>
            ) : null}
          </div>

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
            {loading ? 'Please wait…' : 'Proceed to checkout'}
          </button>
          <button
            type="button"
            onClick={() => {
              setStep('lookup');
              setQuote(null);
              setError('');
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
