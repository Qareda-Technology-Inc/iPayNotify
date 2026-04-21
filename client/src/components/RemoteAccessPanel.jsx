import { useEffect, useState, useMemo } from 'react';
import { apiFetch } from '../api.js';
import {
  formatRemainingFromPaidUntil,
  remainingMsUntil,
} from '../utils/remainingTime.js';

/** @typedef {'all'|'active'|'expired'|'suspended'|'pending'|'expiring'} Rafilter */

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
      <rect
        x="4"
        y="5"
        width="16"
        height="14"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.25"
        opacity="0.35"
      />
      <path d="M8 9h8M8 13h5" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
    </svg>
  );
}

function isExpired(a) {
  if (!a.paidUntil) return false;
  return new Date(a.paidUntil) < new Date();
}

function isActiveSub(a) {
  if (!a.paidUntil) return false;
  return new Date(a.paidUntil) >= new Date();
}

function matchesFilter(a, filter) {
  switch (filter) {
    case 'all':
      return true;
    case 'active':
      return isActiveSub(a) && !a.disabled;
    case 'expired':
      return isExpired(a);
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

function displayRowName(a) {
  if (a.userId?.fullName || a.userId?.email) {
    return a.userId.fullName || a.userId.email;
  }
  return a.displayName || '—';
}

export function RemoteAccessPanel() {
  const [rows, setRows] = useState([]);
  const [users, setUsers] = useState([]);
  const [packages, setPackages] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  /** @type {[Rafilter, import('react').Dispatch<import('react').SetStateAction<Rafilter>>]} */
  const [statusFilter, setStatusFilter] = useState(/** @type {Rafilter} */ ('all'));
  const [tableSearch, setTableSearch] = useState('');
  const [showNewModal, setShowNewModal] = useState(false);
  const [renewRow, setRenewRow] = useState(null);
  const [renewPackageId, setRenewPackageId] = useState('');
  const [renewChargeBalance, setRenewChargeBalance] = useState(false);
  const [renewBusy, setRenewBusy] = useState(false);

  const [linkCustomer, setLinkCustomer] = useState(false);
  const [userId, setUserId] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [packageId, setPackageId] = useState('');
  /** @type {'package' | 'duration' | 'until'} */
  const [validityMode, setValidityMode] = useState('package');
  const [validityAmount, setValidityAmount] = useState(30);
  const [validityUnit, setValidityUnit] = useState('day');
  const [paidUntilInput, setPaidUntilInput] = useState('');
  const [notes, setNotes] = useState('');

  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserName, setNewUserName] = useState('');
  const [newUserPhone, setNewUserPhone] = useState('');

  async function loadAll() {
    const [u, pkgs, list] = await Promise.all([
      apiFetch('/api/users'),
      apiFetch('/api/packages?all=1'),
      apiFetch('/api/remote-access'),
    ]);
    const ra = (Array.isArray(pkgs) ? pkgs : []).filter((x) => x.kind === 'remote_access');
    setUsers(Array.isArray(u) ? u : []);
    setPackages(ra);
    setRows(Array.isArray(list) ? list : []);
    setPackageId((pid) => {
      const sid = pid ? String(pid) : '';
      if (sid && ra.some((x) => String(x._id) === sid)) return sid;
      return ra[0]?._id ? String(ra[0]._id) : '';
    });
    if (Array.isArray(u) && u[0]) setUserId((uid) => uid || u[0]._id);
  }

  function openRenewRow(a) {
    setError('');
    setRenewRow(a);
    setRenewPackageId(
      a.packageId?._id ? String(a.packageId._id) : a.packageId ? String(a.packageId) : ''
    );
    setRenewChargeBalance(false);
  }

  async function submitRenewRemote(e) {
    e.preventDefault();
    if (!renewRow?._id) return;
    setRenewBusy(true);
    setError('');
    try {
      const body = {
        chargeBalance: renewChargeBalance,
        ...(renewPackageId ? { packageId: renewPackageId } : {}),
      };
      await apiFetch(`/api/remote-access/${renewRow._id}/renew`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      setRenewRow(null);
      window.location.reload();
    } catch (err) {
      setError(err.message || 'Renew failed');
    } finally {
      setRenewBusy(false);
    }
  }

  async function refreshStatus() {
    setRefreshing(true);
    setError('');
    try {
      await loadAll();
    } catch (e) {
      setError(e.message || 'Refresh failed');
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    loadAll().catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (!showNewModal) return;
    const onKey = (e) => {
      if (e.key === 'Escape' && !loading) setShowNewModal(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showNewModal, loading]);

  const counts = useMemo(() => {
    return {
      all: rows.length,
      active: rows.filter((a) => matchesFilter(a, 'active')).length,
      expired: rows.filter((a) => matchesFilter(a, 'expired')).length,
      suspended: rows.filter((a) => matchesFilter(a, 'suspended')).length,
      pending: rows.filter((a) => matchesFilter(a, 'pending')).length,
      expiring: rows.filter((a) => matchesFilter(a, 'expiring')).length,
    };
  }, [rows]);

  const filteredRows = useMemo(() => {
    const q = tableSearch.trim().toLowerCase();
    return rows.filter((a) => {
      if (!matchesFilter(a, statusFilter)) return false;
      if (!q) return true;
      const name = displayRowName(a).toLowerCase();
      const ph = (a.phone || '').toLowerCase();
      const em = (a.email || a.userId?.email || '').toLowerCase();
      return name.includes(q) || ph.includes(q) || em.includes(q);
    });
  }, [rows, statusFilter, tableSearch]);

  async function createCustomer(e) {
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

  async function createSubscription(e) {
    e.preventDefault();
    setError('');
    const ph = phone.trim();
    if (!ph) {
      setError('Phone number is required for SMS notifications.');
      return;
    }
    if (!linkCustomer && !displayName.trim()) {
      setError('Enter a display name or link a billing customer.');
      return;
    }
    if (linkCustomer && !userId) {
      setError('Choose a customer or turn off “Link to customer”.');
      return;
    }
    setLoading(true);
    try {
      const payload = {
        phone: ph,
        email: email.trim() || undefined,
        notes: notes.trim() || undefined,
        ...(linkCustomer && userId ? { userId } : {}),
        ...(!linkCustomer ? { displayName: displayName.trim() } : {}),
        packageId: packageId || undefined,
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

      await apiFetch('/api/remote-access', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      setPhone('');
      setEmail('');
      setDisplayName('');
      setNotes('');
      setShowNewModal(false);
      await loadAll();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  const filterChips = [
    { id: /** @type {Rafilter} */ ('all'), label: 'All', count: counts.all },
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
          <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            Remote access
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-400">
            Subscriptions outside PPPoE (VPN, panel access, etc.).{' '}
            <strong className="text-slate-300">Phone numbers</strong> are used for payment and renewal SMS.
            Track <strong className="text-slate-300">paid until</strong> here — no MikroTik sync.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <button
            type="button"
            disabled={refreshing}
            onClick={() => refreshStatus()}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-600/80 bg-slate-800/50 px-4 py-2.5 text-sm font-medium text-slate-200 transition hover:border-slate-500 hover:bg-slate-800 disabled:opacity-50"
          >
            <IconRefresh className={refreshing ? 'animate-spin text-slate-400' : 'text-slate-400'} />
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
          <button
            type="button"
            onClick={() => {
              setError('');
              setShowNewModal(true);
            }}
            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-violet-500 to-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-950/30 transition hover:from-violet-400 hover:to-indigo-500"
          >
            <IconUserPlus className="opacity-90" />
            New subscription
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
                  ? 'border-violet-500/50 bg-violet-500/15 text-violet-100 shadow-sm shadow-violet-950/20'
                  : 'border-slate-700/80 bg-slate-900/60 text-slate-400 hover:border-slate-600 hover:text-slate-200'
              }`}
            >
              {c.dot && <span className={`h-2 w-2 rounded-full ${c.dot}`} />}
              {c.label}
              <span
                className={`rounded-md px-1.5 py-0.5 text-xs tabular-nums ${
                  on ? 'bg-violet-500/20 text-violet-200' : 'bg-slate-800 text-slate-500'
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
              placeholder="Search name, phone, email…"
              value={tableSearch}
              onChange={(e) => setTableSearch(e.target.value)}
              className="w-full rounded-xl border border-slate-700/80 bg-slate-950/80 py-2.5 pl-10 pr-4 text-sm text-slate-200 placeholder:text-slate-600 outline-none ring-violet-500/30 focus:border-violet-500/40 focus:ring-2"
            />
          </div>
          <p className="text-xs text-slate-500">
            Showing <span className="font-medium text-slate-400">{filteredRows.length}</span> of{' '}
            {rows.length}
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[800px] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-800/80 text-xs font-semibold uppercase tracking-wider text-slate-500">
                <th className="px-5 py-3.5">Name</th>
                <th className="px-5 py-3.5">Phone</th>
                <th className="px-5 py-3.5">Email</th>
                <th className="px-5 py-3.5">Package</th>
                <th className="px-5 py-3.5">Paid until</th>
                <th className="px-5 py-3.5">Remaining</th>
                <th className="px-5 py-3.5">Status</th>
                <th className="px-5 py-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-5 py-16 text-center">
                    <div className="mx-auto flex max-w-sm flex-col items-center">
                      <IconEmpty className="text-slate-600" />
                      <p className="mt-4 text-base font-medium text-slate-300">
                        {rows.length === 0 ? 'No remote access subscriptions' : 'No rows match this view'}
                      </p>
                      <p className="mt-1 text-sm text-slate-500">
                        {rows.length === 0
                          ? 'Add Finance → Packages with kind Remote access, then create a subscription.'
                          : 'Try another filter or clear search.'}
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredRows.map((a) => {
                  const rem = remainingMsUntil(a.paidUntil);
                  const remClass =
                    rem == null
                      ? 'text-slate-500'
                      : rem < 0
                        ? 'text-red-400'
                        : rem < 24 * 60 * 60 * 1000
                          ? 'text-amber-300'
                          : 'text-emerald-400/90';
                  const expired = isExpired(a);
                  const statusLabel = a.disabled ? 'Suspended' : expired ? 'Expired' : 'Active';
                  const statusClass = a.disabled
                    ? 'bg-slate-700/50 text-slate-300'
                    : expired
                      ? 'bg-red-500/15 text-red-300'
                      : 'bg-emerald-500/15 text-emerald-300';
                  return (
                    <tr key={a._id} className="text-slate-300 transition hover:bg-slate-800/30">
                      <td className="px-5 py-3.5 font-medium text-white">{displayRowName(a)}</td>
                      <td className="px-5 py-3.5 font-mono text-sm text-violet-300/90">{a.phone}</td>
                      <td className="px-5 py-3.5 text-slate-400">
                        {a.email || a.userId?.email || <span className="text-slate-600">—</span>}
                      </td>
                      <td className="px-5 py-3.5 text-slate-400">
                        {a.packageId?.name || '—'}
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
                          onClick={() => openRenewRow(a)}
                          className="text-emerald-400/95 hover:text-emerald-300"
                        >
                          Renew
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

      {renewRow && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="ra-renew-title"
          onClick={() => !renewBusy && setRenewRow(null)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
              <h2 id="ra-renew-title" className="text-lg font-semibold text-white">
                Renew remote access — {displayRowName(renewRow)}
              </h2>
              <button
                type="button"
                onClick={() => !renewBusy && setRenewRow(null)}
                className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white"
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <form onSubmit={submitRenewRemote} className="space-y-4 p-5">
              <p className="text-sm text-slate-400">
                Adds one billing period from the package, re-enables the subscription, and records a paid renewal in
                Finance history.
              </p>
              <label className="block text-sm text-slate-300">
                Package
                <select
                  value={renewPackageId}
                  onChange={(e) => setRenewPackageId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
                  required
                >
                  {packages.length === 0 ? (
                    <option value="">No remote access packages</option>
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
                  disabled={!renewRow.userId}
                  className="mt-1 rounded border-slate-600 disabled:opacity-40"
                />
                <span>
                  Deduct from linked customer&apos;s wallet
                  {!renewRow.userId && (
                    <span className="text-slate-500"> (link a customer to enable)</span>
                  )}
                </span>
              </label>
              <p className="text-xs text-slate-500">
                Unchecked: admin renewal (amount 0 in ledger). Checked: uses package price and customer balance.
              </p>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => !renewBusy && setRenewRow(null)}
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

      {showNewModal && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="ra-modal-title"
          onClick={() => !loading && setShowNewModal(false)}
        >
          <div
            className="max-h-[min(90vh,760px)] w-full max-w-lg overflow-y-auto rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl shadow-black/50"
            onClick={(e) => e.stopPropagation()}
            role="document"
          >
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-800 bg-slate-900/95 px-5 py-4 backdrop-blur">
              <h2 id="ra-modal-title" className="text-lg font-semibold text-white">
                New remote access subscription
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
              <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-4">
                <h3 className="text-sm font-medium text-white">Quick-add customer (optional)</h3>
                <p className="mt-1 text-xs text-slate-500">
                  Saves email, name, and <strong className="text-slate-400">phone</strong> for SMS.
                </p>
                <form onSubmit={createCustomer} className="mt-3 grid gap-2 sm:grid-cols-2">
                  <input
                    type="tel"
                    placeholder="Phone (Ghana: 0XX… or 233…)"
                    value={newUserPhone}
                    onChange={(e) => setNewUserPhone(e.target.value)}
                    className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none ring-violet-500/30 focus:ring-2 sm:col-span-2"
                  />
                  <input
                    type="email"
                    placeholder="Email (optional)"
                    value={newUserEmail}
                    onChange={(e) => setNewUserEmail(e.target.value)}
                    className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none ring-violet-500/30 focus:ring-2"
                  />
                  <input
                    placeholder="Full name (optional)"
                    value={newUserName}
                    onChange={(e) => setNewUserName(e.target.value)}
                    className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none ring-violet-500/30 focus:ring-2"
                  />
                  <button
                    type="submit"
                    className="rounded-lg bg-slate-700 px-3 py-2 text-sm text-white hover:bg-slate-600 sm:col-span-2"
                  >
                    Add customer
                  </button>
                </form>
              </div>

              <form onSubmit={createSubscription} className="space-y-4">
                <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-300">
                  <input
                    type="checkbox"
                    checked={linkCustomer}
                    onChange={(e) => setLinkCustomer(e.target.checked)}
                    className="rounded border-slate-600"
                  />
                  Link to billing customer
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
                {!linkCustomer && (
                  <label className="block text-sm text-slate-300">
                    Display name
                    <input
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
                      placeholder="e.g. ACME VPN — front desk"
                    />
                  </label>
                )}
                <label className="block text-sm text-slate-300">
                  Phone <span className="text-red-400">*</span> (SMS notifications)
                  <input
                    type="tel"
                    required
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm"
                    placeholder="0244… or 233…"
                  />
                </label>
                <label className="block text-sm text-slate-300">
                  Email (optional)
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
                  />
                </label>
                <label className="block text-sm text-slate-300">
                  Package (optional — Remote access kind only)
                  <select
                    value={packageId}
                    onChange={(e) => setPackageId(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
                  >
                    <option value="">None — default 30-day period</option>
                    {packages.map((p) => (
                      <option key={p._id} value={String(p._id)}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  {packages.length === 0 && (
                    <p className="mt-2 text-xs text-amber-200/90">
                      Create a package with kind <span className="font-mono">remote_access</span> under Finance →
                      Packages.
                    </p>
                  )}
                </label>

                <fieldset className="rounded-xl border border-slate-800 bg-slate-950/50 p-3">
                  <legend className="px-1 text-xs font-medium text-slate-400">Subscription validity</legend>
                  <div className="mt-2 space-y-2 text-sm text-slate-300">
                    <label className="flex cursor-pointer items-center gap-2">
                      <input
                        type="radio"
                        name="ravm"
                        checked={validityMode === 'package'}
                        onChange={() => setValidityMode('package')}
                      />
                      From package (or 30 days if none)
                    </label>
                    <label className="flex cursor-pointer items-center gap-2">
                      <input
                        type="radio"
                        name="ravm"
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
                        name="ravm"
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
                  Notes (optional)
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={2}
                    className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                  />
                </label>

                <div className="flex flex-wrap gap-2 pt-2">
                  <button
                    type="submit"
                    disabled={loading || !phone.trim()}
                    className="rounded-xl bg-gradient-to-r from-violet-500 to-indigo-600 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                  >
                    {loading ? 'Saving…' : 'Create subscription'}
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
