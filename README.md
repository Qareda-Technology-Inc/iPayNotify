# QareFi Billing

Multi-tenant billing platform for ISPs running **MikroTik**: PPPoE subscribers, hotspot vouchers, router management over WireGuard, **Hubtel** online checkout, a per-organisation **wallet** with platform fee and withdrawals, **SMS** via Arkesel, and offline voucher **ticket sales** for resellers.

## Repository layout

| Path      | Role |
|-----------|------|
| `server/` | Express API — MongoDB (Mongoose), JWT auth, RouterOS API/SSH, Hubtel callbacks, cron jobs |
| `client/` | React + Vite + Tailwind SPA — admin dashboard (`/`) and customer portal (`/portal/*`) |
| `docs/`   | Hubtel UAT pack and integration flow |
| `scripts/mikrotik/` | RouterOS script for WireGuard self-registration |

## Prerequisites

- **Node.js** 18+
- **MongoDB** (local or Atlas)

## Setup

1. **Install** each app:

   ```bash
   npm install --prefix server
   npm install --prefix client
   ```

2. **Environment** — copy the templates and edit (never commit real secrets):

   ```bash
   cp server/.env.example server/.env
   cp client/.env.example client/.env
   ```

   Key server variables (full list and comments in `server/.env.example`):

   | Variable | Purpose |
   |---|---|
   | `MONGODB_URI`, `PORT` | Database and API port (default `4000`) |
   | `JWT_SECRET` | Signs admin JWTs — required in production |
   | `ROUTER_SECRET_KEY` | 32-byte key that encrypts router API/SSH passwords at rest |
   | `CLIENT_ORIGIN`, `CORS_VERCEL_PREVIEW_HOST_SUFFIX` | Allowed browser origins |
   | `PUBLIC_APP_URL`, `PUBLIC_API_URL` | Frontend and API base URLs |
   | `HUBTEL_*` | Merchant account, client id/secret, callback URL |
   | `HUBTEL_MOCK`, `PAYMENT_DRAFT_CHECKOUT`, `ALLOW_PAYMENT_SIMULATION` | Local payment testing |
   | `ARKESEL_*`, `SMS_BRAND_NAME` | SMS |
   | `SMTP_*` | Admin invites and login codes |
   | `WG_*` | WireGuard VPS used to reach routers |
   | `CRON_TZ`, `PPPOE_EXPIRY_CRON`, `EXPIRY_REMINDER_*` | Job schedules |

   Client: `VITE_API_BASE_URL` in production (API on a different host), `VITE_API_PROXY_TARGET` for the dev proxy.

3. **Database helpers** (first deploy or upgrades), from `server/`:

   ```bash
   npm run db:backfill-organization
   npm run db:backfill-admin-roles
   npm run db:backfill-pppoe-renew-codes
   npm run db:backfill-wallet-settlements
   npm run db:encrypt-router-secrets   # after setting ROUTER_SECRET_KEY
   npm run db:purge-org-hubtel-credentials -- --apply   # one-off: drop legacy per-org Hubtel keys
   npm run db:sync-indexes
   ```

4. **Development** — run the API and the web app in two terminals:

   ```bash
   npm run dev --prefix server
   ```

   ```bash
   npm run dev --prefix client
   ```

   - API: `http://localhost:4000`
   - Web: `http://localhost:5173` (Vite proxies `/api` to the API)

5. **Tests** (server) — Vitest against an in-memory MongoDB; nothing reaches Hubtel, Arkesel, SMTP or routers:

   ```bash
   npm test --prefix server
   ```

   The first run downloads a MongoDB binary (cached afterwards). Tests live in `server/test/`.

6. **Production** — the client is a static build (Vercel, see `client/vercel.json`); the API runs with `npm start --prefix server` (e.g. on Render). Point `HUBTEL_CALLBACK_URL` at the **API** host, not the frontend.

## How it works

### Tenancy and roles

Each ISP is an `Organization` (status `active` / `trial` / `past_due` / `suspended`, optional modules and limits, branding, portal design, optional own Hubtel credentials). Admin roles: `super_admin`, `org_admin`, `ticket_manager`, `org_staff`. Super admins may send `X-Organization-Id` to act inside a tenant.

### Payments

1. A customer renews PPPoE (`/portal/renew`, by renew code, phone or username) or buys a hotspot voucher (`/portal/hotspot`).
2. The API creates a pending `Transaction` and a Hubtel Online Checkout session.
3. Hubtel posts to `/api/payments/hubtel/callback`; a background job also polls Hubtel status for unconfirmed payments.
4. On paid: renewal → extend `paidUntil` and sync the PPP secret; voucher → create the code, push it to the router, SMS it.
5. The net amount (after the platform fee) is credited to the organisation wallet ledger. Organisations request withdrawals; a super admin pays out offline and marks them paid.

Auto-renewal only debits a customer's in-app balance — Hubtel checkout cannot charge silently.

### Scheduled jobs (`server/src/jobs/scheduler.js`)

| Schedule | Job |
|---|---|
| every minute | Router online/offline monitor; Hubtel unconfirmed-payment check |
| every 2 min | Retry fulfilment of paid transactions; hotspot plan enforcement |
| every 5 min | Remote-access subscription block/unblock |
| `PPPOE_EXPIRY_CRON` (10 min) | Move expired PPPoE accounts to the expired profile |
| hourly at :15 | Fail checkouts pending > 24h |
| `EXPIRY_REMINDER_SMS_CRON` (09:00) | Expiry reminder SMS |
| midnight | Auto-renew, expiry, hotspot purge, near-expiry sync |

## API overview

- `GET /api/health` — liveness
- `POST /api/auth/*` — sign-in (with email/SMS code for org admins), invites
- `GET/POST /api/public/*` — customer portal: portal context, packages, renew quote/checkout, hotspot checkout, payment status, captive login page
- `POST /api/payments/hubtel/callback` — Hubtel webhook (`/api/payments/momo/callback` is kept as a legacy alias)
- `POST /api/routers/register` — WireGuard self-registration from MikroTik
- `/api/super-admin/*` — platform administration
- `/api/*` — authenticated dashboard API (`Authorization: Bearer …`)

## Security notes

- Do **not** commit `server/.env` or production credentials.
- Use a strong `JWT_SECRET` and set `ROUTER_SECRET_KEY` in production; back the key up — losing it means re-entering every router password.
- Keep `ALLOW_PAYMENT_SIMULATION` off in production.

## License

Private / unlicensed unless you add a `LICENSE` file.
