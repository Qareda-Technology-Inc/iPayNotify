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
  const [info, setInfo] = useState('');
  const [loading, setLoading] = useState(true);
  const [amountGhs, setAmountGhs] = useState('');
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
    setInfo('');
    try {
      const created = await apiFetch('/api/wallet/withdrawals', {
        method: 'POST',
        body: JSON.stringify({ amountGhs: Number(amountGhs) }),
      });
      setAmountGhs('');
      const amount = formatMoney(created.amountCents);
      setInfo(
        created.status === 'paid'
          ? `${amount} sent to ${wallet.payoutMomoNumber}.`
          : created.status === 'processing'
            ? `${amount} is on its way to ${wallet.payoutMomoNumber}. It usually arrives within a few minutes.`
            : `${amount} is waiting for approval${created.holdReason ? ` (${created.holdReason.toLowerCase()})` : ''}. You'll see it here once it is paid.`
      );
      await load();
    } catch (e2) {
      setErr(e2.message || 'Withdrawal request failed');
    } finally {
      setBusy(false);
    }
  }

  const available =
    (wallet?.balanceCents || 0) - (wallet?.pendingWithdrawals?.amountCents || 0);
  const canRequest = available >= 100;
  const salesNet = Number(wallet?.sales?.netCents) || 0;
  const balanceLooksEmpty = (wallet?.balanceCents || 0) === 0 && salesNet > 0;

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-white">Wallet &amp; withdrawals</h1>
        <p className="mt-1 text-sm text-slate-400">
          Customer payments settle through Qaretech. Your balance is sales minus the platform fee (
          {wallet ? `${wallet.feePercent}%` : '…'}).
        </p>
      </div>

      <ol className="list-decimal space-y-1 rounded-xl border border-slate-800 bg-slate-900/40 px-5 py-4 text-sm text-slate-300">
        <li>Paid customer sales credit this wallet (net of platform fee).</li>
        <li>
          You <strong className="text-slate-100">withdraw</strong> (min GHS 1.00) to your payout MoMo number.
        </li>
        <li>
          Within the platform&apos;s limits it is sent straight away. Larger amounts, the first withdrawal and
          withdrawals soon after you change the payout number wait for approval.
        </li>
      </ol>

      {err && (
        <p className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">{err}</p>
      )}
      {info && (
        <p className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
          {info}
        </p>
      )}
      {balanceLooksEmpty && (
        <p className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
          You have paid sales recorded, but wallet balance is still GHS 0.00. Older payments may not have been
          settled into the wallet. Ask a platform admin to run{' '}
          <code className="rounded bg-slate-900 px-1 font-mono text-xs">npm run db:backfill-wallet-settlements</code>{' '}
          on the server.
        </p>
      )}

      {loading && !wallet ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : wallet ? (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/20 px-4 py-3">
              <p className="text-xs uppercase tracking-wide text-emerald-200/80">Available to withdraw</p>
              <p className="mt-1 text-2xl font-semibold text-emerald-200">{formatMoney(available)}</p>
              <p className="mt-1 text-xs text-slate-500">
                Ledger {formatMoney(wallet.balanceCents)}
                {wallet.pendingWithdrawals?.count
                  ? ` · ${wallet.pendingWithdrawals.count} pending (reserved)`
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
            <h2 className="text-lg font-medium text-white">Withdraw to MoMo</h2>
            <p className="mt-1 text-xs text-slate-500">
              Only organisation admins can withdraw. Money goes to{' '}
              {wallet.payoutMomoNumber ? (
                <strong className="font-mono text-slate-200">{wallet.payoutMomoNumber}</strong>
              ) : (
                <span className="text-amber-200">your payout number (not set yet)</span>
              )}
              . Change it under{' '}
              <Link to="/org/settings" className="text-indigo-400 hover:text-indigo-300">
                Organisation
              </Link>
              ; after a change, withdrawals wait for approval for a while.
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
              {!canRequest ? (
                <p className="text-xs text-amber-200/90 sm:col-span-2">
                  Available balance must be at least GHS 1.00 to request a withdrawal.
                </p>
              ) : null}
              <button
                type="submit"
                disabled={busy || !canRequest || !wallet.payoutMomoNumber}
                className="rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50 sm:col-span-2"
              >
                {busy ? 'Sending…' : 'Withdraw'}
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
                        {w.payoutMsisdn ? ` · to ${w.payoutMsisdn}` : w.destinationNote ? ` · ${w.destinationNote}` : ''}
                        {w.processNote ? ` · ${w.processNote}` : ''}
                      </p>
                      {w.status === 'pending' && w.holdReason ? (
                        <p className="text-xs text-amber-200/80">Waiting for approval: {w.holdReason}</p>
                      ) : null}
                    </div>
                    <span
                      className={`rounded-md border px-2 py-0.5 text-xs capitalize ${
                        w.status === 'paid'
                          ? 'border-emerald-500/40 text-emerald-200'
                          : w.status === 'pending' || w.status === 'approved' || w.status === 'processing'
                            ? 'border-amber-500/40 text-amber-200'
                            : 'border-slate-600 text-slate-300'
                      }`}
                    >
                      {w.status === 'pending' ? 'waiting for approval' : w.status === 'processing' ? 'on its way' : w.status}
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
