import dotenv from 'dotenv';

dotenv.config();

export const config = {
  port: Number(process.env.PORT) || 4000,
  mongoUri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/qarefi_billing',
  /** After `npm run db:backfill-organization`, set this to the printed id (optional if slug fallback is enough). */
  defaultOrganizationId: (process.env.DEFAULT_ORGANIZATION_ID || '').trim(),
  jwtSecret: process.env.JWT_SECRET || 'change-me-in-production',
  jwtExpiresIn: String(process.env.JWT_EXPIRES_IN || '7d').trim(),
  mikrotik: {
    host: process.env.MIKROTIK_HOST || '192.168.88.1',
    port: Number(process.env.MIKROTIK_PORT) || 8728,
    user: process.env.MIKROTIK_USER || 'admin',
    password: process.env.MIKROTIK_PASSWORD || '',
  },
  profiles: {
    defaultPpp: process.env.MIKROTIK_DEFAULT_PPP_PROFILE || 'default',
    expiredPpp: process.env.MIKROTIK_EXPIRED_PPP_PROFILE || 'nonpayment',
  },
  publicAppUrl:
    process.env.PUBLIC_APP_URL || process.env.CLIENT_ORIGIN || 'http://localhost:5173',
  /**
   * When true, PPPoE renew + hotspot checkout skip Hubtel and return `mode: draft_hubtel`
   * for an in-app test prompt. Prefer HUBTEL_MOCK for redirect-to-mock-page testing.
   */
  paymentDraftCheckout:
    process.env.PAYMENT_DRAFT_CHECKOUT === 'true' ||
    process.env.PAYMENT_DRAFT_MOMO === 'true',
  /** Shown on checkout description / draft UI */
  merchant: {
    displayName: (process.env.MERCHANT_DISPLAY_NAME || 'QareFi Billing').trim(),
  },
  /** Hubtel Online Checkout — https://developers.hubtel.com / unified-pay SDK */
  hubtel: {
    merchantAccount: (process.env.HUBTEL_MERCHANT_ACCOUNT || '').trim(),
    clientId: (process.env.HUBTEL_CLIENT_ID || '').trim(),
    clientSecret: (process.env.HUBTEL_CLIENT_SECRET || '').trim(),
    callbackUrl: (process.env.HUBTEL_CALLBACK_URL || '').trim(),
    mock: process.env.HUBTEL_MOCK === 'true',
    allowedChannels: String(process.env.HUBTEL_ALLOWED_CHANNELS || 'mobileMoney,bankCard')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  },
  /** @deprecated Prefer `hubtel` — kept empty so older walled-garden helpers do not crash. */
  mtnMomo: {
    subscriptionKey: '',
    apiUser: '',
    apiKey: '',
    targetEnvironment: '',
    baseUrl: '',
    callbackUrl: '',
    mockRequest: false,
  },
  /**
   * Hotspot walled garden: allow billing + payment hosts before login.
   * SYNC_WALLED_GARDEN_ON_PING=false disables auto-sync after "Test connection".
   * WALLED_GARDEN_EXTRA_HOSTS= — optional comma list; empty clears defaults (URL-derived hosts still added).
   */
  walledGarden: {
    syncOnPing: process.env.SYNC_WALLED_GARDEN_ON_PING !== 'false',
    extraDstHosts:
      process.env.WALLED_GARDEN_EXTRA_HOSTS !== undefined
        ? String(process.env.WALLED_GARDEN_EXTRA_HOSTS)
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : [],
  },
  cronTz: process.env.CRON_TZ || 'UTC',
  // PPPOE_EXPIRY_CRON: 5-field cron (min hour dom mon dow). Default every 10 minutes if unset.
  pppoeExpiryCron: (process.env.PPPOE_EXPIRY_CRON || '*/10 * * * *').trim(),
  /**
   * SMS to PPPoE (linked User.phone) & remote-access subscribers when paidUntil is within N days (not yet expired).
   * Opt-in: set EXPIRY_REMINDER_SMS_ENABLED=true. Uses MessageTemplate category `expiry_reminder_3d` per organisation.
   */
  expiryReminderSms: {
    enabled: process.env.EXPIRY_REMINDER_SMS_ENABLED === 'true' || process.env.EXPIRY_REMINDER_SMS_ENABLED === '1',
    days: Math.min(
      14,
      Math.max(1, Number(process.env.EXPIRY_REMINDER_DAYS) || 3)
    ),
    cron: (process.env.EXPIRY_REMINDER_SMS_CRON || '0 9 * * *').trim(),
    logQuiet:
      String(process.env.EXPIRY_REMINDER_SMS_LOG_QUIET || '').toLowerCase() === 'true' ||
      process.env.EXPIRY_REMINDER_SMS_LOG_QUIET === '1',
  },
  /** Arkesel SMS — https://sms.arkesel.com/api/v2/sms/send */
  arkesel: {
    apiKey: (process.env.ARKESEL_API_KEY || '').trim(),
    senderId: (process.env.ARKESEL_SENDER_ID || '').trim(),
    smsUrl:
      (process.env.ARKESEL_SMS_URL || 'https://sms.arkesel.com/api/v2/sms/send').trim(),
    /** Log SMS to console instead of calling the API */
    mock: process.env.ARKESEL_MOCK === 'true',
    brandName: (process.env.SMS_BRAND_NAME || 'QareFi').trim(),
    /** Parallel HTTP calls per broadcast batch (1–20). */
    sendConcurrency: Math.min(
      20,
      Math.max(1, Number(process.env.ARKESEL_SEND_CONCURRENCY) || 5)
    ),
  },
  /** Main admin (created only when `admins` collection is empty). Override in production via env. */
  defaultAdmin: {
    email: process.env.DEFAULT_ADMIN_EMAIL || 'qaredadev@gmail.com',
    password: process.env.DEFAULT_ADMIN_PASSWORD || 'qarefi2026',
    /** Optional Ghana MSISDN for SMS login verification on seeded super admin */
    phone: (process.env.DEFAULT_ADMIN_PHONE || '').trim(),
    fullName: (process.env.DEFAULT_ADMIN_FULL_NAME || '').trim(),
  },
  /**
   * When true, POST /api/auth/login returns a verification step; codes are sent by email (SMTP) and/or SMS (Arkesel).
   * At least one channel must be available: SMTP configured, or admin has a normalised Ghana phone and Arkesel is ready/mock.
   */
  adminLoginVerify: process.env.ADMIN_LOGIN_VERIFY === 'true',
  /** Nodemailer SMTP — used for admin login verification and future transactional mail */
  smtp: {
    host: (process.env.SMTP_HOST || '').trim(),
    port: Number(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === 'true' || process.env.SMTP_SECURE === '1',
    user: (process.env.SMTP_USER || '').trim(),
    pass: (process.env.SMTP_PASS || '').trim(),
    from: (process.env.SMTP_FROM || '').trim(),
    /** Log messages only; no SMTP connection */
    mock: process.env.SMTP_MOCK === 'true',
  },
};
