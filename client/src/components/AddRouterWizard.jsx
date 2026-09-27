import { useState } from 'react';
import { apiFetch } from '../api.js';

/**
 * Compact add-router modal: one screen, provision over Auto/SSH/API.
 */
export function AddRouterWizard({ onCreated, onCancel }) {
  const [siteName, setSiteName] = useState('');
  const [host, setHost] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [transport, setTransport] = useState('auto');
  const [allowRemoteAccess, setAllowRemoteAccess] = useState(true);
  const [allowLanAccess, setAllowLanAccess] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault();
    setError('');
    if (!siteName.trim() || siteName.trim().length < 2) {
      setError('Site name is required.');
      return;
    }
    if (!host.trim() || !username.trim() || !password) {
      setError('IP, username, and password are required.');
      return;
    }
    setBusy(true);
    try {
      const data = await apiFetch('/api/routers/provision', {
        method: 'POST',
        body: JSON.stringify({
          siteName: siteName.trim(),
          host: host.trim(),
          username: username.trim(),
          password,
          transport,
          allowRemoteAccess,
          allowLanAccess,
        }),
      });
      if (onCreated) onCreated(data);
    } catch (err) {
      setError(err.message || 'Could not add router');
    } finally {
      setBusy(false);
    }
  }

  const inputClass =
    'mt-1.5 w-full rounded-xl border border-slate-700/80 bg-slate-950 px-3 py-2.5 text-sm text-white outline-none placeholder:text-slate-600 focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20';

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/65 p-0 backdrop-blur-[2px] sm:items-center sm:p-4">
      <button type="button" className="absolute inset-0 cursor-default" aria-label="Close" onClick={onCancel} />
      <div className="relative z-10 flex max-h-[min(92dvh,92vh)] w-full max-w-md flex-col overflow-hidden rounded-t-2xl border border-slate-700/80 bg-slate-900 shadow-2xl sm:rounded-2xl">
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-800 px-4 py-4 sm:px-5">
          <div>
            <h3 className="text-base font-semibold text-white">Add router</h3>
            <p className="mt-0.5 text-xs text-slate-500">
              We’ll set up the VPN tunnel and save remote endpoints.
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg px-2.5 py-1.5 text-sm text-slate-400 hover:bg-slate-800 hover:text-white"
          >
            ✕
          </button>
        </div>

        <form
          onSubmit={submit}
          className="space-y-4 overflow-y-auto px-4 py-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:px-5"
        >
          <label className="block text-xs font-medium text-slate-400">
            Site name
            <input
              required
              autoFocus
              value={siteName}
              onChange={(e) => setSiteName(e.target.value)}
              placeholder="East Legon"
              className={inputClass}
            />
          </label>
          <label className="block text-xs font-medium text-slate-400">
            Router IP
            <input
              required
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder="192.168.88.1 or public IP"
              className={`${inputClass} font-mono`}
            />
          </label>
          <div className="grid grid-cols-1 gap-3 min-[400px]:grid-cols-2">
            <label className="block text-xs font-medium text-slate-400">
              Username
              <input
                required
                autoComplete="off"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className={inputClass}
              />
            </label>
            <label className="block text-xs font-medium text-slate-400">
              Password
              <input
                type="password"
                required
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={inputClass}
              />
            </label>
          </div>

          <div>
            <p className="mb-1.5 text-xs font-medium text-slate-400">Connect with</p>
            <div className="flex gap-1 rounded-xl bg-slate-950 p-1">
              {[
                { id: 'auto', label: 'Auto' },
                { id: 'ssh', label: 'SSH' },
                { id: 'api', label: 'API' },
              ].map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTransport(t.id)}
                  className={`min-h-9 flex-1 rounded-lg text-xs font-semibold transition ${
                    transport === t.id
                      ? 'bg-slate-700 text-white'
                      : 'text-slate-500 hover:text-slate-300'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-2.5 rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-3 text-sm text-slate-300">
            <label className="inline-flex items-center gap-2.5">
              <input
                type="checkbox"
                checked={allowRemoteAccess}
                onChange={(e) => setAllowRemoteAccess(e.target.checked)}
                className="rounded border-slate-600"
              />
              Allow remote access over VPN
            </label>
            <label className="inline-flex items-center gap-2.5">
              <input
                type="checkbox"
                checked={allowLanAccess}
                onChange={(e) => setAllowLanAccess(e.target.checked)}
                className="rounded border-slate-600"
              />
              Allow access to site LAN
            </label>
          </div>

          {error ? (
            <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-xs text-red-200">
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={busy}
            className="flex h-11 w-full items-center justify-center rounded-xl bg-emerald-600 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            {busy ? 'Connecting…' : 'Add router'}
          </button>
        </form>
      </div>
    </div>
  );
}
