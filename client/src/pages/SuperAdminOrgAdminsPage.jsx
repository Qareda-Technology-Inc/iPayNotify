import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { apiFetch } from '../api.js';

const ROLE_LABEL = {
  org_admin: 'Admin',
  ticket_manager: 'Tickets',
  org_staff: 'Staff',
};

export function SuperAdminOrgAdminsPage() {
  const { orgId } = useParams();
  const [org, setOrg] = useState(null);
  const [admins, setAdmins] = useState([]);
  const [err, setErr] = useState('');
  const [info, setInfo] = useState('');
  const [loading, setLoading] = useState(true);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('org_admin');
  const [creating, setCreating] = useState(false);

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

  function openEdit(a) {
    setEditAdmin(a);
    setEditFullName(a.fullName || '');
    setEditEmail(a.email || '');
    setEditRole(a.role || 'org_admin');
    setEditOpen(true);
    setErr('');
  }

  function closeEdit() {
    setEditOpen(false);
    setEditAdmin(null);
  }

  async function inviteAdmin(e) {
    e.preventDefault();
    setCreating(true);
    setErr('');
    setInfo('');
    try {
      const created = await apiFetch(`/api/super-admin/organizations/${orgId}/admins`, {
        method: 'POST',
        body: JSON.stringify({
          fullName: fullName.trim(),
          email: email.trim(),
          role,
        }),
      });
      setFullName('');
      setEmail('');
      setRole('org_admin');
      setInfo(
        created?.emailSent
          ? `Invite emailed to ${created.email}. They will set their own password from the link.`
          : `Invite saved for ${created.email}, but email did not send. Check SMTP, then use Resend.`
      );
      await load();
    } catch (e) {
      setErr(e.message || 'Invite failed');
    } finally {
      setCreating(false);
    }
  }

  async function resendInvite(adminId) {
    setErr('');
    setInfo('');
    try {
      const r = await apiFetch(
        `/api/super-admin/organizations/${orgId}/admins/${adminId}/resend-invite`,
        { method: 'POST', body: JSON.stringify({}) }
      );
      setInfo(
        r?.emailSent
          ? `Invite re-sent to ${r.email}`
          : `Invite refreshed for ${r.email}. Email did not send — check SMTP.`
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
    } catch (e) {
      setErr(e.message || 'Save failed');
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
              Invite people to manage <strong className="text-slate-200">{org.name}</strong>. They get an email and
              create their own password.
            </>
          ) : loading ? (
            'Loading…'
          ) : (
            'Organisation not found'
          )}
        </p>
      </div>

      {err && (
        <p className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">{err}</p>
      )}
      {info && (
        <p className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
          {info}
        </p>
      )}

      <section className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
        <h2 className="text-lg font-medium text-white">Send invite</h2>
        <form onSubmit={inviteAdmin} className="mt-4 space-y-4">
          <label className="block text-sm text-slate-300">
            Full name
            <input
              type="text"
              required
              autoComplete="name"
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
            Access
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
            >
              <option value="org_admin">Organisation admin — full dashboard</option>
              <option value="ticket_manager">Ticket manager — tickets only</option>
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
                </div>
                <div className="flex shrink-0 gap-2">
                  {a.status === 'invited' && (
                    <button
                      type="button"
                      onClick={() => resendInvite(a._id)}
                      className="rounded-lg border border-amber-500/40 px-2.5 py-1 text-xs text-amber-200 hover:bg-amber-950/30"
                    >
                      Resend email
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
                They still need to open the invite email to set a password. Use Resend email if they lost the link.
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
                  <option value="ticket_manager">Ticket manager</option>
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
