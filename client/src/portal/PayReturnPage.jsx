import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { publicFetch } from '../api.js';

/** MoMo approvals can take minutes: poll fast at first, then slower, for up to ~10 minutes. */
const FAST_TRIES = 20;
const FAST_MS = 2000;
const SLOW_MS = 5000;
const MAX_WAIT_MS = 10 * 60 * 1000;
/** After Hubtel was closed or reported failure, keep confirming a little longer before giving up. */
const FAILED_RECHECK_MS = 3 * 60 * 1000;
const MAX_ACTIVATE_TRIES = 60;
const MAX_NETWORK_ERRORS = 6;

function Spinner() {
  return (
    <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-slate-700 border-t-emerald-400" aria-hidden />
  );
}

/**
 * Logs the guest in with their new code. With the router's login address (passed through from its
 * login page) the code goes straight in; without it, any plain-http page makes the hotspot show its
 * login page.
 */
function connectHref(routerLogin, code) {
  let url;
  try {
    url = new URL(routerLogin);
  } catch {
    return 'http://neverssl.com/';
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return 'http://neverssl.com/';
  url.search = new URLSearchParams({ username: code, password: '' }).toString();
  return url.toString();
}

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
  const routerLogin = params.get('login') || '';
  const hotspotQuery = new URLSearchParams();
  if (siteSlug) hotspotQuery.set('r', siteSlug);
  if (serverName) hotspotQuery.set('s', serverName);
  if (routerLogin) hotspotQuery.set('login', routerLogin);
  const hotspotHref = `/portal/hotspot${hotspotQuery.size ? `?${hotspotQuery}` : ''}`;
  const [status, setStatus] = useState(null);
  const [error, setError] = useState('');
  const [timedOut, setTimedOut] = useState(false);
  const [checking, setChecking] = useState(false);
  const isHotspot = params.get('flow') === 'hotspot' || status?.kind === 'voucher';
  const homeHref = isHotspot ? hotspotHref : renewHref;
  const [copied, setCopied] = useState(false);
  const closedEarly = params.get('closed') === '1';
  const [stillChecking, setStillChecking] = useState(true);
  const [netTrouble, setNetTrouble] = useState(false);

  const pollOnce = useCallback(async () => {
    const data = await publicFetch(`/api/public/payment/${encodeURIComponent(ref)}/status`);
    setStatus(data);
    return data;
  }, [ref]);

  useEffect(() => {
    if (!ref) {
      setError('Missing payment reference');
      return undefined;
    }
    let cancelled = false;
    let timer = null;
    let tries = 0;
    let activateTries = 0;
    let netErrors = 0;
    const startedAt = Date.now();
    setTimedOut(false);
    setStillChecking(true);
    const later = (ms) => {
      if (!cancelled) timer = setTimeout(tick, ms);
    };
    async function tick() {
      const elapsed = Date.now() - startedAt;
      try {
        const data = await pollOnce();
        if (cancelled) return;
        netErrors = 0;
        setNetTrouble(false);
        tries += 1;
        if (data.status === 'pending') {
          if (elapsed < MAX_WAIT_MS) later(tries < FAST_TRIES ? FAST_MS : SLOW_MS);
          else {
            setTimedOut(true);
            setStillChecking(false);
          }
        } else if (data.status === 'failed' && closedEarly && elapsed < FAILED_RECHECK_MS) {
          later(SLOW_MS);
        } else if (voucherActivating(data) && activateTries < MAX_ACTIVATE_TRIES) {
          activateTries += 1;
          later(SLOW_MS);
        } else {
          setStillChecking(false);
        }
      } catch (e) {
        if (cancelled) return;
        netErrors += 1;
        setNetTrouble(true);
        if (netErrors >= MAX_NETWORK_ERRORS && elapsed >= MAX_WAIT_MS) {
          setError(e.message || 'Could not reach the payment server');
          return;
        }
        later(SLOW_MS);
      }
    }
    tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [ref, pollOnce, closedEarly]);

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
        <Spinner />
        <p className="mt-4">Confirming payment…</p>
        {netTrouble ? (
          <p className="mt-2 text-xs text-amber-300">Connection is slow — still trying…</p>
        ) : null}
      </div>
    );
  }

  if (status.status === 'pending') {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center">
        {!timedOut ? <Spinner /> : null}
        <p className="mt-4 text-slate-200">
          {timedOut ? 'Still waiting for confirmation' : 'Waiting for payment confirmation…'}
        </p>
        <p className="mt-2 text-sm text-slate-500">
          {timedOut
            ? 'If you already paid, your service will activate automatically once the payment is confirmed — we keep checking in the background. You can check again or contact your ISP with this reference.'
            : closedEarly
              ? 'If you approved the MoMo prompt on your phone, keep this page open — we are confirming the payment.'
              : 'Approve the prompt on your phone if you have not yet. This can take a minute — keep this page open.'}
        </p>
        {!timedOut && status.displayText ? (
          <p className="mt-3 rounded-lg border border-emerald-500/30 bg-emerald-950/30 px-3 py-2 text-sm text-emerald-100">
            {status.displayText}
          </p>
        ) : null}
        {netTrouble ? (
          <p className="mt-2 text-xs text-amber-300">Connection is slow — still trying…</p>
        ) : null}
        <p className="mt-4 font-mono text-xs text-slate-500 break-all">{ref}</p>
        {timedOut ? (
          <button
            type="button"
            disabled={checking}
            onClick={checkAgain}
            className="mt-6 rounded-lg border border-emerald-600/50 bg-emerald-950/40 px-4 py-2 text-sm text-emerald-200 disabled:opacity-50"
          >
            {checking ? 'Checking…' : 'Check again'}
          </button>
        ) : null}
        <Link to={homeHref} className="mt-5 block text-sm text-slate-400 hover:text-emerald-400">
          Didn&apos;t pay? {isHotspot ? 'Back to Wi‑Fi plans' : 'Start again'}
        </Link>
      </div>
    );
  }

  if (status.status === 'failed') {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center">
        {stillChecking ? <Spinner /> : null}
        <p className="mt-4 text-red-300">
          {stillChecking ? 'Payment not confirmed yet' : 'Payment was not completed.'}
        </p>
        <p className="mt-2 text-sm text-slate-500">
          {stillChecking
            ? 'Checking again in case the MoMo approval went through…'
            : 'If money left your wallet, it will be applied automatically once the payment is confirmed. Keep this reference.'}
        </p>
        <p className="mt-4 font-mono text-xs text-slate-500 break-all">{ref}</p>
        {!stillChecking ? (
          <button
            type="button"
            disabled={checking}
            onClick={checkAgain}
            className="mt-6 rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-200 disabled:opacity-50"
          >
            {checking ? 'Checking…' : 'Check again'}
          </button>
        ) : null}
        <Link to={homeHref} className="mt-5 block text-emerald-400">
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
        <a
          href={connectHref(routerLogin, status.voucherCode)}
          className={`mt-6 block w-full rounded-xl px-4 py-3 text-base font-semibold ${
            activating
              ? 'pointer-events-none bg-slate-800 text-slate-500'
              : 'bg-emerald-500 text-slate-950 hover:bg-emerald-400'
          }`}
          aria-disabled={activating || undefined}
        >
          {routerLogin ? 'Connect now' : 'Enter code to connect'}
        </a>
        <p className="mt-3 text-sm text-slate-500">
          {routerLogin
            ? 'Connects this phone with your code. Keep the code until your plan runs out.'
            : 'Opens the Wi‑Fi login page: enter the code there. Keep it until your plan runs out.'}
        </p>
        <Link
          to={hotspotHref}
          className="mt-4 block w-full rounded-xl border border-slate-700 px-4 py-3 text-sm text-slate-200 hover:border-slate-500"
        >
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

  if (status.status === 'paid' && status.kind === 'org_subscription') {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center">
        <h1 className="text-lg font-semibold text-white">Bill paid</h1>
        <p className="mt-4 text-slate-400">Thank you. Your organisation account is up to date.</p>
        {/* Admin app route, not the portal: a full load so the dashboard picks up the new status. */}
        <a href="/org/billing" className="mt-8 inline-block text-emerald-400">
          Back to Billing
        </a>
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
