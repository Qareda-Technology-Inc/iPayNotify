import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { apiFetch } from '../api.js';
import { setActingOrganizationId } from '../authStorage.js';
import { useMessage } from '../messages/index.js';
import {
  ConfirmModal,
  FormError,
  Modal,
  btnPrimary,
  btnSecondary,
  inputCls,
  labelCls,
} from '../components/Modal.jsx';

const STATUSES = ['active', 'trial', 'past_due', 'suspended'];

const STATUS_META = {
  active: { label: 'Active', cls: 'bg-emerald-500/15 text-emerald-200 ring-emerald-500/30', dot: 'bg-emerald-400' },
  trial: { label: 'Trial', cls: 'bg-sky-500/15 text-sky-200 ring-sky-500/30', dot: 'bg-sky-400' },
  past_due: { label: 'Past due', cls: 'bg-amber-500/15 text-amber-200 ring-amber-500/30', dot: 'bg-amber-400' },
  suspended: { label: 'Suspended', cls: 'bg-red-500/15 text-red-200 ring-red-500/30', dot: 'bg-red-400' },
};

export function OrgStatusPill({ status }) {
  const m = STATUS_META[status] || STATUS_META.active;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${m.cls}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${m.dot}`} />
      {m.label}
    </span>
  );
}

export function orgInitials(name) {
  const parts = String(name || '?').trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] || '?') + (parts[1]?.[0] || '')).toUpperCase();
}

function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

function ghs(cents) {
  return `GHS ${((Number(cents) || 0) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function limitInput(v) {
  return v != null ? String(v) : '';
}

function parseLimit(v, label) {
  const t = String(v ?? '').trim();
  if (t === '') return null;
  const n = Math.round(Number(t));
  if (!Number.isFinite(n) || n < 0) throw new Error(`${label} must be a non-negative number (blank = unlimited)`);
  return n;
}

function UsageBar({ label, used, max }) {
  const pct = max ? Math.min(100, Math.round((used / max) * 100)) : 0;
  const color = max == null ? 'bg-slate-600' : pct >= 100 ? 'bg-red-500' : pct >= 80 ? 'bg-amber-500' : 'bg-indigo-500';
  return (
    <div>
      <div className="flex items-baseline justify-between text-[11px]">
        <span className="text-slate-400">{label}</span>
        <span className="font-medium text-slate-200">
          {used}
          <span className="text-slate-500"> / {max != null ? max : '∞'}</span>
        </span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-800">
        <div className={`h-full rounded-full ${color}`} style={{ width: max == null ? '100%' : `${pct}%`, opacity: max == null ? 0.25 : 1 }} />
      </div>
    </div>
  );
}

function StatCard({ label, value, tone = 'text-white', sub }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 px-4 py-3">
      <p className="text-[11px] uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-xl font-semibold ${tone}`}>{value}</p>
      {sub ? <p className="mt-0.5 text-[11px] text-slate-500">{sub}</p> : null}
    </div>
  );
}

const EMPTY_EDIT = {
  name: '',
  slug: '',
  status: 'active',
  fee: '',
  maxRouters: '',
  maxAdmins: '',
  maxSmsPerMonth: '',
  remoteAccess: false,
};

export function SuperAdminOrganizationsPage() {
  const navigate = useNavigate();
  const { showSuccess, showError } = useMessage();
  const [rows, setRows] = useState([]);
  const [loadErr, setLoadErr] = useState('');
  const [loading, setLoading] = useState(true);
  const [defaultFeePercent, setDefaultFeePercent] = useState('5');
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({ name: '', slug: '', status: 'active' });
  const [slugTouched, setSlugTouched] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [createErr, setCreateErr] = useState('');

  const [editing, setEditing] = useState(null);
  const [editForm, setEditForm] = useState(EMPTY_EDIT);
  const [editBusy, setEditBusy] = useState(false);
  const [editErr, setEditErr] = useState('');

  const [feeOpen, setFeeOpen] = useState(false);
  const [feeDraft, setFeeDraft] = useState('');
  const [feeBusy, setFeeBusy] = useState(false);
  const [feeErr, setFeeErr] = useState('');

  const [deleting, setDeleting] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteErr, setDeleteErr] = useState('');

  const load = useCallback(async () => {
    setLoadErr('');
    try {
      const [list, settings] = await Promise.all([
        apiFetch('/api/super-admin/organizations'),
        apiFetch('/api/super-admin/platform-settings'),
      ]);
      setRows(Array.isArray(list) ? list : []);
      if (settings?.defaultPlatformFeePercent != null) {
        setDefaultFeePercent(String(settings.defaultPlatformFeePercent));
      }
    } catch (e) {
      setLoadErr(e.message || 'Failed to load organisations');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const stats = useMemo(() => {
    const s = { total: rows.length, active: 0, attention: 0, wallet: 0, routers: 0 };
    for (const o of rows) {
      if (o.status === 'active' || o.status === 'trial' || !o.status) s.active += 1;
      else s.attention += 1;
      s.wallet += Number(o.walletBalanceCents) || 0;
      s.routers += Number(o.usage?.routers) || 0;
    }
    return s;
  }, [rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((o) => {
      if (statusFilter !== 'all' && (o.status || 'active') !== statusFilter) return false;
      if (!q) return true;
      return String(o.name || '').toLowerCase().includes(q) || String(o.slug || '').toLowerCase().includes(q);
    });
  }, [rows, query, statusFilter]);

  function openCreate() {
    setCreateForm({ name: '', slug: '', status: 'active' });
    setSlugTouched(false);
    setCreateErr('');
    setCreateOpen(true);
  }

  async function submitCreate(e) {
    e.preventDefault();
    setCreateBusy(true);
    setCreateErr('');
    try {
      const created = await apiFetch('/api/super-admin/organizations', {
        method: 'POST',
        body: JSON.stringify({
          name: createForm.name.trim(),
          slug: slugify(createForm.slug),
          status: createForm.status,
        }),
      });
      showSuccess(`${created?.name || 'Organisation'} created`);
      setCreateOpen(false);
      const id = created?._id || created?.id;
      if (id) {
        navigate(`/super/organizations/${id}/admins?invite=1`);
        return;
      }
      await load();
    } catch (e2) {
      setCreateErr(e2.message || 'Create failed');
    } finally {
      setCreateBusy(false);
    }
  }

  function openEdit(o) {
    setEditing(o);
    setEditForm({
      name: o.name || '',
      slug: o.slug || '',
      status: o.status || 'active',
      fee: o.billing?.platformFeeBps != null ? String(o.billing.platformFeePercent) : '',
      maxRouters: limitInput(o.limits?.maxRouters),
      maxAdmins: limitInput(o.limits?.maxAdmins),
      maxSmsPerMonth: limitInput(o.limits?.maxSmsPerMonth),
      remoteAccess: Boolean(o.modules?.remoteAccess),
    });
    setEditErr('');
  }

  async function submitEdit(e) {
    e.preventDefault();
    if (!editing) return;
    setEditBusy(true);
    setEditErr('');
    try {
      const limits = {
        maxRouters: parseLimit(editForm.maxRouters, 'Max routers'),
        maxAdmins: parseLimit(editForm.maxAdmins, 'Max team members'),
        maxSmsPerMonth: parseLimit(editForm.maxSmsPerMonth, 'Max SMS per month'),
      };
      const feeText = editForm.fee.trim();
      let feeBps = null;
      if (feeText !== '') {
        const pct = Number(feeText);
        if (!Number.isFinite(pct) || pct < 0 || pct > 100) throw new Error('Fee % must be between 0 and 100');
        feeBps = Math.round(pct * 100);
      }

      await apiFetch(`/api/super-admin/organizations/${editing._id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: editForm.name.trim(),
          slug: slugify(editForm.slug),
          status: editForm.status,
          limits,
          modules: { remoteAccess: editForm.remoteAccess },
        }),
      });
      const prevBps = editing.billing?.platformFeeBps ?? null;
      if (prevBps !== feeBps) {
        await apiFetch(`/api/super-admin/organizations/${editing._id}/billing`, {
          method: 'PATCH',
          body: JSON.stringify({ platformFeeBps: feeBps }),
        });
      }
      showSuccess(`${editForm.name.trim() || 'Organisation'} updated`);
      setEditing(null);
      await load();
    } catch (e2) {
      setEditErr(e2.message || 'Save failed');
    } finally {
      setEditBusy(false);
    }
  }

  async function quickStatus(o, status) {
    try {
      await apiFetch(`/api/super-admin/organizations/${o._id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      showSuccess(`${o.name} is now ${STATUS_META[status]?.label.toLowerCase() || status}`);
      await load();
    } catch (e) {
      showError(e.message || 'Update failed');
    }
  }

  async function submitFee(e) {
    e.preventDefault();
    setFeeBusy(true);
    setFeeErr('');
    try {
      const updated = await apiFetch('/api/super-admin/platform-settings', {
        method: 'PATCH',
        body: JSON.stringify({ defaultPlatformFeePercent: Number(feeDraft) }),
      });
      setDefaultFeePercent(String(updated.defaultPlatformFeePercent));
      showSuccess(`Default platform fee set to ${updated.defaultPlatformFeePercent}%`);
      setFeeOpen(false);
      await load();
    } catch (e2) {
      setFeeErr(e2.message || 'Could not save platform fee');
    } finally {
      setFeeBusy(false);
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    setDeleteBusy(true);
    setDeleteErr('');
    try {
      await apiFetch(`/api/super-admin/organizations/${deleting._id}`, { method: 'DELETE' });
      showSuccess(`${deleting.name} deleted`);
      setDeleting(null);
      await load();
    } catch (e) {
      setDeleteErr(e.message || 'Delete failed');
    } finally {
      setDeleteBusy(false);
    }
  }

  function openDashboardAsOrg(org) {
    setActingOrganizationId(org._id, org.name);
    navigate('/');
  }

  const filterChips = [
    { key: 'all', label: 'All', count: rows.length },
    ...STATUSES.map((s) => ({
      key: s,
      label: STATUS_META[s].label,
      count: rows.filter((o) => (o.status || 'active') === s).length,
    })),
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-white">Organisations</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-400">
            Tenants on the platform. Manage status, limits, modules, fees and team — or open a tenant&apos;s dashboard
            to work inside it.
          </p>
        </div>
        <button type="button" onClick={openCreate} className={`${btnPrimary} inline-flex items-center gap-1.5`}>
          <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
            <path d="M10.75 4.75a.75.75 0 0 0-1.5 0v4.5h-4.5a.75.75 0 0 0 0 1.5h4.5v4.5a.75.75 0 0 0 1.5 0v-4.5h4.5a.75.75 0 0 0 0-1.5h-4.5v-4.5Z" />
          </svg>
          New organisation
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label="Organisations" value={stats.total} />
        <StatCard label="Active / trial" value={stats.active} tone="text-emerald-300" />
        <StatCard label="Needs attention" value={stats.attention} tone={stats.attention ? 'text-amber-300' : 'text-white'} sub="Past due or suspended" />
        <StatCard label="Routers" value={stats.routers} />
        <div className="col-span-2 rounded-xl border border-amber-500/25 bg-amber-950/15 px-4 py-3 lg:col-span-1">
          <p className="text-[11px] uppercase tracking-wide text-amber-200/70">Default platform fee</p>
          <div className="mt-1 flex items-center justify-between gap-2">
            <p className="text-xl font-semibold text-amber-100">{defaultFeePercent}%</p>
            <button
              type="button"
              onClick={() => {
                setFeeDraft(defaultFeePercent);
                setFeeErr('');
                setFeeOpen(true);
              }}
              className="rounded-md border border-amber-500/40 px-2 py-1 text-xs text-amber-100 hover:bg-amber-900/40"
            >
              Change
            </button>
          </div>
          <p className="mt-0.5 text-[11px] text-slate-500">Wallets total {ghs(stats.wallet)}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[14rem] flex-1">
          <svg viewBox="0 0 20 20" fill="currentColor" className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-500">
            <path fillRule="evenodd" d="M9 3.5a5.5 5.5 0 1 0 3.47 9.77l3.13 3.13a.75.75 0 1 0 1.06-1.06l-3.13-3.13A5.5 5.5 0 0 0 9 3.5ZM5 9a4 4 0 1 1 8 0 4 4 0 0 1-8 0Z" clipRule="evenodd" />
          </svg>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name or slug"
            className="w-full rounded-lg border border-slate-700 bg-slate-950 py-2 pl-8 pr-3 text-sm text-white placeholder:text-slate-600 focus:border-indigo-500 focus:outline-none"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {filterChips.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => setStatusFilter(c.key)}
              className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                statusFilter === c.key
                  ? 'bg-indigo-600 text-white'
                  : 'border border-slate-700 text-slate-300 hover:bg-slate-800'
              }`}
            >
              {c.label} <span className="opacity-60">{c.count}</span>
            </button>
          ))}
        </div>
      </div>

      {loadErr ? <FormError>{loadErr}</FormError> : null}

      {loading ? (
        <div className="grid gap-4 md:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-56 animate-pulse rounded-2xl border border-slate-800 bg-slate-900/40" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-700 px-6 py-14 text-center">
          <p className="text-sm text-slate-400">
            {rows.length === 0 ? 'No organisations yet.' : 'No organisations match your search.'}
          </p>
          {rows.length === 0 ? (
            <button type="button" onClick={openCreate} className="mt-3 text-sm text-indigo-400 hover:text-indigo-300">
              Create the first organisation
            </button>
          ) : null}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {filtered.map((o) => {
            const customFee = o.billing?.platformFeeBps != null;
            return (
              <article
                key={o._id}
                className="flex flex-col rounded-2xl border border-slate-800 bg-slate-900/40 transition hover:border-slate-700"
              >
                <div className="flex items-start gap-3 p-5 pb-4">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-indigo-500/15 text-sm font-semibold text-indigo-200 ring-1 ring-inset ring-indigo-500/30">
                    {orgInitials(o.name)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="truncate text-base font-semibold text-white">{o.name}</h2>
                      <OrgStatusPill status={o.status} />
                    </div>
                    <p className="mt-0.5 font-mono text-xs text-slate-500">{o.slug}</p>
                  </div>
                  <select
                    value={o.status || 'active'}
                    onChange={(e) => quickStatus(o, e.target.value)}
                    aria-label={`Status of ${o.name}`}
                    className="rounded-md border border-slate-700 bg-slate-950 px-1.5 py-1 text-xs text-slate-300"
                  >
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {STATUS_META[s].label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-3 px-5">
                  <div className="rounded-lg bg-slate-950/50 px-3 py-2">
                    <p className="text-[10px] uppercase tracking-wide text-slate-500">Wallet</p>
                    <p className="mt-0.5 text-sm font-semibold text-emerald-300">{ghs(o.walletBalanceCents)}</p>
                  </div>
                  <div className="rounded-lg bg-slate-950/50 px-3 py-2">
                    <p className="text-[10px] uppercase tracking-wide text-slate-500">Platform fee</p>
                    <p className="mt-0.5 text-sm font-semibold text-slate-100">
                      {o.billing?.platformFeePercent ?? defaultFeePercent}%
                      <span className="ml-1 text-[11px] font-normal text-slate-500">{customFee ? 'custom' : 'default'}</span>
                    </p>
                  </div>
                </div>

                <div className="space-y-2.5 px-5 py-4">
                  <UsageBar label="Routers" used={o.usage?.routers ?? 0} max={o.limits?.maxRouters ?? null} />
                  <UsageBar label="Team" used={o.usage?.admins ?? 0} max={o.limits?.maxAdmins ?? null} />
                  <UsageBar label="SMS this month" used={o.usage?.smsThisMonth ?? 0} max={o.limits?.maxSmsPerMonth ?? null} />
                </div>

                <div className="flex flex-wrap gap-1.5 px-5 pb-4">
                  <span
                    className={`rounded-md px-2 py-0.5 text-[11px] ring-1 ring-inset ${
                      o.modules?.tickets ? 'bg-emerald-500/10 text-emerald-200 ring-emerald-500/30' : 'bg-slate-800/60 text-slate-500 ring-slate-700'
                    }`}
                  >
                    Ticket operations {o.modules?.tickets ? 'on' : 'off'}
                  </span>
                  <span
                    className={`rounded-md px-2 py-0.5 text-[11px] ring-1 ring-inset ${
                      o.modules?.remoteAccess ? 'bg-emerald-500/10 text-emerald-200 ring-emerald-500/30' : 'bg-slate-800/60 text-slate-500 ring-slate-700'
                    }`}
                  >
                    Remote access {o.modules?.remoteAccess ? 'on' : 'off'}
                  </span>
                </div>

                <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-slate-800 px-5 py-3">
                  <button
                    type="button"
                    onClick={() => openDashboardAsOrg(o)}
                    className="rounded-md bg-emerald-600/90 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500"
                  >
                    Open dashboard
                  </button>
                  <Link
                    to={`/super/organizations/${o._id}/admins`}
                    className="rounded-md border border-slate-600 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-800"
                  >
                    Team ({o.usage?.admins ?? 0})
                  </Link>
                  <button
                    type="button"
                    onClick={() => openEdit(o)}
                    className="rounded-md border border-slate-600 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-800"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setDeleteErr('');
                      setDeleting(o);
                    }}
                    className="ml-auto rounded-md px-2.5 py-1.5 text-xs text-red-300 hover:bg-red-950/40"
                  >
                    Delete
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <Modal
        open={createOpen}
        title="New organisation"
        subtitle="Next you'll invite the first organisation admin."
        onClose={() => setCreateOpen(false)}
        footer={
          <>
            <button type="button" onClick={() => setCreateOpen(false)} className={btnSecondary}>
              Cancel
            </button>
            <button
              type="submit"
              form="org-create-form"
              disabled={createBusy || !createForm.name.trim() || !slugify(createForm.slug)}
              className={btnPrimary}
            >
              {createBusy ? 'Creating…' : 'Create & invite admin'}
            </button>
          </>
        }
      >
        <form id="org-create-form" onSubmit={submitCreate} className="space-y-4">
          <label className={labelCls}>
            Display name
            <input
              required
              autoFocus
              value={createForm.name}
              onChange={(e) => {
                const name = e.target.value;
                setCreateForm((f) => ({ ...f, name, slug: slugTouched ? f.slug : slugify(name) }));
              }}
              placeholder="e.g. Acme ISP"
              className={inputCls}
            />
          </label>
          <label className={labelCls}>
            Slug <span className="text-slate-600">(unique, used in links)</span>
            <input
              required
              value={createForm.slug}
              onChange={(e) => {
                setSlugTouched(true);
                setCreateForm((f) => ({ ...f, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') }));
              }}
              placeholder="acme-isp"
              className={`${inputCls} font-mono`}
            />
          </label>
          <label className={labelCls}>
            Status
            <select
              value={createForm.status}
              onChange={(e) => setCreateForm((f) => ({ ...f, status: e.target.value }))}
              className={inputCls}
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_META[s].label}
                </option>
              ))}
            </select>
          </label>
          {createErr ? <FormError>{createErr}</FormError> : null}
        </form>
      </Modal>

      <Modal
        open={Boolean(editing)}
        title={editing ? `Edit ${editing.name}` : 'Edit organisation'}
        onClose={() => setEditing(null)}
        size="lg"
        footer={
          <>
            <button type="button" onClick={() => setEditing(null)} className={btnSecondary}>
              Cancel
            </button>
            <button type="submit" form="org-edit-form" disabled={editBusy} className={btnPrimary}>
              {editBusy ? 'Saving…' : 'Save changes'}
            </button>
          </>
        }
      >
        {editing ? (
          <form id="org-edit-form" onSubmit={submitEdit} className="space-y-6">
            <fieldset className="space-y-4">
              <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">General</legend>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className={`${labelCls} sm:col-span-2`}>
                  Display name
                  <input
                    required
                    value={editForm.name}
                    onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                    className={inputCls}
                  />
                </label>
                <label className={labelCls}>
                  Slug
                  <input
                    required
                    value={editForm.slug}
                    onChange={(e) =>
                      setEditForm((f) => ({ ...f, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') }))
                    }
                    className={`${inputCls} font-mono`}
                  />
                </label>
                <label className={labelCls}>
                  Status
                  <select
                    value={editForm.status}
                    onChange={(e) => setEditForm((f) => ({ ...f, status: e.target.value }))}
                    className={inputCls}
                  >
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {STATUS_META[s].label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {editForm.slug !== editing.slug ? (
                <p className="text-[11px] text-amber-300/90">
                  Changing the slug can affect links that already use the old slug.
                </p>
              ) : null}
            </fieldset>

            <fieldset className="space-y-3 border-t border-slate-800 pt-5">
              <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Billing</legend>
              <label className={`${labelCls} max-w-xs`}>
                Platform fee %
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  value={editForm.fee}
                  onChange={(e) => setEditForm((f) => ({ ...f, fee: e.target.value }))}
                  placeholder={`Default (${defaultFeePercent}%)`}
                  className={inputCls}
                />
              </label>
              <p className="text-[11px] text-slate-500">Leave blank to use the platform default.</p>
            </fieldset>

            <fieldset className="space-y-3 border-t border-slate-800 pt-5">
              <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Limits</legend>
              <div className="grid gap-4 sm:grid-cols-3">
                {[
                  { key: 'maxRouters', label: 'Max routers', used: editing.usage?.routers },
                  { key: 'maxAdmins', label: 'Max team members', used: editing.usage?.admins },
                  { key: 'maxSmsPerMonth', label: 'Max SMS / month', used: editing.usage?.smsThisMonth },
                ].map((f) => (
                  <label key={f.key} className={labelCls}>
                    {f.label}
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={editForm[f.key]}
                      onChange={(e) => setEditForm((x) => ({ ...x, [f.key]: e.target.value }))}
                      placeholder="Unlimited"
                      className={inputCls}
                    />
                    <span className="mt-1 block text-[11px] font-normal text-slate-500">Using {f.used ?? 0} now</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset className="space-y-3 border-t border-slate-800 pt-5">
              <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Modules</legend>
              <label className="flex cursor-pointer items-start justify-between gap-4 rounded-lg border border-slate-800 bg-slate-950/50 px-3 py-2.5">
                <span>
                  <span className="block text-sm text-white">Remote access</span>
                  <span className="block text-[11px] text-slate-500">Enables the Remote access feature for this organisation.</span>
                </span>
                <input
                  type="checkbox"
                  checked={editForm.remoteAccess}
                  onChange={(e) => setEditForm((f) => ({ ...f, remoteAccess: e.target.checked }))}
                  className="mt-1 h-4 w-4 rounded border-slate-600"
                />
              </label>
              <div className="flex items-start justify-between gap-4 rounded-lg border border-slate-800 bg-slate-950/30 px-3 py-2.5">
                <span>
                  <span className="block text-sm text-slate-300">Ticket operations</span>
                  <span className="block text-[11px] text-slate-500">
                    Only available to <span className="font-mono">qaretech-innovative</span>.
                  </span>
                </span>
                <span className={`text-xs ${editing.modules?.tickets ? 'text-emerald-300' : 'text-slate-500'}`}>
                  {editing.modules?.tickets ? 'On' : 'Off'}
                </span>
              </div>
            </fieldset>

            {editErr ? <FormError>{editErr}</FormError> : null}
          </form>
        ) : null}
      </Modal>

      <Modal
        open={feeOpen}
        title="Default platform fee"
        subtitle="Applies to every organisation without a custom fee."
        size="sm"
        onClose={() => setFeeOpen(false)}
        footer={
          <>
            <button type="button" onClick={() => setFeeOpen(false)} className={btnSecondary}>
              Cancel
            </button>
            <button type="submit" form="platform-fee-form" disabled={feeBusy} className={btnPrimary}>
              {feeBusy ? 'Saving…' : 'Save'}
            </button>
          </>
        }
      >
        <form id="platform-fee-form" onSubmit={submitFee}>
          <label className={labelCls}>
            Fee %
            <input
              type="number"
              min="0"
              max="100"
              step="0.01"
              required
              autoFocus
              value={feeDraft}
              onChange={(e) => setFeeDraft(e.target.value)}
              className={inputCls}
            />
          </label>
          {feeErr ? <FormError>{feeErr}</FormError> : null}
        </form>
      </Modal>

      <ConfirmModal
        open={Boolean(deleting)}
        title="Delete organisation?"
        danger
        confirmLabel="Delete"
        busy={deleteBusy}
        error={deleteErr}
        onClose={() => setDeleting(null)}
        onConfirm={confirmDelete}
        message={
          deleting ? (
            <div className="space-y-2">
              <p>
                <strong className="text-white">{deleting.name}</strong> will be permanently deleted.
              </p>
              {(deleting.usage?.admins ?? 0) > 0 || (deleting.usage?.routers ?? 0) > 0 ? (
                <p className="rounded-lg border border-amber-500/30 bg-amber-950/20 px-3 py-2 text-xs text-amber-100">
                  It still has {deleting.usage?.admins ?? 0} team member(s) and {deleting.usage?.routers ?? 0} router(s).
                  Remove them first, or the delete will be refused.
                </p>
              ) : null}
            </div>
          ) : null
        }
      />
    </div>
  );
}
