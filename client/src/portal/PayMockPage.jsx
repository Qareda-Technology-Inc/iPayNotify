import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { publicFetch } from '../api.js';

/** Dev / mock: completes payment via API without MTN (see MTN_MOMO_MOCK, ALLOW_PAYMENT_SIMULATION). */
export function PayMockPage() {
  const [params] = useSearchParams();
  const ref = params.get('ref');
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    if (!ref) {
      setError('Missing ref');
      setBusy(false);
      return;
    }
    (async () => {
      try {
        await publicFetch('/api/public/payment/mock-complete', {
          method: 'POST',
          body: JSON.stringify({ clientReference: ref }),
        });
        navigate(`/portal/pay/return?ref=${encodeURIComponent(ref)}`, { replace: true });
      } catch (e) {
        setError(e.message);
      } finally {
        setBusy(false);
      }
    })();
  }, [ref, navigate]);

  if (error) {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center text-red-300">
        {error}
        <p className="mt-4 text-sm text-slate-500">
          Set MTN_MOMO_MOCK=true, PAYMENT_DRAFT_MOMO=true, or ALLOW_PAYMENT_SIMULATION=true for mock
          payments (non-production).
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md px-4 py-16 text-center text-slate-400">
      {busy ? 'Completing test payment…' : 'Redirecting…'}
    </div>
  );
}
