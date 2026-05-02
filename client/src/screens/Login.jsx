import { useEffect, useState } from 'react';
import { setToken, setActingOrganizationId } from '../authStorage.js';
import { publicFetch } from '../api.js';

const VERIFY_PENDING_KEY = 'adminLoginVerifyPending';

function readPendingVerify() {
  try {
    const raw = sessionStorage.getItem(VERIFY_PENDING_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writePendingVerify(payload) {
  try {
    sessionStorage.setItem(VERIFY_PENDING_KEY, JSON.stringify(payload));
  } catch {
    /* ignore */
  }
}

function clearPendingVerify() {
  try {
    sessionStorage.removeItem(VERIFY_PENDING_KEY);
  } catch {
    /* ignore */
  }
}

function LogoMark({ className = '' }) {
  return (
    <svg className={className} viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <rect width="40" height="40" rx="12" className="fill-emerald-500/15 stroke-emerald-400/40" strokeWidth="1" />
      <path
        d="M12 28V12h8.2c3.1 0 5.3 2 5.3 4.9 0 2.1-1.1 3.7-2.9 4.4L28 28h-4.2l-4.8-6.2h-3V28H12zm4-9.6h3.8c1.4 0 2.3-.8 2.3-2.1 0-1.3-.9-2.1-2.3-2.1H16v4.2z"
        className="fill-emerald-300"
      />
    </svg>
  );
}

function FieldShell({ children }) {
  return (
    <div className="rounded-xl border border-slate-700/80 bg-slate-950/60 shadow-inner shadow-black/20 transition-colors focus-within:border-emerald-500/50 focus-within:ring-2 focus-within:ring-emerald-500/25">
      {children}
    </div>
  );
}

export function Login({ onDone }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [loginVerifyEnabled, setLoginVerifyEnabled] = useState(false);

  const [step, setStep] = useState('password');
  const [challengeId, setChallengeId] = useState('');
  const [sentEmail, setSentEmail] = useState(false);
  const [sentSms, setSentSms] = useState(false);
  const [sameCodeOnBothChannels, setSameCodeOnBothChannels] = useState(false);
  const [code, setCode] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = await publicFetch('/api/auth/status');
        if (!cancelled && s?.loginVerification?.enabled) {
          setLoginVerifyEnabled(true);
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const p = readPendingVerify();
    if (p?.challengeId) {
      setChallengeId(p.challengeId);
      setSentEmail(Boolean(p.sentEmail));
      setSentSms(Boolean(p.sentSms));
      setSameCodeOnBothChannels(Boolean(p.sameCodeOnBothChannels));
      if (p.email) setEmail(String(p.email));
      setStep('verify');
      setCode('');
    }
  }, []);

  function resetFlow() {
    clearPendingVerify();
    setStep('password');
    setChallengeId('');
    setSentEmail(false);
    setSentSms(false);
    setSameCodeOnBothChannels(false);
    setCode('');
    setPassword('');
  }

  function verifyHint() {
    if (sameCodeOnBothChannels) {
      return 'The same 6-digit code was sent to your email and your phone.';
    }
    if (sentEmail && sentSms) {
      return 'Check your email and phone for the verification code.';
    }
    if (sentEmail) return 'Check your email for the verification code.';
    if (sentSms) return 'Check your phone for the SMS verification code.';
    return 'Enter the verification code you received.';
  }

  async function onSubmitPassword(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const data = await publicFetch('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      if (data._nonJson) {
        setError('Login response was not valid JSON. Check API URL / hosting (proxy returning HTML).');
        return;
      }
      const needsVerify =
        data.step === 'verify' ||
        (!data.token &&
          typeof data.challengeId === 'string' &&
          data.challengeId.length > 10);
      if (needsVerify) {
        const cid =
          typeof data.challengeId === 'string' && data.challengeId.trim()
            ? data.challengeId.trim()
            : '';
        if (!cid) {
          setError('Verification was required but no challenge id was returned. Please try again.');
          return;
        }
        setChallengeId(cid);
        setSentEmail(Boolean(data.sentEmail));
        setSentSms(Boolean(data.sentSms));
        setSameCodeOnBothChannels(Boolean(data.sameCodeOnBothChannels));
        writePendingVerify({
          challengeId: cid,
          sentEmail: Boolean(data.sentEmail),
          sentSms: Boolean(data.sentSms),
          sameCodeOnBothChannels: Boolean(data.sameCodeOnBothChannels),
          email: String(email || '').trim(),
        });
        setStep('verify');
        setCode('');
        return;
      }
      if (data.token) {
        clearPendingVerify();
        setToken(data.token);
        setActingOrganizationId(null);
        onDone();
        return;
      }
      setError('Unexpected login response. Please try again.');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function onSubmitVerify(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const data = await publicFetch('/api/auth/login/verify', {
        method: 'POST',
        body: JSON.stringify({
          challengeId,
          code: code.trim(),
        }),
      });
      if (data.token) {
        clearPendingVerify();
        setToken(data.token);
        setActingOrganizationId(null);
        onDone();
        return;
      }
      setError('Verification did not return a session. Please try again.');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative flex min-h-screen min-h-[100dvh] flex-col items-center justify-center overflow-x-hidden overflow-y-auto px-4 py-8 sm:py-12">
      {/* ambient */}
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,rgba(16,185,129,0.22),transparent)]"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute -left-32 top-1/4 h-72 w-72 rounded-full bg-emerald-500/10 blur-3xl"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute -right-24 bottom-0 h-80 w-80 rounded-full bg-teal-500/8 blur-3xl"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,rgba(148,163,184,0.04)_1px,transparent_1px),linear-gradient(to_bottom,rgba(148,163,184,0.04)_1px,transparent_1px)] bg-[size:48px_48px] [mask-image:radial-gradient(ellipse_70%_60%_at_50%_40%,black,transparent)]"
        aria-hidden
      />

      <div className="relative z-10 w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-400/20 to-teal-600/10 ring-1 ring-emerald-400/30">
            <LogoMark className="h-10 w-10" />
          </div>
          <h1 className="mt-5 bg-gradient-to-r from-white via-slate-100 to-slate-400 bg-clip-text text-2xl font-bold tracking-tight text-transparent sm:text-3xl">
            QareFi Billing
          </h1>
          <p className="mt-2 text-sm font-medium text-emerald-400/90">Run your ISP revenue from one calm dashboard.</p>
          <p className="mt-1 text-xs text-slate-500">Administrator access · Secure session</p>
        </div>

        <div className="rounded-2xl border border-slate-800/90 bg-slate-900/70 p-6 shadow-2xl shadow-black/40 ring-1 ring-white/5 backdrop-blur-md sm:p-8">
          {step === 'verify' && (
            <>
              <div className="mb-4 text-center">
                <h2 className="text-lg font-semibold text-white">Verify it&apos;s you</h2>
                <p className="mt-1 text-xs text-slate-500">Enter the 6-digit code we sent</p>
              </div>
              <div className="mb-6 flex items-center justify-center gap-2">
                <span className="h-1.5 w-8 rounded-full bg-slate-700" />
                <span className="h-1.5 w-8 rounded-full bg-gradient-to-r from-emerald-500 to-teal-500" />
              </div>
            </>
          )}

          {loginVerifyEnabled && step === 'password' && (
            <p className="mb-6 rounded-lg border border-slate-700/60 bg-slate-950/50 px-3 py-2.5 text-xs leading-relaxed text-slate-400">
              <span className="font-medium text-slate-300">Tip:</span> Org admins may get a one-time code by email
              or SMS after password. Super admins sign in with password only.
            </p>
          )}

          {step === 'password' ? (
            <form onSubmit={onSubmitPassword} className="space-y-5" autoComplete="on">
              <label htmlFor="admin-login-email" className="block text-sm font-medium text-slate-200">
                <span className="mb-1.5 block text-xs uppercase tracking-wider text-slate-500">Email</span>
                <FieldShell>
                  <input
                    id="admin-login-email"
                    name="email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="username"
                    placeholder="you@company.com"
                    className="w-full rounded-xl border-0 bg-transparent px-4 py-3 text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-0"
                  />
                </FieldShell>
              </label>
              <label htmlFor="admin-login-password" className="block text-sm font-medium text-slate-200">
                <span className="mb-1.5 block text-xs uppercase tracking-wider text-slate-500">Password</span>
                <FieldShell>
                  <input
                    id="admin-login-password"
                    name="password"
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                    placeholder="••••••••"
                    className="w-full rounded-xl border-0 bg-transparent px-4 py-3 text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-0"
                  />
                </FieldShell>
              </label>
              {error && (
                <p
                  role="alert"
                  className="rounded-xl border border-red-500/35 bg-red-500/10 px-4 py-3 text-sm text-red-100"
                >
                  {error}
                </p>
              )}
              <button
                type="submit"
                disabled={loading}
                className="group relative w-full overflow-hidden rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 py-3 text-sm font-semibold text-white shadow-lg shadow-emerald-900/30 transition hover:from-emerald-500 hover:to-teal-500 hover:shadow-emerald-800/40 disabled:cursor-not-allowed disabled:opacity-55"
              >
                <span className="relative z-10">{loading ? 'Signing in…' : 'Sign in'}</span>
                <span
                  className="absolute inset-0 -translate-x-full bg-white/10 transition group-hover:translate-x-0 group-hover:duration-500"
                  aria-hidden
                />
              </button>
            </form>
          ) : (
            <form onSubmit={onSubmitVerify} className="space-y-5" autoComplete="on">
              <p className="text-center text-sm leading-relaxed text-slate-300">{verifyHint()}</p>
              <label htmlFor="admin-login-otp" className="block text-sm font-medium text-slate-200">
                <span className="mb-1.5 block text-xs uppercase tracking-wider text-slate-500">6-digit code</span>
                <FieldShell>
                  <input
                    id="admin-login-otp"
                    name="one-time-code"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="\d{6}"
                    maxLength={6}
                    required
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="000000"
                    className="w-full rounded-xl border-0 bg-transparent px-4 py-3 text-center font-mono text-lg tracking-[0.35em] text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-0"
                  />
                </FieldShell>
              </label>
              {error && (
                <p
                  role="alert"
                  className="rounded-xl border border-red-500/35 bg-red-500/10 px-4 py-3 text-sm text-red-100"
                >
                  {error}
                </p>
              )}
              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 py-3 text-sm font-semibold text-white shadow-lg shadow-emerald-900/30 transition hover:from-emerald-500 hover:to-teal-500 disabled:cursor-not-allowed disabled:opacity-55"
              >
                {loading ? 'Verifying…' : 'Verify and sign in'}
              </button>
              <button
                type="button"
                onClick={() => {
                  resetFlow();
                  setError('');
                }}
                className="w-full rounded-xl border border-slate-600/80 bg-slate-950/40 py-3 text-sm font-medium text-slate-300 transition hover:border-slate-500 hover:bg-slate-800/50"
              >
                Back to password
              </button>
            </form>
          )}
        </div>

        <p className="mt-8 text-center text-[11px] text-slate-600">
          Protected by your organization&apos;s policies. Only use credentials you were given.
        </p>
      </div>
    </div>
  );
}
