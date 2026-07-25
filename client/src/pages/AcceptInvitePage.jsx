import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { publicFetch } from '../api.js';
import { setToken, setActingOrganizationId } from '../authStorage.js';

export function AcceptInvitePage({ onDone }) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = useMemo(() => String(params.get('token') || '').trim(), [params]);
  const [preview, setPreview] = useState(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!token) {
      setErr('Missing invite token');
      setLoading(false);
      return;
    }
    setLoading(true);
    publicFetch(`/api/auth/invite/${encodeURIComponent(token)}`)
      .then(setPreview)
      .catch((e) => {
        setPreview(null);
        setErr(e.message || 'Invite is invalid or expired');
      })
      .finally(() => setLoading(false));
  }, [token]);

  async function onSubmit(e) {
    e.preventDefault();
    setErr('');
    if (password.length < 8) {
      setErr('Password must be at least 8 characters');
      return;
    }
    if (password !== confirm) {
      setErr('Passwords do not match');
      return;
    }
    setSaving(true);
    try {
      const data = await publicFetch('/api/auth/invite/accept', {
        method: 'POST',
        body: JSON.stringify({ token, password }),
      });
      if (data?.token) {
        setToken(data.token);
        setActingOrganizationId(null);
      }
      if (typeof onDone === 'function') onDone();
      else navigate('/', { replace: true });
    } catch (e2) {
      setErr(e2.message || 'Could not accept invite');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900/70 p-6 shadow-xl">
        <h1 className="text-xl font-semibold text-white">Accept invite</h1>
        {loading ? (
          <p className="mt-3 text-sm text-slate-400">Checking invite…</p>
        ) : preview ? (
          <>
            <p className="mt-2 text-sm text-slate-400">
              Set a password for <span className="text-slate-200">{preview.email}</span>
              {preview.organizationName ? (
                <>
                  {' '}
                  to join <span className="text-slate-200">{preview.organizationName}</span>
                </>
              ) : null}
              .
            </p>
            <form onSubmit={onSubmit} className="mt-6 space-y-4">
              <label className="block text-sm text-slate-300">
                Password
                <input
                  type="password"
                  required
                  minLength={8}
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
                />
              </label>
              <label className="block text-sm text-slate-300">
                Confirm password
                <input
                  type="password"
                  required
                  minLength={8}
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
                />
              </label>
              {err && (
                <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                  {err}
                </p>
              )}
              <button
                type="submit"
                disabled={saving}
                className="w-full rounded-xl bg-indigo-600 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Activate account'}
              </button>
            </form>
          </>
        ) : (
          <p className="mt-3 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
            {err || 'Invite link is invalid or has expired'}
          </p>
        )}
      </div>
    </div>
  );
}
