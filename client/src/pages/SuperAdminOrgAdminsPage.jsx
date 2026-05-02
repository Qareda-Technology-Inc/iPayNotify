import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { apiFetch } from '../api.js';

export function SuperAdminOrgAdminsPage() {
  const { orgId } = useParams();
  const [org, setOrg] = useState(null);
  const [admins, setAdmins] = useState([]);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('org_admin');
  const [creating, setCreating] = useState(false);

  const [editOpen, setEditOpen] = useState(false);
  const [editAdmin, setEditAdmin] = useState(null);
  const [editFullName, setEditFullName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editPassword, setEditPassword] = useState('');
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
    setEditEmail(a.email || '');
    setEditPhone(a.phone || '');
    setEditPassword('');
    setEditRole(a.role || 'org_admin');
    setEditOpen(true);
    setErr('');
  }

  function closeEdit() {
    setEditOpen(false);
    setEditAdmin(null);
    setEditPassword('');
  }

  async function createAdmin(e) {
    e.preventDefault();
    setCreating(true);
    setErr('');
    try {
      const body = { fullName: fullName.trim(), email: email.trim(), password };
      body.role = role;
      if (phone.trim()) body.phone = phone.trim();
      await apiFetch(`/api/super-admin/organizations/${orgId}/admins`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      setFullName('');
      setEmail('');
      setPhone('');
      setPassword('');
      setRole('org_admin');
      await load();
    } catch (e) {
      setErr(e.message || 'Create failed');
    } finally {
      setCreating(false);
    }
  }

  async function saveEdit(e) {
    e.preventDefault();
    if (!editAdmin) return;
    setSavingEdit(true);
    setErr('');
    try {
      const body = {
        fullName: editFullName.trim(),
        email: editEmail.trim(),
        phone: editPhone.trim(),
        role: editRole,
      };
      if (editPassword.trim().length > 0) {
        body.password = editPassword;
      }
      await apiFetch(`/api/super-admin/organizations/${orgId}/admins/${editAdmin._id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
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
    if (!window.confirm('Remove this organisation administrator?')) return;
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
        <h1 className="mt-2 text-2xl font-semibold text-white">Organisation admins</h1>
        <p className="mt-1 text-sm text-slate-400">
          {org ? (
            <>
              <strong className="text-slate-300">{org.name}</strong>{' '}
              <span className="font-mono text-slate-500">({org.slug})</span>
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

      <section className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
        <h2 className="text-lg font-medium text-white">Invite administrator</h2>
        <p className="mt-1 text-xs text-slate-500">
          Create organisation admins, ticket managers, or organisation staff for this organisation. Add a Ghana phone for
          SMS login codes when verification is enabled.
        </p>
        <form onSubmit={createAdmin} className="mt-4 space-y-4">
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
            Email
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
            />
          </label>
          <label className="block text-sm text-slate-300">
            Role
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
            >
              <option value="org_admin">Organisation admin</option>
              <option value="ticket_manager">Ticket manager</option>
              <option value="org_staff">Organisation staff</option>
            </select>
          </label>
          <label className="block text-sm text-slate-300">
            Phone <span className="text-slate-500">(optional, Ghana 0XX… or 233…)</span>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="0244…"
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
            />
          </label>
          <label className="block text-sm text-slate-300">
            Password (min 8 characters)
            <input
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
            />
          </label>
          <button
            type="submit"
            disabled={creating || !org}
            className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            {creating ? 'Creating…' : 'Create admin'}
          </button>
        </form>
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
        <h2 className="text-lg font-medium text-white">Administrators</h2>
        {loading ? (
          <p className="mt-4 text-sm text-slate-500">Loading…</p>
        ) : admins.length === 0 ? (
          <p className="mt-4 text-sm text-slate-500">No organisation admins yet.</p>
        ) : (
          <ul className="mt-4 divide-y divide-slate-800">
            {admins.map((a) => (
              <li key={a._id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-white">
                    {String(a.fullName || '').trim() || a.email}
                  </p>
                  <p className="text-sm text-slate-300">
                    {a.email}{' '}
                    <span className="ml-2 rounded bg-slate-800 px-1.5 py-0.5 text-[10px] uppercase text-slate-400">
                      {a.role === 'ticket_manager'
                        ? 'Ticket manager'
                        : a.role === 'org_staff'
                          ? 'Org staff'
                          : 'Org admin'}
                    </span>
                  </p>
                  {a.phone ? (
                    <p className="mt-0.5 font-mono text-xs text-slate-500">{a.phone}</p>
                  ) : (
                    <p className="mt-0.5 text-xs text-slate-600">No phone</p>
                  )}
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    onClick={() => openEdit(a)}
                    className="rounded-lg border border-slate-600 px-2 py-1 text-xs text-slate-200 hover:bg-slate-800/50"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteAdmin(a._id)}
                    className="rounded-lg border border-red-500/40 px-2 py-1 text-xs text-red-300 hover:bg-red-950/30"
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
              Edit administrator
            </h2>
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
                Role
                <select
                  value={editRole}
                  onChange={(e) => setEditRole(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
                >
                  <option value="org_admin">Organisation admin</option>
                  <option value="ticket_manager">Ticket manager</option>
                  <option value="org_staff">Organisation staff</option>
                </select>
              </label>
              <label className="block text-sm text-slate-300">
                Phone <span className="text-slate-500">(optional)</span>
                <input
                  type="tel"
                  value={editPhone}
                  onChange={(e) => setEditPhone(e.target.value)}
                  placeholder="Clear to remove"
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
                />
              </label>
              <label className="block text-sm text-slate-300">
                New password <span className="text-slate-500">(optional, min 8 if set)</span>
                <input
                  type="password"
                  minLength={8}
                  value={editPassword}
                  onChange={(e) => setEditPassword(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
                />
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
