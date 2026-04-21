import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { apiFetch } from '../api.js';
import {
  getActingOrganizationId,
  getActingOrganizationName,
  setActingOrganizationId,
} from '../authStorage.js';

function NavGroup({ title, children }) {
  return (
    <div className="mb-6">
      <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        {title}
      </p>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

function SideLink({ to, children, badge, accent = 'indigo' }) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      className={({ isActive }) =>
        `flex items-center justify-between rounded-lg px-3 py-2 text-sm transition ${
          isActive
            ? accent === 'amber'
              ? 'bg-orange-500/20 text-orange-50 ring-1 ring-orange-500/35'
              : 'bg-indigo-600/25 text-white'
            : 'text-slate-400 hover:bg-slate-800/80 hover:text-slate-200'
        }`
      }
    >
      <span>{children}</span>
      {badge != null && (
        <span className="rounded-md bg-slate-800 px-1.5 py-0.5 text-[10px] font-medium text-slate-300">
          {badge}
        </span>
      )}
    </NavLink>
  );
}

function headerTitleForPath(pathname) {
  const p = pathname.replace(/\/$/, '') || '/';
  if (p === '/') return 'Dashboard';
  const exact = {
    '/users/customers': 'Customers',
    '/users/active': 'Active users',
    '/finance/pppoe': 'PPPoE',
    '/users/remote-access': 'Remote access',
    '/finance/packages': 'Packages',
    '/hotspot': 'Hotspot vouchers',
    '/finance/payments': 'Payments',
    '/finance/messages': 'Messages & SMS',
    '/devices/mikrotik': 'MikroTik routers',
    '/org/settings': 'Organisation',
    '/super/organizations': 'All organisations',
    '/super/email-templates': 'Email & templates',
  };
  if (exact[p]) return exact[p];
  if (p.startsWith('/super/organizations/') && p.includes('/admins')) return 'Organisation admins';
  return 'Admin';
}

export function AdminShell({ onSignOut }) {
  const location = useLocation();
  const [me, setMe] = useState(null);
  const [counts, setCounts] = useState(null);
  const [sessionTick, setSessionTick] = useState(0);

  const adminEmail = me?.admin?.email || '';
  const adminRole = me?.admin?.role || 'super_admin';
  const organizationName = me?.organizationName || null;

  useEffect(() => {
    apiFetch('/api/auth/me')
      .then((d) => setMe(d))
      .catch(() => setMe(null));
  }, [sessionTick]);

  useEffect(() => {
    apiFetch('/api/dashboard/summary')
      .then((d) => setCounts(d.counts))
      .catch(() => {});
  }, []);

  function clearActingOrganization() {
    setActingOrganizationId(null);
    setSessionTick((n) => n + 1);
  }

  const actingId = getActingOrganizationId();
  const actingName = getActingOrganizationName();
  const headerTitle = headerTitleForPath(location.pathname);

  return (
    <div className="flex min-h-screen bg-slate-950 text-slate-200">
      <aside className="flex w-60 shrink-0 flex-col border-r border-slate-800/80 bg-slate-900/95">
        <div className="border-b border-slate-800 px-4 py-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-indigo-400">QareFi</p>
          <h1 className="mt-1 text-lg font-semibold text-white">Billing</h1>
          <p className="mt-1 truncate text-xs text-slate-500" title={adminEmail}>
            {adminEmail}
          </p>
          {organizationName && (
            <p className="mt-1 truncate text-xs text-slate-400" title={organizationName}>
              {organizationName}
            </p>
          )}
          {adminRole === 'super_admin' && (
            <p className="mt-1 text-[10px] font-medium uppercase tracking-wide text-amber-400/90">
              Super administrator
            </p>
          )}
          {adminRole === 'org_admin' && (
            <p className="mt-1 text-[10px] font-medium uppercase tracking-wide text-slate-500">
              Organisation administrator
            </p>
          )}
        </div>
        <nav className="flex-1 overflow-y-auto px-2 py-4">
          <NavGroup title="Tenant">
            <SideLink to="/">Dashboard</SideLink>
            <SideLink to="/org/settings">Organisation &amp; MoMo</SideLink>
          </NavGroup>
          <NavGroup title="Customers &amp; access">
            <SideLink to="/users/customers" badge={counts?.customers}>
              Customers
            </SideLink>
            <SideLink to="/users/active">Active users</SideLink>
            <SideLink to="/finance/pppoe" badge={counts?.pppoeAccounts} accent="amber">
              PPPoE
            </SideLink>
            <SideLink to="/users/remote-access" badge={counts?.remoteAccessSubscriptions}>
              Remote access
            </SideLink>
          </NavGroup>
          <NavGroup title="Billing">
            <SideLink to="/finance/packages" badge={counts?.packages}>
              Packages
            </SideLink>
            <SideLink to="/hotspot" badge={counts?.vouchers}>
              Vouchers
            </SideLink>
            <SideLink to="/finance/payments" badge={counts?.paymentsPending}>
              Payments
            </SideLink>
            <SideLink to="/finance/messages">Messages / SMS</SideLink>
          </NavGroup>
          <NavGroup title="Network">
            <SideLink to="/devices/mikrotik" badge={counts?.routers}>
              MikroTik
            </SideLink>
          </NavGroup>
          {adminRole === 'super_admin' && (
            <NavGroup title="Platform (super admin)">
              <SideLink to="/super/organizations" accent="amber">
                All organisations
              </SideLink>
              <SideLink to="/super/email-templates" accent="amber">
                Email &amp; templates
              </SideLink>
            </NavGroup>
          )}
        </nav>
        <div className="border-t border-slate-800 p-3">
          <button
            type="button"
            onClick={onSignOut}
            className="w-full rounded-lg border border-slate-700 py-2 text-sm text-slate-300 hover:bg-slate-800"
          >
            Sign out
          </button>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex min-h-14 flex-wrap items-center justify-between gap-3 border-b border-slate-800 bg-slate-900/50 px-6 py-3">
          <h2 className="text-sm font-semibold text-white sm:text-base">{headerTitle}</h2>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {adminRole === 'super_admin' && actingId && (
              <div className="flex max-w-full items-center gap-2 rounded-lg border border-emerald-700/35 bg-emerald-950/25 px-3 py-1.5 text-xs text-emerald-100">
                <span className="truncate">
                  Acting as{' '}
                  <strong className="text-emerald-50">
                    {actingName || `Organisation ${actingId.slice(-8)}`}
                  </strong>
                </span>
                <button
                  type="button"
                  onClick={clearActingOrganization}
                  className="shrink-0 rounded-md border border-emerald-600/50 px-2 py-0.5 text-[11px] font-medium text-emerald-200 hover:bg-emerald-900/40"
                >
                  Clear
                </button>
              </div>
            )}
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
