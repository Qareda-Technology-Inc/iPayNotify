import { useEffect, useState } from 'react';
import { publicFetch } from '../api.js';

/** Read ?r= / ?router= / ?site= for captive portal deep links. */
export function getPortalSlugFromLocation() {
  if (typeof window === 'undefined') return '';
  const q = new URLSearchParams(window.location.search);
  return (
    (q.get('r') || q.get('router') || q.get('site') || '').trim() || ''
  );
}

export function usePortalContext() {
  const [ctx, setCtx] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const slug = getPortalSlugFromLocation();
    const qs = slug ? `?r=${encodeURIComponent(slug)}` : '';
    setLoading(true);
    publicFetch(`/api/public/portal-context${qs}`)
      .then(setCtx)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return { ctx, loading, error, slug: getPortalSlugFromLocation() };
}
