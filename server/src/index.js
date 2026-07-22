import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { connectDb } from './db/connect.js';
import { seedDefaultAdmin } from './db/seedDefaultAdmin.js';
import { errorHandler } from './middleware/errorHandler.js';
import { healthRouter } from './routes/health.js';
import { authRouter } from './routes/auth.js';
import { publicPortalRouter } from './routes/publicPortal.js';
import { hubtelPaymentsRouter } from './routes/hubtelPayments.js';
import { protectedApiRouter } from './routes/protectedApi.js';
import { superAdminApiRouter } from './routes/superAdminApi.js';
import { startBillingScheduler } from './jobs/scheduler.js';

const app = express();
/** Behind nginx/Cloudflare so req.ip / X-Forwarded-For reflect the customer (for sitePublicIp matching). */
if (process.env.TRUST_PROXY === 'true' || process.env.TRUST_PROXY === '1') {
  app.set('trust proxy', 1);
} else if (process.env.TRUST_PROXY && !Number.isNaN(Number(process.env.TRUST_PROXY))) {
  app.set('trust proxy', Number(process.env.TRUST_PROXY));
}

/** Strip trailing slashes so `https://app.vercel.app/` matches the browser's `https://app.vercel.app`. */
function normalizeCorsOrigin(o) {
  return String(o ?? '')
    .trim()
    .replace(/\/+$/, '');
}

/** Comma-separated exact origins (prod + any preview URL you paste in). No trailing slash. */
const clientOriginsRaw = (process.env.CLIENT_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map((s) => normalizeCorsOrigin(s))
  .filter(Boolean);
const allowedOriginsExact = new Set(clientOriginsRaw);

/**
 * Optional: allow every Vercel deployment hostname for your team without listing each preview URL.
 * Set to the stable part of preview hosts, e.g. `elprofessortechs-projects.vercel.app` (from
 * `something-elprofessortechs-projects.vercel.app`). Comma-separated for multiple teams.
 * Only https origins on matching hosts are accepted.
 */
const vercelPreviewHostSuffixes = (process.env.CORS_VERCEL_PREVIEW_HOST_SUFFIX || '')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

function hostMatchesVercelPreviewSuffix(hostname, suffixes) {
  const h = String(hostname || '').toLowerCase();
  return suffixes.some((s) => h === s || h.endsWith(`.${s}`) || h.endsWith(s));
}

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) {
        callback(null, true);
        return;
      }
      const norm = normalizeCorsOrigin(origin);
      if (allowedOriginsExact.has(norm)) {
        callback(null, origin);
        return;
      }
      try {
        const u = new URL(origin);
        if (u.protocol !== 'https:') {
          callback(null, false);
          return;
        }
        if (
          vercelPreviewHostSuffixes.length > 0 &&
          hostMatchesVercelPreviewSuffix(u.hostname, vercelPreviewHostSuffixes)
        ) {
          callback(null, origin);
          return;
        }
      } catch {
        callback(null, false);
        return;
      }
      callback(null, false);
    },
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Organization-Id'],
  })
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use('/api/health', healthRouter);
app.use('/api/auth', authRouter);
app.use('/api/public', publicPortalRouter);
app.use('/api/payments/hubtel', hubtelPaymentsRouter);
/** Legacy path kept so old MTN callback registrations still hit a handler if needed. */
app.use('/api/payments/momo', hubtelPaymentsRouter);
app.use('/api/super-admin', superAdminApiRouter);
app.use('/api', protectedApiRouter);

app.use(errorHandler);

await connectDb();
await seedDefaultAdmin();
if (process.env.NODE_ENV === 'production' && config.jwtSecret === 'change-me-in-production') {
  console.warn('[auth] Set JWT_SECRET in production — using default is insecure.');
}
startBillingScheduler();

app.listen(config.port, () => {
  console.log(`QareFi Billing API http://localhost:${config.port}`);
});
