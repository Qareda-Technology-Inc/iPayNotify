import { useCallback, useEffect, useState } from 'react';
import { apiFetch, publicFetch } from '../api.js';
import { HubtelCheckout } from '../portal/HubtelCheckout.jsx';

function money(cents, currency = 'GHS') {
  return `${currency || 'GHS'} ${(Math.max(0, Number(cents) || 0) / 100).toFixed(2)}`;
}

function day(d) {
  return d ? new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
}

const STATUS_STYLE = {
  active: ['Paid up', 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'],
  past_due: ['Overdue', 'border-amber-500/40 bg-amber-500/10 text-amber-200'],
  suspended: ['Suspended', 'border-red-500/40 bg-red-500/10 text-red-200'],
  trial: ['Trial', 'border-sky-500/40 bg-sky-500/10 text-sky-200'],
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * What this organisation owes the platform (org fee + per-router fee each month) and Pay by Hubtel.
 * Stays reachable while the organisation is suspended for an unpaid bill.
 */
export function OrgBillingPage() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [months, setMonths] = useState(1);
  const [msisdn, setMsisdn] = useState('');
  const [canPay, setCanPay] = useState(false);
  const [paying, setPaying] = useState(false);
  const [session, setSession] = useState(null);
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    try {
      const d = await apiFetch('/api/organization/platform-billing');
      setData(d);
      setMonths((m) => (m === 1 ? Math.max(1, d?.quote?.monthsOwed || 1) : m));
    } catch (e) {
      setErr(e.message || 'Could not load billing');
    }
  }, []);

  useEffect(() => {
    load();
    apiFetch('/api/auth/me')
      .then((me) => {
        const role = me?.admin?.role;
        setCanPay(role === 'org_admin' || role === 'super_admin');
        const phone = String(me?.admin?.phone || '');
        /* Stored as 233XXXXXXXXX; show the local 0XX form people type. */
        if (phone) setMsisdn((cur) => cur || (phone.startsWith('233') ? `0${phone.slice(3)}` : phone));
      })
      .catch(() => {});
  }, [load]);

  /* Hubtel confirms in the background; wait for the payment to land, then reload the whole app. */
  async function waitForPayment(ref) {
    setNotice('Confirming your payment with Hubtel…');
    for (let i = 0; i < 40; i += 1) {
      try {
        const s = await publicFetch(`/api/public/payment/${encodeURIComponent(ref)}/status`);
        if (s.status === 'paid') {
          setNotice('Payment received. Thank you!');
          await sleep(800);
          window.location.reload();
          return;
        }
        if (s.status === 'failed') {
          setNotice('');
          setErr('The payment did not go through. You can try again.');
          return;
        }
      } catch {
        /* keep waiting */
      }
      await sleep(i < 10 ? 2000 : 5000);
    }
    setNotice('Still waiting for Hubtel. If you approved the payment, this page will update shortly.');
    load();
  }

  async function onPay(e) {
    e.preventDefault();
    setErr('');
    setNotice('');
    setPaying(true);
    try {
      const out = await apiFetch('/api/organization/platform-billing/checkout', {
        method: 'POST',
        body: JSON.stringify({ months: Number(months), customerMsisdn: msisdn }),
      });
      if (out.mode === 'hubtel_checkout') setSession(out);
      else if (out.checkoutUrl) window.location.href = out.checkoutUrl;
    } catch (e2) {
      setErr(e2.message || 'Could not start payment');
    } finally {
      setPaying(false);
    }
  }

  if (!data && !err) return <p className="text-sm text-slate-400">Loading billing…</p>;
  if (!data) return <p className="text-sm text-red-300">{err}</p>;
  if (!data.enabled) {
    return (
      <div className="mx-auto max-w-2xl space-y-2">
        <h1 className="text-2xl font-semibold text-white">Subscription</h1>
        <p className="text-sm text-slate-400">
          There is no monthly subscription set up for this organisation yet. Once the platform sets your price and
          due date, your bill and the Pay button appear here.
        </p>
      </div>
    );
  }

  const q = data.quote || {};
  const [label, style] = STATUS_STYLE[data.status] || STATUS_STYLE.active;
  const total = (q.monthlyCents || 0) * Number(months || 1);
  const monthOptions = Array.from({ length: data.maxMonths || 12 }, (_, i) => i + 1);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <HubtelCheckout
        open={Boolean(session)}
        purchaseInfo={session?.purchaseInfo}
        hubtelConfig={session?.hubtelConfig}
        onSuccess={() => {
          const ref = session?.clientReference;
          setSession(null);
          if (ref) waitForPayment(ref);
        }}
        onFailure={() => {
          setSession(null);
          setErr('The payment did not go through. You can try again.');
        }}
        onClose={() => {
          const ref = session?.clientReference;
          setSession(null);
          /* MoMo may already be approved on the phone. */
          if (ref) waitForPayment(ref);
        }}
      />

      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">Subscription</h1>
        <p className="mt-1 text-sm text-slate-400">Your monthly platform charge: organisation fee plus a fee per router.</p>
      </div>

      {data.locked ? (
        <div className="rounded-2xl border border-red-500/40 bg-red-950/30 p-4 text-sm text-red-100">
          <p className="font-semibold">Your account is suspended for an unpaid bill.</p>
          <p className="mt-1 text-red-100/80">
            The dashboard and your remote access (VPN) are off until it is paid. Customers can still buy Wi-Fi and renew.
          </p>
        </div>
      ) : data.status === 'past_due' ? (
        <div className="rounded-2xl border border-amber-500/40 bg-amber-950/25 p-4 text-sm text-amber-100">
          <p className="font-semibold">Your bill is overdue.</p>
          <p className="mt-1 text-amber-100/80">Pay by {day(data.suspendAt)} to avoid suspension.</p>
        </div>
      ) : null}

      <section className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-700 bg-slate-900/60 px-4 py-3">
          <p className="text-xs uppercase tracking-wide text-slate-500">Status</p>
          <span className={`mt-1.5 inline-block rounded-full border px-2.5 py-0.5 text-xs font-semibold ${style}`}>{label}</span>
        </div>
        <div className="rounded-xl border border-slate-700 bg-slate-900/60 px-4 py-3">
          <p className="text-xs uppercase tracking-wide text-slate-500">Paid until</p>
          <p className="mt-1 text-lg font-semibold text-white">{day(data.paidUntil)}</p>
        </div>
        <div className="rounded-xl border border-slate-700 bg-slate-900/60 px-4 py-3">
          <p className="text-xs uppercase tracking-wide text-slate-500">Due now</p>
          <p className={`mt-1 text-lg font-semibold ${q.amountDueCents ? 'text-amber-200' : 'text-emerald-300'}`}>
            {money(q.amountDueCents, q.currency)}
          </p>
          {q.monthsOwed > 1 ? <p className="text-xs text-slate-500">{q.monthsOwed} months</p> : null}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4 text-sm">
        <h2 className="mb-2 font-semibold text-white">Each month</h2>
        <dl className="space-y-1.5 text-slate-300">
          <div className="flex justify-between">
            <dt>Organisation</dt>
            <dd>{money(q.orgFeeCents, q.currency)}</dd>
          </div>
          <div className="flex justify-between">
            <dt>
              Routers ({q.routers} × {money(q.routerFeeCents, q.currency)})
            </dt>
            <dd>{money((q.routerFeeCents || 0) * (q.routers || 0), q.currency)}</dd>
          </div>
          <div className="flex justify-between border-t border-slate-800 pt-1.5 font-semibold text-white">
            <dt>Total per month</dt>
            <dd>{money(q.monthlyCents, q.currency)}</dd>
          </div>
        </dl>
      </section>

      {canPay ? (
        <form onSubmit={onPay} className="space-y-3 rounded-2xl border border-emerald-700/40 bg-emerald-950/15 p-4">
          <h2 className="text-sm font-semibold text-white">Pay with mobile money</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs text-slate-400">
              Months
              <select
                value={months}
                onChange={(e) => setMonths(Number(e.target.value))}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
              >
                {monthOptions.map((m) => (
                  <option key={m} value={m}>
                    {m} month{m === 1 ? '' : 's'}
                    {m === q.monthsOwed && q.monthsOwed > 0 ? ' (clears what is due)' : ''}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs text-slate-400">
              Mobile money number
              <input
                type="tel"
                inputMode="tel"
                value={msisdn}
                onChange={(e) => setMsisdn(e.target.value)}
                placeholder="024 123 4567"
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-white"
              />
            </label>
          </div>
          {Number(months) < (q.monthsOwed || 0) ? (
            <p className="text-xs text-amber-200">
              {q.monthsOwed} months are due; paying {months} still leaves the account overdue.
            </p>
          ) : null}
          <button
            type="submit"
            disabled={paying || !q.monthlyCents}
            className="w-full rounded-lg bg-emerald-600 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            {paying ? 'Starting payment…' : `Pay ${money(total, q.currency)}`}
          </button>
        </form>
      ) : (
        <p className="text-xs text-slate-500">Only organisation admins can pay the bill.</p>
      )}

      {notice ? <p className="text-sm text-emerald-200">{notice}</p> : null}
      {err ? <p className="text-sm text-red-300">{err}</p> : null}

      {data.payments?.length ? (
        <section className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4">
          <h2 className="mb-2 text-sm font-semibold text-white">Payments</h2>
          <ul className="divide-y divide-slate-800 text-sm">
            {data.payments.map((p) => (
              <li key={p.clientReference} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="text-slate-300">
                  {day(p.createdAt)} · {p.months} month{p.months === 1 ? '' : 's'}
                  {p.paidUntil ? <span className="text-slate-500"> · to {day(p.paidUntil)}</span> : null}
                </span>
                <span className="flex items-center gap-2">
                  <span className="font-medium text-white">{money(p.amountCents, p.currency)}</span>
                  <span className={`rounded-full border px-2 py-0.5 text-[11px] ${(STATUS_STYLE[p.status === 'paid' ? 'active' : p.status === 'pending' ? 'past_due' : 'suspended'] || [])[1]}`}>
                    {p.status}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
