import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../api.js';

const STATUSES = ['active', 'trial', 'past_due', 'suspended'];

function billingFromOrg(o) {
  const b = o?.billing || {};
  return {
    merchantDisplayName: String(b.merchantDisplayName || ''),
    smsBrandName: String(b.smsBrandName || ''),
    platformFeePercent: b.platformFeePercent != null ? Number(b.platformFeePercent) : null,
    platformFeeBps: b.platformFeeBps,
    defaultPlatformFeePercent:
      b.defaultPlatformFeePercent != null ? Number(b.defaultPlatformFeePercent) : null,
    payoutMomoNumber: String(b.payoutMomoNumber || ''),
    payoutNote: String(b.payoutNote || ''),
  };
}

export function OrganizationSettingsPage() {
  const [me, setMe] = useState(null);
  const [org, setOrg] = useState(null);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [status, setStatus] = useState('active');
  const [bill, setBill] = useState(billingFromOrg(null));
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pwdCurrent, setPwdCurrent] = useState('');
  const [pwdNew, setPwdNew] = useState('');
  const [pwdBusy, setPwdBusy] = useState(false);
  const [pwdMsg, setPwdMsg] = useState('');
  const [pwdErr, setPwdErr] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const isSuper = me?.admin?.role === 'super_admin';

  const load = useCallback(async () => {
    setErr('');
    setLoading(true);
    try {
      const [m, o] = await Promise.all([apiFetch('/api/auth/me'), apiFetch('/api/organization')]);
      setMe(m);
      setOrg(o);
      setName(String(o?.name || ''));
      setSlug(String(o?.slug || ''));
      setStatus(STATUSES.includes(o?.status) ? o.status : 'active');
      setBill(billingFromOrg(o));
    } catch (e) {
      setErr(e.message || 'Could not load organisation');
      setOrg(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function save(e) {
    e.preventDefault();
    if (!org?._id) return;
    setSaving(true);
    setErr('');
    try {
      const body = {
        name: name.trim(),
        billing: {
          merchantDisplayName: bill.merchantDisplayName.trim(),
          smsBrandName: bill.smsBrandName.trim(),
          payoutMomoNumber: bill.payoutMomoNumber.trim(),
          payoutNote: bill.payoutNote.trim(),
        },
      };
      if (isSuper) {
        body.slug = slug.trim().toLowerCase().replace(/\s+/g, '-');
        body.status = status;
      }
      const updated = await apiFetch('/api/organization', {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      setOrg(updated);
      setName(String(updated?.name || ''));
      setSlug(String(updated?.slug || ''));
      setStatus(STATUSES.includes(updated?.status) ? updated.status : 'active');
      setBill(billingFromOrg(updated));
    } catch (e2) {
      setErr(e2.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

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
      setShowPassword(false);
    } catch (e2) {
      setPwdErr(e2.message || 'Could not update password');
    } finally {
      setPwdBusy(false);
    }
  }

  if (loading) {
    return <p className="text-sm text-slate-500">Loading organisation…</p>;
  }

  if (!org) {
    return (
      <p className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
        {err || 'No organisation data.'}
      </p>
    );
  }

  const feeLabel =
    bill.platformFeePercent != null ? `${bill.platformFeePercent}%` : '—';

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-white">Organisation</h1>
        <p className="mt-1 text-sm text-slate-400">
          Branding and payout details. Customer payments go through Qaretech; your share is in{' '}
          <Link to="/finance/wallet" className="text-indigo-400 hover:text-indigo-300">
            Wallet
          </Link>
          .
        </p>
      </div>

      {err && (
        <p className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {err}
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-slate-800 bg-slate-900/50 px-4 py-3">
          <p className="text-xs uppercase tracking-wide text-slate-500">Wallet</p>
          <p className="mt-1 text-xl font-semibold text-emerald-300">
            GHS {((Number(org.walletBalanceCents) || 0) / 100).toFixed(2)}
          </p>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900/50 px-4 py-3">
          <p className="text-xs uppercase tracking-wide text-slate-500">Platform fee</p>
          <p className="mt-1 text-xl font-semibold text-slate-100">{feeLabel}</p>
        </div>
      </div>

      <form
        onSubmit={save}
        className="space-y-8 rounded-2xl border border-slate-800 bg-slate-900/40 p-6"
      >
        <fieldset className="space-y-4">
          <legend className="text-sm font-semibold text-white">Profile</legend>
          <label className="block text-sm text-slate-300">
            Display name
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white"
            />
          </label>

          {isSuper ? (
            <>
              <label className="block text-sm text-slate-300">
                Slug
                <input
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-slate-200"
                />
              </label>
              <label className="block text-sm text-slate-300">
                Status
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-200"
                >
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s.replace(/_/g, ' ')}
                    </option>
                  ))}
                </select>
              </label>
            </>
          ) : null}
        </fieldset>

        <fieldset className="space-y-4 border-t border-slate-800 pt-6">
          <legend className="text-sm font-semibold text-white">Branding</legend>
          <label className="block text-sm text-slate-300">
            Name on checkout
            <input
              value={bill.merchantDisplayName}
              onChange={(e) => setBill((b) => ({ ...b, merchantDisplayName: e.target.value }))}
              placeholder="e.g. Acme Fibre"
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white"
            />
          </label>
          <label className="block text-sm text-slate-300">
            SMS brand
            <input
              value={bill.smsBrandName}
              onChange={(e) => setBill((b) => ({ ...b, smsBrandName: e.target.value }))}
              placeholder="e.g. AcmeNet"
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white"
            />
          </label>
        </fieldset>

        <fieldset className="space-y-4 border-t border-slate-800 pt-6">
          <legend className="text-sm font-semibold text-white">Payout destination</legend>
          <p className="text-xs text-slate-500">
            Where Qaretech should send your withdrawals (shown when you request payout in Wallet).
          </p>
          <label className="block text-sm text-slate-300">
            MoMo number
            <input
              value={bill.payoutMomoNumber}
              onChange={(e) => setBill((b) => ({ ...b, payoutMomoNumber: e.target.value }))}
              placeholder="0244…"
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white"
            />
          </label>
          <label className="block text-sm text-slate-300">
            Note (account name / bank)
            <input
              value={bill.payoutNote}
              onChange={(e) => setBill((b) => ({ ...b, payoutNote: e.target.value }))}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white"
            />
          </label>
        </fieldset>

        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </form>

      <section className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-white">Your login password</h2>
            <p className="mt-0.5 text-xs text-slate-500">{me?.admin?.email}</p>
          </div>
          <button
            type="button"
            onClick={() => {
              setShowPassword((v) => !v);
              setPwdErr('');
              setPwdMsg('');
            }}
            className="rounded-lg border border-slate-600 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
          >
            {showPassword ? 'Hide' : 'Change'}
          </button>
        </div>
        {showPassword ? (
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
              className="rounded-lg bg-slate-700 px-4 py-2 text-sm font-medium text-white hover:bg-slate-600 disabled:opacity-50"
            >
              {pwdBusy ? 'Updating…' : 'Update password'}
            </button>
          </form>
        ) : null}
      </section>

      <p className="text-xs text-slate-500">
        Site renew and hotspot links are on each router under{' '}
        <Link to="/devices/mikrotik" className="text-indigo-400 hover:text-indigo-300">
          MikroTik
        </Link>
        . Online PPPoE renew also works with each customer&apos;s renew ID.
      </p>
    </div>
  );
}
