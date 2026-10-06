import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { publicFetch } from '../api.js';

const MAX_TRIES = 40;
const MAX_ACTIVATE_TRIES = 60;

function voucherActivating(data) {
  return data?.status === 'paid' && data?.kind === 'voucher' && data?.fulfillment !== 'done';
}

export function PayReturnPage() {
  const [params] = useSearchParams();
  const ref = params.get('ref');
  const siteSlug = params.get('r');
  const renewHref = siteSlug
    ? `/portal/renew?r=${encodeURIComponent(siteSlug)}`
    : '/portal/renew';
  const serverName = params.get('s');
  const hotspotHref = `/portal/hotspot${siteSlug ? `?r=${encodeURIComponent(siteSlug)}` : ''}${
    serverName ? `${siteSlug ? '&' : '?'}s=${encodeURIComponent(serverName)}` : ''
  }`;
  const [status, setStatus] = useState(null);
  const [error, setError] = useState('');
  const [timedOut, setTimedOut] = useState(false);
  const [checking, setChecking] = useState(false);
  const isHotspot = params.get('flow') === 'hotspot' || status?.kind === 'voucher';
  const homeHref = isHotspot ? hotspotHref : renewHref;
  const [copied, setCopied] = useState(false);

  const pollOnce = useCallback(async () => {
    const data = await publicFetch(`/api/public/payment/${encodeURIComponent(ref)}/status`);
    setStatus(data);
    return data;
  }, [ref]);

  useEffect(() => {
    if (!ref) {
      setError('Missing payment reference');
      return;
    }
    let cancelled = false;
    let tries = 0;
    let activateTries = 0;
    setTimedOut(false);
    const tick = async () => {
      try {
        const data = await pollOnce();
        if (cancelled) return;
        if (data.status === 'pending' && tries < MAX_TRIES) {
          tries += 1;
          setTimeout(tick, 1500);
        } else if (data.status === 'pending') {
          setTimedOut(true);
        } else if (voucherActivating(data) && activateTries < MAX_ACTIVATE_TRIES) {
          activateTries += 1;
          setTimeout(tick, 5000);
        }
      } catch (e) {
        if (!cancelled) setError(e.message);
      }
    };
    tick();
    return () => {
      cancelled = true;
    };
  }, [ref, pollOnce]);

  async function checkAgain() {
    setChecking(true);
    setError('');
    try {
      const data = await pollOnce();
      if (data.status === 'pending') setTimedOut(true);
      else setTimedOut(false);
    } catch (e) {
      setError(e.message);
    } finally {
      setChecking(false);
    }
  }

  if (!ref) {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center text-red-300">
        Invalid return link.
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center text-red-300">{error}</div>
    );
  }

  if (!status) {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center text-slate-400">
        Confirming payment…
      </div>
    );
  }

  if (status.status === 'pending') {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center">
        <p className="text-slate-300">
          {timedOut ? 'Still waiting for confirmation' : 'Waiting for payment confirmation…'}
        </p>
        <p className="mt-2 text-sm text-slate-500">
          {timedOut
            ? 'If you already paid, your service will activate when Hubtel confirms. You can check again or contact your ISP with this reference.'
            : 'If you already paid, this can take a minute. You can keep this page open.'}
        </p>
        {timedOut ? (
          <>
            <p className="mt-4 font-mono text-xs text-slate-500 break-all">{ref}</p>
            <button
              type="button"
              disabled={checking}
              onClick={checkAgain}
              className="mt-6 rounded-lg border border-emerald-600/50 bg-emerald-950/40 px-4 py-2 text-sm text-emerald-200 disabled:opacity-50"
            >
              {checking ? 'Checking…' : 'Check again'}
            </button>
            <Link to={homeHref} className="mt-4 block text-sm text-slate-400 hover:text-emerald-400">
              {isHotspot ? 'Back to Wi‑Fi plans' : 'Back to renew'}
            </Link>
          </>
        ) : null}
      </div>
    );
  }

  if (status.status === 'failed') {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center text-red-300">
        Payment was not completed.
        <Link to={homeHref} className="mt-6 block text-emerald-400">
          Try again
        </Link>
      </div>
    );
  }

  if (status.status === 'paid' && status.kind === 'voucher' && !status.voucherCode) {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center">
        <h1 className="text-lg font-semibold text-white">Payment received</h1>
        <p className="mt-4 text-slate-400">Preparing your Wi‑Fi ticket code… keep this page open.</p>
        <p className="mt-4 font-mono text-xs text-slate-500 break-all">{ref}</p>
        <button
          type="button"
          disabled={checking}
          onClick={checkAgain}
          className="mt-6 rounded-lg border border-emerald-600/50 bg-emerald-950/40 px-4 py-2 text-sm text-emerald-200 disabled:opacity-50"
        >
          {checking ? 'Checking…' : 'Check again'}
        </button>
      </div>
    );
  }

  if (status.status === 'paid' && status.kind === 'voucher' && status.voucherCode) {
    const activating = voucherActivating(status);
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center">
        <h1 className="text-lg font-semibold text-white">Payment successful</h1>
        <p className="mt-4 text-slate-400">Your Wi‑Fi ticket code</p>
        <p className="mt-2 select-all font-mono text-3xl font-bold tracking-wider text-emerald-400">
          {status.voucherCode}
        </p>
        <button
          type="button"
          onClick={() => {
            navigator.clipboard?.writeText(status.voucherCode).then(() => setCopied(true)).catch(() => {});
          }}
          className="mt-3 rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:border-slate-500"
        >
          {copied ? 'Copied' : 'Copy code'}
        </button>
        {activating ? (
          <div className="mt-6 rounded-lg border border-amber-500/40 bg-amber-950/30 px-3 py-2 text-sm text-amber-100">
            <p>Activating this code on the Wi‑Fi router… it can take a few minutes.</p>
            <button
              type="button"
              disabled={checking}
              onClick={checkAgain}
              className="mt-2 text-xs text-amber-200 underline disabled:opacity-50"
            >
              {checking ? 'Checking…' : 'Check again'}
            </button>
          </div>
        ) : null}
        <p className="mt-6 text-sm text-slate-500">
          Go back to the Wi‑Fi login page and enter this code to connect. Keep it until your plan runs out.
        </p>
        <Link to={hotspotHref} className="mt-8 inline-block text-emerald-400">
          Buy another
        </Link>
      </div>
    );
  }

  if (status.status === 'paid' && status.kind === 'renewal') {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center">
        <h1 className="text-lg font-semibold text-white">Renewal complete</h1>
        <p className="mt-4 text-slate-400">Your service is active until</p>
        <p className="mt-2 text-xl text-emerald-400">
          {status.renewedUntil
            ? new Date(status.renewedUntil).toLocaleString()
            : 'Updated — reconnect your router'}
        </p>
        <Link to={renewHref} className="mt-8 inline-block text-emerald-400">
          Done
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md px-4 py-16 text-center text-slate-400">
      Status: {status.status}
      <Link to={homeHref} className="mt-6 block text-emerald-400">
        Home
      </Link>
    </div>
  );
}
