import { useEffect, useState } from 'react';
import { apiFetch } from '../api.js';

/** Change password for any signed-in admin (org settings may be module-gated). */
export function AccountPage() {
  const [email, setEmail] = useState('');
  const [pwdCurrent, setPwdCurrent] = useState('');
  const [pwdNew, setPwdNew] = useState('');
  const [pwdBusy, setPwdBusy] = useState(false);
  const [pwdMsg, setPwdMsg] = useState('');
  const [pwdErr, setPwdErr] = useState('');

  useEffect(() => {
    apiFetch('/api/auth/me')
      .then((m) => setEmail(String(m?.admin?.email || '')))
      .catch(() => setEmail(''));
  }, []);

  async function changePassword(e) {
    e.preventDefault();
    setPwdBusy(true);
    setPwdErr('');
    setPwdMsg('');
    try {
      await apiFetch('/api/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({
          currentPassword: pwdCurrent,
          newPassword: pwdNew,
        }),
      });
      setPwdCurrent('');
      setPwdNew('');
      setPwdMsg('Password updated.');
    } catch (e2) {
      setPwdErr(e2.message || 'Could not update password');
    } finally {
      setPwdBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-md space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-white">Account</h1>
        <p className="mt-1 text-sm text-slate-400">Your sign-in details for this dashboard.</p>
      </div>

      <section className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
        <h2 className="text-lg font-semibold text-white">Login password</h2>
        {email ? <p className="mt-1 text-xs text-slate-500">{email}</p> : null}
        <form onSubmit={changePassword} className="mt-4 space-y-3">
          {pwdErr && (
            <p className="rounded-lg border border-red-500/35 bg-red-500/10 px-3 py-2 text-sm text-red-200">
              {pwdErr}
            </p>
          )}
          {pwdMsg && (
            <p className="rounded-lg border border-emerald-500/30 bg-emerald-950/25 px-3 py-2 text-sm text-emerald-100">
              {pwdMsg}
            </p>
          )}
          <label className="block text-sm text-slate-300">
            Current password
            <input
              type="password"
              autoComplete="current-password"
              value={pwdCurrent}
              onChange={(e) => setPwdCurrent(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white"
            />
          </label>
          <label className="block text-sm text-slate-300">
            New password
            <input
              type="password"
              autoComplete="new-password"
              minLength={8}
              value={pwdNew}
              onChange={(e) => setPwdNew(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white"
            />
          </label>
          <button
            type="submit"
            disabled={pwdBusy || !pwdCurrent || pwdNew.length < 8}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            {pwdBusy ? 'Updating…' : 'Update password'}
          </button>
        </form>
      </section>
    </div>
  );
}
