import { useCallback, useEffect, useState } from 'react';
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

/**
 * Org-admin self-serve team invites (uses /api/organization/admins).
 */
export function OrgTeamSection({ canManage, usage, limits }) {
  const [admins, setAdmins] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [info, setInfo] = useState('');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState('org_staff');
  const [creating, setCreating] = useState(false);
  const [lastAcceptUrl, setLastAcceptUrl] = useState('');

  const load = useCallback(async () => {
    if (!canManage) {
      setAdmins([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setErr('');
    try {
      const list = await apiFetch('/api/organization/admins');
      setAdmins(Array.isArray(list) ? list : []);
    } catch (e) {
      setErr(e.message || 'Could not load team');
      setAdmins([]);
    } finally {
      setLoading(false);
    }
  }, [canManage]);

  useEffect(() => {
    load();
  }, [load]);

  if (!canManage) {
    return (
      <section className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5">
        <h2 className="text-lg font-medium text-white">Team</h2>
        <p className="mt-2 text-sm text-slate-500">
          Only organisation admins can invite or remove team members.
        </p>
      </section>
    );
  }

  const maxAdmins = limits?.maxAdmins;
  const used = usage?.admins ?? admins.length;
  const atLimit = maxAdmins != null && used >= maxAdmins;

  async function copyUrl(url) {
    try {
      await navigator.clipboard.writeText(url);
      setInfo('Invite link copied.');
    } catch {
      setErr('Could not copy — select the link manually.');
    }
  }

  async function invite(e) {
    e.preventDefault();
    setCreating(true);
    setErr('');
    setInfo('');
    setLastAcceptUrl('');
    try {
      const created = await apiFetch('/api/organization/admins', {
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
      setRole('org_staff');
      if (created?.acceptUrl) setLastAcceptUrl(created.acceptUrl);
      setInfo(
        created?.emailSent
          ? `Invite emailed to ${created.email}.`
          : `Invite saved for ${created.email}. Email did not send — copy the link below.`
      );
      await load();
    } catch (e2) {
      setErr(e2.message || 'Invite failed');
    } finally {
      setCreating(false);
    }
  }

  async function resend(adminId) {
    setErr('');
    setInfo('');
    setLastAcceptUrl('');
    try {
      const r = await apiFetch(`/api/organization/admins/${adminId}/resend-invite`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      if (r?.acceptUrl) setLastAcceptUrl(r.acceptUrl);
      setInfo(
        r?.emailSent
          ? `Invite re-sent to ${r.email}`
          : `Invite refreshed. Copy the link below if email failed.`
      );
      await load();
    } catch (e) {
      setErr(e.message || 'Resend failed');
    }
  }

  async function remove(adminId) {
    if (!window.confirm('Remove this person from the organisation?')) return;
    setErr('');
    try {
      await apiFetch(`/api/organization/admins/${adminId}`, { method: 'DELETE' });
      await load();
    } catch (e) {
      setErr(e.message || 'Remove failed');
    }
  }

  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-medium text-white">Team</h2>
          <p className="mt-1 text-sm text-slate-500">
            Invite staff to help run this organisation. They set their own password from the email
            link.
          </p>
        </div>
        <p className="text-xs text-slate-500">
          {used}
          {maxAdmins != null ? ` / ${maxAdmins}` : ''} members
        </p>
      </div>

      {err ? (
        <p className="mt-3 rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          {err}
        </p>
      ) : null}
      {info ? (
        <p className="mt-3 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-100">
          {info}
        </p>
      ) : null}
      {lastAcceptUrl ? (
        <div className="mt-3 rounded-xl border border-amber-500/30 bg-amber-950/20 px-3 py-3 text-sm">
          <p className="font-medium text-amber-50">Invite link</p>
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

      <form onSubmit={invite} className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="block text-xs text-slate-400 sm:col-span-2">
          Full name
          <input
            required
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white"
          />
        </label>
        <label className="block text-xs text-slate-400">
          Work email
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white"
          />
        </label>
        <label className="block text-xs text-slate-400">
          Phone <span className="text-slate-600">(optional)</span>
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="024…"
            className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white"
          />
        </label>
        <label className="block text-xs text-slate-400 sm:col-span-2">
          Access
          <select
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white"
          >
            <option value="org_staff">Staff — day-to-day operations</option>
            <option value="org_admin">Organisation admin — full access</option>
          </select>
        </label>
        <button
          type="submit"
          disabled={creating || atLimit}
          className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50 sm:col-span-2 sm:w-fit"
        >
          {atLimit ? 'Team limit reached' : creating ? 'Sending…' : 'Email invite'}
        </button>
      </form>

      <div className="mt-6 border-t border-slate-800 pt-4">
        <h3 className="text-sm font-medium text-slate-200">People</h3>
        {loading ? (
          <p className="mt-3 text-sm text-slate-500">Loading…</p>
        ) : admins.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">No one invited yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-slate-800">
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
                      {a.status === 'invited' ? 'Pending' : 'Active'}
                    </span>
                  </p>
                  {a.status === 'invited' && a.inviteExpiresAt ? (
                    <p className="mt-1 text-[11px] text-slate-500">
                      Expires {formatExpiry(a.inviteExpiresAt)}
                    </p>
                  ) : null}
                </div>
                <div className="flex shrink-0 gap-2">
                  {a.status === 'invited' ? (
                    <button
                      type="button"
                      onClick={() => resend(a._id)}
                      className="rounded-lg border border-amber-500/40 px-2.5 py-1 text-xs text-amber-200 hover:bg-amber-950/30"
                    >
                      Resend
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => remove(a._id)}
                    className="rounded-lg border border-red-500/40 px-2.5 py-1 text-xs text-red-300 hover:bg-red-950/30"
                  >
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
