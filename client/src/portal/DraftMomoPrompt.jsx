import { useState } from 'react';
import { publicFetch } from '../api.js';

function maskMsisdn(raw) {
  if (!raw) return '—';
  const s = String(raw).replace(/\s/g, '');
  if (s.length <= 4) return `••••${s}`;
  return `•••• ••${s.slice(-4)}`;
}

/**
 * Test-only MoMo-style sheet: shown when checkout returns `mode: draft_momo`.
 * Approve calls mock-complete then `onComplete(ref)`.
 */
export function DraftMomoPrompt({ open, payload, onClose, onComplete }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  if (!open || !payload) return null;

  async function simulateApprove() {
    setErr('');
    setBusy(true);
    try {
      await publicFetch('/api/public/payment/mock-complete', {
        method: 'POST',
        body: JSON.stringify({ clientReference: payload.clientReference }),
      });
      onComplete(payload.clientReference);
    } catch (e) {
      setErr(e.message || 'Could not complete payment');
    } finally {
      setBusy(false);
    }
  }

  const amount =
    typeof payload.amountGhs === 'number'
      ? payload.amountGhs.toFixed(2)
      : (Number(payload.amountCents) / 100).toFixed(2);
  const cur = payload.currency || 'GHS';

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/75 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="draft-momo-title"
      onClick={busy ? undefined : onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl border border-amber-500/25 bg-gradient-to-b from-slate-900 via-slate-950 to-slate-950 p-5 shadow-2xl shadow-black/50"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-amber-500/20 pb-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-amber-500/20 text-lg">
            📱
          </span>
          <div>
            <p id="draft-momo-title" className="text-sm font-semibold text-amber-100">
              Mobile Money
            </p>
            <p className="text-xs text-slate-500">Draft test — no live MTN call</p>
          </div>
        </div>

        <p className="mt-4 text-center text-sm text-slate-400">
          Payment request from{' '}
          <span className="font-medium text-slate-200">{payload.merchantName || 'Merchant'}</span>
        </p>
        <p className="mt-2 text-center text-3xl font-bold tracking-tight text-amber-300">
          {cur} {amount}
        </p>
        {payload.description && (
          <p className="mt-2 text-center text-xs text-slate-500">{payload.description}</p>
        )}
        <div className="mt-4 rounded-lg border border-slate-800 bg-slate-900/80 px-3 py-2 text-center text-sm text-slate-300">
          <span className="text-slate-500">Wallet </span>
          <span className="font-mono">{maskMsisdn(payload.customerMsisdn)}</span>
        </div>

        {err && (
          <p className="mt-3 rounded border border-red-500/40 bg-red-500/10 px-2 py-1.5 text-center text-xs text-red-200">
            {err}
          </p>
        )}

        <p className="mt-3 text-center text-[11px] leading-relaxed text-slate-500">
          No real charge. Tap below to simulate approving the prompt (same as mock checkout).
        </p>

        <div className="mt-5 flex flex-col gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={simulateApprove}
            className="w-full rounded-xl bg-amber-500 py-3 text-sm font-semibold text-slate-950 disabled:opacity-50"
          >
            {busy ? 'Processing…' : 'Simulate approve (enter PIN)'}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="w-full py-2 text-sm text-slate-500 hover:text-slate-300"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
