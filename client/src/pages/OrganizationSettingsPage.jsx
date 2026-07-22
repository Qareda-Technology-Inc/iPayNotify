import { useCallback, useEffect, useState } from 'react';
import { apiFetch, resolveApiUrl, fetchWithApiDiagnostics } from '../api.js';
import { getActingOrganizationId, getToken } from '../authStorage.js';

function auditMetaSummary(meta) {
  if (!meta || typeof meta !== 'object') return '';
  const parts = [];
  if (Array.isArray(meta.keys) && meta.keys.length) parts.push(`keys: ${meta.keys.join(', ')}`);
  if (Array.isArray(meta.billingKeys) && meta.billingKeys.length) {
    parts.push(`billing fields: ${meta.billingKeys.join(', ')}`);
  }
  if (Array.isArray(meta.patchKeys) && meta.patchKeys.length) {
    parts.push(`updated fields: ${meta.patchKeys.join(', ')}`);
  }
  if (meta.name && meta.kind != null) parts.push(`${meta.kind}: ${meta.name}`);
  if (meta.secretName) parts.push(`PPPoE ${meta.secretName}`);
  if (meta.displayName) parts.push(String(meta.displayName));
  if (meta.host && meta.transport) parts.push(`${meta.transport} ${meta.host}`);
  if (parts.length) return parts.join(' · ');
  const j = JSON.stringify(meta);
  return j.length > 140 ? `${j.slice(0, 140)}…` : j;
}

const STATUSES = ['active', 'trial', 'past_due', 'suspended'];

function billingFromOrg(o) {
  const b = o?.billing || {};
  return {
    merchantDisplayName: String(b.merchantDisplayName || ''),
    smsBrandName: String(b.smsBrandName || ''),
    useCustomHubtel: Boolean(b.useCustomHubtel),
    hubtelMerchantAccount: String(b.hubtelMerchantAccount || ''),
    hubtelClientId: String(b.hubtelClientId || ''),
    hubtelClientSecret: '',
    hubtelCallbackUrl: String(b.hubtelCallbackUrl || ''),
    hubtelClientSecretSet: Boolean(b.hubtelClientSecretSet),
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
  const [audit, setAudit] = useState([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditCsvErr, setAuditCsvErr] = useState('');

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

  useEffect(() => {
    if (!org?._id) return;
    let cancelled = false;
    setAuditLoading(true);
    apiFetch('/api/organization/audit-log?limit=30')
      .then((rows) => {
        if (!cancelled) setAudit(Array.isArray(rows) ? rows : []);
      })
      .catch(() => {
        if (!cancelled) setAudit([]);
      })
      .finally(() => {
        if (!cancelled) setAuditLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [org?._id]);

  async function downloadAuditCsv() {
    if (!org?._id) return;
    setAuditCsvErr('');
    try {
      const token = getToken();
      const headers = {};
      if (token) headers.Authorization = `Bearer ${token}`;
      const acting = getActingOrganizationId();
      if (acting) headers['X-Organization-Id'] = acting;
      const res = await fetchWithApiDiagnostics(
        resolveApiUrl('/api/organization/audit-log?format=csv&limit=500'),
        {
          headers,
          cache: 'no-store',
        }
      );
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error || res.statusText || 'Download failed');
      }
      const text = await res.text();
      const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `org-audit-${String(org.slug || org._id).replace(/[^\w-]+/g, '_')}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setAuditCsvErr(e.message || 'Download failed');
    }
  }

  async function changePassword(e) {
    e.preventDefault();
    setPwdErr('');
    setPwdMsg('');
    setPwdBusy(true);
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
      setPwdMsg('Password updated. Use the new password next time you sign in.');
    } catch (err) {
      setPwdErr(err.message || 'Could not change password');
    } finally {
      setPwdBusy(false);
    }
  }

  async function save(e) {
    e.preventDefault();
    if (!org?._id) return;
    setSaving(true);
    setErr('');
    try {
      const body = { name: name.trim() };
      if (isSuper) {
        body.slug = slug.trim().toLowerCase().replace(/\s+/g, '-');
        body.status = status;
      }
      const billing = {
        merchantDisplayName: bill.merchantDisplayName.trim(),
        smsBrandName: bill.smsBrandName.trim(),
        useCustomHubtel: bill.useCustomHubtel,
        hubtelMerchantAccount: bill.hubtelMerchantAccount.trim(),
        hubtelClientId: bill.hubtelClientId.trim(),
        hubtelCallbackUrl: bill.hubtelCallbackUrl.trim(),
      };
      if (bill.hubtelClientSecret.trim()) {
        billing.hubtelClientSecret = bill.hubtelClientSecret.trim();
      }
      body.billing = billing;

      const updated = await apiFetch('/api/organization', {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      setOrg(updated);
      setName(String(updated?.name || ''));
      setSlug(String(updated?.slug || ''));
      setStatus(STATUSES.includes(updated?.status) ? updated.status : 'active');
      setBill(billingFromOrg(updated));
      try {
        const rows = await apiFetch('/api/organization/audit-log?limit=30');
        setAudit(Array.isArray(rows) ? rows : []);
      } catch {
        /* ignore */
      }
    } catch (e) {
      setErr(e.message || 'Save failed');
    } finally {
      setSaving(false);
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

  const portal = org.portal || {};

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">
          Organisation
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-400">
          Tenant profile, <strong className="text-slate-300">MoMo &amp; SMS branding</strong> for this organisation, and
          customer links. Slug and account status: super admin only.
        </p>
      </div>

      {err && (
        <p className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {err}
        </p>
      )}

      <form
        onSubmit={save}
        className="space-y-10 rounded-2xl border border-slate-800 bg-slate-900/40 p-6 shadow-lg shadow-black/20"
      >
        <fieldset className="space-y-6">
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

          <label className="block text-sm text-slate-300">
            Portal slug
            <input
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              disabled={!isSuper}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-slate-200 disabled:cursor-not-allowed disabled:opacity-60"
            />
            <span className="mt-1 block text-xs text-slate-500">
              Customer URLs use <span className="font-mono text-slate-400">?r=</span> with this slug.
            </span>
          </label>

          <label className="block text-sm text-slate-300">
            Account status
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              disabled={!isSuper}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-200 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </label>
        </fieldset>

        <fieldset className="space-y-4 border-t border-slate-800 pt-8">
          <legend className="text-sm font-semibold text-white">Payments &amp; SMS branding</legend>
          <p className="text-xs text-slate-500">
            <strong className="text-slate-400">Merchant name</strong> appears on Hubtel checkout descriptions.{' '}
            <strong className="text-slate-400">SMS brand</strong> is used when a router has no site-specific SMS brand.
            Per-router overrides still win in Messages and payment SMS.
          </p>
          <label className="block text-sm text-slate-300">
            Merchant display name
            <input
              value={bill.merchantDisplayName}
              onChange={(e) => setBill((b) => ({ ...b, merchantDisplayName: e.target.value }))}
              placeholder="e.g. Acme Fibre"
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white"
            />
          </label>
          <label className="block text-sm text-slate-300">
            SMS brand name (fallback)
            <input
              value={bill.smsBrandName}
              onChange={(e) => setBill((b) => ({ ...b, smsBrandName: e.target.value }))}
              placeholder="Short label in SMS, e.g. AcmeNet"
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white"
            />
          </label>

          <label className="flex items-start gap-3 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={bill.useCustomHubtel}
              onChange={(e) => setBill((b) => ({ ...b, useCustomHubtel: e.target.checked }))}
              className="mt-1"
            />
            <span>
              <strong className="text-white">Use organisation Hubtel credentials</strong>
              <span className="mt-1 block text-xs font-normal text-slate-500">
                When off, the platform <span className="font-mono">HUBTEL_*</span> environment keys are used. When on,
                fill merchant account, client ID, and client secret from your Hubtel business dashboard.
              </span>
            </span>
          </label>

          {bill.useCustomHubtel && (
            <div className="ml-7 space-y-3 rounded-xl border border-emerald-500/25 bg-emerald-950/15 p-4">
              <label className="block text-xs font-medium uppercase tracking-wide text-emerald-200/90">
                Merchant account number
                <input
                  value={bill.hubtelMerchantAccount}
                  onChange={(e) => setBill((b) => ({ ...b, hubtelMerchantAccount: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-white"
                />
              </label>
              <label className="block text-xs font-medium uppercase tracking-wide text-emerald-200/90">
                Client ID
                <input
                  value={bill.hubtelClientId}
                  onChange={(e) => setBill((b) => ({ ...b, hubtelClientId: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-white"
                />
              </label>
              <label className="block text-xs font-medium uppercase tracking-wide text-emerald-200/90">
                Client secret
                <input
                  type="password"
                  autoComplete="off"
                  value={bill.hubtelClientSecret}
                  onChange={(e) => setBill((b) => ({ ...b, hubtelClientSecret: e.target.value }))}
                  placeholder={bill.hubtelClientSecretSet ? 'Leave blank to keep saved secret' : 'Required'}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-white"
                />
              </label>
              <label className="block text-xs font-medium uppercase tracking-wide text-emerald-200/90">
                Callback URL (optional if server has HUBTEL_CALLBACK_URL)
                <input
                  value={bill.hubtelCallbackUrl}
                  onChange={(e) => setBill((b) => ({ ...b, hubtelCallbackUrl: e.target.value }))}
                  placeholder="https://your-billing-host/api/payments/hubtel/callback"
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-white"
                />
              </label>
            </div>
          )}
        </fieldset>

        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </form>

      <form
        onSubmit={changePassword}
        className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900/40 p-6"
      >
        <h2 className="text-lg font-semibold text-white">Your sign-in password</h2>
        <p className="text-xs text-slate-500">
          Changes the password for <span className="font-mono text-slate-400">{me?.admin?.email}</span> — the account
          you are logged in with now.
        </p>
        {pwdErr && (
          <p className="rounded-lg border border-red-500/35 bg-red-500/10 px-3 py-2 text-sm text-red-200">{pwdErr}</p>
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
          New password (min 8 characters)
          <input
            type="password"
            autoComplete="new-password"
            value={pwdNew}
            onChange={(e) => setPwdNew(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white"
          />
        </label>
        <button
          type="submit"
          disabled={pwdBusy || !pwdCurrent || !pwdNew}
          className="rounded-lg border border-slate-600 bg-slate-800 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-slate-700 disabled:opacity-50"
        >
          {pwdBusy ? 'Updating…' : 'Update password'}
        </button>
      </form>

      <section className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-white">Recent changes</h2>
            <p className="mt-1 text-xs text-slate-500">
              Organisation settings, packages, routers, PPPoE, and remote access admin actions. Sensitive values are
              never stored in the log.
            </p>
          </div>
          <button
            type="button"
            onClick={downloadAuditCsv}
            className="shrink-0 rounded-lg border border-slate-600 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700"
          >
            Download CSV
          </button>
        </div>
        {auditCsvErr && (
          <p className="mt-3 rounded-lg border border-red-500/35 bg-red-500/10 px-3 py-2 text-xs text-red-200">
            {auditCsvErr}
          </p>
        )}
        {auditLoading ? (
          <p className="mt-4 text-sm text-slate-500">Loading audit…</p>
        ) : audit.length === 0 ? (
          <p className="mt-4 text-sm text-slate-500">
            No entries yet — save organisation settings or change billing, packages, or network items to create logs.
          </p>
        ) : (
          <ul className="mt-4 max-h-72 space-y-2 overflow-y-auto text-sm">
            {audit.map((row) => {
              const summary = auditMetaSummary(row.meta);
              return (
                <li
                  key={row._id}
                  className="rounded-lg border border-slate-800/80 bg-slate-950/50 px-3 py-2 text-slate-300"
                >
                  <span className="text-xs text-slate-500">
                    {row.createdAt ? new Date(row.createdAt).toLocaleString() : '—'}
                  </span>
                  <p className="mt-0.5 font-mono text-xs text-amber-200/90">{row.action}</p>
                  <p className="text-xs text-slate-500">{row.actorEmail || '—'}</p>
                  {summary ? (
                    <p className="mt-1 break-words font-mono text-[11px] leading-snug text-slate-500">{summary}</p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
        <h2 className="text-lg font-semibold text-white">Customer links</h2>
        <p className="mt-1 text-sm text-slate-500">
          Built from <span className="font-mono text-slate-400">PUBLIC_APP_URL</span> and your portal slug.
        </p>
        <ul className="mt-4 space-y-3 text-sm">
          <li>
            <span className="text-slate-500">PPPoE renew</span>
            <a
              href={portal.renewUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-1 block break-all font-mono text-emerald-400 hover:text-emerald-300"
            >
              {portal.renewUrl || '—'}
            </a>
          </li>
          <li>
            <span className="text-slate-500">Hotspot purchase</span>
            <a
              href={portal.hotspotUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-1 block break-all font-mono text-emerald-400 hover:text-emerald-300"
            >
              {portal.hotspotUrl || '—'}
            </a>
          </li>
        </ul>
      </section>
    </div>
  );
}
