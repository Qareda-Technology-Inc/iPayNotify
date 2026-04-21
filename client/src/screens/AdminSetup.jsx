import { useState } from 'react';
import { setToken, setActingOrganizationId } from '../authStorage.js';
import { publicFetch } from '../api.js';

export function AdminSetup({ onDone }) {
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    if (password !== password2) {
      setError('Passwords do not match');
      return;
    }
    setLoading(true);
    try {
      const body = { email, password };
      if (phone.trim()) body.phone = phone.trim();
      const data = await publicFetch('/api/auth/setup', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      setToken(data.token);
      setActingOrganizationId(null);
      onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-md px-4 py-16">
      <h1 className="text-xl font-semibold text-white">QareFi Billing</h1>
      <p className="mt-2 text-sm text-slate-400">
        Create the first super administrator (only if no default admin was seeded on the server).
      </p>
      <form onSubmit={onSubmit} className="mt-8 space-y-4">
        <label className="block text-sm">
          <span className="text-slate-300">Email</span>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-slate-100 outline-none ring-emerald-500/40 focus:ring-2"
          />
        </label>
        <label className="block text-sm">
          <span className="text-slate-300">Phone (optional, Ghana — for SMS login codes)</span>
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-slate-100 outline-none ring-emerald-500/40 focus:ring-2"
          />
        </label>
        <label className="block text-sm">
          <span className="text-slate-300">Password (min 8 characters)</span>
          <input
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 outline-none ring-emerald-500/40 focus:ring-2"
          />
        </label>
        <label className="block text-sm">
          <span className="text-slate-300">Confirm password</span>
          <input
            type="password"
            required
            value={password2}
            onChange={(e) => setPassword2(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 outline-none ring-emerald-500/40 focus:ring-2"
          />
        </label>
        {error && (
          <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg bg-emerald-600 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
        >
          {loading ? 'Creating…' : 'Create admin & continue'}
        </button>
      </form>
    </div>
  );
}
