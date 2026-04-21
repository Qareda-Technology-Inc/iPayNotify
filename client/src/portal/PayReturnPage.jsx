import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { publicFetch } from '../api.js';

export function PayReturnPage() {
  const [params] = useSearchParams();
  const ref = params.get('ref');
  const [status, setStatus] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!ref) {
      setError('Missing payment reference');
      return;
    }
    let cancelled = false;
    let tries = 0;
    const tick = async () => {
      try {
        const data = await publicFetch(`/api/public/payment/${encodeURIComponent(ref)}/status`);
        if (cancelled) return;
        setStatus(data);
        if (data.status === 'pending' && tries < 40) {
          tries++;
          setTimeout(tick, 1500);
        }
      } catch (e) {
        if (!cancelled) setError(e.message);
      }
    };
    tick();
    return () => {
      cancelled = true;
    };
  }, [ref]);

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
        <p className="text-slate-300">Waiting for payment confirmation…</p>
        <p className="mt-2 text-sm text-slate-500">
          If you already paid, this can take a minute. You can keep this page open.
        </p>
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
