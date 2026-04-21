import { OrganizationAuditLog } from '../models/index.js';

/** True if this object key should never store raw values in audit meta. */
function isSensitiveKey(key) {
  const k = String(key || '');
  if (/password$/i.test(k)) return true;
  if (/apikey$/i.test(k) || /api_key$/i.test(k)) return true;
  if (/sshPassword/i.test(k) || /apiPassword/i.test(k)) return true;
  if (/mtnMomoSubscriptionKey/i.test(k) || /mtnMomoApiKey/i.test(k)) return true;
  if (/subscriptionkey/i.test(k) || /subscription_key/i.test(k)) return true;
  if (/refreshToken$/i.test(k) || /accessToken$/i.test(k)) return true;
  if (/authorization$/i.test(k)) return true;
  if (/^(hash|privateKey)$/i.test(k)) return true;
  if (k === 'secret' || k === 'secretPassword') return true;
  return false;
}

/**
 * Deep-clone plain JSON-ish values and replace sensitive field values with "[redacted]".
 * Truncates very long strings to avoid huge log rows.
 */
export function redactForAudit(input, depth = 0) {
  if (depth > 8) return '[max-depth]';
  if (input == null) return input;
  const t = typeof input;
  if (t === 'string') {
    if (input.length > 500) return `[string:${input.length} chars]`;
    return input;
  }
  if (t === 'number' || t === 'boolean') return input;
  if (Array.isArray(input)) {
    return input.map((x) => redactForAudit(x, depth + 1));
  }
  if (t !== 'object') return String(input);
  const out = {};
  for (const [k, v] of Object.entries(input)) {
    if (isSensitiveKey(k)) {
      out[k] = v != null && v !== '' ? '[redacted]' : '';
      continue;
    }
    if (v != null && typeof v === 'object') {
      out[k] = redactForAudit(v, depth + 1);
    } else {
      out[k] = v;
    }
  }
  return out;
}

/**
 * Append an organisation audit row. Never throws — logs failures to console.
 * @param {{ organizationId: string; actorEmail?: string; action: string; meta?: object }} p
 */
export async function logOrgAudit({ organizationId, actorEmail, action, meta }) {
  if (!organizationId || !action) return;
  try {
    const safeMeta = meta && typeof meta === 'object' ? redactForAudit(meta) : {};
    await OrganizationAuditLog.create({
      organizationId,
      actorEmail: String(actorEmail || '').trim(),
      action: String(action).trim(),
      meta: safeMeta,
    });
  } catch (e) {
    console.error('[orgAudit] write failed', action, e);
  }
}

function csvCell(s) {
  const t = String(s ?? '').replace(/"/g, '""');
  if (/[",\r\n]/.test(t)) return `"${t}"`;
  return t;
}

/** Build CSV for download (meta column is JSON). */
export function formatOrgAuditCsv(rows) {
  const header = ['createdAt', 'actorEmail', 'action', 'meta'];
  const lines = [header.join(',')];
  for (const row of rows) {
    const metaJson = JSON.stringify(row.meta ?? {}).replace(/"/g, '""');
    lines.push(
      [
        row.createdAt ? new Date(row.createdAt).toISOString() : '',
        csvCell(row.actorEmail || ''),
        csvCell(row.action || ''),
        `"${metaJson}"`,
      ].join(',')
    );
  }
  return lines.join('\n');
}
