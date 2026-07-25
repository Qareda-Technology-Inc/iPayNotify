import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatRemainingFromPaidUntil } from '../utils/remainingTime.js';
import { publicFetch } from '../api.js';
import { usePortalContext, getPortalSlugFromLocation } from './usePortalContext.js';
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

/**
 * Online renew: platform-unique renew ID (or registered phone).
 * On-site / captive (?r=): PPPoE username still works for that venue only.
 */
export function RenewPage() {
  const navigate = useNavigate();
  const { ctx, loading: ctxLoading, error: ctxError } = usePortalContext();
  const [lookupMode, setLookupMode] = useState('renewCode');
  const [lookupValue, setLookupValue] = useState('');
  const [quote, setQuote] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState('lookup');
  const [draftCheckout, setDraftCheckout] = useState(null);
  const [hubtelSession, setHubtelSession] = useState(null);
  /** Remember how we found the quote so checkout uses the same key. */
  const [lookupPayload, setLookupPayload] = useState(null);

  const siteReady = Boolean(ctx?.resolved && ctx.router?.id);

  function buildLookupBody(value) {
    const v = String(value || '').trim();
    if (!v) return null;
    if (lookupMode === 'phone') {
      return { phone: v };
    }
    if (lookupMode === 'secretName') {
      return {
        secretName: v,
        portalSlug: getPortalSlugFromLocation() || undefined,
      };
    }
    return { renewCode: v };
  }

  function applyQuote(data, body) {
    setQuote(data);
    setLookupPayload(body);
    setStep('review');
  }

  async function doQuote(e) {
    e.preventDefault();
    setError('');
    if (lookupMode === 'secretName' && !siteReady) {
      setError(
        'Site not detected for username lookup. Use your renew ID or registered phone instead.'
      );
      return;
    }
    const body = buildLookupBody(lookupValue);
    if (!body) {
      setError('Enter your renew ID, phone, or PPPoE username');
      return;
    }
    setLoading(true);
    setQuote(null);
    try {
      const data = await publicFetch('/api/public/renew/quote', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      if (data.needsPrice) {
        setError(
          'This line has no renewal price. Ask your ISP to link a PPPoE package with a price.'
        );
        return;
      }
      applyQuote(data, body);
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
          ...(lookupPayload || {}),
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

  const modes = [
    { id: 'renewCode', label: 'Renew ID' },
    { id: 'phone', label: 'Phone' },
    ...(siteReady ? [{ id: 'secretName', label: 'PPPoE username' }] : []),
  ];

  const inputLabel =
    lookupMode === 'phone'
      ? 'Registered phone'
      : lookupMode === 'secretName'
        ? 'PPPoE username'
        : 'Renew ID';

  const inputPlaceholder =
    lookupMode === 'phone'
      ? 'e.g. 0244123456'
      : lookupMode === 'secretName'
        ? 'Your PPP login name'
        : 'e.g. QF7K2M9P';

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
      {step === 'lookup' ? (
        <p className="mt-2 text-sm text-slate-400">
          Renew online with your <span className="text-slate-200">renew ID</span> or registered
          phone
          {siteReady ? (
            <>
              {' '}
              — or your PPPoE username for <span className="text-slate-200">{ctx.router.name}</span>
            </>
          ) : null}
          .
        </p>
      ) : null}

      {ctxLoading && (
        <p className="mt-2 text-sm text-slate-500">Checking site link…</p>
      )}

      {ctxError && !siteReady && (
        <p className="mt-4 rounded border border-slate-700/80 bg-slate-900/50 px-3 py-2 text-sm text-slate-400">
          {ctxError} You can still renew with your renew ID or phone.
        </p>
      )}

      {step === 'lookup' && (
        <form onSubmit={doQuote} className="mt-8 space-y-4">
          <div className="flex flex-wrap gap-2">
            {modes.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => {
                  setLookupMode(m.id);
                  setLookupValue('');
                  setError('');
                }}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
                  lookupMode === m.id
                    ? 'bg-emerald-600 text-white'
                    : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
          <label className="block text-sm">
            <span className="text-slate-300">{inputLabel}</span>
            <input
              required
              value={lookupValue}
              onChange={(e) => setLookupValue(e.target.value)}
              placeholder={inputPlaceholder}
              autoCapitalize={lookupMode === 'renewCode' ? 'characters' : 'off'}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 font-mono outline-none ring-emerald-500/40 focus:ring-2"
            />
          </label>
          {lookupMode === 'renewCode' && (
            <p className="text-xs text-slate-500">
              Your renew ID looks like QF7K2M9P — ask your ISP or check your reminder SMS.
            </p>
          )}
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

      {step === 'review' && quote && (
        <form onSubmit={doCheckout} className="mt-8 space-y-4">
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-1 text-sm">
            {quote.renewCode ? (
              <DetailRow label="Renew ID">
                <span className="font-mono">{quote.renewCode}</span>
              </DetailRow>
            ) : null}
            <DetailRow label="PPPoE username">
              <span className="font-mono">{quote.secretName}</span>
            </DetailRow>
            {quote.customerName ? (
              <DetailRow label="Customer">{quote.customerName}</DetailRow>
            ) : null}
            {quote.routerName ? (
              <DetailRow label="Site">{quote.routerName}</DetailRow>
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
              setLookupPayload(null);
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
