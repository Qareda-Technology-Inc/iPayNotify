import { getToken, setToken, getActingOrganizationId } from './authStorage.js';

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

  const res = await fetch(path, {
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

export async function publicFetch(path, options = {}) {
  const res = await fetch(path, {
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
