import { useEffect, useState, useMemo } from 'react';
import { apiFetch } from '../api.js';

export function CustomersPage() {
  const [users, setUsers] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({
    email: '',
    phone: '',
    fullName: '',
    balanceCents: 0,
    autoRenewalEnabled: false,
  });

  async function load() {
    setError('');
    try {
      const list = await apiFetch('/api/users?limit=500');
      setUsers(Array.isArray(list) ? list : []);
    } catch (e) {
      setError(e.message || 'Failed to load customers');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) => {
      const blob = [u.fullName, u.phone, u.email].filter(Boolean).join(' ').toLowerCase();
      return blob.includes(q);
    });
  }, [users, search]);

  function openCreate() {
    setEditingId(null);
    setForm({
      email: '',
      phone: '',
      fullName: '',
      balanceCents: 0,
      autoRenewalEnabled: false,
    });
    setShowModal(true);
  }

  function openEdit(u) {
    setEditingId(u._id);
    setForm({
      email: u.email || '',
      phone: u.phone || '',
      fullName: u.fullName || '',
      balanceCents: u.balanceCents ?? 0,
      autoRenewalEnabled: !!u.autoRenewalEnabled,
    });
    setShowModal(true);
  }

  async function saveCustomer(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const payload = {
        email: form.email.trim() || undefined,
        phone: form.phone.trim() || undefined,
        fullName: form.fullName.trim() || undefined,
        balanceCents: Number(form.balanceCents) || 0,
        autoRenewalEnabled: form.autoRenewalEnabled,
      };
      if (editingId) {
        await apiFetch(`/api/users/${editingId}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
      } else {
        await apiFetch('/api/users', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      }
      setShowModal(false);
      await load();
    } catch (err) {
      setError(err.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function removeCustomer(u) {
    const ok = window.confirm(
      `Delete customer "${[u.fullName, u.phone, u.email].filter(Boolean).join(' · ') || u._id}"?\n\n` +
        'Linked PPPoE accounts will be unlinked (not deleted).'
    );
    if (!ok) return;
    setError('');
    try {
      await apiFetch(`/api/users/${u._id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setError(err.message || 'Delete failed');
    }
  }

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">Customers</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-400">
            This list is <strong className="text-slate-300">billing customers only</strong> (name, phone, wallet) — not
            MikroTik PPPoE logins. A new PPPoE <span className="font-mono text-slate-400">secret name</span> appears
            under <strong className="text-slate-300">Network → PPPoE</strong>. To tie Elvin&apos;s line to someone here,
            open that PPPoE account, enable <strong className="text-slate-300">Link to a billing customer</strong>, and
            pick this customer (or create the customer first, then link). Deleting a customer only unlinks PPPoE /
            related subscriptions.
          </p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="shrink-0 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500"
        >
          New customer
        </button>
      </div>

      {error && (
        <div
          className="mt-6 rounded-xl border border-red-500/35 bg-red-500/10 px-4 py-3 text-sm text-red-200"
          role="alert"
        >
          {error}
        </div>
      )}

      <div className="mt-8 rounded-2xl border border-slate-800/90 bg-slate-900/40 shadow-xl shadow-black/20">
        <div className="border-b border-slate-800/80 p-4">
          <input
            type="search"
            placeholder="Search name, phone, email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full max-w-md rounded-xl border border-slate-700/80 bg-slate-950/80 px-4 py-2.5 text-sm text-slate-200 placeholder:text-slate-600 outline-none ring-indigo-500/30 focus:border-indigo-500/40 focus:ring-2"
          />
          <p className="mt-2 text-xs text-slate-500">
            Showing {filtered.length} of {users.length}
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-800/80 text-xs font-semibold uppercase tracking-wider text-slate-500">
                <th className="px-5 py-3.5">Name</th>
                <th className="px-5 py-3.5">Phone</th>
                <th className="px-5 py-3.5">Email</th>
                <th className="px-5 py-3.5">Added</th>
                <th className="px-5 py-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-5 py-12 text-center text-slate-500">
                    Loading…
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-5 py-12 text-center text-slate-500">
                    {users.length === 0 ? 'No customers yet.' : 'No matches.'}
                  </td>
                </tr>
              ) : (
                filtered.map((u) => (
                  <tr key={u._id} className="text-slate-300 transition hover:bg-slate-800/30">
                    <td className="px-5 py-3.5">{u.fullName || '—'}</td>
                    <td className="px-5 py-3.5 font-mono text-sm text-slate-400">{u.phone || '—'}</td>
                    <td className="px-5 py-3.5 text-slate-400">{u.email || '—'}</td>
                    <td className="px-5 py-3.5 text-xs text-slate-500">
                      {u.createdAt ? new Date(u.createdAt).toLocaleString() : '—'}
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <button
                        type="button"
                        onClick={() => openEdit(u)}
                        className="mr-2 text-indigo-400 hover:text-indigo-300"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => removeCustomer(u)}
                        className="text-red-400/90 hover:text-red-300"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          onClick={() => !saving && setShowModal(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-semibold text-white">
              {editingId ? 'Edit customer' : 'New customer'}
            </h2>
            <form onSubmit={saveCustomer} className="mt-4 space-y-3">
              <label className="block text-sm text-slate-300">
                Full name
                <input
                  value={form.fullName}
                  onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
                />
              </label>
              <label className="block text-sm text-slate-300">
                Phone
                <input
                  type="tel"
                  value={form.phone}
                  onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-slate-100"
                />
              </label>
              <label className="block text-sm text-slate-300">
                Email
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
                />
              </label>
              <label className="block text-sm text-slate-300">
                Balance (minor units, e.g. pesewas)
                <input
                  type="number"
                  value={form.balanceCents}
                  onChange={(e) => setForm((f) => ({ ...f, balanceCents: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-slate-100"
                />
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-300">
                <input
                  type="checkbox"
                  checked={form.autoRenewalEnabled}
                  onChange={(e) => setForm((f) => ({ ...f, autoRenewalEnabled: e.target.checked }))}
                  className="rounded border-slate-600"
                />
                Auto-renewal enabled
              </label>
              <div className="flex gap-2 pt-2">
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {saving ? 'Saving…' : 'Save'}
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => setShowModal(false)}
                  className="rounded-xl border border-slate-600 px-4 py-2.5 text-sm text-slate-300 hover:bg-slate-800"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
