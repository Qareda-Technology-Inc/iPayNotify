import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch, publicFetch } from '../api.js';

export function SuperAdminEmailTemplatesPage() {
  const [smtpStatus, setSmtpStatus] = useState(null);
  const [preview, setPreview] = useState(null);
  const [adminEmail, setAdminEmail] = useState('');
  const [testTo, setTestTo] = useState('');
  const [err, setErr] = useState('');
  const [testResult, setTestResult] = useState(null);
  const [testBusy, setTestBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setErr('');
    setLoading(true);
    try {
      const [status, tmpl, me] = await Promise.all([
        publicFetch('/api/auth/email-status'),
        apiFetch('/api/super-admin/email-templates/sign-in-otp-preview'),
        apiFetch('/api/auth/me'),
      ]);
      setSmtpStatus(status && typeof status === 'object' ? status : null);
      setPreview(tmpl && typeof tmpl === 'object' ? tmpl : null);
      const em = me?.admin?.email || '';
      setAdminEmail(em);
      setTestTo(em);
    } catch (e) {
      setErr(e.message || 'Load failed');
      setSmtpStatus(null);
      setPreview(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function sendTest(e) {
    e.preventDefault();
    setTestBusy(true);
    setTestResult(null);
    setErr('');
    try {
      const r = await apiFetch('/api/super-admin/email-templates/test-smtp', {
        method: 'POST',
        body: JSON.stringify({ to: testTo.trim() || undefined }),
      });
      setTestResult(r);
    } catch (e) {
      setErr(e.message || 'Send failed');
    } finally {
      setTestBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <div>
        <Link to="/super/organizations" className="text-sm text-indigo-400 hover:text-indigo-300">
          ← Organisations
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-white">Email &amp; templates</h1>
        <p className="mt-1 text-sm text-slate-400">
          Transactional HTML used by the server (Nodemailer). Configure SMTP in{' '}
          <code className="text-slate-500">server/.env</code>.
        </p>
      </div>

      {err && (
        <p className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">{err}</p>
      )}

      <section className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
        <h2 className="text-lg font-medium text-white">SMTP status</h2>
        {loading ? (
          <p className="mt-3 text-sm text-slate-500">Loading…</p>
        ) : smtpStatus ? (
          <ul className="mt-3 space-y-1 text-sm text-slate-300">
            <li>
              Configured:{' '}
              <strong className={smtpStatus.configured ? 'text-emerald-400' : 'text-amber-400'}>
                {smtpStatus.configured ? 'yes' : 'no'}
              </strong>
            </li>
            <li>
              Ready to send:{' '}
              <strong className={smtpStatus.ready ? 'text-emerald-400' : 'text-amber-400'}>
                {smtpStatus.ready ? 'yes' : 'no'}
              </strong>
            </li>
            <li>
              Mock mode:{' '}
              <strong className={smtpStatus.mock ? 'text-slate-400' : 'text-slate-500'}>
                {smtpStatus.mock ? 'yes (logged only)' : 'no'}
              </strong>
            </li>
          </ul>
        ) : (
          <p className="mt-3 text-sm text-slate-500">Could not load status.</p>
        )}
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
        <h2 className="text-lg font-medium text-white">Test delivery</h2>
        <p className="mt-1 text-xs text-slate-500">
          Sends a short HTML message so you can confirm inbox rendering and SPF/DKIM if applicable.
        </p>
        <form onSubmit={sendTest} className="mt-4 flex flex-wrap items-end gap-3">
          <label className="block min-w-[220px] flex-1 text-sm text-slate-300">
            To
            <input
              type="email"
              value={testTo}
              onChange={(e) => setTestTo(e.target.value)}
              placeholder={adminEmail || 'you@example.com'}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
            />
          </label>
          <button
            type="submit"
            disabled={testBusy || !smtpStatus?.ready}
            className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            {testBusy ? 'Sending…' : 'Send test email'}
          </button>
        </form>
        {testResult && (
          <p className="mt-3 text-sm text-emerald-300">
            Sent{testResult.mock ? ' (mock — check server logs)' : ''} to {testResult.to}.
          </p>
        )}
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-medium text-white">Sign-in verification (org admins)</h2>
            <p className="mt-1 max-w-xl text-xs text-slate-500">
              {preview?.description ||
                'Used when ADMIN_LOGIN_VERIFY=true. Sample code below is for preview only.'}
            </p>
          </div>
          {preview?.subject && (
            <p className="text-xs text-slate-500">
              Subject: <span className="font-mono text-slate-400">{preview.subject}</span>
            </p>
          )}
        </div>
        {loading || !preview?.html ? (
          <p className="mt-4 text-sm text-slate-500">Loading preview…</p>
        ) : (
          <div className="mt-4 overflow-hidden rounded-xl border border-slate-800 bg-white">
            <iframe
              title="Email preview"
              sandbox="allow-same-origin"
              srcDoc={preview.html}
              className="h-[min(520px,70vh)] w-full border-0"
            />
          </div>
        )}
        {preview?.text && (
          <details className="mt-4">
            <summary className="cursor-pointer text-sm text-slate-400">Plain-text version</summary>
            <pre className="mt-2 max-h-48 overflow-auto rounded-lg border border-slate-800 bg-slate-950 p-3 font-mono text-xs text-slate-400">
              {preview.text}
            </pre>
          </details>
        )}
      </section>
    </div>
  );
}
