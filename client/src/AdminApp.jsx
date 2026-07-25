import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { getToken, setToken, setActingOrganizationId } from './authStorage.js';
import { apiFetch, publicFetch } from './api.js';
import { AdminSetup } from './screens/AdminSetup.jsx';
import { Login } from './screens/Login.jsx';
import { Dashboard } from './screens/Dashboard.jsx';
import { AcceptInvitePage } from './pages/AcceptInvitePage.jsx';

export default function AdminApp() {
  const location = useLocation();
  const isAcceptInvite = location.pathname === '/accept-invite';
  const [needsSetup, setNeedsSetup] = useState(null);
  const [sessionReady, setSessionReady] = useState(false);

  useEffect(() => {
    if (isAcceptInvite) return;
    publicFetch('/api/auth/status')
      .then((s) => setNeedsSetup(s.needsAdminSetup))
      .catch(() => setNeedsSetup(false));
  }, [isAcceptInvite]);

  useEffect(() => {
    if (isAcceptInvite) return;
    if (needsSetup === null) return;
    if (needsSetup) {
      setSessionReady(false);
      return;
    }
    const token = getToken();
    if (!token) {
      setSessionReady(false);
      return;
    }
    apiFetch('/api/auth/me')
      .then(() => setSessionReady(true))
      .catch(() => setSessionReady(false));
  }, [needsSetup, isAcceptInvite]);

  function afterSessionEstablished() {
    setNeedsSetup(false);
    setSessionReady(true);
  }

  function afterAdminSetup() {
    setNeedsSetup(false);
    afterSessionEstablished();
  }

  function onSignOut() {
    setToken(null);
    setActingOrganizationId(null);
    setSessionReady(false);
  }

  if (isAcceptInvite) {
    return <AcceptInvitePage onDone={afterSessionEstablished} />;
  }

  if (needsSetup === null) {
    return (
      <div className="flex min-h-screen items-center justify-center text-slate-400">
        Loading…
      </div>
    );
  }

  if (needsSetup) {
    return <AdminSetup onDone={afterAdminSetup} />;
  }

  if (!sessionReady) {
    return <Login onDone={afterSessionEstablished} />;
  }

  return <Dashboard onSignOut={onSignOut} />;
}
