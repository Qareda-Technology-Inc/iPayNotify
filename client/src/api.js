import { getToken, setToken, getActingOrganizationId } from './authStorage.js';

/**
 * When the SPA is on Vercel (or any static host) and the API is elsewhere (e.g. Render),
 * set `VITE_API_BASE_URL` at build time to your API origin, e.g. `https://your-api.onrender.com`
 * (no trailing slash). Leave unset for same-origin or Vite dev proxy (`/api` → local server).
 */
export function resolveApiUrl(path) {
  const p = String(path ?? '').startsWith('/') ? String(path) : `/${path}`;
  const base = String(import.meta.env.VITE_API_BASE_URL || '').trim().replace(/\/$/, '');
  return base ? `${base}${p}` : p;
}

export async function fetchWithApiDiagnostics(url, init) {
  if (
    typeof window !== 'undefined' &&
    window.location.protocol === 'https:' &&
    String(url).startsWith('http:')
  ) {
    throw new Error(
      'Mixed content blocked: the page is HTTPS but VITE_API_BASE_URL is http. Use https:// for your Render API URL.'
    );
  }
  try {
    return await fetch(url, init);
  } catch (e) {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const base = String(import.meta.env.VITE_API_BASE_URL || '').trim();
    const extra = base
      ? ` Tried: ${url}. On Render set CLIENT_ORIGIN to include ${origin || '(your Vercel origin)'} (CORS).`
      : ` Tried: ${url}. Set VITE_API_BASE_URL in Vercel to your Render API origin (https://…) and redeploy.`;
    throw new Error(`${e?.message || 'Failed to fetch'}.${extra}`);
  }
}

export async function apiFetch(path, options = {}) {
  const token = getToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const acting = getActingOrganizationId();
  if (acting && !headers['X-Organization-Id']) {
    headers['X-Organization-Id'] = acting;
  }

  const url = resolveApiUrl(path);
  const res = await fetchWithApiDiagnostics(url, {
    cache: 'no-store',
    ...options,
    headers,
  });
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    /* Only drop JWT on real admin-session failures — not 401 from MikroTik/SSH upstream. */
    const errText = String(data.error || res.statusText || '');
    const isSessionAuthFailure =
      /authentication required|invalid or expired session/i.test(errText);
    if (res.status === 401 && token && isSessionAuthFailure) {
      setToken(null);
    }
    throw new Error(errText || res.statusText);
  }
  return data;
}

/** Authenticated download (CSV etc.) — returns a Blob. */
export async function apiDownload(path) {
  const token = getToken();
  const headers = {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
  const acting = getActingOrganizationId();
  if (acting) headers['X-Organization-Id'] = acting;
  const url = resolveApiUrl(path);
  const res = await fetchWithApiDiagnostics(url, { cache: 'no-store', headers });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || res.statusText || 'Download failed');
  }
  return res.blob();
}

export async function publicFetch(path, options = {}) {
  const url = resolveApiUrl(path);
  const res = await fetchWithApiDiagnostics(url, {
    cache: 'no-store',
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    /* Proxy/HTML or non-JSON — avoid generic "Bad Request" with no context */
    data = { _nonJson: true };
  }
  if (!res.ok) {
    const snippet = text && text.length > 0 ? text.slice(0, 400).trim() : '';
    const msg =
      data.error ||
      data.message ||
      data.detail ||
      (Array.isArray(data.errors) && data.errors.map((e) => e.message || e).join('; ')) ||
      (data._nonJson && snippet ? snippet : '') ||
      res.statusText;
    throw new Error(msg || `Request failed (${res.status})`);
  }
  return data;
}
