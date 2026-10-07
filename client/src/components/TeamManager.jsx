import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../api.js';
import { useMessage } from '../messages/index.js';
import {
  ConfirmModal,
  FormError,
  Modal,
  btnPrimary,
  btnSecondary,
  inputCls,
  labelCls,
} from './Modal.jsx';

const ROLE_META = {
  org_admin: { label: 'Admin', cls: 'bg-indigo-500/15 text-indigo-200 ring-indigo-500/30' },
  org_staff: { label: 'Staff', cls: 'bg-slate-700/60 text-slate-200 ring-slate-600/50' },
  ticket_manager: { label: 'Staff', cls: 'bg-slate-700/60 text-slate-200 ring-slate-600/50' },
};

const ROLE_OPTIONS = [
  { value: 'org_admin', label: 'Admin', hint: 'Full dashboard, team and settings' },
  { value: 'org_staff', label: 'Staff', hint: 'Day-to-day operations' },
];

const AVATAR_COLORS = [
  'from-indigo-500 to-violet-500',
  'from-emerald-500 to-teal-500',
  'from-amber-500 to-orange-500',
  'from-sky-500 to-cyan-500',
  'from-rose-500 to-pink-500',
];

function normRole(role) {
  return role === 'ticket_manager' ? 'org_staff' : role || 'org_staff';
}

function displayName(a) {
  return String(a?.fullName || '').trim() || a?.email || '—';
}

function initials(a) {
  const src = String(a?.fullName || '').trim() || String(a?.email || '').split('@')[0];
  const parts = src.split(/[\s._-]+/).filter(Boolean);
  return ((parts[0]?.[0] || '?') + (parts[1]?.[0] || '')).toUpperCase();
}

function avatarColor(a) {
  const s = String(a?._id || a?.email || '');
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

function memberStatus(a) {
  if (a.status !== 'invited') return { key: 'active', label: 'Active', cls: 'bg-emerald-500/15 text-emerald-200 ring-emerald-500/30' };
  const exp = a.inviteExpiresAt ? new Date(a.inviteExpiresAt).getTime() : null;
  if (exp && exp < Date.now()) {
    return { key: 'invited', label: 'Invite expired', cls: 'bg-red-500/15 text-red-200 ring-red-500/30' };
  }
  return { key: 'invited', label: 'Invite pending', cls: 'bg-amber-500/15 text-amber-200 ring-amber-500/30' };
}

function formatDate(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    return '';
  }
}

function Badge({ cls, children }) {
  return (
    <span className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ring-inset ${cls}`}>
      {children}
    </span>
  );
}

function RolePicker({ value, onChange, disabled }) {
  return (
    <div className="mt-1 grid gap-2 sm:grid-cols-2">
      {ROLE_OPTIONS.map((o) => {
        const active = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            disabled={disabled}
            onClick={() => onChange(o.value)}
            className={`rounded-lg border px-3 py-2 text-left transition disabled:cursor-not-allowed disabled:opacity-60 ${
              active
                ? 'border-indigo-500 bg-indigo-500/10 ring-1 ring-indigo-500'
                : 'border-slate-700 bg-slate-950 hover:border-slate-600'
            }`}
          >
            <span className="block text-sm font-medium text-white">{o.label}</span>
            <span className="block text-[11px] text-slate-400">{o.hint}</span>
          </button>
        );
      })}
    </div>
  );
}

function InviteLinkBox({ url, onCopy }) {
  if (!url) return null;
  return (
    <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-950/20 p-3">
      <p className="text-xs font-medium text-amber-100">Invite link — share it once if the email didn&apos;t arrive</p>
      <p className="mt-1 break-all font-mono text-[11px] text-amber-100/80 select-all">{url}</p>
      <button
        type="button"
        onClick={() => onCopy(url)}
        className="mt-2 rounded-md border border-amber-500/40 px-2.5 py-1 text-xs text-amber-50 hover:bg-amber-900/40"
      >
        Copy link
      </button>
    </div>
  );
}

const EMPTY_FORM = { fullName: '', email: '', phone: '', role: 'org_staff' };

/**
 * Team list + invite / edit / resend / remove for one organisation.
 * `apiBase` is either `/api/organization/admins` or `/api/super-admin/organizations/:id/admins`.
 */
export function TeamManager({
  apiBase,
  currentAdminId,
  maxAdmins = null,
  defaultRole = 'org_staff',
  autoOpenInvite = false,
  disabled = false,
  title = 'Team',
  description,
  onChanged,
}) {
  const { showSuccess, showError } = useMessage();
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState('');
  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteForm, setInviteForm] = useState({ ...EMPTY_FORM, role: defaultRole });
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteErr, setInviteErr] = useState('');
  const [inviteResult, setInviteResult] = useState(null);

  const [editing, setEditing] = useState(null);
  const [editForm, setEditForm] = useState(EMPTY_FORM);
  const [editBusy, setEditBusy] = useState(false);
  const [editErr, setEditErr] = useState('');

  const [removing, setRemoving] = useState(null);
  const [removeBusy, setRemoveBusy] = useState(false);
  const [removeErr, setRemoveErr] = useState('');

  const [linkResult, setLinkResult] = useState(null);
  const [resendingId, setResendingId] = useState('');

  const load = useCallback(async () => {
    if (!apiBase) return;
    setLoading(true);
    setLoadErr('');
    try {
      const list = await apiFetch(apiBase);
      setMembers(Array.isArray(list) ? list : []);
    } catch (e) {
      setLoadErr(e.message || 'Could not load team');
      setMembers([]);
    } finally {
      setLoading(false);
    }
  }, [apiBase]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (autoOpenInvite && !disabled) setInviteOpen(true);
  }, [autoOpenInvite, disabled]);

  async function refresh() {
    await load();
    onChanged?.();
  }

  const counts = useMemo(() => {
    const c = { total: members.length, admins: 0, staff: 0, active: 0, invited: 0 };
    for (const m of members) {
      if (normRole(m.role) === 'org_admin') c.admins += 1;
      else c.staff += 1;
      if (m.status === 'invited') c.invited += 1;
      else c.active += 1;
    }
    return c;
  }, [members]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return members
      .filter((m) => roleFilter === 'all' || normRole(m.role) === roleFilter)
      .filter((m) => statusFilter === 'all' || memberStatus(m).key === statusFilter)
      .filter((m) => {
        if (!q) return true;
        return [m.fullName, m.email, m.phone].some((v) => String(v || '').toLowerCase().includes(q));
      })
      .sort((a, b) => {
        const ra = normRole(a.role) === 'org_admin' ? 0 : 1;
        const rb = normRole(b.role) === 'org_admin' ? 0 : 1;
        if (ra !== rb) return ra - rb;
        return displayName(a).localeCompare(displayName(b));
      });
  }, [members, query, roleFilter, statusFilter]);

  const atLimit = maxAdmins != null && counts.total >= maxAdmins;
  const isSelf = (m) => currentAdminId && String(m._id) === String(currentAdminId);

  async function copyUrl(url) {
    try {
      await navigator.clipboard.writeText(url);
      showSuccess('Invite link copied');
    } catch {
      showError('Could not copy — select the link manually');
    }
  }

  function openInvite() {
    setInviteForm({ ...EMPTY_FORM, role: defaultRole });
    setInviteErr('');
    setInviteResult(null);
    setInviteOpen(true);
  }

  async function submitInvite(e) {
    e.preventDefault();
    setInviteBusy(true);
    setInviteErr('');
    try {
      const created = await apiFetch(apiBase, {
        method: 'POST',
        body: JSON.stringify({
          fullName: inviteForm.fullName.trim(),
          email: inviteForm.email.trim(),
          role: inviteForm.role,
          ...(inviteForm.phone.trim() ? { phone: inviteForm.phone.trim() } : {}),
        }),
      });
      setInviteResult(created || {});
      if (created?.emailSent) showSuccess(`Invite emailed to ${created.email}`);
      await refresh();
    } catch (e2) {
      setInviteErr(e2.message || 'Invite failed');
    } finally {
      setInviteBusy(false);
    }
  }

  function openEdit(m) {
    setEditing(m);
    setEditForm({
      fullName: m.fullName || '',
      email: m.email || '',
      phone: m.phone || '',
      role: normRole(m.role),
    });
    setEditErr('');
  }

  async function submitEdit(e) {
    e.preventDefault();
    if (!editing) return;
    setEditBusy(true);
    setEditErr('');
    const body = {
      fullName: editForm.fullName.trim(),
      email: editForm.email.trim(),
      phone: editForm.phone.trim(),
    };
    if (editForm.role !== normRole(editing.role)) body.role = editForm.role;
    try {
      await apiFetch(`${apiBase}/${editing._id}`, { method: 'PATCH', body: JSON.stringify(body) });
      showSuccess(`Saved ${body.fullName || body.email}`);
      setEditing(null);
      await refresh();
    } catch (e2) {
      setEditErr(e2.message || 'Save failed');
    } finally {
      setEditBusy(false);
    }
  }

  async function resend(m) {
    setResendingId(m._id);
    try {
      const r = await apiFetch(`${apiBase}/${m._id}/resend-invite`, { method: 'POST', body: JSON.stringify({}) });
      if (r?.emailSent) showSuccess(`Invite re-sent to ${r.email || m.email}`);
      setLinkResult({ ...r, email: r?.email || m.email });
      await load();
    } catch (e) {
      showError(e.message || 'Resend failed');
    } finally {
      setResendingId('');
    }
  }

  async function confirmRemove() {
    if (!removing) return;
    setRemoveBusy(true);
    setRemoveErr('');
    try {
      await apiFetch(`${apiBase}/${removing._id}`, { method: 'DELETE' });
      showSuccess(`${displayName(removing)} removed`);
      setRemoving(null);
      await refresh();
    } catch (e) {
      setRemoveErr(e.message || 'Remove failed');
    } finally {
      setRemoveBusy(false);
    }
  }

  const pct = maxAdmins ? Math.min(100, Math.round((counts.total / maxAdmins) * 100)) : 0;
  const hasFilters = query || roleFilter !== 'all' || statusFilter !== 'all';

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/40">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-800 px-5 py-4">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-white">{title}</h2>
          <p className="mt-0.5 text-sm text-slate-400">
            {description || 'People who can sign in to this organisation. Invitees set their own password from the email link.'}
          </p>
        </div>
        <button
          type="button"
          onClick={openInvite}
          disabled={disabled || atLimit}
          title={atLimit ? 'Team limit reached' : undefined}
          className={`${btnPrimary} inline-flex items-center gap-1.5`}
        >
          <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
            <path d="M10.75 4.75a.75.75 0 0 0-1.5 0v4.5h-4.5a.75.75 0 0 0 0 1.5h4.5v4.5a.75.75 0 0 0 1.5 0v-4.5h4.5a.75.75 0 0 0 0-1.5h-4.5v-4.5Z" />
          </svg>
          {atLimit ? 'Team limit reached' : 'Add member'}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-px bg-slate-800 sm:grid-cols-4">
        {[
          { label: 'Members', value: maxAdmins != null ? `${counts.total} / ${maxAdmins}` : counts.total },
          { label: 'Admins', value: counts.admins },
          { label: 'Staff', value: counts.staff },
          { label: 'Pending invites', value: counts.invited },
        ].map((s) => (
          <div key={s.label} className="bg-slate-900/80 px-5 py-3">
            <p className="text-[11px] uppercase tracking-wide text-slate-500">{s.label}</p>
            <p className="mt-0.5 text-lg font-semibold text-white">{s.value}</p>
          </div>
        ))}
      </div>
      {maxAdmins != null ? (
        <div className="h-1 bg-slate-800">
          <div
            className={`h-1 ${pct >= 100 ? 'bg-red-500' : pct >= 80 ? 'bg-amber-500' : 'bg-indigo-500'}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      ) : null}

      {linkResult ? (
        <div className="border-b border-slate-800 px-5 pb-4">
          <div className="flex items-start justify-between gap-2">
            <p className="mt-4 text-sm text-slate-300">
              {linkResult.emailSent
                ? `Invite re-sent to ${linkResult.email}.`
                : `Invite refreshed for ${linkResult.email}, but the email did not send.`}
            </p>
            <button
              type="button"
              onClick={() => setLinkResult(null)}
              className="mt-3 rounded-md px-2 py-1 text-xs text-slate-400 hover:bg-slate-800 hover:text-white"
            >
              Dismiss
            </button>
          </div>
          <InviteLinkBox url={linkResult.acceptUrl} onCopy={copyUrl} />
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 px-5 py-3">
        <div className="relative min-w-[12rem] flex-1">
          <svg viewBox="0 0 20 20" fill="currentColor" className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-500">
            <path fillRule="evenodd" d="M9 3.5a5.5 5.5 0 1 0 3.47 9.77l3.13 3.13a.75.75 0 1 0 1.06-1.06l-3.13-3.13A5.5 5.5 0 0 0 9 3.5ZM5 9a4 4 0 1 1 8 0 4 4 0 0 1-8 0Z" clipRule="evenodd" />
          </svg>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, email or phone"
            className="w-full rounded-lg border border-slate-700 bg-slate-950 py-2 pl-8 pr-3 text-sm text-white placeholder:text-slate-600 focus:border-indigo-500 focus:outline-none"
          />
        </div>
        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
          className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-sm text-slate-200"
        >
          <option value="all">All roles</option>
          <option value="org_admin">Admins</option>
          <option value="org_staff">Staff</option>
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-sm text-slate-200"
        >
          <option value="all">Any status</option>
          <option value="active">Active</option>
          <option value="invited">Invited</option>
        </select>
      </div>

      {loadErr ? (
        <div className="px-5 pb-4">
          <FormError>{loadErr}</FormError>
        </div>
      ) : null}

      {loading ? (
        <ul className="divide-y divide-slate-800/80 border-t border-slate-800">
          {[0, 1, 2].map((i) => (
            <li key={i} className="flex items-center gap-3 px-5 py-4">
              <div className="h-10 w-10 animate-pulse rounded-full bg-slate-800" />
              <div className="flex-1 space-y-2">
                <div className="h-3 w-40 animate-pulse rounded bg-slate-800" />
                <div className="h-3 w-56 animate-pulse rounded bg-slate-800/70" />
              </div>
            </li>
          ))}
        </ul>
      ) : filtered.length === 0 ? (
        <div className="border-t border-slate-800 px-5 py-10 text-center">
          <p className="text-sm text-slate-400">
            {hasFilters ? 'No one matches these filters.' : 'No team members yet.'}
          </p>
          {hasFilters ? (
            <button
              type="button"
              onClick={() => {
                setQuery('');
                setRoleFilter('all');
                setStatusFilter('all');
              }}
              className="mt-2 text-sm text-indigo-400 hover:text-indigo-300"
            >
              Clear filters
            </button>
          ) : !disabled ? (
            <button type="button" onClick={openInvite} className="mt-2 text-sm text-indigo-400 hover:text-indigo-300">
              Invite the first member
            </button>
          ) : null}
        </div>
      ) : (
        <ul className="divide-y divide-slate-800/80 border-t border-slate-800">
          {filtered.map((m) => {
            const st = memberStatus(m);
            const role = ROLE_META[m.role] || ROLE_META.org_staff;
            const self = isSelf(m);
            return (
              <li key={m._id} className="flex flex-wrap items-center gap-x-4 gap-y-3 px-5 py-3.5 hover:bg-slate-800/20">
                <div
                  className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br text-sm font-semibold text-white ${avatarColor(m)}`}
                >
                  {initials(m)}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-white">
                    <span className="truncate">{displayName(m)}</span>
                    {self ? <Badge cls="bg-sky-500/15 text-sky-200 ring-sky-500/30">You</Badge> : null}
                    <Badge cls={role.cls}>{role.label}</Badge>
                    <Badge cls={st.cls}>{st.label}</Badge>
                  </p>
                  <p className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-slate-400">
                    <span className="truncate">{m.email}</span>
                    {m.phone ? <span className="font-mono">{m.phone}</span> : <span className="text-slate-600">No phone</span>}
                    {m.status === 'invited' && m.inviteExpiresAt ? (
                      <span className="text-slate-500">expires {formatDate(m.inviteExpiresAt)}</span>
                    ) : m.createdAt ? (
                      <span className="text-slate-500">joined {formatDate(m.createdAt)}</span>
                    ) : null}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  {m.status === 'invited' ? (
                    <button
                      type="button"
                      onClick={() => resend(m)}
                      disabled={resendingId === m._id}
                      className="rounded-md border border-amber-500/40 px-2.5 py-1 text-xs text-amber-200 hover:bg-amber-950/30 disabled:opacity-50"
                    >
                      {resendingId === m._id ? 'Sending…' : 'Resend'}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => openEdit(m)}
                    className="rounded-md border border-slate-600 px-2.5 py-1 text-xs text-slate-200 hover:bg-slate-800"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setRemoveErr('');
                      setRemoving(m);
                    }}
                    disabled={self}
                    title={self ? 'You cannot remove yourself' : undefined}
                    className="rounded-md border border-red-500/40 px-2.5 py-1 text-xs text-red-300 hover:bg-red-950/30 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Remove
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <Modal
        open={inviteOpen}
        title={inviteResult ? 'Invite sent' : 'Add team member'}
        subtitle={inviteResult ? undefined : 'They receive an email to set their own password.'}
        onClose={() => setInviteOpen(false)}
        footer={
          inviteResult ? (
            <>
              <button type="button" onClick={openInvite} className={btnSecondary}>
                Invite another
              </button>
              <button type="button" onClick={() => setInviteOpen(false)} className={btnPrimary}>
                Done
              </button>
            </>
          ) : (
            <>
              <button type="button" onClick={() => setInviteOpen(false)} className={btnSecondary}>
                Cancel
              </button>
              <button type="submit" form="team-invite-form" disabled={inviteBusy} className={btnPrimary}>
                {inviteBusy ? 'Sending…' : 'Send invite'}
              </button>
            </>
          )
        }
      >
        {inviteResult ? (
          <div>
            <p className="text-sm text-slate-300">
              {inviteResult.emailSent ? (
                <>
                  An invite was emailed to <strong className="text-white">{inviteResult.email}</strong>.
                </>
              ) : (
                <>
                  <strong className="text-white">{inviteResult.email}</strong> was added, but the email did not send
                  (check SMTP). Share the link below instead.
                </>
              )}
            </p>
            <InviteLinkBox url={inviteResult.acceptUrl} onCopy={copyUrl} />
          </div>
        ) : (
          <form id="team-invite-form" onSubmit={submitInvite} className="space-y-4">
            <label className={labelCls}>
              Full name
              <input
                required
                autoFocus
                autoComplete="off"
                value={inviteForm.fullName}
                onChange={(e) => setInviteForm((f) => ({ ...f, fullName: e.target.value }))}
                className={inputCls}
              />
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className={labelCls}>
                Work email
                <input
                  type="email"
                  required
                  autoComplete="off"
                  value={inviteForm.email}
                  onChange={(e) => setInviteForm((f) => ({ ...f, email: e.target.value }))}
                  className={inputCls}
                />
              </label>
              <label className={labelCls}>
                Phone <span className="text-slate-600">(optional — router alerts by SMS)</span>
                <input
                  type="tel"
                  placeholder="024…"
                  value={inviteForm.phone}
                  onChange={(e) => setInviteForm((f) => ({ ...f, phone: e.target.value }))}
                  className={inputCls}
                />
              </label>
            </div>
            <div>
              <span className={labelCls}>Access</span>
              <RolePicker value={inviteForm.role} onChange={(role) => setInviteForm((f) => ({ ...f, role }))} />
            </div>
            {inviteErr ? <FormError>{inviteErr}</FormError> : null}
          </form>
        )}
      </Modal>

      <Modal
        open={Boolean(editing)}
        title="Edit team member"
        subtitle={editing ? editing.email : undefined}
        onClose={() => setEditing(null)}
        footer={
          <>
            <button type="button" onClick={() => setEditing(null)} className={btnSecondary}>
              Cancel
            </button>
            <button type="submit" form="team-edit-form" disabled={editBusy} className={btnPrimary}>
              {editBusy ? 'Saving…' : 'Save changes'}
            </button>
          </>
        }
      >
        {editing ? (
          <form id="team-edit-form" onSubmit={submitEdit} className="space-y-4">
            {editing.status === 'invited' ? (
              <p className="rounded-lg border border-amber-500/30 bg-amber-950/20 px-3 py-2 text-xs text-amber-100">
                Hasn&apos;t accepted the invite yet. Use <strong>Resend</strong> if they lost the email.
              </p>
            ) : null}
            <label className={labelCls}>
              Full name
              <input
                required
                value={editForm.fullName}
                onChange={(e) => setEditForm((f) => ({ ...f, fullName: e.target.value }))}
                className={inputCls}
              />
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className={labelCls}>
                Email
                <input
                  type="email"
                  required
                  value={editForm.email}
                  onChange={(e) => setEditForm((f) => ({ ...f, email: e.target.value }))}
                  className={inputCls}
                />
              </label>
              <label className={labelCls}>
                Phone <span className="text-slate-600">(blank to clear)</span>
                <input
                  type="tel"
                  placeholder="024…"
                  value={editForm.phone}
                  onChange={(e) => setEditForm((f) => ({ ...f, phone: e.target.value }))}
                  className={inputCls}
                />
              </label>
            </div>
            <div>
              <span className={labelCls}>Access</span>
              <RolePicker
                value={editForm.role}
                disabled={isSelf(editing)}
                onChange={(role) => setEditForm((f) => ({ ...f, role }))}
              />
              {isSelf(editing) ? (
                <p className="mt-1.5 text-[11px] text-slate-500">You can&apos;t change your own access level.</p>
              ) : null}
            </div>
            {editErr ? <FormError>{editErr}</FormError> : null}
          </form>
        ) : null}
      </Modal>

      <ConfirmModal
        open={Boolean(removing)}
        title="Remove team member?"
        danger
        confirmLabel="Remove"
        busy={removeBusy}
        error={removeErr}
        onClose={() => setRemoving(null)}
        onConfirm={confirmRemove}
        message={
          removing ? (
            <>
              <strong className="text-white">{displayName(removing)}</strong> ({removing.email}) will lose access to this
              organisation immediately.
            </>
          ) : null
        }
      />
    </section>
  );
}
