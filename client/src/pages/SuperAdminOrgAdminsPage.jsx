import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { apiFetch } from '../api.js';

const ROLE_LABEL = {
  org_admin: 'Admin',
  org_staff: 'Staff',
  ticket_manager: 'Staff',
};

function formatExpiry(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return '';
  }
}

export function SuperAdminOrgAdminsPage() {
  const { orgId } = useParams();
  const [searchParams] = useSearchParams();
  const inviteFocus = searchParams.get('invite') === '1';
  const inviteFormRef = useRef(null);

  const [org, setOrg] = useState(null);
  const [admins, setAdmins] = useState([]);
  const [err, setErr] = useState('');
  const [info, setInfo] = useState('');
  const [loading, setLoading] = useState(true);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState('org_admin');
  const [creating, setCreating] = useState(false);
  const [lastAcceptUrl, setLastAcceptUrl] = useState('');

  const [editOpen, setEditOpen] = useState(false);
  const [editAdmin, setEditAdmin] = useState(null);
  const [editFullName, setEditFullName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editRole, setEditRole] = useState('org_admin');
  const [savingEdit, setSavingEdit] = useState(false);

  const load = useCallback(async () => {
    if (!orgId) return;
    setErr('');
    setLoading(true);
    try {
      const [orgs, list] = await Promise.all([
        apiFetch('/api/super-admin/organizations'),
        apiFetch(`/api/super-admin/organizations/${orgId}/admins`),
      ]);
      const o = (Array.isArray(orgs) ? orgs : []).find((x) => String(x._id) === String(orgId));
      setOrg(o || null);
      setAdmins(Array.isArray(list) ? list : []);
    } catch (e) {
      setErr(e.message || 'Load failed');
      setOrg(null);
      setAdmins([]);
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!inviteFocus || loading) return;
    inviteFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [inviteFocus, loading]);

  function openEdit(a) {
    setEditAdmin(a);
    setEditFullName(a.fullName || '');
    setEditEmail(a.email || '');
    const r = a.role || 'org_admin';
    setEditRole(r === 'ticket_manager' ? 'org_staff' : r);
    setEditOpen(true);
    setErr('');
  }

  function closeEdit() {
    setEditOpen(false);
    setEditAdmin(null);
  }

  async function copyUrl(url) {
    try {
      await navigator.clipboard.writeText(url);
      setInfo('Invite link copied. Share it with them if email did not arrive.');
    } catch {
      setErr('Could not copy link — select it manually below.');
    }
  }

  async function inviteAdmin(e) {
    e.preventDefault();
    setCreating(true);
    setErr('');
    setInfo('');
    setLastAcceptUrl('');
    try {
      const created = await apiFetch(`/api/super-admin/organizations/${orgId}/admins`, {
        method: 'POST',
        body: JSON.stringify({
          fullName: fullName.trim(),
          email: email.trim(),
          role,
          ...(phone.trim() ? { phone: phone.trim() } : {}),
        }),
      });
      setFullName('');
      setEmail('');
      setPhone('');
      setRole('org_admin');
      if (created?.acceptUrl) setLastAcceptUrl(created.acceptUrl);
      setInfo(
        created?.emailSent
          ? `Invite emailed to ${created.email}. They will set their own password from the link.`
          : `Invite saved for ${created.email}, but email did not send. Copy the invite link below (check SMTP).`
      );
      await load();
    } catch (e2) {
      setErr(e2.message || 'Invite failed');
    } finally {
      setCreating(false);
    }
  }

  async function resendInvite(adminId) {
    setErr('');
    setInfo('');
    setLastAcceptUrl('');
    try {
      const r = await apiFetch(
        `/api/super-admin/organizations/${orgId}/admins/${adminId}/resend-invite`,
        { method: 'POST', body: JSON.stringify({}) }
      );
      if (r?.acceptUrl) setLastAcceptUrl(r.acceptUrl);
      setInfo(
        r?.emailSent
          ? `Invite re-sent to ${r.email}`
          : `Invite refreshed for ${r.email}. Email did not send — copy the link below.`
      );
      await load();
    } catch (e) {
      setErr(e.message || 'Resend failed');
    }
  }

  async function saveEdit(e) {
    e.preventDefault();
    if (!editAdmin) return;
    setSavingEdit(true);
    setErr('');
    try {
      await apiFetch(`/api/super-admin/organizations/${orgId}/admins/${editAdmin._id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          fullName: editFullName.trim(),
          email: editEmail.trim(),
          role: editRole,
        }),
      });
      closeEdit();
      await load();
    } catch (e2) {
      setErr(e2.message || 'Save failed');
    } finally {
      setSavingEdit(false);
    }
  }

  async function deleteAdmin(adminId) {
    if (!window.confirm('Remove this person from the organisation?')) return;
    setErr('');
    try {
      await apiFetch(`/api/super-admin/organizations/${orgId}/admins/${adminId}`, {
        method: 'DELETE',
      });
      await load();
    } catch (e) {
      setErr(e.message || 'Delete failed');
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <div>
        <Link to="/super/organizations" className="text-sm text-indigo-400 hover:text-indigo-300">
          ← Organisations
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-white">Team invites</h1>
        <p className="mt-1 text-sm text-slate-400">
          {org ? (
            <>
              Invite people to manage <strong className="text-slate-200">{org.name}</strong>. They get an
              email and create their own password.
            </>
          ) : loading ? (
            'Loading…'
          ) : (
            'Organisation not found'
          )}
        </p>
        {inviteFocus ? (
          <p className="mt-2 rounded-lg border border-indigo-500/30 bg-indigo-950/30 px-3 py-2 text-xs text-indigo-100">
            Organisation created — invite the first admin below so they can sign in.
          </p>
        ) : null}
      </div>

      {err && (
        <p className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {err}
        </p>
      )}
      {info && (
        <p className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
          {info}
        </p>
      )}
      {lastAcceptUrl ? (
        <div className="rounded-xl border border-amber-500/30 bg-amber-950/20 px-4 py-3 text-sm">
          <p className="font-medium text-amber-50">Invite link (share once)</p>
          <p className="mt-1 break-all font-mono text-[11px] text-amber-100/90 select-all">
            {lastAcceptUrl}
          </p>
          <button
            type="button"
            onClick={() => copyUrl(lastAcceptUrl)}
            className="mt-2 rounded-lg border border-amber-500/40 px-3 py-1.5 text-xs text-amber-50 hover:bg-amber-900/40"
          >
            Copy link
          </button>
        </div>
      ) : null}

      <section
        ref={inviteFormRef}
        className={`rounded-2xl border bg-slate-900/40 p-6 ${
          inviteFocus ? 'border-indigo-500/40 ring-1 ring-indigo-500/20' : 'border-slate-800'
        }`}
      >
        <h2 className="text-lg font-medium text-white">Send invite</h2>
        <form onSubmit={inviteAdmin} className="mt-4 space-y-4">
          <label className="block text-sm text-slate-300">
            Full name
            <input
              type="text"
              required
              autoComplete="name"
              autoFocus={inviteFocus}
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
            />
          </label>
          <label className="block text-sm text-slate-300">
            Work email
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
            />
          </label>
          <label className="block text-sm text-slate-300">
            Phone <span className="text-slate-500">(optional, Ghana)</span>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="024…"
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
            />
          </label>
          <label className="block text-sm text-slate-300">
            Access
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
            >
              <option value="org_admin">Organisation admin — full dashboard</option>
              <option value="org_staff">Staff — day-to-day operations</option>
            </select>
          </label>
          <button
            type="submit"
            disabled={creating || !org}
            className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            {creating ? 'Sending…' : 'Email invite'}
          </button>
        </form>
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
        <h2 className="text-lg font-medium text-white">People</h2>
        {loading ? (
          <p className="mt-4 text-sm text-slate-500">Loading…</p>
        ) : admins.length === 0 ? (
          <p className="mt-4 text-sm text-slate-500">No one invited yet.</p>
        ) : (
          <ul className="mt-4 divide-y divide-slate-800">
            {admins.map((a) => (
              <li key={a._id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-white">
                    {String(a.fullName || '').trim() || a.email}
                  </p>
                  <p className="truncate text-sm text-slate-400">{a.email}</p>
                  {a.phone ? (
                    <p className="mt-0.5 font-mono text-xs text-slate-500">{a.phone}</p>
                  ) : null}
                  <p className="mt-1 flex flex-wrap gap-1.5 text-[10px] uppercase tracking-wide">
                    <span className="rounded bg-slate-800 px-1.5 py-0.5 text-slate-400">
                      {ROLE_LABEL[a.role] || a.role}
                    </span>
                    <span
                      className={`rounded px-1.5 py-0.5 ${
                        a.status === 'invited'
                          ? 'bg-amber-500/15 text-amber-200'
                          : 'bg-emerald-500/15 text-emerald-200'
                      }`}
                    >
                      {a.status === 'invited' ? 'Pending invite' : 'Active'}
                    </span>
                  </p>
                  {a.status === 'invited' && a.inviteExpiresAt ? (
                    <p className="mt-1 text-[11px] text-slate-500">
                      Expires {formatExpiry(a.inviteExpiresAt)}
                    </p>
                  ) : null}
                </div>
                <div className="flex shrink-0 gap-2">
                  {a.status === 'invited' && (
                    <button
                      type="button"
                      onClick={() => resendInvite(a._id)}
                      className="rounded-lg border border-amber-500/40 px-2.5 py-1 text-xs text-amber-200 hover:bg-amber-950/30"
                    >
                      Resend / copy link
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => openEdit(a)}
                    className="rounded-lg border border-slate-600 px-2.5 py-1 text-xs text-slate-200 hover:bg-slate-800/50"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteAdmin(a._id)}
                    className="rounded-lg border border-red-500/40 px-2.5 py-1 text-xs text-red-300 hover:bg-red-950/30"
                  >
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {editOpen && editAdmin && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-admin-title"
          onClick={() => closeEdit()}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="edit-admin-title" className="text-lg font-semibold text-white">
              Edit person
            </h2>
            {editAdmin.status === 'invited' ? (
              <p className="mt-2 text-xs text-slate-500">
                They still need to open the invite email to set a password. Use Resend / copy link if
                they lost it.
              </p>
            ) : null}
            <form onSubmit={saveEdit} className="mt-4 space-y-4">
              <label className="block text-sm text-slate-300">
                Full name
                <input
                  type="text"
                  required
                  autoComplete="name"
                  value={editFullName}
                  onChange={(e) => setEditFullName(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
                />
              </label>
              <label className="block text-sm text-slate-300">
                Email
                <input
                  type="email"
                  required
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
                />
              </label>
              <label className="block text-sm text-slate-300">
                Access
                <select
                  value={editRole}
                  onChange={(e) => setEditRole(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
                >
                  <option value="org_admin">Organisation admin</option>
                  <option value="org_staff">Staff</option>
                </select>
              </label>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={closeEdit}
                  className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingEdit}
                  className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
                >
                  {savingEdit ? 'Saving…' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
