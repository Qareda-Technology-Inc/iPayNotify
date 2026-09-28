import mongoose from 'mongoose';
import { config } from '../config.js';
import { Router } from '../models/index.js';
import { withRouterMikrotik } from '../mikrotik/routeros.js';
import { normalizePrintRows } from '../mikrotik/helpers.js';
import { cliEscapeValue } from '../mikrotik/rosSsh.js';
import { syncPaymentWalledGarden } from './walledGardenSyncService.js';

function fail(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function publicApiBase() {
  const base = String(config.publicApiUrl || '').replace(/\/$/, '');
  if (!/^https:\/\//i.test(base)) {
    throw fail(
      'Set PUBLIC_API_URL to the public https address of this API. The router downloads the login page from there.'
    );
  }
  return base;
}

export function captiveLoginFetchUrl(portalSlug) {
  const slug = String(portalSlug || '').trim().toLowerCase();
  return `${publicApiBase()}/api/public/captive/${encodeURIComponent(slug)}/login.html`;
}

export function captiveBuyUrl(portalSlug) {
  const base = String(config.publicAppUrl || '').replace(/\/$/, '');
  const slug = String(portalSlug || '').trim().toLowerCase();
  if (!base || !slug) return '';
  return `${base}/portal/hotspot?r=${encodeURIComponent(slug)}`;
}

function htmlDirectory(profile) {
  const raw = String(profile['html-directory'] || profile.htmlDirectory || 'hotspot').trim();
  const dir = raw.replace(/^\/+|\/+$/g, '') || 'hotspot';
  if (!/^[A-Za-z0-9_./-]+$/.test(dir)) return 'hotspot';
  return dir;
}

function withPap(loginBy) {
  const parts = String(loginBy || 'cookie,http-chap')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!parts.includes('http-pap')) parts.push('http-pap');
  return parts.join(',');
}

function assertCommandOk(stdout, context) {
  const text = String(stdout || '');
  if (
    /failure:\s|syntax error|timed out|could not|interrupted|no such|invalid value|unknown parameter/i.test(
      text
    )
  ) {
    const line =
      text
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .pop() || text.trim();
    throw fail(`${context}: ${line.slice(0, 400)}`, 502);
  }
}

async function runCli(api, line, context) {
  if (typeof api.execCli === 'function') {
    const out = await api.execCli(line);
    assertCommandOk(out, context);
    return out;
  }
  return '';
}

/**
 * Download the saved login page onto each hotspot profile's html directory
 * and allow HTTP PAP so a voucher code can log in.
 */
export async function pushCaptivePortalToRouter(routerId, organizationId) {
  if (!mongoose.isValidObjectId(String(routerId))) throw fail('Invalid router id');
  const q = { _id: routerId };
  if (
    organizationId != null &&
    String(organizationId).trim() &&
    mongoose.isValidObjectId(String(organizationId).trim())
  ) {
    q.organizationId = String(organizationId).trim();
  }
  const router = await Router.findOne(q);
  if (!router) throw fail('Router not found', 404);
  const slug = String(router.portalSlug || '').trim().toLowerCase();
  if (!slug) {
    throw fail('This router has no portal slug. Set one under Network → Routers, then push again.');
  }

  const url = captiveLoginFetchUrl(slug);

  const pushed = await withRouterMikrotik(router, async (api) => {
    const profiles = normalizePrintRows(await api.write('/ip/hotspot/profile/print'));
    if (!profiles.length) {
      throw fail('This router has no hotspot profile. Enable the hotspot package first.', 502);
    }

    const dirs = [...new Set(profiles.map(htmlDirectory))];
    const files = [];
    for (const dir of dirs) {
      const dst = `${dir}/login.html`;
      if (typeof api.execCli === 'function') {
        await runCli(
          api,
          `:do { /file remove [find name=${cliEscapeValue(dst)}] } on-error={}`,
          'Remove old login page'
        );
        await runCli(
          api,
          `/tool fetch url=${cliEscapeValue(url)} dst-path=${cliEscapeValue(dst)} mode=https`,
          'Download login page'
        );
      } else {
        const existing = normalizePrintRows(await api.write('/file/print'));
        for (const file of existing) {
          if (String(file.name || '') !== dst || !file['.id']) continue;
          await api.write(['/file/remove', `=.id=${file['.id']}`]);
        }
        await api.write(['/tool/fetch', `=url=${url}`, `=dst-path=${dst}`, '=mode=https']);
      }
      files.push(dst);
    }

    const updated = [];
    for (const profile of profiles) {
      const id = profile['.id'];
      const name = String(profile.name || '').trim() || 'default';
      const next = withPap(profile['login-by'] || profile.loginBy);
      if (id && next !== String(profile['login-by'] || profile.loginBy || '')) {
        if (typeof api.execCli === 'function') {
          await runCli(
            api,
            `/ip hotspot profile set [find name=${cliEscapeValue(name)}] login-by=${cliEscapeValue(next)}`,
            'Enable voucher login'
          );
        } else {
          await api.write(['/ip/hotspot/profile/set', `=.id=${id}`, `=login-by=${next}`]);
        }
      }
      updated.push({ name, htmlDirectory: htmlDirectory(profile), loginBy: next });
    }
    return { files, profiles: updated };
  });

  let walledGarden = { ok: true };
  try {
    await syncPaymentWalledGarden(routerId, organizationId);
  } catch (e) {
    walledGarden = { ok: false, error: e.message || 'Walled garden sync failed' };
  }

  return {
    ok: true,
    routerId: String(router._id),
    routerName: router.name || router.host,
    portalSlug: slug,
    files: pushed.files,
    profiles: pushed.profiles,
    walledGarden,
  };
}
