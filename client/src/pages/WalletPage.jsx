import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../api.js';

function formatMoney(cents) {
  const n = Number(cents) || 0;
  return `GHS ${(n / 100).toFixed(2)}`;
}

export function WalletPage() {
  const [wallet, setWallet] = useState(null);
  const [withdrawals, setWithdrawals] = useState([]);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);
  const [amountGhs, setAmountGhs] = useState('');
  const [destinationNote, setDestinationNote] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setErr('');
    setLoading(true);
    try {
      const [w, list] = await Promise.all([
        apiFetch('/api/wallet'),
        apiFetch('/api/wallet/withdrawals?limit=40'),
      ]);
      setWallet(w);
      setWithdrawals(Array.isArray(list) ? list : []);
      setDestinationNote((prev) => prev || w?.payoutNote || w?.payoutMomoNumber || '');
    } catch (e) {
      setErr(e.message || 'Could not load wallet');
      setWallet(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function requestWithdraw(e) {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      await apiFetch('/api/wallet/withdrawals', {
        method: 'POST',
        body: JSON.stringify({
          amountGhs: Number(amountGhs),
          destinationNote: destinationNote.trim(),
        }),
      });
      setAmountGhs('');
      await load();
    } catch (e2) {
      setErr(e2.message || 'Withdrawal request failed');
    } finally {
      setBusy(false);
    }
  }

  const available =
    (wallet?.balanceCents || 0) - (wallet?.pendingWithdrawals?.amountCents || 0);

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-white">Wallet &amp; withdrawals</h1>
        <p className="mt-1 text-sm text-slate-400">
          Customer payments settle through Qaretech Hubtel. Your balance is sales minus the platform fee (
          {wallet ? `${wallet.feePercent}%` : '…'}). Request a withdrawal anytime.
        </p>
      </div>

      {err && (
        <p className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">{err}</p>
      )}

      {loading && !wallet ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : wallet ? (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/20 px-4 py-3">
              <p className="text-xs uppercase tracking-wide text-emerald-200/80">Available</p>
              <p className="mt-1 text-2xl font-semibold text-emerald-200">{formatMoney(available)}</p>
              <p className="mt-1 text-xs text-slate-500">
                Ledger {formatMoney(wallet.balanceCents)}
                {wallet.pendingWithdrawals?.count
                  ? ` · ${wallet.pendingWithdrawals.count} pending`
                  : ''}
              </p>
            </div>
            <div className="rounded-xl border border-slate-700 bg-slate-900/60 px-4 py-3">
              <p className="text-xs uppercase tracking-wide text-slate-500">Paid sales (gross)</p>
              <p className="mt-1 text-lg font-semibold text-white">
                {formatMoney(wallet.sales?.grossCents)}
              </p>
              <p className="mt-1 text-xs text-slate-500">{wallet.sales?.paidCount || 0} payments</p>
            </div>
            <div className="rounded-xl border border-slate-700 bg-slate-900/60 px-4 py-3">
              <p className="text-xs uppercase tracking-wide text-slate-500">Platform fees</p>
              <p className="mt-1 text-lg font-semibold text-amber-200">
                {formatMoney(wallet.sales?.feeCents)}
              </p>
              <p className="mt-1 text-xs text-slate-500">Your net credited {formatMoney(wallet.sales?.netCents)}</p>
            </div>
          </div>

          <section className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
            <h2 className="text-lg font-medium text-white">Request withdrawal</h2>
            <p className="mt-1 text-xs text-slate-500">
              Qaretech pays out manually (MoMo/bank). Set your preferred destination under{' '}
              <Link to="/org/settings" className="text-indigo-400 hover:text-indigo-300">
                Organisation settings
              </Link>
              .
            </p>
            <form onSubmit={requestWithdraw} className="mt-4 grid gap-4 sm:grid-cols-2">
              <label className="block text-sm text-slate-300">
                Amount (GHS)
                <input
                  type="number"
                  min="1"
                  step="0.01"
                  required
                  value={amountGhs}
                  onChange={(e) => setAmountGhs(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
                />
              </label>
              <label className="block text-sm text-slate-300 sm:col-span-2">
                Destination note (MoMo number / bank)
                <input
                  value={destinationNote}
                  onChange={(e) => setDestinationNote(e.target.value)}
                  placeholder="0244… MTN / bank details"
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
                />
              </label>
              <button
                type="submit"
                disabled={busy}
                className="rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50 sm:col-span-2"
              >
                {busy ? 'Submitting…' : 'Request withdrawal'}
              </button>
            </form>
          </section>

          <section className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
            <h2 className="text-lg font-medium text-white">Withdrawal history</h2>
            {withdrawals.length === 0 ? (
              <p className="mt-3 text-sm text-slate-500">No withdrawal requests yet.</p>
            ) : (
              <ul className="mt-3 divide-y divide-slate-800">
                {withdrawals.map((w) => (
                  <li key={w.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
                    <div>
                      <p className="font-medium text-white">{formatMoney(w.amountCents)}</p>
                      <p className="text-xs text-slate-500">
                        {w.createdAt ? new Date(w.createdAt).toLocaleString() : ''}
                        {w.destinationNote ? ` · ${w.destinationNote}` : ''}
                      </p>
                    </div>
                    <span className="rounded-md border border-slate-600 px-2 py-0.5 text-xs capitalize text-slate-300">
                      {w.status}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
            <h2 className="text-lg font-medium text-white">Recent ledger</h2>
            {(wallet.ledger || []).length === 0 ? (
              <p className="mt-3 text-sm text-slate-500">No ledger entries yet.</p>
            ) : (
              <ul className="mt-3 divide-y divide-slate-800">
                {wallet.ledger.map((e) => (
                  <li key={e.id} className="flex justify-between gap-3 py-2.5 text-sm">
                    <div>
                      <p className="text-slate-200 capitalize">{e.type.replace(/_/g, ' ')}</p>
                      <p className="text-xs text-slate-500">
                        {e.createdAt ? new Date(e.createdAt).toLocaleString() : ''}
                        {e.note ? ` · ${e.note}` : ''}
                      </p>
                    </div>
                    <div className="text-right">
                      <p
                        className={
                          e.amountCents >= 0 ? 'font-medium text-emerald-300' : 'font-medium text-amber-200'
                        }
                      >
                        {e.amountCents >= 0 ? '+' : ''}
                        {formatMoney(e.amountCents)}
                      </p>
                      <p className="text-xs text-slate-500">bal {formatMoney(e.balanceAfterCents)}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}
