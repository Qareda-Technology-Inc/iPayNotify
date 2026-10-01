/**
 * Turn low-level router connection failures (SSH, API, WireGuard jump) into a short reason
 * an operator can act on. The raw text is kept as `detail` for troubleshooting.
 *
 * code: offline | vpn_server | refused | login | setup | error
 */
export function describeRouterError(err) {
  const raw = String(err?.message ?? err ?? '').trim();
  const code = err?.code;

  if (code === 'WG_VPS_UNREACHABLE' || /SSH to VPS .*timed out|cannot SSH to VPS/i.test(raw)) {
    return {
      code: 'vpn_server',
      message: 'VPN server unreachable',
      hint: 'The WireGuard VPS did not answer. Check that it is running and its SSH key is current.',
      detail: raw,
    };
  }
  if (/no VPS SSH key|Router host is empty|No API password|API user name is empty|no portal slug/i.test(raw)) {
    return { code: 'setup', message: firstSentence(raw), hint: '', detail: raw };
  }
  if (
    /rejected (API|SSH)? ?login|username or password is invalid|invalid user name or password|cannot log in|All configured authentication methods failed|authentication failed/i.test(
      raw
    )
  ) {
    return {
      code: 'login',
      message: 'Router rejected the login',
      hint: 'Update the router username and password under Network → Routers.',
      detail: raw,
    };
  }
  if (/ECONNREFUSED|connection refused/i.test(raw) && code !== 'WG_ROUTER_UNREACHABLE') {
    return {
      code: 'refused',
      message: 'Router refused the connection',
      hint: 'The router is online but SSH/API is off. Enable it under IP → Services.',
      detail: raw,
    };
  }
  if (
    code === 'WG_ROUTER_UNREACHABLE' ||
    code === 'ROUTER_TIMEOUT' ||
    /cannot reach|Channel open failure|timed out|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|ENOTFOUND|No route to host|socket hang up|not speaking SSH|Cannot connect/i.test(
      raw
    )
  ) {
    return {
      code: 'offline',
      message: 'Router offline',
      hint: 'No answer from the router. Check that it has power and internet, and that its VPN tunnel is up.',
      detail: raw,
    };
  }
  return { code: 'error', message: firstSentence(raw) || 'Router error', hint: '', detail: raw };
}

function firstSentence(text) {
  const s = String(text || '').trim();
  const m = s.match(/^(.{1,180}?[.!?])(\s|$)/);
  return (m ? m[1] : s.slice(0, 180)).trim();
}

/** Attach the friendly description to an error object (idempotent). */
export function tagRouterError(err) {
  if (!err || typeof err !== 'object' || err.routerError) return err;
  const d = describeRouterError(err);
  if (d.code === 'error') return err;
  err.routerError = d;
  if (!err.status) err.status = 502;
  return err;
}
