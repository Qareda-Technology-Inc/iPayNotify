import mongoose from 'mongoose';
import { config } from '../config.js';
import { Router } from '../models/index.js';
import { withRouterMikrotik } from '../mikrotik/routeros.js';
import { normalizePrintRows } from '../mikrotik/helpers.js';
import { cliEscapeValue } from '../mikrotik/rosSsh.js';
import { syncPaymentWalledGarden } from './walledGardenSyncService.js';
import { ensurePortalSlug } from './portalContextService.js';

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

/** The profile's html-directory as set on the router, or '' when unset/unusable. */
export function configuredHtmlDirectory(profile) {
  const dir = String(profile['html-directory'] || profile.htmlDirectory || '')
    .trim()
    .replace(/^\/+|\/+$/g, '');
  return dir && /^[A-Za-z0-9_./-]+$/.test(dir) && !dir.includes('..') ? dir : '';
}

/** Does a file/folder exist on the router? Returns { exists, size }. */
async function statFile(api, name) {
  if (typeof api.execCli === 'function') {
    const out = String(
      await api.execCli(
        `:local f [/file find name=${cliEscapeValue(name)}]; :if ([:len $f] = 0) do={ :put "missing" } else={ :put ("size=" . [/file get $f size]) }`
      )
    ).trim();
    if (/missing/.test(out) || !/size=/.test(out)) return { exists: false, size: null };
    const n = Number(out.match(/size=([\d.]+)/)?.[1]);
    return { exists: true, size: Number.isFinite(n) ? n : null };
  }
  const rows = normalizePrintRows(await api.write(['/file/print', `?name=${name}`]));
  const row = rows.find((r) => String(r.name || '') === name);
  return row ? { exists: true, size: Number(row.size) || null } : { exists: false, size: null };
}

async function setProfileValue(api, profile, key, value, context) {
  const name = String(profile.name || '').trim() || 'default';
  if (typeof api.execCli === 'function') {
    await runCli(
      api,
      `/ip hotspot profile set [find name=${cliEscapeValue(name)}] ${key}=${cliEscapeValue(value)}`,
      context
    );
  } else {
    await api.write(['/ip/hotspot/profile/set', `=.id=${profile['.id']}`, `=${key}=${value}`]);
  }
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
 * Download the saved login page into the html directory of the chosen hotspot server's profile
 * and allow HTTP PAP on that profile so a ticket code can log in.
 * Other servers sharing the same html directory see the same page (listed in `sharedWith`).
 */
export async function pushCaptivePortalToRouter(routerId, organizationId, { hotspotServer } = {}) {
  const serverName = String(hotspotServer || '').trim();
  if (!serverName) throw fail('Choose the hotspot server to push the login page to.');
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
  const slug = await ensurePortalSlug(router);

  const url = captiveLoginFetchUrl(slug);

  const pushed = await withRouterMikrotik(router, async (api) => {
    const servers = normalizePrintRows(await api.write('/ip/hotspot/print'));
    const server = servers.find((s) => String(s.name || '').trim() === serverName);
    if (!server) {
      throw fail(`Hotspot server "${serverName}" was not found on this router.`, 404);
    }
    const allProfiles = normalizePrintRows(await api.write('/ip/hotspot/profile/print'));
    const profileName = String(server.profile || '').trim() || 'default';
    const profile = allProfiles.find((p) => String(p.name || '').trim() === profileName);
    if (!profile) {
      throw fail(`Hotspot profile "${profileName}" used by server "${serverName}" was not found.`, 502);
    }
    const profiles = [profile];
    const configuredDir = configuredHtmlDirectory(profile);
    const dir =
      configuredDir || ((await statFile(api, 'flash/hotspot')).exists ? 'flash/hotspot' : 'hotspot');
    if (!configuredDir) {
      await setProfileValue(api, profile, 'html-directory', dir, 'Set hotspot html directory');
    }
    const sharedWith = servers
      .filter((s) => String(s.name || '').trim() !== serverName)
      .filter((s) => {
        const p = allProfiles.find((x) => String(x.name || '').trim() === (String(s.profile || '').trim() || 'default'));
        return p && p !== profile && (configuredHtmlDirectory(p) || '') === configuredDir && configuredDir;
      })
      .map((s) => String(s.name || '').trim());

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
    const written = await statFile(api, dst);
    if (!written.exists) {
      throw fail(
        `The router did not save ${dst}. Check that it can open ${new URL(url).host} over HTTPS (DNS and internet on the router).`,
        502
      );
    }
    const files = [dst];

    const updated = [];
    for (const p of profiles) {
      const name = String(p.name || '').trim() || 'default';
      const next = withPap(p['login-by'] || p.loginBy);
      if (next !== String(p['login-by'] || p.loginBy || '')) {
        await setProfileValue(api, p, 'login-by', next, 'Enable ticket login');
      }
      updated.push({ name, htmlDirectory: dir, loginBy: next });
    }
    return {
      files,
      profiles: updated,
      sharedWith,
      htmlDirectory: dir,
      htmlDirectorySet: !configuredDir,
      profileName,
      fileSize: written.size,
    };
  });

  router.captivePortal = {
    hotspotServer: serverName,
    profile: pushed.profileName,
    htmlDirectory: pushed.htmlDirectory,
    file: pushed.files[0],
    pushedAt: new Date(),
  };
  await router.save();

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
    hotspotServer: serverName,
    htmlDirectory: pushed.htmlDirectory,
    htmlDirectorySet: pushed.htmlDirectorySet,
    profile: pushed.profileName,
    fileSize: pushed.fileSize,
    pushedAt: router.captivePortal.pushedAt,
    sharedWith: pushed.sharedWith,
    files: pushed.files,
    profiles: pushed.profiles,
    walledGarden,
  };
}
