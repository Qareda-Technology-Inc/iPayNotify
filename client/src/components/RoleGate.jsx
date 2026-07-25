import { useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { apiFetch } from '../api.js';

/**
 * @param {{ allow?: string[], module?: 'tickets' | 'remoteAccess', children: import('react').ReactNode }} props
 */
export function RoleGate({ allow = [], module, children }) {
  const [state, setState] = useState({
    loading: true,
    role: null,
    modules: { tickets: false, remoteAccess: false },
  });
  const allowed = useMemo(() => new Set((allow || []).map((r) => String(r))), [allow]);

  useEffect(() => {
    let cancelled = false;
    apiFetch('/api/auth/me')
      .then((d) => {
        if (cancelled) return;
        setState({
          loading: false,
          role: d?.admin?.role || 'super_admin',
          modules: {
            tickets: Boolean(d?.modules?.tickets),
            remoteAccess: Boolean(d?.modules?.remoteAccess),
          },
        });
      })
      .catch(() => {
        if (!cancelled) {
          setState({
            loading: false,
            role: null,
            modules: { tickets: false, remoteAccess: false },
          });
        }
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
  if (module && state.role !== 'super_admin' && !state.modules[module]) {
    return <Navigate to="/" replace />;
  }
  return children;
}
