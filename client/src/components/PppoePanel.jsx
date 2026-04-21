import { useEffect, useState, useMemo } from 'react';
import { apiFetch } from '../api.js';
import { routerDisplayName } from '../utils/routerDisplayName.js';
import {
  formatRemainingFromPaidUntil,
  remainingMsUntil,
} from '../utils/remainingTime.js';

/** @typedef {'all'|'active'|'expired'|'suspended'|'pending'|'expiring'} PppoeFilter */

function IconRefresh({ className }) {
  return (
    <svg className={className} width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 12a8 8 0 0113.657-5.657M20 12a8 8 0 01-13.657 5.657M4 12H1m19 0h-3M4 12l2-2m14 2l-2-2"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconUserPlus({ className }) {
  return (
    <svg className={className} width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2M12 11a4 4 0 100-8 4 4 0 000 8zm8-1v6m-3-3h6"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconSearch({ className }) {
  return (
    <svg className={className} width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.75" />
      <path d="M20 20l-3-3" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  );
}

function IconEmpty({ className }) {
  return (
    <svg className={className} width="64" height="64" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.25" opacity="0.35" />
      <path d="M9 9l6 6M15 9l-6 6" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
    </svg>
  );
}

function IconChevron({ open, className }) {
  return (
    <svg
      className={`${className} transition-transform ${open ? 'rotate-180' : ''}`}
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
    >
      <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function isExpiredAccount(a) {
  if (!a.paidUntil) return false;
  return new Date(a.paidUntil) < new Date();
}

function isActiveSubscription(a) {
  if (!a.paidUntil) return false;
  return new Date(a.paidUntil) >= new Date();
}

function toDatetimeLocalValue(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function matchesFilter(a, filter) {
  switch (filter) {
    case 'all':
      return true;
    case 'active':
      return isActiveSubscription(a) && !a.disabled;
    case 'expired':
      return isExpiredAccount(a);
    case 'suspended':
      return !!a.disabled;
    case 'pending':
      return !a.userId;
    case 'expiring': {
      const ms = remainingMsUntil(a.paidUntil);
      const week = 7 * 24 * 60 * 60 * 1000;
      return ms != null && ms > 0 && ms <= week;
    }
    default:
      return true;
  }
}

export function PppoePanel() {
  const [routers, setRouters] = useState([]);
  const [packages, setPackages] = useState([]);
  const [users, setUsers] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [mikrotikError, setMikrotikError] = useState('');
  const [mikrotikProfiles, setMikrotikProfiles] = useState([]);
  const [mikrotikSecrets, setMikrotikSecrets] = useState([]);
  const [loadingRouter, setLoadingRouter] = useState(false);
  const [pingMessage, setPingMessage] = useState('');
  const [enforceExpiryBusy, setEnforceExpiryBusy] = useState(false);
  const [expirySyncSummary, setExpirySyncSummary] = useState('');
  /** @type {[PppoeFilter, import('react').Dispatch<import('react').SetStateAction<PppoeFilter>>]} */
  const [statusFilter, setStatusFilter] = useState(/** @type {PppoeFilter} */ ('all'));
  const [tableSearch, setTableSearch] = useState('');
  const [showNewModal, setShowNewModal] = useState(false);
  const [showRouterTools, setShowRouterTools] = useState(false);
  const [editAccount, setEditAccount] = useState(null);
  const [editProfiles, setEditProfiles] = useState([]);
  const [editProfilesLoading, setEditProfilesLoading] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [renewAccount, setRenewAccount] = useState(null);
  const [renewPackageId, setRenewPackageId] = useState('');
  const [renewChargeBalance, setRenewChargeBalance] = useState(false);
  const [renewBusy, setRenewBusy] = useState(false);
  const [editPaidUntil, setEditPaidUntil] = useState('');
  const [editDisabled, setEditDisabled] = useState(false);
  const [editPackageId, setEditPackageId] = useState('');
  const [editUserId, setEditUserId] = useState('');
  const [editActiveProf, setEditActiveProf] = useState('');
  const [editExpiredProf, setEditExpiredProf] = useState('');
  const [editSecretPassword, setEditSecretPassword] = useState('');

  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserName, setNewUserName] = useState('');
  const [newUserPhone, setNewUserPhone] = useState('');
  const [linkCustomer, setLinkCustomer] = useState(false);
  const [userId, setUserId] = useState('');
  const [packageId, setPackageId] = useState('');
  const [routerId, setRouterId] = useState('');
  const [secretName, setSecretName] = useState('');
  const [secretPassword, setSecretPassword] = useState('');
  const [activeProfilePick, setActiveProfilePick] = useState('');
  const [expiredProfilePick, setExpiredProfilePick] = useState('');
  /** @type {'package' | 'duration' | 'until'} */
  const [validityMode, setValidityMode] = useState('package');
  const [validityAmount, setValidityAmount] = useState(30);
  const [validityUnit, setValidityUnit] = useState('day');
  const [paidUntilInput, setPaidUntilInput] = useState('');

  const counts = useMemo(() => {
    return {
      all: accounts.length,
      active: accounts.filter((a) => matchesFilter(a, 'active')).length,
      expired: accounts.filter((a) => matchesFilter(a, 'expired')).length,
      suspended: accounts.filter((a) => matchesFilter(a, 'suspended')).length,
      pending: accounts.filter((a) => matchesFilter(a, 'pending')).length,
      expiring: accounts.filter((a) => matchesFilter(a, 'expiring')).length,
    };
  }, [accounts]);

  const filteredAccounts = useMemo(() => {
    const q = tableSearch.trim().toLowerCase();
    return accounts.filter((a) => {
      if (!matchesFilter(a, statusFilter)) return false;
      if (!q) return true;
      const secret = (a.secretName || '').toLowerCase();
      const email = (a.userId?.email || '').toLowerCase();
      const name = (a.userId?.fullName || '').toLowerCase();
      const phone = (a.userId?.phone || '').toLowerCase();
      return secret.includes(q) || email.includes(q) || name.includes(q) || phone.includes(q);
    });
  }, [accounts, statusFilter, tableSearch]);

  async function loadAll() {
    const [r, allPkgs, u, a] = await Promise.all([
      apiFetch('/api/routers'),
      apiFetch('/api/packages?all=1'),
      apiFetch('/api/users?limit=500'),
      apiFetch('/api/pppoe'),
    ]);
    const p = (Array.isArray(allPkgs) ? allPkgs : []).filter((x) => x.kind === 'pppoe');
    setRouters(Array.isArray(r) ? r : []);
    setPackages(p);
    setUsers(Array.isArray(u) ? u : []);
    setAccounts(Array.isArray(a) ? a : []);
    setRouterId((id) => id || (r[0]?._id ?? ''));
    setPackageId((pid) => {
      const sid = pid ? String(pid) : '';
      if (sid && p.some((x) => String(x._id) === sid)) return sid;
      return p[0]?._id ? String(p[0]._id) : '';
    });
    if (u[0]) setUserId((uid) => uid || u[0]._id);
  }

  async function loadRouterLiveData(rid) {
    if (!rid) return;
    setMikrotikError('');
    setPingMessage('');
    setLoadingRouter(true);
    try {
      const [profiles, secrets] = await Promise.all([
        apiFetch(`/api/routers/${rid}/mikrotik/ppp-profiles`),
        apiFetch(`/api/routers/${rid}/mikrotik/ppp-secrets`),
      ]);
      setMikrotikProfiles(Array.isArray(profiles) ? profiles : []);
      setMikrotikSecrets(Array.isArray(secrets) ? secrets : []);
    } catch (e) {
      setMikrotikProfiles([]);
      setMikrotikSecrets([]);
      setMikrotikError(e.message || 'Could not read router');
    } finally {
      setLoadingRouter(false);
    }
  }

  async function refreshStatus() {
    setRefreshing(true);
    setError('');
    setExpirySyncSummary('');
    try {
      await loadAll();
      if (routerId) await loadRouterLiveData(routerId);
    } catch (e) {
      setError(e.message || 'Refresh failed');
    } finally {
      setRefreshing(false);
    }
  }

  async function runEnforceExpirySync() {
    setEnforceExpiryBusy(true);
    setExpirySyncSummary('');
    setError('');
    try {
      const s = await apiFetch('/api/pppoe/enforce-expiry', { method: 'POST', body: '{}' });
      const checked = Number(s.checked) || 0;
      const synced = Number(s.synced) || 0;
      const failed = Number(s.syncFailed) || 0;
      setExpirySyncSummary(
        `Expired lines on routers: ${synced}/${checked} synced${failed ? `, ${failed} failed` : ''}.`
      );
      await loadAll();
    } catch (e) {
      setError(e.message || 'Expiry sync failed');
    } finally {
      setEnforceExpiryBusy(false);
    }
  }

  useEffect(() => {
    loadAll().catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (routerId) loadRouterLiveData(routerId);
  }, [routerId]);

  useEffect(() => {
    if (!showNewModal) return;
    const onKey = (e) => {
      if (e.key === 'Escape' && !loading) setShowNewModal(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showNewModal, loading]);

  async function createUser(e) {
    e.preventDefault();
    setError('');
    try {
      const doc = await apiFetch('/api/users', {
        method: 'POST',
        body: JSON.stringify({
          email: newUserEmail || undefined,
          fullName: newUserName || undefined,
          phone: newUserPhone.trim() || undefined,
        }),
      });
      setNewUserEmail('');
      setNewUserName('');
      setNewUserPhone('');
      setLinkCustomer(true);
      await loadAll();
      setUserId(doc._id);
    } catch (err) {
      setError(err.message);
    }
  }

  async function openEditAccount(a) {
    setError('');
    setEditAccount(a);
    setEditPaidUntil(toDatetimeLocalValue(a.paidUntil));
    setEditDisabled(!!a.disabled);
    setEditPackageId(
      a.packageId?._id ? String(a.packageId._id) : a.packageId ? String(a.packageId) : ''
    );
    setEditUserId(a.userId?._id ? String(a.userId._id) : a.userId ? String(a.userId) : '');
    setEditActiveProf(a.activeProfile || '');
    setEditExpiredProf(a.expiredProfile || '');
    setEditSecretPassword('');
    setEditProfiles([]);
    const rid = String(a.routerId?._id || a.routerId || '');
    if (!rid) return;
    setEditProfilesLoading(true);
    try {
      const profiles = await apiFetch(`/api/routers/${rid}/mikrotik/ppp-profiles`);
      setEditProfiles(Array.isArray(profiles) ? profiles : []);
    } catch {
      setEditProfiles([]);
    } finally {
      setEditProfilesLoading(false);
    }
  }

  async function saveEditAccount(e) {
    e.preventDefault();
    if (!editAccount?._id) return;
    setError('');
    setEditSaving(true);
    try {
      const body = {
        paidUntil: new Date(editPaidUntil).toISOString(),
        disabled: editDisabled,
        packageId: editPackageId || null,
        userId: editUserId || null,
        activeProfile: editActiveProf || undefined,
        expiredProfile: editExpiredProf || undefined,
        syncRouter: true,
      };
      if (editSecretPassword.trim()) {
        body.secretPassword = editSecretPassword.trim();
      }
      await apiFetch(`/api/pppoe/${editAccount._id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      setEditAccount(null);
      await loadAll();
      if (routerId) await loadRouterLiveData(routerId);
    } catch (err) {
      setError(err.message || 'Update failed');
    } finally {
      setEditSaving(false);
    }
  }

  function openRenewAccount(a) {
    setError('');
    setRenewAccount(a);
    setRenewPackageId(
      a.packageId?._id ? String(a.packageId._id) : a.packageId ? String(a.packageId) : ''
    );
    setRenewChargeBalance(false);
  }

  async function submitRenew(e) {
    e.preventDefault();
    if (!renewAccount?._id) return;
    setRenewBusy(true);
    setError('');
    try {
      const body = {
        chargeBalance: renewChargeBalance,
        ...(renewPackageId ? { packageId: renewPackageId } : {}),
      };
      await apiFetch(`/api/pppoe/${renewAccount._id}/renew`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      setRenewAccount(null);
      window.location.reload();
    } catch (err) {
      setError(err.message || 'Renew failed');
    } finally {
      setRenewBusy(false);
    }
  }

  async function syncOneAccount(a) {
    setError('');
    try {
      await apiFetch(`/api/pppoe/${a._id}/sync`, { method: 'POST', body: '{}' });
      await loadAll();
      if (routerId) await loadRouterLiveData(routerId);
    } catch (err) {
      setError(err.message || 'Sync failed');
    }
  }

  async function deletePppoeAccount(a) {
    const ok = window.confirm(
      `Remove PPPoE secret "${a.secretName}" from billing and delete it on the router? This cannot be undone.`
    );
    if (!ok) return;
    setError('');
    try {
      await apiFetch(`/api/pppoe/${a._id}`, { method: 'DELETE' });
      if (editAccount?._id === a._id) setEditAccount(null);
      await loadAll();
      if (routerId) await loadRouterLiveData(routerId);
    } catch (err) {
      setError(err.message || 'Delete failed');
    }
  }

  async function createPppoe(e) {
    e.preventDefault();
    setError('');
    if (linkCustomer && !userId) {
      setError('Add a billing customer first, or turn off “Link to customer”.');
      return;
    }
    setLoading(true);
    try {
      const payload = {
        ...(linkCustomer && userId ? { userId } : {}),
        packageId: packageId || undefined,
        routerId: routerId || undefined,
        secretName: secretName.trim(),
        secretPassword: secretPassword || undefined,
        activeProfile: activeProfilePick || undefined,
        expiredProfile: expiredProfilePick || undefined,
        syncRouter: true,
      };
      if (validityMode === 'until') {
        if (!paidUntilInput) {
          setError('Choose a paid-until date and time.');
          setLoading(false);
          return;
        }
        payload.paidUntil = new Date(paidUntilInput).toISOString();
      } else if (validityMode === 'duration') {
        const n = Number(validityAmount);
        if (!Number.isFinite(n) || n <= 0) {
          setError('Validity length must be a positive number.');
          setLoading(false);
          return;
        }
        payload.validityAmount = n;
        payload.validityUnit = validityUnit;
      }

      await apiFetch('/api/pppoe', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      setSecretName('');
      setSecretPassword('');
      setShowNewModal(false);
      await loadAll();
      await loadRouterLiveData(routerId);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  const filterChips = [
    { id: /** @type {PppoeFilter} */ ('all'), label: 'All', count: counts.all },
    { id: 'active', label: 'Active', count: counts.active, dot: 'bg-emerald-500' },
    { id: 'expiring', label: 'Expiring ≤7d', count: counts.expiring, dot: 'bg-amber-500' },
    { id: 'expired', label: 'Expired', count: counts.expired, dot: 'bg-red-500' },
    { id: 'suspended', label: 'Suspended', count: counts.suspended },
    { id: 'pending', label: 'Unlinked', count: counts.pending },
  ];

  return (
    <div className="mx-auto max-w-6xl">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">PPPoE Users</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-400">
            Billing-backed PPP secrets synced to MikroTik. Link customers with a{' '}
            <strong className="text-slate-300">phone number</strong> for SMS. Past{' '}
            <strong className="text-slate-300">paid until</strong> moves the line to your{' '}
            <strong className="text-slate-300">expired profile</strong> (e.g. nonpayment). A scheduled job syncs that
            to MikroTik; use <strong className="text-slate-300">Sync expired to routers</strong> when you need it
            immediately.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <button
            type="button"
            disabled={refreshing || enforceExpiryBusy}
            onClick={() => refreshStatus()}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-600/80 bg-slate-800/50 px-4 py-2.5 text-sm font-medium text-slate-200 transition hover:border-slate-500 hover:bg-slate-800 disabled:opacity-50"
          >
            <IconRefresh className={refreshing ? 'animate-spin text-slate-400' : 'text-slate-400'} />
            {refreshing ? 'Refreshing…' : 'Refresh status'}
          </button>
          <button
            type="button"
            title="Re-apply expired profile on MikroTik for every past-due line in this organisation (same as the scheduled job)."
            disabled={refreshing || enforceExpiryBusy}
            onClick={() => runEnforceExpirySync()}
            className="inline-flex items-center gap-2 rounded-xl border border-amber-600/50 bg-amber-950/30 px-4 py-2.5 text-sm font-medium text-amber-100 transition hover:border-amber-500/60 hover:bg-amber-950/50 disabled:opacity-50"
          >
            {enforceExpiryBusy ? 'Syncing routers…' : 'Sync expired to routers'}
          </button>
          <button
            type="button"
            onClick={() => {
              setError('');
              setShowNewModal(true);
            }}
            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 px-4 py-2.5 text-sm font-semibold text-slate-950 shadow-lg shadow-orange-950/30 transition hover:from-amber-400 hover:to-orange-400"
          >
            <IconUserPlus className="text-slate-900/90" />
            New PPPoE user
          </button>
        </div>
      </div>

      {error && (
        <div
          className="mt-6 rounded-xl border border-red-500/35 bg-red-500/10 px-4 py-3 text-sm text-red-200"
          role="alert"
        >
          {error}
        </div>
      )}

      {expirySyncSummary && (
        <p
          className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-950/25 px-4 py-3 text-sm text-emerald-100"
          role="status"
        >
          {expirySyncSummary}
        </p>
      )}

      <div className="mt-8 flex flex-wrap gap-2">
        {filterChips.map((c) => {
          const on = statusFilter === c.id;
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => setStatusFilter(c.id)}
              className={`inline-flex items-center gap-2 rounded-full border px-3.5 py-2 text-sm font-medium transition ${
                on
                  ? 'border-orange-500/50 bg-orange-500/15 text-orange-100 shadow-sm shadow-orange-950/20'
                  : 'border-slate-700/80 bg-slate-900/60 text-slate-400 hover:border-slate-600 hover:text-slate-200'
              }`}
            >
              {c.dot && <span className={`h-2 w-2 rounded-full ${c.dot}`} />}
              {c.label}
              <span
                className={`rounded-md px-1.5 py-0.5 text-xs tabular-nums ${
                  on ? 'bg-orange-500/20 text-orange-200' : 'bg-slate-800 text-slate-500'
                }`}
              >
                {c.count}
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-6 rounded-2xl border border-slate-800/90 bg-slate-900/40 shadow-xl shadow-black/20">
        <div className="flex flex-col gap-3 border-b border-slate-800/80 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative max-w-md flex-1">
            <IconSearch className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              type="search"
              placeholder="Search secret, customer name, email, or phone…"
              value={tableSearch}
              onChange={(e) => setTableSearch(e.target.value)}
              className="w-full rounded-xl border border-slate-700/80 bg-slate-950/80 py-2.5 pl-10 pr-4 text-sm text-slate-200 placeholder:text-slate-600 outline-none ring-orange-500/30 focus:border-orange-500/40 focus:ring-2"
            />
          </div>
          <p className="text-xs text-slate-500">
            Showing <span className="font-medium text-slate-400">{filteredAccounts.length}</span> of{' '}
            {accounts.length}
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[920px] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-800/80 text-xs font-semibold uppercase tracking-wider text-slate-500">
                <th className="px-5 py-3.5">Secret</th>
                <th className="px-5 py-3.5">Customer</th>
                <th className="px-5 py-3.5">Phone</th>
                <th className="px-5 py-3.5">Package</th>
                <th className="px-5 py-3.5">Paid until</th>
                <th className="px-5 py-3.5">Remaining</th>
                <th className="px-5 py-3.5">Status</th>
                <th className="px-5 py-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {filteredAccounts.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-5 py-16 text-center">
                    <div className="mx-auto flex max-w-sm flex-col items-center">
                      <IconEmpty className="text-slate-600" />
                      <p className="mt-4 text-base font-medium text-slate-300">
                        {accounts.length === 0 ? 'No PPPoE users' : 'No users match this view'}
                      </p>
                      <p className="mt-1 text-sm text-slate-500">
                        {accounts.length === 0
                          ? 'Create a subscriber to sync a secret to your MikroTik.'
                          : 'Try another filter or clear search.'}
                      </p>
                      {accounts.length === 0 && (
                        <button
                          type="button"
                          onClick={() => setShowNewModal(true)}
                          className="mt-6 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 px-5 py-2.5 text-sm font-semibold text-slate-950"
                        >
                          New PPPoE user
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ) : (
                filteredAccounts.map((a) => {
                  const rem = remainingMsUntil(a.paidUntil);
                  const remClass =
                    rem == null
                      ? 'text-slate-500'
                      : rem < 0
                        ? 'text-red-400'
                        : rem < 24 * 60 * 60 * 1000
                          ? 'text-amber-300'
                          : 'text-emerald-400/90';
                  const expired = isExpiredAccount(a);
                  const statusLabel = a.disabled
                    ? 'Suspended'
                    : expired
                      ? 'Expired'
                      : 'Active';
                  const statusClass = a.disabled
                    ? 'bg-slate-700/50 text-slate-300'
                    : expired
                      ? 'bg-red-500/15 text-red-300'
                      : 'bg-emerald-500/15 text-emerald-300';
                  return (
                    <tr key={a._id} className="text-slate-300 transition hover:bg-slate-800/30">
                      <td className="px-5 py-3.5 font-mono text-sm text-orange-300/95">{a.secretName}</td>
                      <td className="px-5 py-3.5 text-slate-400">
                        {a.userId?.fullName || a.userId?.email || (
                          <span className="text-slate-600">—</span>
                        )}
                      </td>
                      <td className="px-5 py-3.5 font-mono text-sm text-slate-400">
                        {a.userId?.phone || <span className="text-slate-600">—</span>}
                      </td>
                      <td className="px-5 py-3.5 text-slate-400">
                        {a.packageId?.name ? (
                          <span title={a.packageId?.kind || ''}>{a.packageId.name}</span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="px-5 py-3.5 text-slate-400">
                        {a.paidUntil ? new Date(a.paidUntil).toLocaleString() : '—'}
                      </td>
                      <td className={`px-5 py-3.5 font-medium ${remClass}`}>
                        {formatRemainingFromPaidUntil(a.paidUntil)}
                      </td>
                      <td className="px-5 py-3.5">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${statusClass}`}
                        >
                          {statusLabel}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => openEditAccount(a)}
                          className="text-orange-400 hover:text-orange-300"
                        >
                          Edit
                        </button>
                        <span className="mx-1.5 text-slate-600">·</span>
                        <button
                          type="button"
                          onClick={() => openRenewAccount(a)}
                          className="text-emerald-400/95 hover:text-emerald-300"
                        >
                          Renew
                        </button>
                        <span className="mx-1.5 text-slate-600">·</span>
                        <button
                          type="button"
                          onClick={() => syncOneAccount(a)}
                          className="text-slate-400 hover:text-slate-200"
                        >
                          Sync
                        </button>
                        <span className="mx-1.5 text-slate-600">·</span>
                        <button
                          type="button"
                          onClick={() => deletePppoeAccount(a)}
                          className="text-red-400/90 hover:text-red-300"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-8">
        <button
          type="button"
          onClick={() => setShowRouterTools((v) => !v)}
          className="flex w-full items-center justify-between rounded-xl border border-slate-800 bg-slate-900/50 px-4 py-3 text-left text-sm font-medium text-slate-300 hover:bg-slate-800/50"
        >
          <span>Router diagnostics — profiles, secrets &amp; API test</span>
          <IconChevron open={showRouterTools} className="text-slate-500" />
        </button>
        {showRouterTools && (
          <div className="mt-3 rounded-2xl border border-slate-800 bg-slate-900/40 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="font-medium text-white">Live data from MikroTik</h3>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={routerId}
                  onChange={(e) => setRouterId(e.target.value)}
                  className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                >
                  {routers.map((r) => (
                    <option key={r._id} value={r._id}>
                      {routerDisplayName(r)}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={loadingRouter || !routerId}
                  onClick={() => loadRouterLiveData(routerId)}
                  className="rounded-xl border border-slate-600 px-3 py-2 text-sm text-slate-300 hover:bg-slate-800 disabled:opacity-50"
                >
                  {loadingRouter ? 'Loading…' : 'Reload router'}
                </button>
                <button
                  type="button"
                  disabled={!routerId}
                  onClick={async () => {
                    setPingMessage('');
                    setMikrotikError('');
                    try {
                      const r = await apiFetch(`/api/routers/${routerId}/mikrotik/ping`);
                      setPingMessage(r.message || 'Router API reachable');
                    } catch (e) {
                      setMikrotikError(e.message || 'Ping failed');
                    }
                  }}
                  className="rounded-xl border border-emerald-700/50 px-3 py-2 text-sm text-emerald-300 hover:bg-emerald-950/50 disabled:opacity-50"
                >
                  Test API
                </button>
              </div>
            </div>

            {pingMessage && <p className="mt-3 text-sm text-emerald-400">{pingMessage}</p>}
            {mikrotikError && (
              <p className="mt-3 text-sm text-amber-300">
                {mikrotikError}{' '}
                <span className="text-slate-500">
                  (Use the API port under Routers — often 8728. Not Winbox 8291.)
                </span>
              </p>
            )}

            <div className="mt-4 grid gap-6 lg:grid-cols-2">
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  PPP profiles (on router)
                </h4>
                <div className="mt-2 max-h-52 overflow-auto rounded-xl border border-slate-800">
                  <table className="w-full text-left text-xs">
                    <thead className="sticky top-0 bg-slate-900 text-slate-400">
                      <tr>
                        <th className="px-3 py-2">Name</th>
                        <th className="px-3 py-2">Local address</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800">
                      {mikrotikProfiles.length === 0 ? (
                        <tr>
                          <td colSpan={2} className="px-3 py-6 text-center text-slate-500">
                            {loadingRouter ? '…' : 'No data — reload or fix API access'}
                          </td>
                        </tr>
                      ) : (
                        mikrotikProfiles.map((p) => (
                          <tr key={p.id || p.name} className="text-slate-300">
                            <td className="px-3 py-2 font-mono text-emerald-400/90">{p.name}</td>
                            <td className="px-3 py-2 text-slate-500">{p.localAddress || '—'}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  PPP secrets (on router)
                </h4>
                <p className="mb-2 text-xs text-slate-500">Read-only; passwords are not shown.</p>
                <div className="max-h-52 overflow-auto rounded-xl border border-slate-800">
                  <table className="w-full text-left text-xs">
                    <thead className="sticky top-0 bg-slate-900 text-slate-400">
                      <tr>
                        <th className="px-3 py-2">Name</th>
                        <th className="px-3 py-2">Profile</th>
                        <th className="px-3 py-2">Off</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800">
                      {mikrotikSecrets.length === 0 ? (
                        <tr>
                          <td colSpan={3} className="px-3 py-6 text-center text-slate-500">
                            {loadingRouter ? '…' : 'No secrets or API error'}
                          </td>
                        </tr>
                      ) : (
                        mikrotikSecrets.map((s) => (
                          <tr key={s.id || s.name} className="text-slate-300">
                            <td className="px-3 py-2 font-mono text-emerald-400/90">{s.name}</td>
                            <td className="px-3 py-2">{s.profile}</td>
                            <td className="px-3 py-2">{s.disabled ? 'yes' : 'no'}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {renewAccount && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="pppoe-renew-title"
          onClick={() => !renewBusy && setRenewAccount(null)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
              <h2 id="pppoe-renew-title" className="text-lg font-semibold text-white">
                Renew package —{' '}
                <span className="font-mono text-emerald-300">{renewAccount.secretName}</span>
              </h2>
              <button
                type="button"
                onClick={() => !renewBusy && setRenewAccount(null)}
                className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white"
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <form onSubmit={submitRenew} className="space-y-4 p-5">
              <p className="text-sm text-slate-400">
                Adds <strong className="text-slate-200">one billing period</strong> from the package
                (from today if expired, otherwise from the current paid-until). Re-enables the line and syncs
                MikroTik.
              </p>
              <label className="block text-sm text-slate-300">
                Package for this renewal
                <select
                  value={renewPackageId}
                  onChange={(e) => setRenewPackageId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
                  required
                >
                  {packages.length === 0 ? (
                    <option value="">No PPPoE packages — create one under Finance → Packages</option>
                  ) : (
                    packages.map((p) => (
                      <option key={p._id} value={p._id}>
                        {p.name}
                      </option>
                    ))
                  )}
                </select>
              </label>
              <label className="flex cursor-pointer items-start gap-2 text-sm text-slate-300">
                <input
                  type="checkbox"
                  checked={renewChargeBalance}
                  onChange={(e) => setRenewChargeBalance(e.target.checked)}
                  disabled={!renewAccount.userId}
                  className="mt-1 rounded border-slate-600 disabled:opacity-40"
                />
                <span>
                  Deduct package price from linked customer&apos;s <strong className="text-slate-200">wallet</strong>{' '}
                  {!renewAccount.userId && (
                    <span className="text-slate-500">(link a customer on the line to enable)</span>
                  )}
                </span>
              </label>
              <p className="text-xs text-slate-500">
                If unchecked, renewal is recorded as paid by admin (cash / MoMo outside the app). A receipt row is
                still created with amount 0.
              </p>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => !renewBusy && setRenewAccount(null)}
                  className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={renewBusy || !renewPackageId}
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
                >
                  {renewBusy ? 'Renewing…' : 'Apply renewal'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {editAccount && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="pppoe-edit-title"
          onClick={() => !editSaving && setEditAccount(null)}
        >
          <div
            className="max-h-[min(90vh,760px)] w-full max-w-lg overflow-y-auto rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-800 bg-slate-900/95 px-5 py-4 backdrop-blur">
              <h2 id="pppoe-edit-title" className="text-lg font-semibold text-white">
                Edit PPPoE —{' '}
                <span className="font-mono text-orange-300">{editAccount.secretName}</span>
              </h2>
              <button
                type="button"
                onClick={() => !editSaving && setEditAccount(null)}
                className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white"
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <form onSubmit={saveEditAccount} className="space-y-4 p-5">
              <label className="block text-sm text-slate-300">
                Paid until
                <input
                  type="datetime-local"
                  required
                  value={editPaidUntil}
                  onChange={(e) => setEditPaidUntil(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm"
                />
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-300">
                <input
                  type="checkbox"
                  checked={editDisabled}
                  onChange={(e) => setEditDisabled(e.target.checked)}
                  className="rounded border-slate-600"
                />
                Suspended (admin — secret disabled on router when still paid)
              </label>
              <label className="block text-sm text-slate-300">
                Billing customer
                <select
                  value={editUserId}
                  onChange={(e) => setEditUserId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
                >
                  <option value="">— None —</option>
                  {users.map((u) => (
                    <option key={u._id} value={u._id}>
                      {[u.fullName, u.phone, u.email].filter(Boolean).join(' · ') || u._id}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm text-slate-300">
                Package
                <select
                  value={editPackageId}
                  onChange={(e) => setEditPackageId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
                >
                  <option value="">— None —</option>
                  {packages.map((p) => (
                    <option key={p._id} value={String(p._id)}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <p className="text-xs text-slate-500">
                PPP profiles from{' '}
                <strong className="text-slate-400">
                  {routerDisplayName(
                    routers.find(
                      (r) => String(r._id) === String(editAccount.routerId?._id || editAccount.routerId)
                    )
                  ) || 'this line’s router'}
                </strong>
                . {editProfilesLoading ? 'Loading…' : `${editProfiles.length} loaded.`}
              </p>
              <label className="block text-sm text-slate-300">
                Active profile
                <select
                  value={editActiveProf}
                  onChange={(e) => setEditActiveProf(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm"
                >
                  <option value="">— Unchanged —</option>
                  {editActiveProf &&
                    !editProfiles.some((p) => p.name === editActiveProf) && (
                      <option value={editActiveProf}>{editActiveProf} (current)</option>
                    )}
                  {editProfiles.map((p) => (
                    <option key={p.name} value={p.name}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm text-slate-300">
                Expired profile
                <select
                  value={editExpiredProf}
                  onChange={(e) => setEditExpiredProf(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm"
                >
                  <option value="">— Unchanged —</option>
                  {editExpiredProf &&
                    !editProfiles.some((p) => p.name === editExpiredProf) && (
                      <option value={editExpiredProf}>{editExpiredProf} (current)</option>
                    )}
                  {editProfiles.map((p) => (
                    <option key={`e-${p.name}`} value={p.name}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm text-slate-300">
                New password (optional)
                <input
                  type="password"
                  value={editSecretPassword}
                  onChange={(e) => setEditSecretPassword(e.target.value)}
                  placeholder="Leave blank to keep"
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm"
                />
              </label>
              <div className="flex flex-wrap gap-2 pt-2">
                <button
                  type="submit"
                  disabled={editSaving || !editPaidUntil}
                  className="rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 px-5 py-2.5 text-sm font-semibold text-slate-950 disabled:opacity-50"
                >
                  {editSaving ? 'Saving…' : 'Save & sync router'}
                </button>
                <button
                  type="button"
                  disabled={editSaving}
                  onClick={() => setEditAccount(null)}
                  className="rounded-xl border border-slate-600 px-5 py-2.5 text-sm text-slate-300 hover:bg-slate-800"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showNewModal && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="pppoe-modal-title"
          onClick={() => !loading && setShowNewModal(false)}
        >
          <div
            className="max-h-[min(90vh,720px)] w-full max-w-lg overflow-y-auto rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl shadow-black/50"
            onClick={(e) => e.stopPropagation()}
            role="document"
          >
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-800 bg-slate-900/95 px-5 py-4 backdrop-blur">
              <h2 id="pppoe-modal-title" className="text-lg font-semibold text-white">
                New PPPoE user
              </h2>
              <button
                type="button"
                onClick={() => !loading && setShowNewModal(false)}
                className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white"
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <div className="space-y-6 p-5">
              <p className="rounded-lg border border-slate-700/80 bg-slate-950/60 px-3 py-2 text-xs text-slate-400">
                The PPPoE <span className="font-mono text-slate-300">secret name</span> is the router login. It shows on
                this PPPoE list, <strong className="text-slate-300">not</strong> on{' '}
                <strong className="text-slate-300">Customers</strong> unless you link a billing customer below.
              </p>
              <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-4">
                <h3 className="text-sm font-medium text-white">Billing customer (optional)</h3>
                <p className="mt-1 text-xs text-slate-500">
                  Add a <strong className="text-slate-400">phone number</strong> for SMS payment and renewal
                  notifications (Ghana: 0XX… or 233…).
                </p>
                <form onSubmit={createUser} className="mt-3 grid gap-2 sm:grid-cols-2">
                  <input
                    type="tel"
                    placeholder="Phone (recommended for SMS)"
                    value={newUserPhone}
                    onChange={(e) => setNewUserPhone(e.target.value)}
                    className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none ring-orange-500/30 focus:ring-2 sm:col-span-2"
                  />
                  <input
                    type="email"
                    placeholder="Email (optional)"
                    value={newUserEmail}
                    onChange={(e) => setNewUserEmail(e.target.value)}
                    className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none ring-orange-500/30 focus:ring-2"
                  />
                  <input
                    placeholder="Name (optional)"
                    value={newUserName}
                    onChange={(e) => setNewUserName(e.target.value)}
                    className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none ring-orange-500/30 focus:ring-2"
                  />
                  <button
                    type="submit"
                    className="rounded-lg bg-slate-700 px-3 py-2 text-sm text-white hover:bg-slate-600 sm:col-span-2"
                  >
                    Add customer
                  </button>
                </form>
              </div>

              <form onSubmit={createPppoe} className="space-y-4">
                <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-300">
                  <input
                    type="checkbox"
                    checked={linkCustomer}
                    onChange={(e) => setLinkCustomer(e.target.checked)}
                    className="rounded border-slate-600"
                  />
                  Link to a billing customer
                </label>
                {linkCustomer && (
                  <label className="block text-sm text-slate-300">
                    Customer
                    <select
                      required={linkCustomer}
                      value={userId}
                      onChange={(e) => setUserId(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
                    >
                      {users.length === 0 ? (
                        <option value="">Add a customer first</option>
                      ) : (
                        users.map((u) => (
                          <option key={u._id} value={u._id}>
                            {[u.fullName, u.phone, u.email].filter(Boolean).join(' · ') || u._id}
                          </option>
                        ))
                      )}
                    </select>
                  </label>
                )}
                <label className="block text-sm text-slate-300">
                  Router
                  <select
                    required
                    value={routerId}
                    onChange={(e) => setRouterId(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
                  >
                    {routers.map((r) => (
                      <option key={r._id} value={r._id}>
                        {routerDisplayName(r)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm text-slate-300">
                  Package (optional)
                  <select
                    value={packageId}
                    onChange={(e) => setPackageId(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
                  >
                    <option value="">None — router defaults</option>
                    {packages.map((p) => (
                      <option key={p._id} value={String(p._id)}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  {packages.length === 0 && (
                    <p className="mt-2 rounded-lg border border-amber-500/30 bg-amber-950/30 px-3 py-2 text-xs text-amber-200">
                      Add a <strong className="text-amber-100">PPPoE</strong> package under Finance → Packages.
                    </p>
                  )}
                </label>

                <fieldset className="rounded-xl border border-slate-800 bg-slate-950/50 p-3">
                  <legend className="px-1 text-xs font-medium text-slate-400">Subscription validity</legend>
                  <div className="mt-2 space-y-2 text-sm text-slate-300">
                    <label className="flex cursor-pointer items-center gap-2">
                      <input
                        type="radio"
                        name="vmode"
                        checked={validityMode === 'package'}
                        onChange={() => setValidityMode('package')}
                      />
                      From package (or 30 days if none)
                    </label>
                    <label className="flex cursor-pointer items-center gap-2">
                      <input
                        type="radio"
                        name="vmode"
                        checked={validityMode === 'duration'}
                        onChange={() => setValidityMode('duration')}
                      />
                      Fixed length from now
                    </label>
                    {validityMode === 'duration' && (
                      <div className="ml-6 flex flex-wrap items-center gap-2">
                        <input
                          type="number"
                          min={1}
                          value={validityAmount}
                          onChange={(e) => setValidityAmount(e.target.value)}
                          className="w-24 rounded border border-slate-700 bg-slate-950 px-2 py-1"
                        />
                        <select
                          value={validityUnit}
                          onChange={(e) => setValidityUnit(e.target.value)}
                          className="rounded border border-slate-700 bg-slate-950 px-2 py-1"
                        >
                          <option value="minute">minute(s)</option>
                          <option value="hour">hour(s)</option>
                          <option value="day">day(s)</option>
                          <option value="month">month(s)</option>
                        </select>
                      </div>
                    )}
                    <label className="flex cursor-pointer items-center gap-2">
                      <input
                        type="radio"
                        name="vmode"
                        checked={validityMode === 'until'}
                        onChange={() => setValidityMode('until')}
                      />
                      Until date &amp; time
                    </label>
                    {validityMode === 'until' && (
                      <input
                        type="datetime-local"
                        value={paidUntilInput}
                        onChange={(e) => setPaidUntilInput(e.target.value)}
                        className="ml-6 mt-1 rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-xs"
                      />
                    )}
                  </div>
                </fieldset>
                <label className="block text-sm text-slate-300">
                  Active profile
                  <select
                    value={activeProfilePick}
                    onChange={(e) => setActiveProfilePick(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm"
                  >
                    <option value="">Default (package / router)</option>
                    {mikrotikProfiles.map((p) => (
                      <option key={p.name} value={p.name}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm text-slate-300">
                  Expired profile
                  <select
                    value={expiredProfilePick}
                    onChange={(e) => setExpiredProfilePick(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm"
                  >
                    <option value="">Default (package / router)</option>
                    {mikrotikProfiles.map((p) => (
                      <option key={`e-${p.name}`} value={p.name}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm text-slate-300">
                  PPP login name (secret name)
                  <input
                    required
                    value={secretName}
                    onChange={(e) => setSecretName(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm"
                  />
                </label>
                <label className="block text-sm text-slate-300">
                  Password (optional — random if empty)
                  <input
                    type="password"
                    value={secretPassword}
                    onChange={(e) => setSecretPassword(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm"
                  />
                </label>
                <div className="flex flex-wrap gap-2 pt-2">
                  <button
                    type="submit"
                    disabled={loading || !secretName.trim() || !routerId}
                    className="rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 px-5 py-2.5 text-sm font-semibold text-slate-950 disabled:opacity-50"
                  >
                    {loading ? 'Creating…' : 'Create & sync to router'}
                  </button>
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => setShowNewModal(false)}
                    className="rounded-xl border border-slate-600 px-5 py-2.5 text-sm text-slate-300 hover:bg-slate-800"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
