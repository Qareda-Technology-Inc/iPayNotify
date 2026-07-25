import { useEffect, useState } from 'react';
import { apiFetch } from '../api.js';

function formatCedi(cents) {
  const n = Number(cents) || 0;
  return new Intl.NumberFormat('en-GH', {
    style: 'currency',
    currency: 'GHS',
    minimumFractionDigits: 2,
  }).format(n / 100);
}

function StatCard({ label, value, sub }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-white">{value}</p>
      {sub && <p className="mt-1 text-xs text-slate-500">{sub}</p>}
    </div>
  );
}

export function DashboardHome() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    apiFetch('/api/dashboard/summary')
      .then(setData)
      .catch((e) => setErr(e.message));
  }, []);

  if (err) {
    return (
      <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
        {err}
      </p>
    );
  }

  if (!data) {
    return <p className="text-slate-500">Loading dashboard…</p>;
  }

  const { counts, revenueCents, organization } = data;
  const hour = new Date().getHours();
  const greet =
    hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const orgLabel = organization?.name ? ` — ${organization.name}` : '';

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-balance text-lg font-semibold text-white sm:text-xl">
          {greet}
          <span className="text-slate-400">{orgLabel}</span>
          <span className="text-slate-500"> · QareFi Billing</span>
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          Revenue from paid Hubtel transactions recorded in this organisation&apos;s data.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard
          label="Wallet available"
          value={formatCedi(data.walletBalanceCents)}
          sub="Finance → Wallet to withdraw"
        />
        <StatCard label="Today's revenue" value={formatCedi(revenueCents.today)} />
        <StatCard label="Weekly revenue" value={formatCedi(revenueCents.week)} />
        <StatCard label="Monthly revenue" value={formatCedi(revenueCents.month)} />
        <StatCard
          label="Routers online (saved)"
          value={String(counts.routers)}
          sub="Use Devices → MikroTik → Test connection"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <StatCard label="Packages" value={String(counts.packages)} />
        <StatCard label="Vouchers issued" value={String(counts.vouchers)} />
        <StatCard label="PPPoE accounts" value={String(counts.pppoeAccounts)} />
        <StatCard
          label="Remote access"
          value={String(counts.remoteAccessSubscriptions ?? 0)}
          sub="Users → Remote access"
        />
        <StatCard label="Customers (users)" value={String(counts.customers)} />
      </div>

      <div className="rounded-xl border border-emerald-500/20 bg-emerald-950/20 p-5">
        <h3 className="text-sm font-semibold text-emerald-200">Customer payment links</h3>
        <ul className="mt-3 space-y-2 font-mono text-xs text-emerald-400/90">
          <li>
            PPPoE renew:{' '}
            <span className="select-all">
              {typeof window !== 'undefined' ? window.location.origin : ''}/portal/renew
            </span>
          </li>
          <li>
            Hotspot:{' '}
            <span className="select-all">
              {typeof window !== 'undefined' ? window.location.origin : ''}/portal/hotspot
            </span>
          </li>
        </ul>
        <p className="mt-2 text-xs text-slate-500">
          Add <span className="font-mono">?r=slug</span> per router; set <span className="font-mono">PUBLIC_APP_URL</span> for walled garden + portal.
        </p>
      </div>
    </div>
  );
}
