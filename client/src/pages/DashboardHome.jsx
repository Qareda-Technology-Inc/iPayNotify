import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../api.js';
import { getActingOrganizationId } from '../authStorage.js';

function useShowRemoteAccessStat() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    apiFetch('/api/auth/me')
      .then((m) => {
        const isSuper = m?.admin?.role === 'super_admin';
        setShow(isSuper || Boolean(m?.modules?.remoteAccess));
      })
      .catch(() => setShow(false));
  }, []);
  return show;
}

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
  const [portalSites, setPortalSites] = useState([]);
  const [err, setErr] = useState('');
  const showRemoteAccess = useShowRemoteAccessStat();
  const actingId = getActingOrganizationId();

  useEffect(() => {
    setData(null);
    apiFetch('/api/dashboard/summary')
      .then(setData)
      .catch((e) => setErr(e.message));
    apiFetch('/api/organization')
      .then((o) => setPortalSites(Array.isArray(o?.portalSites) ? o.portalSites : []))
      .catch(() => setPortalSites([]));
  }, [actingId]);

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

  const { counts, revenueCents, organization, platform } = data;
  const hour = new Date().getHours();
  const greet =
    hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const platformScope = Boolean(data.platformScope) || !organization;
  const orgLabel = organization?.name
    ? ` — ${organization.name}`
    : platformScope
      ? ' — All organisations'
      : '';
  const byStatus = platform?.organizationsByStatus || {};

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-balance text-lg font-semibold text-white sm:text-xl">
          {greet}
          <span className="text-slate-400">{orgLabel}</span>
          <span className="text-slate-500"> · QareFi Billing</span>
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          {platformScope
            ? 'Platform overview across every organisation. Pick one in the header to make tenant changes.'
            : "Revenue from paid Hubtel transactions recorded in this organisation's data."}
        </p>
      </div>

      {platformScope && platform ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Organisations"
            value={String(platform.organizations ?? 0)}
            sub={`${byStatus.active || 0} active · ${byStatus.trial || 0} trial · ${byStatus.suspended || 0} suspended`}
          />
          <StatCard
            label="Total org wallets"
            value={formatCedi(platform.totalWalletBalanceCents)}
            sub="Sum of all tenant balances"
          />
          <StatCard
            label="Pending withdrawals"
            value={String(platform.pendingWithdrawals ?? 0)}
            sub="Platform → Vendor withdrawals"
          />
          <StatCard
            label="Pending invites"
            value={String(platform.pendingInvites ?? 0)}
            sub="Team members who have not accepted yet"
          />
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {platformScope ? (
          <StatCard
            label="Pending payments"
            value={String(counts.paymentsPending ?? 0)}
            sub="All tenants · Finance → Payments"
          />
        ) : (
          <StatCard
            label="Wallet available"
            value={formatCedi(data.walletBalanceCents)}
            sub="Finance → Wallet to withdraw"
          />
        )}
        <StatCard label="Today's revenue" value={formatCedi(revenueCents.today)} />
        <StatCard label="Weekly revenue" value={formatCedi(revenueCents.week)} />
        <StatCard label="Monthly revenue" value={formatCedi(revenueCents.month)} />
        <StatCard
          label="Routers"
          value={String(counts.routers)}
          sub={platformScope ? 'Across all organisations' : 'Network → Routers → Test connection'}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <StatCard label="Packages" value={String(counts.packages)} />
        <StatCard label="Vouchers issued" value={String(counts.vouchers)} />
        <StatCard label="PPPoE accounts" value={String(counts.pppoeAccounts)} />
        {showRemoteAccess ? (
          <StatCard
            label="Remote access"
            value={String(counts.remoteAccessSubscriptions ?? 0)}
            sub="Users → Remote access"
          />
        ) : null}
        <StatCard label="Customers (users)" value={String(counts.customers)} />
      </div>

      {platformScope ? (
        <div className="flex flex-wrap gap-3 rounded-xl border border-amber-500/25 bg-amber-950/15 p-5">
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-amber-50">Platform actions</h3>
            <p className="mt-1 text-xs text-amber-100/80">
              Create tenants, invite their admins, or review withdrawal requests.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              to="/super/organizations"
              className="rounded-lg bg-amber-600 px-3 py-2 text-xs font-semibold text-white hover:bg-amber-500"
            >
              Organisations
            </Link>
            <Link
              to="/super/withdrawals"
              className="rounded-lg border border-amber-500/40 px-3 py-2 text-xs font-medium text-amber-50 hover:bg-amber-900/40"
            >
              Withdrawals
            </Link>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-950/20 p-5">
          <h3 className="text-sm font-semibold text-emerald-200">Customer site links</h3>
          {portalSites.length === 0 ? (
            <p className="mt-3 text-sm text-slate-400">
              Set a portal slug on each router under Network → Routers. Full links also appear on
              Organisation.
            </p>
          ) : (
            <ul className="mt-3 space-y-3 text-xs">
              {portalSites.slice(0, 4).map((s) => (
                <li key={s.id}>
                  <p className="font-medium text-emerald-100">{s.name}</p>
                  <p className="mt-0.5 break-all font-mono text-emerald-400/90 select-all">
                    {s.renewUrl}
                  </p>
                  <p className="mt-0.5 break-all font-mono text-emerald-400/90 select-all">
                    {s.hotspotUrl}
                  </p>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-xs text-slate-500">
            Online renew also works with each customer&apos;s renew ID (no site slug required).
          </p>
        </div>
      )}
    </div>
  );
}
