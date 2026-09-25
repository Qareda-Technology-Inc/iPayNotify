import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { publicFetch } from '../api.js';

const MAX_TRIES = 40;

export function PayReturnPage() {
  const [params] = useSearchParams();
  const ref = params.get('ref');
  const [status, setStatus] = useState(null);
  const [error, setError] = useState('');
  const [timedOut, setTimedOut] = useState(false);
  const [checking, setChecking] = useState(false);

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
            <Link to="/portal/renew" className="mt-4 block text-sm text-slate-400 hover:text-emerald-400">
              Back to renew
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
        <Link to="/portal/renew" className="mt-6 block text-emerald-400">
          Try again
        </Link>
      </div>
    );
  }

  if (status.status === 'paid' && status.kind === 'voucher' && status.voucherCode) {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center">
        <h1 className="text-lg font-semibold text-white">Payment successful</h1>
        <p className="mt-4 text-slate-400">Your hotspot code</p>
        <p className="mt-2 font-mono text-2xl font-bold tracking-wider text-emerald-400">
          {status.voucherCode}
        </p>
        <p className="mt-6 text-sm text-slate-500">Use this as username and password on the hotspot login.</p>
        <Link to="/portal/hotspot" className="mt-8 inline-block text-emerald-400">
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
        <Link to="/portal/renew" className="mt-8 inline-block text-emerald-400">
          Done
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md px-4 py-16 text-center text-slate-400">
      Status: {status.status}
      <Link to="/portal/renew" className="mt-6 block text-emerald-400">
        Home
      </Link>
    </div>
  );
}
