import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadTemplate() {
  const candidates = [
    path.join(__dirname, '../../../scripts/mikrotik/wireguard-auto-register.rsc'),
    path.join(process.cwd(), 'scripts/mikrotik/wireguard-auto-register.rsc'),
    path.join(process.cwd(), 'server/scripts/mikrotik/wireguard-auto-register.rsc'),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8');
    } catch {
      /* try next */
    }
  }
  throw new Error('wireguard-auto-register.rsc template not found on server');
}

function escapeRosString(s) {
  /* RouterOS expands $var inside "..."; also escape quotes/backslashes */
  return String(s || '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\$/g, '\\$');
}

/**
 * Build a ready-to-import .rsc with API_BASE + REGISTER_TOKEN (+ optional ORG_ID) filled.
 * SITE_NAME / LAN_SUBNET stay "auto" unless overridden so each router detects its own.
 */
export function buildWireGuardInstallScript(overrides = {}) {
  let body = loadTemplate();
  const apiBase = String(
    overrides.apiBase || config.publicApiUrl || 'https://ipaynotifyserver.onrender.com'
  )
    .trim()
    .replace(/\/$/, '');
  const token = String(
    overrides.registerToken != null ? overrides.registerToken : config.wireguard?.registerToken || ''
  ).trim();
  const orgId = String(overrides.organizationId || '').trim();
  const pool = String(config.wireguard?.tunnelPool || '10.66.54.0/24').trim();

  body = body.replace(
    /:local API_BASE "[^"]*"/,
    `:local API_BASE "${escapeRosString(apiBase)}"`
  );
  body = body.replace(
    /:local REGISTER_TOKEN "[^"]*"/,
    `:local REGISTER_TOKEN "${escapeRosString(token)}"`
  );
  body = body.replace(
    /:local ORG_ID "[^"]*"/,
    `:local ORG_ID "${escapeRosString(orgId)}"`
  );
  body = body.replace(
    /:local WG_POOL "[^"]*"/,
    `:local WG_POOL "${escapeRosString(pool)}"`
  );

  if (overrides.siteName != null && String(overrides.siteName).trim()) {
    body = body.replace(
      /:local SITE_NAME "[^"]*"/,
      `:local SITE_NAME "${escapeRosString(String(overrides.siteName).trim())}"`
    );
  }
  if (overrides.lanSubnet != null && String(overrides.lanSubnet).trim()) {
    body = body.replace(
      /:local LAN_SUBNET "[^"]*"/,
      `:local LAN_SUBNET "${escapeRosString(String(overrides.lanSubnet).trim())}"`
    );
  }

  return body;
}
