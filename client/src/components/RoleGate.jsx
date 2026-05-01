import { useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { apiFetch } from '../api.js';

export function RoleGate({ allow = [], children }) {
  const [state, setState] = useState({ loading: true, role: null });
  const allowed = useMemo(() => new Set((allow || []).map((r) => String(r))), [allow]);

  useEffect(() => {
    let cancelled = false;
    apiFetch('/api/auth/me')
      .then((d) => {
        if (cancelled) return;
        setState({ loading: false, role: d?.admin?.role || 'super_admin' });
      })
      .catch(() => {
        if (!cancelled) setState({ loading: false, role: null });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.loading) {
    return <div className="text-sm text-slate-500">Checking access…</div>;
  }
  if (!state.role || (allowed.size > 0 && !allowed.has(state.role))) {
    return <Navigate to="/" replace />;
  }
  return children;
}
