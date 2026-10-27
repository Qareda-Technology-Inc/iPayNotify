import { defineConfig } from 'vitest/config';

/**
 * `src/config.js` loads server/.env, but dotenv never overrides variables that are already set.
 * Everything that could reach a real service is pinned here so tests can never send SMS, email,
 * or talk to Hubtel / the WireGuard VPS, whatever is in your .env.
 */
const testEnv = {
  NODE_ENV: 'test',
  MONGODB_URI: 'mongodb://127.0.0.1:1/never-used',
  DEFAULT_ORGANIZATION_ID: '',
  JWT_SECRET: 'test-jwt-secret',
  ROUTER_SECRET_KEY: 'ab'.repeat(32),
  PUBLIC_APP_URL: 'https://app.test',
  PUBLIC_API_URL: 'https://api.test',
  HUBTEL_MERCHANT_ACCOUNT: '2000000',
  HUBTEL_CLIENT_ID: 'test-client',
  HUBTEL_CLIENT_SECRET: 'test-secret',
  HUBTEL_CALLBACK_URL: 'https://api.test/api/payments/hubtel/callback',
  HUBTEL_STATUS_CHECK_URL: 'https://hubtel-status.test/transactions',
  HUBTEL_MOCK: 'false',
  HUBTEL_TRUST_UNVERIFIED_CALLBACKS: 'false',
  PAYMENT_DRAFT_CHECKOUT: 'false',
  PAYMENT_DRAFT_MOMO: 'false',
  ALLOW_PAYMENT_SIMULATION: 'false',
  ARKESEL_API_KEY: '',
  ARKESEL_SENDER_ID: '',
  ARKESEL_MOCK: 'true',
  SMTP_HOST: '',
  SMTP_USER: '',
  SMTP_PASS: '',
  SMTP_MOCK: 'true',
  PAYMENT_ADMIN_NOTIFY_EMAIL: '',
  EXPIRY_REMINDER_SMS_ENABLED: 'false',
  WG_VPS_HOST: '',
  WG_VPS_SSH_KEY_PATH: '',
  WG_VPS_SSH_PRIVATE_KEY: '',
  WG_SERVER_PUBLIC_KEY: '',
  WG_ENDPOINT: '',
};

export default defineConfig({
  test: {
    environment: 'node',
    env: testEnv,
    globalSetup: ['./test/setup/globalSetup.js'],
    setupFiles: ['./test/setup/perFile.js'],
    include: ['test/**/*.test.js'],
    /* The services log heavily (Hubtel payloads, router pushes); show logs only for failures. */
    silent: 'passed-only',
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
