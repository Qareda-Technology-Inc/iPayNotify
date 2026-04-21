# QareFi Billing

Multi-tenant admin dashboard for ISPs: **MikroTik** (PPPoE, hotspot, routers), **MTN MoMo** payments for renewals and hotspot vouchers, **customer** records, **SMS** (templates and broadcasts via Arkesel), and scheduled jobs (PPPoE expiry sync, billing).

## Repository layout

| Path       | Role |
|-----------|------|
| `server/` | Express API (MongoDB, JWT auth, RouterOS API/SSH, MoMo callback, cron) |
| `client/` | React + Vite + Tailwind SPA |
| Root      | `concurrently` script to run API + web together |

## Prerequisites

- **Node.js** 18+ (tested with current LTS lines)
- **MongoDB** (local or Atlas URI)

## Setup

1. **Clone** and install dependencies (root + both apps):

   ```bash
   npm install
   npm install --prefix server
   npm install --prefix client
   ```

2. **Environment** — copy the example and edit (never commit real secrets):

   ```bash
   cp server/.env.example server/.env
   ```

   Important variables (see `server/.env.example` for full list and comments):

   - `MONGODB_URI`, `JWT_SECRET`, `CLIENT_ORIGIN`, `PUBLIC_APP_URL`
   - `PORT` (API, default `4000`)
   - MikroTik / MoMo / Arkesel blocks as needed for your environment

3. **Database helpers** (when upgrading or first deploy):

   ```bash
   cd server && npm run db:backfill-organization
   cd server && npm run db:backfill-admin-roles   # if you use org_admin roles
   ```

4. **Development** — from the **repository root**:

   ```bash
   npm run dev
   ```

   - API: `http://localhost:4000` (or your `PORT`)
   - Web: `http://localhost:5173` — Vite proxies `/api` to the API (`VITE_API_PROXY_TARGET` overrides the proxy target)

   Run only one side if you prefer:

   ```bash
   npm run dev:server
   npm run dev:client
   ```

5. **Production build** (static client):

   ```bash
   npm run build --prefix client
   ```

   Serve `client/dist` behind your reverse proxy and run `node server/src/index.js` (or `npm start --prefix server`) with production `NODE_ENV` and env vars set.

## Main features

- **Organisations** — tenants with slug, status, optional per-org MoMo credentials and SMS/merchant branding.
- **Customers** — billing users (phone, wallet, auto-renewal). PPPoE lines can be **linked** to a customer for SMS segments and renewals.
- **MikroTik** — per-site routers (API or SSH transport), PPPoE accounts, hotspot vouchers, walled-garden sync, **active sessions** (PPP + hotspot).
- **Payments** — MTN MoMo Collections (request-to-pay); optional draft/mock flow for local testing.
- **Messages** — SMS templates (categories), broadcasts (segments, picked customers, or manual numbers), send-time placeholders (e.g. maintenance `{{date}}`).
- **Jobs** — `PPPOE_EXPIRY_CRON` pushes expired profiles to routers; midnight billing job (see `server/src/jobs/scheduler.js`).

## API overview

- `GET /api/health` — liveness
- `POST /api/auth/*` — sign-in, JWT
- `GET/POST /api/public/*` — customer portal (renewals, hotspot checkout)
- `POST /api/payments/momo/callback` — MoMo webhook (configure in MTN portal)
- `GET /api/*` — authenticated dashboard API (`Authorization: Bearer …`; super admins may send `X-Organization-Id` to act in a tenant)

## Security notes for GitHub

- Do **not** commit `server/.env` or production credentials.
- Use strong `JWT_SECRET` in production.
- Restrict MoMo callback URL and Arkesel keys to your deployed host.

## License

Private / unlicensed unless you add a `LICENSE` file. Set the correct license for your organisation before open-sourcing.
