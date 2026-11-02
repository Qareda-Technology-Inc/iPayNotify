import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../api.js';

function formatMoney(cents) {
  return `GHS ${((Number(cents) || 0) / 100).toFixed(2)}`;
}

const inputCls = 'mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm';
const toGhs = (cents) => String((Number(cents) || 0) / 100);

/** Limits for paying vendors straight to their MoMo; anything outside them waits on this page. */
function PayoutLimitsCard() {
  const [form, setForm] = useState(null);
  const [saved, setSaved] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  function fill(s) {
    setSaved(s);
    setForm({
      autoEnabled: s.autoEnabled,
      firstNeedsApproval: s.firstNeedsApproval,
      maxAutoGhs: toGhs(s.maxAutoCents),
      dailyAutoGhs: toGhs(s.dailyAutoCents),
      newNumberHoldHours: String(s.newNumberHoldHours),
    });
  }

  useEffect(() => {
    apiFetch('/api/super-admin/payout-settings')
      .then(fill)
      .catch((e) => setErr(e.message || 'Could not load payout limits'));
  }, []);

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setErr('');
    setMsg('');
    try {
      const s = await apiFetch('/api/super-admin/payout-settings', {
        method: 'PATCH',
        body: JSON.stringify({
          autoEnabled: form.autoEnabled,
          firstNeedsApproval: form.firstNeedsApproval,
          maxAutoCents: Math.round(Number(form.maxAutoGhs) * 100),
          dailyAutoCents: Math.round(Number(form.dailyAutoGhs) * 100),
          newNumberHoldHours: Number(form.newNumberHoldHours),
        }),
      });
      fill(s);
      setMsg('Saved');
    } catch (e2) {
      setErr(e2.message || 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  if (!form) {
    return err ? <p className="text-sm text-red-300">{err}</p> : null;
  }
  const set = (k) => (e) => {
    setMsg('');
    setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  };

  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-medium text-white">Automatic payouts</h2>
          <p className="mt-1 text-xs text-slate-400">
            Withdrawals within these limits go straight to the organisation&apos;s payout MoMo number through
            Paystack. Anything else waits here for you. Use 0 for no limit.
          </p>
        </div>
        <span
          className={`rounded-md border px-2 py-0.5 text-xs ${
            saved?.autoEnabled ? 'border-emerald-500/40 text-emerald-200' : 'border-slate-600 text-slate-400'
          }`}
        >
          {saved?.autoEnabled ? 'On' : 'Off'}
        </span>
      </div>
      <form onSubmit={save} className="mt-4 grid gap-4 sm:grid-cols-3">
        <label className="flex items-center gap-2 text-sm text-slate-200 sm:col-span-3">
          <input type="checkbox" checked={form.autoEnabled} onChange={set('autoEnabled')} />
          Pay withdrawals automatically
        </label>
        <label className="block text-sm text-slate-300">
          Largest automatic payout (GHS)
          <input type="number" min="0" step="0.01" required value={form.maxAutoGhs} onChange={set('maxAutoGhs')} className={inputCls} />
        </label>
        <label className="block text-sm text-slate-300">
          Automatic total per organisation per 24 h (GHS)
          <input type="number" min="0" step="0.01" required value={form.dailyAutoGhs} onChange={set('dailyAutoGhs')} className={inputCls} />
        </label>
        <label className="block text-sm text-slate-300">
          Wait after a payout number change (hours)
          <input type="number" min="0" step="1" required value={form.newNumberHoldHours} onChange={set('newNumberHoldHours')} className={inputCls} />
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-300 sm:col-span-3">
          <input type="checkbox" checked={form.firstNeedsApproval} onChange={set('firstNeedsApproval')} />
          Approve each organisation&apos;s first withdrawal myself
        </label>
        <div className="flex flex-wrap items-center gap-3 sm:col-span-3">
          <button
            type="submit"
            disabled={busy}
            className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            {busy ? 'Saving…' : 'Save limits'}
          </button>
          {msg ? <span className="text-xs text-emerald-300">{msg}</span> : null}
          {err ? <span className="text-xs text-red-300">{err}</span> : null}
        </div>
        <p className="text-xs text-slate-500 sm:col-span-3">
          In Paystack: transfers must be enabled for your business, your Paystack balance must cover payouts, and
          &quot;Confirm transfers with OTP&quot; must be off. Add the webhook URL
          {' '}<span className="font-mono">/api/payments/paystack/webhook</span> so results arrive at once.
        </p>
      </form>
    </section>
  );
}

export function SuperAdminWithdrawalsPage() {
  const [status, setStatus] = useState('pending');
  const [rows, setRows] = useState([]);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [info, setInfo] = useState('');

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
    const note = window.prompt('Already paid outside the system? Add the MoMo or bank reference (optional). This only records it; no money is sent.');
    if (note === null) return;
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

  async function send(w) {
    const to = w.payoutMomoNumber || 'their payout number';
    if (!window.confirm(`Send ${formatMoney(w.amountCents)} to ${to} now through Paystack?`)) return;
    setBusyId(w.id);
    setErr('');
    setInfo('');
    try {
      const out = await apiFetch(`/api/super-admin/withdrawals/${w.id}/send`, { method: 'POST' });
      setInfo(
        out.status === 'paid'
          ? `Sent ${formatMoney(w.amountCents)} to ${to}.`
          : out.status === 'processing'
            ? `On its way to ${to}. It moves to Paid when Paystack confirms.`
            : `Not sent: ${out.holdReason || out.failureReason || 'Paystack refused it'}`
      );
      await load();
    } catch (e) {
      setErr(e.message || 'Send failed');
    } finally {
      setBusyId('');
    }
  }

  async function check(id) {
    setBusyId(id);
    setErr('');
    try {
      await apiFetch(`/api/super-admin/withdrawals/${id}/check`, { method: 'POST' });
      await load();
    } catch (e) {
      setErr(e.message || 'Check failed');
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
          Withdrawals outside the automatic limits wait here. Send to MoMo pays the organisation&apos;s payout
          number through Paystack; Mark paid only records money you sent another way.
        </p>
      </div>

      <PayoutLimitsCard />

      {err && (
        <p className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">{err}</p>
      )}
      {info && (
        <p className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">{info}</p>
      )}

      <div className="flex flex-wrap gap-2">
        {['pending', 'processing', 'paid', 'rejected', 'all'].map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStatus(s)}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium capitalize ${
              status === s ? 'bg-amber-600 text-white' : 'bg-slate-800 text-slate-400'
            }`}
          >
            {s === 'pending' ? 'waiting' : s === 'processing' ? 'on its way' : s}
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
                  <p className="mt-0.5 text-xs text-slate-400">
                    {w.status === 'paid' || w.status === 'processing'
                      ? `To ${w.payoutMsisdn || '—'}${w.payoutMethod ? ` · ${w.payoutMethod === 'auto' ? 'automatic' : 'by admin'}` : ''}`
                      : `Payout number: ${w.payoutMomoNumber || 'not set'}`}
                    {w.payoutMomoChangedAt && w.status === 'pending'
                      ? ` (changed ${new Date(w.payoutMomoChangedAt).toLocaleString()})`
                      : ''}
                  </p>
                  {w.status === 'pending' && w.holdReason ? (
                    <p className="mt-1 text-xs text-amber-200">Waiting because: {w.holdReason}</p>
                  ) : null}
                  {w.status === 'processing' && w.failureReason ? (
                    <p className="mt-1 text-xs text-amber-200">{w.failureReason}</p>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-md border border-slate-600 px-2 py-0.5 text-xs capitalize text-slate-300">
                    {w.status === 'pending' ? 'waiting' : w.status === 'processing' ? 'on its way' : w.status}
                  </span>
                  {w.status === 'processing' && (
                    <button
                      type="button"
                      disabled={busyId === w.id}
                      onClick={() => check(w.id)}
                      className="rounded-lg border border-slate-600 px-3 py-1.5 text-xs text-slate-200 disabled:opacity-50"
                    >
                      Check status
                    </button>
                  )}
                  {(w.status === 'pending' || w.status === 'approved') && (
                    <>
                      <button
                        type="button"
                        disabled={busyId === w.id || !w.payoutMomoNumber}
                        onClick={() => send(w)}
                        className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
                      >
                        {busyId === w.id ? 'Sending…' : 'Send to MoMo'}
                      </button>
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
