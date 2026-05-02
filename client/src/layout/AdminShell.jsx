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
    '/tickets/sales': 'Ticket operations',
    '/tickets/sites': 'Ticket sites',
    '/tickets/types': 'Ticket types',
    '/tickets/issue': 'Issue tickets',
    '/tickets/collections': 'Cash collections',
    '/tickets/reports': 'Ticket reports',
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

function MenuIcon({ open }) {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      {open ? (
        <path d="M6 6L18 18M18 6L6 18" strokeLinecap="round" />
      ) : (
        <>
          <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />
        </>
      )}
    </svg>
  );
}

export function AdminShell({ onSignOut }) {
  const location = useLocation();
  const [me, setMe] = useState(null);
  const [counts, setCounts] = useState(null);
  const [sessionTick, setSessionTick] = useState(0);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const adminEmail = me?.admin?.email || '';
  const adminDisplayName = String(me?.admin?.fullName || '').trim() || adminEmail;
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

  useEffect(() => {
    setMobileNavOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!mobileNavOpen) return;
    const onKey = (e) => {
      if (e.key === 'Escape') setMobileNavOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mobileNavOpen]);

  function clearActingOrganization() {
    setActingOrganizationId(null);
    setSessionTick((n) => n + 1);
  }

  const actingId = getActingOrganizationId();
  const actingName = getActingOrganizationName();
  const headerTitle = headerTitleForPath(location.pathname);

  return (
    <div className="flex min-h-screen min-h-[100dvh] bg-slate-950 text-slate-200">
      <button
        type="button"
        aria-label="Close navigation menu"
        className={`fixed inset-0 z-30 bg-slate-950/60 backdrop-blur-sm transition-opacity lg:hidden ${
          mobileNavOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
        onClick={() => setMobileNavOpen(false)}
      />

      <aside
        id="admin-sidebar"
        className={`fixed inset-y-0 left-0 z-40 flex w-60 max-w-[85vw] shrink-0 flex-col border-r border-slate-800/80 bg-slate-900/95 shadow-2xl shadow-black/40 transition-transform duration-200 ease-out lg:static lg:z-0 lg:max-w-none lg:translate-x-0 lg:shadow-none ${
          mobileNavOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
      >
        <div className="border-b border-slate-800 px-4 py-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-indigo-400">QareFi</p>
          <h1 className="mt-1 text-lg font-semibold text-white">Billing</h1>
          <p className="mt-1 truncate text-xs text-slate-500" title={adminEmail ? `${adminDisplayName} · ${adminEmail}` : adminDisplayName}>
            {adminDisplayName}
            {adminEmail && adminDisplayName !== adminEmail ? (
              <span className="mt-0.5 block truncate font-mono text-[10px] text-slate-600">{adminEmail}</span>
            ) : null}
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
          {adminRole === 'ticket_manager' && (
            <p className="mt-1 text-[10px] font-medium uppercase tracking-wide text-emerald-400/90">
              Ticket manager
            </p>
          )}
          {adminRole === 'org_staff' && (
            <p className="mt-1 text-[10px] font-medium uppercase tracking-wide text-cyan-400/90">
              Organisation staff
            </p>
          )}
        </div>
        <nav className="flex-1 overflow-y-auto px-2 py-4">
          {adminRole !== 'ticket_manager' && (
            <>
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
            </>
          )}
          <NavGroup title="Ticket operations">
            <SideLink to="/tickets/issue" accent="amber">
              Issue tickets
            </SideLink>
            <SideLink to="/tickets/collections" accent="amber">
              Collections
            </SideLink>
            <SideLink to="/tickets/reports" accent="amber">
              Reports
            </SideLink>
            <SideLink to="/tickets/types" accent="amber">
              Ticket types
            </SideLink>
            <SideLink to="/tickets/sites" accent="amber">
              Ticket sites
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
        <header className="sticky top-0 z-20 flex min-h-14 flex-wrap items-center gap-2 border-b border-slate-800 bg-slate-900/90 px-3 py-2 backdrop-blur-sm sm:gap-3 sm:px-4 sm:py-3 lg:px-6">
          <button
            type="button"
            className="inline-flex shrink-0 items-center justify-center rounded-lg border border-slate-700 p-2 text-slate-200 hover:bg-slate-800 lg:hidden"
            aria-expanded={mobileNavOpen}
            aria-controls="admin-sidebar"
            onClick={() => setMobileNavOpen((o) => !o)}
          >
            <MenuIcon open={mobileNavOpen} />
          </button>
          <h2 className="min-w-0 flex-1 text-sm font-semibold text-white sm:text-base">{headerTitle}</h2>
          <div className="flex basis-full min-w-0 flex-wrap items-center justify-end gap-2 sm:basis-auto sm:w-auto sm:flex-initial">
            {adminRole === 'super_admin' && actingId && (
              <div className="flex w-full max-w-full items-center gap-2 rounded-lg border border-emerald-700/35 bg-emerald-950/25 px-3 py-1.5 text-xs text-emerald-100 sm:w-auto">
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
        <main className="flex-1 overflow-x-hidden overflow-y-auto p-4 sm:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
