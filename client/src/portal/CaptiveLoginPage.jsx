import { useEffect, useState } from 'react';
import { resolveApiUrl } from '../api.js';
import { getPortalSlugFromLocation } from './usePortalContext.js';

/**
 * Hosted Wi-Fi login. The API renders the organisation's chosen template (same as the router's
 * login.html); the form posts straight to the router login URL passed by the hotspot.
 */
export function CaptiveLoginPage() {
  const [html, setHtml] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const params = new URLSearchParams();
    const slug = getPortalSlugFromLocation();
    if (slug) params.set('r', slug);
    for (const key of ['link-login-only', 'link-login', 'dst', 'link-orig', 'error']) {
      const v = q.get(key);
      if (v) params.set(key, v);
    }
    fetch(resolveApiUrl(`/api/public/captive/page.html?${params}`), { cache: 'no-store' })
      .then(async (res) => {
        const text = await res.text();
        if (!res.ok) throw new Error(text || 'Could not load the login page');
        setHtml(text);
      })
      .catch((e) => setError(e.message || 'Could not load the login page'));
  }, []);

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 p-6 text-center text-sm text-slate-300">
        {error}
      </div>
    );
  }
  if (!html) {
    return <div className="min-h-screen bg-slate-950" />;
  }
  return (
    <iframe
      title="Wi-Fi login"
      srcDoc={html}
      sandbox="allow-forms allow-top-navigation allow-scripts allow-same-origin"
      className="fixed inset-0 h-full w-full border-0"
    />
  );
}
