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

/** Token as form-safe value (no raw $ in the .rsc file). Express decodes it on register. */
function rosFormToken(token) {
  return encodeURIComponent(String(token || '').trim()).replace(/"/g, '%22');
}

function replaceLocal(body, name, value) {
  const re = new RegExp(`:local ${name} "[^"]*"`);
  /* Function replacer — string replacer treats $ specially and corrupts tokens */
  return body.replace(re, () => `:local ${name} "${value}"`);
}

/**
 * Build a ready-to-import .rsc with apibase + regtoken (+ optional orgid) filled.
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

  body = replaceLocal(body, 'apibase', escapeRosString(apiBase));
  body = replaceLocal(body, 'regtoken', rosFormToken(token));
  body = replaceLocal(body, 'orgid', escapeRosString(orgId));
  body = replaceLocal(body, 'wgpool', escapeRosString(pool));

  if (overrides.siteName != null && String(overrides.siteName).trim()) {
    body = replaceLocal(body, 'sitename', escapeRosString(String(overrides.siteName).trim()));
  }
  if (overrides.lanSubnet != null && String(overrides.lanSubnet).trim()) {
    body = replaceLocal(body, 'lansubnet', escapeRosString(String(overrides.lanSubnet).trim()));
  }

  return body;
}
