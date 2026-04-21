import { useState } from 'react';
import { apiFetch } from '../api.js';

export function CreateRouter({ onCreated }) {
  const [name, setName] = useState('Main router');
  const [host, setHost] = useState('');
  const [connectPort, setConnectPort] = useState(22);
  const [apiUser, setApiUser] = useState('');
  const [apiPassword, setApiPassword] = useState('');
  const [defaultPppProfile, setDefaultPppProfile] = useState('default');
  const [expiredPppProfile, setExpiredPppProfile] = useState('nonpayment');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const port = Number(connectPort) || 22;
      await apiFetch('/api/routers', {
        method: 'POST',
        body: JSON.stringify({
          name,
          host: port === 22 ? host : `${host}:${port}`,
          transport: 'ssh',
          sshPort: port,
          apiUser,
          apiPassword,
          defaultPppProfile,
          expiredPppProfile,
        }),
      });
      onCreated();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-10">
      <h1 className="text-xl font-semibold text-white">Add a router</h1>
      <p className="mt-2 text-sm text-slate-400">
        Create the router record before you can manage PPPoE or hotspot vouchers. Connection uses{' '}
        <strong>SSH</strong> (same as MikroTicket). Use a user that can run the same commands as in
        the terminal for <code className="text-emerald-400">/ppp/secret</code> and{' '}
        <code className="text-emerald-400">/ip/hotspot/user</code>.
      </p>
      <form onSubmit={onSubmit} className="mt-8 space-y-4">
        <label className="block text-sm">
          <span className="text-slate-300">Label</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 outline-none ring-emerald-500/40 focus:ring-2"
          />
        </label>
        <label className="block text-sm">
          <span className="text-slate-300">Host / IP</span>
          <input
            value={host}
            onChange={(e) => setHost(e.target.value)}
            required
            placeholder="192.168.88.1"
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 outline-none ring-emerald-500/40 focus:ring-2"
          />
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="text-slate-300">SSH port</span>
            <input
              type="number"
              value={connectPort}
              onChange={(e) => setConnectPort(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 outline-none ring-emerald-500/40 focus:ring-2"
            />
          </label>
          <label className="block text-sm">
            <span className="text-slate-300">Login (SSH)</span>
            <input
              value={apiUser}
              onChange={(e) => setApiUser(e.target.value)}
              required
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 outline-none ring-emerald-500/40 focus:ring-2"
            />
          </label>
        </div>
        <label className="block text-sm">
          <span className="text-slate-300">Password</span>
          <input
            type="password"
            value={apiPassword}
            onChange={(e) => setApiPassword(e.target.value)}
            required
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 outline-none ring-emerald-500/40 focus:ring-2"
          />
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="text-slate-300">Active PPP profile</span>
            <input
              value={defaultPppProfile}
              onChange={(e) => setDefaultPppProfile(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 outline-none ring-emerald-500/40 focus:ring-2"
            />
          </label>
          <label className="block text-sm">
            <span className="text-slate-300">Expired profile (e.g. nonpayment)</span>
            <input
              value={expiredPppProfile}
              onChange={(e) => setExpiredPppProfile(e.target.value)}
              placeholder="nonpayment"
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 outline-none ring-emerald-500/40 focus:ring-2"
            />
          </label>
        </div>
        {error && (
          <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={loading}
          className="rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
        >
          {loading ? 'Saving…' : 'Save router'}
        </button>
      </form>
    </div>
  );
}
