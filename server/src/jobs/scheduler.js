import cron from 'node-cron';
import {
  runMidnightBillingJob,
  enforceExpiredPppoeAccounts,
} from '../services/renewalService.js';
import { runExpiryReminderSmsJob } from '../services/expiryReminderSmsService.js';
import { config } from '../config.js';

let task;
let pppoeExpiryTask;
let expiryReminderSmsTask;

export function startBillingScheduler() {
  if (!task) {
    task = cron.schedule(
      '0 0 * * *',
      async () => {
        try {
          const summary = await runMidnightBillingJob();
          console.log('[billing]', new Date().toISOString(), JSON.stringify(summary));
        } catch (e) {
          console.error('[billing] job failed', e);
        }
      },
      { timezone: config.cronTz }
    );
    console.log(`[billing] cron scheduled 0 0 * * * (${config.cronTz})`);
  }

  if (!pppoeExpiryTask) {
    const expr = config.pppoeExpiryCron || '*/10 * * * *';
    pppoeExpiryTask = cron.schedule(
      expr,
      async () => {
        try {
          const summary = await enforceExpiredPppoeAccounts();
          const quiet =
            String(process.env.PPPOE_EXPIRY_LOG_QUIET || '').toLowerCase() === 'true' ||
            process.env.PPPOE_EXPIRY_LOG_QUIET === '1';
          if (!quiet || summary.checked > 0 || summary.syncFailed > 0) {
            console.log('[billing] pppoe expiry tick', new Date().toISOString(), summary);
          }
        } catch (e) {
          console.error('[billing] pppoe expiry tick failed', e);
        }
      },
      { timezone: config.cronTz }
    );
    console.log(`[billing] PPPoE expiry check "${expr}" (${config.cronTz})`);
  }

  if (config.expiryReminderSms.enabled && !expiryReminderSmsTask) {
    const expr = config.expiryReminderSms.cron || '0 9 * * *';
    expiryReminderSmsTask = cron.schedule(
      expr,
      async () => {
        try {
          const summary = await runExpiryReminderSmsJob({ respectEnabledFlag: true });
          if (summary.skipped) return;
          const quiet = config.expiryReminderSms.logQuiet;
          const totalSent = (summary.pppoe?.sent || 0) + (summary.remote?.sent || 0);
          const totalFail = (summary.pppoe?.failed || 0) + (summary.remote?.failed || 0);
          if (!quiet || totalSent > 0 || totalFail > 0) {
            console.log('[billing] expiry reminder SMS', new Date().toISOString(), summary);
          }
        } catch (e) {
          console.error('[billing] expiry reminder SMS tick failed', e);
        }
      },
      { timezone: config.cronTz }
    );
    console.log(
      `[billing] Expiry reminder SMS cron "${expr}" (${config.cronTz}) — tiers ${config.expiryReminderSms.daysThresholds.join('/')}d (on by default)`
    );
  }
}

export function stopBillingScheduler() {
  if (task) {
    task.stop();
    task = null;
  }
  if (pppoeExpiryTask) {
    pppoeExpiryTask.stop();
    pppoeExpiryTask = null;
  }
  if (expiryReminderSmsTask) {
    expiryReminderSmsTask.stop();
    expiryReminderSmsTask = null;
  }
}
