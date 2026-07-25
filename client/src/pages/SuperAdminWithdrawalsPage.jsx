import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../api.js';

function formatMoney(cents) {
  return `GHS ${((Number(cents) || 0) / 100).toFixed(2)}`;
}

export function SuperAdminWithdrawalsPage() {
  const [status, setStatus] = useState('pending');
  const [rows, setRows] = useState([]);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');

  const load = useCallback(async () => {
    setErr('');
    setLoading(true);
    try {
      const list = await apiFetch(`/api/super-admin/withdrawals?status=${encodeURIComponent(status)}`);
      setRows(Array.isArray(list) ? list : []);
    } catch (e) {
      setErr(e.message || 'Load failed');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    load();
  }, [load]);

  async function pay(id) {
    const note = window.prompt('Optional payout note (MoMo ref / bank transfer ref)') || '';
    setBusyId(id);
    setErr('');
    try {
      await apiFetch(`/api/super-admin/withdrawals/${id}/pay`, {
        method: 'POST',
        body: JSON.stringify({ processNote: note }),
      });
      await load();
    } catch (e) {
      setErr(e.message || 'Pay failed');
    } finally {
      setBusyId('');
    }
  }

  async function reject(id) {
    const note = window.prompt('Reason for rejection') || '';
    setBusyId(id);
    setErr('');
    try {
      await apiFetch(`/api/super-admin/withdrawals/${id}/reject`, {
        method: 'POST',
        body: JSON.stringify({ processNote: note }),
      });
      await load();
    } catch (e) {
      setErr(e.message || 'Reject failed');
    } finally {
      setBusyId('');
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-white">Vendor withdrawals</h1>
        <p className="mt-1 text-sm text-slate-400">
          Pay organisations offline (MoMo/bank), then mark paid to debit their wallet.
        </p>
      </div>

      {err && (
        <p className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">{err}</p>
      )}

      <div className="flex flex-wrap gap-2">
        {['pending', 'paid', 'rejected', 'all'].map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStatus(s)}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium capitalize ${
              status === s ? 'bg-amber-600 text-white' : 'bg-slate-800 text-slate-400'
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      <section className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
        {loading ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-slate-500">No withdrawals in this view.</p>
        ) : (
          <ul className="divide-y divide-slate-800">
            {rows.map((w) => (
              <li key={w.id} className="flex flex-wrap items-center justify-between gap-3 py-4">
                <div>
                  <p className="font-medium text-white">{formatMoney(w.amountCents)}</p>
                  <p className="text-sm text-slate-300">
                    {w.organization?.name || 'Organisation'}{' '}
                    <span className="font-mono text-xs text-slate-500">
                      ({w.organization?.slug || '—'})
                    </span>
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {w.createdAt ? new Date(w.createdAt).toLocaleString() : ''}
                    {w.destinationNote ? ` · ${w.destinationNote}` : ''}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-md border border-slate-600 px-2 py-0.5 text-xs capitalize text-slate-300">
                    {w.status}
                  </span>
                  {(w.status === 'pending' || w.status === 'approved') && (
                    <>
                      <button
                        type="button"
                        disabled={busyId === w.id}
                        onClick={() => pay(w.id)}
                        className="rounded-lg border border-emerald-600/50 bg-emerald-950/40 px-3 py-1.5 text-xs text-emerald-200 disabled:opacity-50"
                      >
                        Mark paid
                      </button>
                      <button
                        type="button"
                        disabled={busyId === w.id}
                        onClick={() => reject(w.id)}
                        className="rounded-lg border border-red-500/40 px-3 py-1.5 text-xs text-red-300 disabled:opacity-50"
                      >
                        Reject
                      </button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
