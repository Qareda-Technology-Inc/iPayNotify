import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch, apiDownload } from '../api.js';

const STATUSES = ['active', 'trial', 'past_due', 'suspended'];

function billingFromOrg(o) {
  const b = o?.billing || {};
  return {
    merchantDisplayName: String(b.merchantDisplayName || ''),
    smsBrandName: String(b.smsBrandName || ''),
    logoUrl: String(b.logoUrl || ''),
    platformFeePercent: b.platformFeePercent != null ? Number(b.platformFeePercent) : null,
    platformFeeBps: b.platformFeeBps,
    defaultPlatformFeePercent:
      b.defaultPlatformFeePercent != null ? Number(b.defaultPlatformFeePercent) : null,
    payoutMomoNumber: String(b.payoutMomoNumber || ''),
    payoutNote: String(b.payoutNote || ''),
  };
}

function limitLabel(n) {
  return n == null ? 'Unlimited' : String(n);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function OrganizationSettingsPage() {
  const [me, setMe] = useState(null);
  const [org, setOrg] = useState(null);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [status, setStatus] = useState('active');
  const [bill, setBill] = useState(billingFromOrg(null));
  const [err, setErr] = useState('');
  const [info, setInfo] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [audit, setAudit] = useState([]);
  const [auditLoading, setAuditLoading] = useState(false);

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

  const loadAudit = useCallback(async () => {
    setAuditLoading(true);
    try {
      const rows = await apiFetch('/api/organization/audit-log?limit=40');
      setAudit(Array.isArray(rows) ? rows : []);
    } catch {
      setAudit([]);
    } finally {
      setAuditLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    loadAudit();
  }, [load, loadAudit]);

  async function save(e) {
    e.preventDefault();
    if (!org?._id) return;
    setSaving(true);
    setErr('');
    setInfo('');
    try {
      const body = {
        name: name.trim(),
        billing: {
          merchantDisplayName: bill.merchantDisplayName.trim(),
          smsBrandName: bill.smsBrandName.trim(),
          logoUrl: bill.logoUrl.trim(),
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
      setInfo('Saved.');
      await loadAudit();
    } catch (e2) {
      setErr(e2.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function exportAuditCsv() {
    try {
      const blob = await apiDownload('/api/organization/audit-log?format=csv&limit=500');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'organization-audit.csv';
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setErr(e.message || 'Audit export failed');
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
  const portalSites = Array.isArray(org.portalSites) ? org.portalSites : [];
  const limits = org.limits || {};
  const usage = org.usage || {};

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-white">Organisation</h1>
        <p className="mt-1 text-sm text-slate-400">
          Branding, payouts, and customer site links. Wallet is under{' '}
          <Link to="/finance/wallet" className="text-indigo-400 hover:text-indigo-300">
            Finance → Wallet
          </Link>
          .
        </p>
      </div>

      {err && (
        <p className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {err}
        </p>
      )}
      {info && (
        <p className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
          {info}
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

      <div className="rounded-xl border border-slate-800 bg-slate-900/50 px-4 py-3 text-xs text-slate-400">
        <p className="font-semibold uppercase tracking-wide text-slate-500">Usage / limits</p>
        <p className="mt-2">
          Routers {usage.routers ?? 0} / {limitLabel(limits.maxRouters)} · Team {usage.admins ?? 0} /{' '}
          {limitLabel(limits.maxAdmins)} · SMS this month {usage.smsThisMonth ?? 0} /{' '}
          {limitLabel(limits.maxSmsPerMonth)}
        </p>
      </div>

      <section className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
        <h2 className="text-lg font-semibold text-white">Customer site links</h2>
        <p className="mt-1 text-xs text-slate-500">
          Links use each router&apos;s <span className="font-mono">portal slug</span> (not the
          organisation slug). Set slugs under{' '}
          <Link to="/devices/mikrotik" className="text-indigo-400 hover:text-indigo-300">
            MikroTik
          </Link>
          .
        </p>
        {portalSites.length === 0 ? (
          <p className="mt-4 text-sm text-slate-500">
            No routers with a portal slug yet. Add a portal slug on a router to get renew/hotspot
            URLs.
          </p>
        ) : (
          <ul className="mt-4 space-y-3">
            {portalSites.map((s) => (
              <li
                key={s.id}
                className="rounded-xl border border-slate-800 bg-slate-950/50 px-3 py-3 text-sm"
              >
                <p className="font-medium text-white">
                  {s.name}{' '}
                  <span className="font-mono text-xs text-slate-500">?r={s.portalSlug}</span>
                </p>
                <div className="mt-2 space-y-1 font-mono text-[11px] text-emerald-300/90">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="select-all break-all">{s.renewUrl}</span>
                    <button
                      type="button"
                      className="shrink-0 text-indigo-400 hover:text-indigo-300"
                      onClick={async () => {
                        if (await copyText(s.renewUrl)) setInfo('Renew link copied');
                      }}
                    >
                      Copy
                    </button>
                  </p>
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="select-all break-all">{s.hotspotUrl}</span>
                    <button
                      type="button"
                      className="shrink-0 text-indigo-400 hover:text-indigo-300"
                      onClick={async () => {
                        if (await copyText(s.hotspotUrl)) setInfo('Hotspot link copied');
                      }}
                    >
                      Copy
                    </button>
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

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
            Name on checkout / portal
            <input
              value={bill.merchantDisplayName}
              onChange={(e) => setBill((b) => ({ ...b, merchantDisplayName: e.target.value }))}
              placeholder="e.g. Acme Fibre"
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white"
            />
          </label>
          <label className="block text-sm text-slate-300">
            Logo URL (https)
            <input
              type="url"
              value={bill.logoUrl}
              onChange={(e) => setBill((b) => ({ ...b, logoUrl: e.target.value }))}
              placeholder="https://cdn.example.com/logo.png"
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white"
            />
            <span className="mt-1 block text-xs text-slate-500">
              Shown on renew and hotspot portal pages. Must be a public https image URL.
            </span>
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
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-white">Activity log</h2>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={loadAudit}
              className="rounded-lg border border-slate-600 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
            >
              Refresh
            </button>
            <button
              type="button"
              onClick={exportAuditCsv}
              className="rounded-lg border border-slate-600 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
            >
              Export CSV
            </button>
          </div>
        </div>
        {auditLoading ? (
          <p className="mt-4 text-sm text-slate-500">Loading…</p>
        ) : audit.length === 0 ? (
          <p className="mt-4 text-sm text-slate-500">No audit events yet.</p>
        ) : (
          <ul className="mt-4 max-h-80 space-y-2 overflow-y-auto text-xs">
            {audit.map((row) => (
              <li
                key={row._id}
                className="rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2 text-slate-300"
              >
                <p className="text-slate-500">
                  {row.createdAt ? new Date(row.createdAt).toLocaleString() : '—'}
                  {row.actorEmail ? ` · ${row.actorEmail}` : ''}
                </p>
                <p className="mt-0.5 font-medium text-slate-100">{row.action}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="text-xs text-slate-500">
        Change your login password under{' '}
        <Link to="/account" className="text-indigo-400 hover:text-indigo-300">
          Account
        </Link>
        .
      </p>
    </div>
  );
}
