# Integration flow — Hubtel Online Checkout (External)

**Product:** iPay subscriber billing (Qaretech Innovative)  
**Checkout:** Hubtel Online Checkout — External — Modal (`@hubteljs/checkout`)  
**Live app:** https://ipaysub.vercel.app  
**Live API:** https://ipaynotifyserver.onrender.com  
**Callback:** https://ipaynotifyserver.onrender.com/api/payments/hubtel/callback  

---

## High-level architecture

```
 Customer browser                 iPay API (Render)              Hubtel
 ─────────────────               ─────────────────              ──────
 1. Open /portal/renew
 2. Enter PPPoE username  ──►  Lookup account / price
 3. Proceed to checkout   ──►  Create pending Transaction
                               Generate unique clientReference (QF-…)
                               Build purchaseInfo + config
                          ◄──  Return session to browser
 4. CheckoutSdk.openModal({ purchaseInfo, config })
                          ─────────────────────────────►  Checkout UI
 5. Customer pays (MoMo / card)
                          ◄─────────────────────────────  Payment result
 6.                                ◄── Callback POST/GET ──  Notify merchant
                               Match clientReference
                               Mark paid / failed
                               Fulfill PPPoE or voucher
                               SMS customer / email admin
 7. (If callback delayed) ──►  Status Check API  ─────────►  Paid/Unpaid
```

---

## Step detail

### A. Pre-checkout (merchant backend)

Our API creates the order locally, then returns everything the Checkout SDK needs.

**Example purchaseInfo**

```json
{
  "amount": 1.0,
  "purchaseDescription": "QareFi Billing: PPPoE renewal — customeruser",
  "customerPhoneNumber": "233XXXXXXXXX",
  "clientReference": "QF-f13b21d32ea0c37a438c648c"
}
```

**Example config**

```json
{
  "branding": "enabled",
  "callbackUrl": "https://ipaynotifyserver.onrender.com/api/payments/hubtel/callback",
  "merchantAccount": 1234567,
  "basicAuth": "<base64(clientId:clientSecret) — no 'Basic ' prefix>",
  "integrationType": "External",
  "allowedChannels": ["mobileMoney", "bankCard"]
}
```

Notes:

- `clientReference` is unique and never reused.  
- `basicAuth` is the raw Base64 credential string only (per Hubtel docs).  
- Pre-checkout is implemented on **our** backend (not a separate Hubtel invoice API) as required for External Checkout.

### B. Checkout (customer)

Browser loads `@hubteljs/checkout` and calls:

```javascript
const checkout = new CheckoutSdk();
checkout.openModal({ purchaseInfo, config, callBacks: { /* onPaymentSuccess / onPaymentFailure */ } });
```

### C. Callback (Hubtel → merchant)

| Property | Value |
|----------|--------|
| URL | `https://ipaynotifyserver.onrender.com/api/payments/hubtel/callback` |
| Methods | `POST`, `GET` |
| Success handling | Mark transaction paid → extend PPPoE / issue voucher |
| Failure handling | Mark transaction failed |
| HTTP response | `200` with `{ received: true, … }` when `ClientReference` is present |

### D. Transaction Status Check (mandatory fallback)

```
GET https://api-txnstatus.hubtel.com/transactions/{Collection_Account_Number}/status?clientReference={clientReference}
Authorization: Basic {base64(clientId:clientSecret)}
```

Used when a final callback is not received within ~5 minutes, and for UAT evidence.

---

## End-user journeys covered

1. **PPPoE renewal** — lookup username → show package/amount/expiry → Hubtel pay → line extended.  
2. **Hotspot voucher purchase** — select package → Hubtel pay → voucher code issued (SMS).

---

## Environments

| Layer | Host |
|-------|------|
| Customer SPA | Vercel — `ipaysub.vercel.app` |
| Merchant API + callback | Render — `ipaynotifyserver.onrender.com` |
