const KEY = 'qarefi_billing_admin_token';
const ACTING_ORG_KEY = 'qarefi_acting_organization_id';
const ACTING_ORG_NAME_KEY = 'qarefi_acting_organization_name';

export function getToken() {
  return localStorage.getItem(KEY);
}

export function setToken(token) {
  if (token) localStorage.setItem(KEY, token);
  else localStorage.removeItem(KEY);
}

/** Super admins: optional tenant context for normal `/api/*` calls (sent as `X-Organization-Id`). */
export function getActingOrganizationId() {
  return localStorage.getItem(ACTING_ORG_KEY);
}

export function getActingOrganizationName() {
  return localStorage.getItem(ACTING_ORG_NAME_KEY);
}

/** @param {string|null|undefined} id @param {string|null|undefined} [displayName] Organisation label when acting as tenant */
export function setActingOrganizationId(id, displayName) {
  if (id) {
    localStorage.setItem(ACTING_ORG_KEY, String(id));
    if (displayName != null && String(displayName).trim()) {
      localStorage.setItem(ACTING_ORG_NAME_KEY, String(displayName).trim());
    } else {
      localStorage.removeItem(ACTING_ORG_NAME_KEY);
    }
  } else {
    localStorage.removeItem(ACTING_ORG_KEY);
    localStorage.removeItem(ACTING_ORG_NAME_KEY);
  }
}
