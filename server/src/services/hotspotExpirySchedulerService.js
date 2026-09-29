import mongoose from 'mongoose';
import { Router } from '../models/index.js';
import { withRouterMikrotik } from '../mikrotik/routeros.js';
import { normalizePrintRows } from '../mikrotik/helpers.js';
import { rosPairs } from '../utils/rosParams.js';
import { cliEscapeValue, rosScriptLit } from '../mikrotik/rosSsh.js';
import { EXPIRY_STAMP_PREFIX } from '../utils/expiryComment.js';

export const HOTSPOT_EXPIRY_SCRIPT_NAME = 'qarefi_hs_expiry';
export const HOTSPOT_EXPIRY_SCHEDULER_NAME = 'qarefi_hs_expiry';

/**
 * Compact RouterOS script: remove hotspot users whose comment stamp is past system clock.
 * Stamp format: QareFi-exp=YYYYMMDDHHmmss (UTC — set router clock / NTP accordingly).
 */
export function buildHotspotExpiryScriptSource() {
  const marker = EXPIRY_STAMP_PREFIX;
  return [
    `:local monthMap {"jan"="01";"feb"="02";"mar"="03";"apr"="04";"may"="05";"jun"="06";"jul"="07";"aug"="08";"sep"="09";"oct"="10";"nov"="11";"dec"="12"}`,
    `:local d [/system clock get date]`,
    `:local t [/system clock get time]`,
    `:local yyyy`,
    `:local mm`,
    `:local dd`,
    `:if (([:len $d] = 10) and ([:pick $d 4 5] = "-")) do={:set yyyy [:pick $d 0 4];:set mm [:pick $d 5 7];:set dd [:pick $d 8 10]} else={:set mm ($monthMap->[:pick $d 0 3]);:set dd [:pick $d 4 6];:set yyyy [:pick $d 7 11]}`,
    `:local hh [:pick $t 0 2]`,
    `:local mi [:pick $t 3 5]`,
    `:local ss [:pick $t 6 8]`,
    `:local nowStamp [:tonum ("$yyyy$mm$dd$hh$mi$ss")]`,
    `:foreach i in=[/ip hotspot user find where comment~"${marker}"] do={`,
    `:local c [/ip hotspot user get $i comment]`,
    `:local n [/ip hotspot user get $i name]`,
    `:local p [:find $c "${marker}"]`,
    `:if ($p != nil) do={`,
    `:local stamp [:tonum [:pick $c ($p + ${marker.length}) ($p + ${marker.length + 14})]]`,
    `:if (($stamp > 0) and ($stamp < $nowStamp)) do={`,
    `/ip hotspot user remove $i`,
    `:do {/ip hotspot active remove [find where user=$n]} on-error={}`,
    `}`,
    `}`,
    `}`,
  ].join(';');
}

async function removeByName(api, printPath, removePath, name) {
  const rows = normalizePrintRows(await api.write(`${printPath}/print`));
  let removed = 0;
  for (const r of rows) {
    if (String(r.name || '') !== name) continue;
    const id = r['.id'];
    if (!id) continue;
    await api.write([`${removePath}/remove`, `=.id=${id}`]);
    removed++;
  }
  return removed;
}

/**
 * Install / refresh QareFi hotspot wall-clock expiry script + 1m scheduler on one router.
 */
export async function syncHotspotExpiryScheduler(routerId, organizationId) {
  if (!mongoose.isValidObjectId(String(routerId))) {
    const e = new Error('Invalid router id');
    e.status = 400;
    throw e;
  }
  const q = { _id: routerId };
  if (
    organizationId != null &&
    String(organizationId).trim() &&
    mongoose.isValidObjectId(String(organizationId).trim())
  ) {
    q.organizationId = String(organizationId).trim();
  }
  const router = await Router.findOne(q);
  if (!router) {
    const e = new Error('Router not found');
    e.status = 404;
    throw e;
  }

  const source = buildHotspotExpiryScriptSource();
  const scriptName = HOTSPOT_EXPIRY_SCRIPT_NAME;
  const schedName = HOTSPOT_EXPIRY_SCHEDULER_NAME;

  await withRouterMikrotik(router, async (api) => {
    if (typeof api.execCli === 'function') {
      await api.execCli(
        `/system script remove [find name=${cliEscapeValue(scriptName)}]`
      ).catch(() => {});
      await api.execCli(
        `/system scheduler remove [find name=${cliEscapeValue(schedName)}]`
      ).catch(() => {});
      await api.execCli(
        `/system script add name=${cliEscapeValue(scriptName)} owner=admin policy=read,write,policy,test source=${rosScriptLit(source)}`
      );
      await api.execCli(
        `/system scheduler add name=${cliEscapeValue(schedName)} interval=1m ` +
          `on-event=${cliEscapeValue(scriptName)} policy=read,write,policy,test ` +
          `comment=${cliEscapeValue('QareFi hotspot elapsed-time expiry')}`
      );
    } else {
      await removeByName(api, '/system/script', '/system/script', scriptName);
      await removeByName(api, '/system/scheduler', '/system/scheduler', schedName);
      await api.write([
        '/system/script/add',
        ...rosPairs({
          name: scriptName,
          source,
          policy: 'read,write,policy,test',
        }),
      ]);
      await api.write([
        '/system/scheduler/add',
        ...rosPairs({
          name: schedName,
          interval: '1m',
          'on-event': scriptName,
          policy: 'read,write,policy,test',
          comment: 'QareFi hotspot elapsed-time expiry',
        }),
      ]);
    }
  });

  return {
    ok: true,
    routerId: String(router._id),
    routerName: router.name || router.host,
    script: scriptName,
    scheduler: schedName,
    interval: '1m',
    marker: EXPIRY_STAMP_PREFIX,
    note: 'Router system clock should match UTC (or Accra/UTC). Scheduler removes users when QareFi-exp= stamp is past.',
  };
}
