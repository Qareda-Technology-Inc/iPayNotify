# Hubtel Online Checkout — Integration flow (iPay / QareFi Billing)

**Merchant app:** iPay subscriber billing (PPPoE renew + hotspot voucher purchase)  
**Live app (customer):** https://ipaysub.vercel.app  
**Live API:** https://ipaynotifyserver.onrender.com  
**Callback URL:** https://ipaynotifyserver.onrender.com/api/payments/hubtel/callback  

**Integration type:** Hubtel Online Checkout — **External** (JS SDK: `@hubteljs/checkout`, modal)  
**APIs used:** Pre-checkout (merchant backend) → Checkout SDK → Payment callback → (UAT) Transaction Status Check  

---

## 1. End-user journey (UAT demo script)

### A. PPPoE renewal

1. Customer opens renew portal: `https://ipaysub.vercel.app/portal/renew?r=<site-slug>`
2. Enters **PPPoE username** → app looks up account (package, amount, expiry).
3. Customer taps **Proceed to checkout**.
4. Backend creates a pending transaction with a unique `clientReference` (`QF-…`) and returns Hubtel `purchaseInfo` + `config` (merchantAccount, basicAuth, callbackUrl).
5. Frontend opens Hubtel **Checkout modal** (`CheckoutSdk.openModal`).
6. Customer enters MoMo number / pays in Hubtel UI.
7. Hubtel POSTs result to our **callback URL**.
8. Backend marks transaction **paid**, extends PPPoE `paidUntil`, syncs MikroTik, sends customer SMS + admin email.
9. Portal shows payment success / return page.

### B. Hotspot voucher (if in scope for UAT)

1. Customer opens hotspot buy page on the portal.
2. Selects package → checkout → same Hubtel modal + callback + voucher issuance SMS.

---

## 2. How the app interfaces with Hubtel

```
┌─────────────┐     1. Lookup + quote      ┌──────────────────┐
│  Customer   │ ─────────────────────────► │  iPay API        │
│  (browser)  │                            │  (Render)        │
└──────┬──────┘     2. Create pending tx   └────────┬─────────┘
       │            unique clientReference          │
       │            build purchaseInfo + config     │
       │ ◄──────────────────────────────────────────┘
       │
       │  3. openModal({ purchaseInfo, config })
       ▼
┌──────────────────┐   4. Customer pays    ┌──────────────────┐
│  Hubtel Checkout │ ─────────────────────►│  Telco / Card    │
│  SDK (modal)     │                       └──────────────────┘
└────────┬─────────┘
         │  5. Callback POST/GET
         ▼
┌──────────────────┐   6. Fulfill service  ┌──────────────────┐
│  /api/payments/  │ ─────────────────────►│  MikroTik / SMS  │
│  hubtel/callback │                       └──────────────────┘
└──────────────────┘
         │
         │  7. (Mandatory) Status check if callback delayed
         ▼
┌──────────────────┐
│  Hubtel Txn      │  GET /transactions/{CollectionAccount}/status
│  Status API      │  ?clientReference=…
└──────────────────┘
```

### Pre-checkout (our backend → Hubtel SDK config)

We do **not** call a Hubtel “create invoice” HTTP API for External checkout.  
Our backend prepares the payload the SDK needs:

| Field | Source |
|--------|--------|
| `amount` | Package price (GHS) |
| `purchaseDescription` | Merchant name + renew/voucher description |
| `customerPhoneNumber` | Linked customer phone when available (else Hubtel UI) |
| `clientReference` | Unique per attempt (`QF-` + hex) — **never reused** |
| `merchantAccount` | Hubtel merchant / POS account id |
| `basicAuth` | Base64(`clientId:clientSecret`) — **no** `Basic ` prefix |
| `callbackUrl` | `https://ipaynotifyserver.onrender.com/api/payments/hubtel/callback` |
| `integrationType` | `External` |
| `branding` | `enabled` |

### Callback (Hubtel → our API)

- **URL:** `POST` or `GET` `/api/payments/hubtel/callback`
- We read `ClientReference` / `clientReference` (and nested variants).
- Success → mark paid + fulfill; failure → mark failed; otherwise acknowledge pending.
- We always respond **HTTP 200** when the reference is understood so Hubtel stops unnecessary retries after success.

### Transaction status check (Hubtel requirement)

- **Endpoint:** `GET https://api-txnstatus.hubtel.com/transactions/{Collection_Account_Number}/status?clientReference={ref}`
- **Auth:** `Authorization: Basic {same base64 clientId:clientSecret}`
- **Note:** Caller IPs must be **whitelisted** by Hubtel (submit Render egress / office IPs).
- Use when callback is delayed (>5 minutes) or for UAT evidence.

---

## 3. Artefacts to attach for Hubtel UAT

1. **This flow document** (PDF/PPT export).
2. **Sample callbacks** — redacted JSON from successful (and failed, if any) payments (`Transaction.meta.callback`).
3. **Sample status-check response** — JSON from the Status Check API for the same `clientReference`.
4. **Live links:**
   - App: https://ipaysub.vercel.app/portal/renew
   - API health: https://ipaynotifyserver.onrender.com/api/health
   - Callback: https://ipaynotifyserver.onrender.com/api/payments/hubtel/callback
5. **UAT meeting** — walk an end user through renew → Hubtel pay → service extended.

---

## 4. Security / go-live notes

- `clientReference` is unique per checkout attempt.
- Secrets stay on the server; only `basicAuth` string is passed into the Checkout SDK as required by Hubtel External docs.
- Callback URL is public HTTPS on the API host (not the Vercel SPA path).
- Production env: `HUBTEL_MOCK=false`, valid merchant + client id/secret, correct `HUBTEL_CALLBACK_URL`.
