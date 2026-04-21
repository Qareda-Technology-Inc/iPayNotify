import cron from 'node-cron';
import {
  runMidnightBillingJob,
  enforceExpiredPppoeAccounts,
} from '../services/renewalService.js';
import { config } from '../config.js';

let task;
let pppoeExpiryTask;

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
}
