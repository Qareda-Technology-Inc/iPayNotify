import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { connectDb } from './db/connect.js';
import { seedDefaultAdmin } from './db/seedDefaultAdmin.js';
import { errorHandler } from './middleware/errorHandler.js';
import { healthRouter } from './routes/health.js';
import { authRouter } from './routes/auth.js';
import { publicPortalRouter } from './routes/publicPortal.js';
import { momoPaymentsRouter } from './routes/momoPayments.js';
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

const clientOrigin = process.env.CLIENT_ORIGIN || 'http://localhost:5173';

app.use(
  cors({
    origin: clientOrigin,
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Organization-Id'],
  })
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use('/api/health', healthRouter);
app.use('/api/auth', authRouter);
app.use('/api/public', publicPortalRouter);
app.use('/api/payments/momo', momoPaymentsRouter);
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
