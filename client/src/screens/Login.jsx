import { useEffect, useState } from 'react';
import { setToken, setActingOrganizationId } from '../authStorage.js';
import { publicFetch } from '../api.js';

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

  function resetFlow() {
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
      if (data.step === 'verify') {
        setChallengeId(data.challengeId);
        setSentEmail(Boolean(data.sentEmail));
        setSentSms(Boolean(data.sentSms));
        setSameCodeOnBothChannels(Boolean(data.sameCodeOnBothChannels));
        setStep('verify');
        setCode('');
        return;
      }
      if (data.token) {
        setToken(data.token);
        setActingOrganizationId(null);
        onDone();
      }
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
        setToken(data.token);
        setActingOrganizationId(null);
        onDone();
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-md px-4 py-16">
      <h1 className="text-xl font-semibold text-white">QareFi Billing</h1>
      <p className="mt-2 text-sm text-slate-400">Administrator sign in</p>
      {loginVerifyEnabled && step === 'password' && (
        <p className="mt-2 text-xs text-slate-500">
          Organisation administrators may need a one-time code by email or SMS after password. Super administrators
          sign in with password only.
        </p>
      )}

      {step === 'password' ? (
        <form onSubmit={onSubmitPassword} className="mt-8 space-y-4">
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
            <span className="text-slate-300">Password</span>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
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
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      ) : (
        <form onSubmit={onSubmitVerify} className="mt-8 space-y-4">
          <p className="text-sm text-slate-300">{verifyHint()}</p>
          <label className="block text-sm">
            <span className="text-slate-300">Verification code</span>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={6}
              required
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 font-mono tracking-widest text-slate-100 outline-none ring-emerald-500/40 focus:ring-2"
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
            {loading ? 'Verifying…' : 'Verify and sign in'}
          </button>
          <button
            type="button"
            onClick={() => {
              resetFlow();
              setError('');
            }}
            className="w-full rounded-lg border border-slate-600 py-2 text-sm text-slate-300 hover:bg-slate-800/50"
          >
            Back
          </button>
        </form>
      )}
    </div>
  );
}
