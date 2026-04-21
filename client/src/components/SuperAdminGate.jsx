import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { apiFetch } from '../api.js';

/**
 * Renders children only for `super_admin`. Organisation admins are redirected home
 * so super-only routes (tenant list, global email templates) are not exposed in the UI.
 */
export function SuperAdminGate({ children }) {
  const [state, setState] = useState({ loading: true, ok: false });

  useEffect(() => {
    let cancelled = false;
    apiFetch('/api/auth/me')
      .then((d) => {
        if (cancelled) return;
        const role = d?.admin?.role || 'super_admin';
        setState({ loading: false, ok: role === 'super_admin' });
      })
      .catch(() => {
        if (!cancelled) setState({ loading: false, ok: false });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-sm text-slate-500">
        Checking access…
      </div>
    );
  }
  if (!state.ok) {
    return <Navigate to="/" replace />;
  }
  return children;
}
