# Hubtel UAT pack — ready to send

Folder: `docs/hubtel-uat-pack/`

## Send to Hubtel

1. Open **`HUBTEL-UAT-PACK.html`** in a browser → **Print → Save as PDF**.  
2. Attach the PDF + the `samples/*.json` files (or zip this whole folder).  
3. Before sending, edit **`03-ip-whitelist-request.md`**: add your **Render outbound IP** (Render Shell → `curl -s https://api.ipify.org`).  
4. Paste **`01-cover-letter.md`** into the email body (or attach it).

## Contents

| File | UAT item |
|------|----------|
| `01-cover-letter.md` | Email / cover |
| `02-integration-flow.md` | Item 5 — flow |
| `HUBTEL-UAT-PACK.html` | Printable PDF of the full pack |
| `samples/sample-callback-*.json` | Item 2 — callbacks (HTTP body) |
| `samples/sample-merchant-log-*.txt` | Item 2 — merchant **success / failed logs** (Render) |
| `samples/sample-transaction-status-*.json` | Item 3 — status check |
| `03-ip-whitelist-request.md` | Status Check IP whitelist |
| `04-uat-meeting-script.md` | Item 1 — meeting script |

## Capture live success + failed logs (for Hubtel)

Hubtel asks for merchant logs that show we handled **success** and **failed** callbacks. After deploying the API:

```bash
# SUCCESS callback → look for HUBTEL CALLBACK SUCCESS in Render logs
curl -sS -X POST 'https://ipaynotifyserver.onrender.com/api/payments/hubtel/callback' \
  -H 'Content-Type: application/json' \
  -d @samples/sample-callback-success.json

# FAILED callback → look for HUBTEL CALLBACK FAILED in Render logs
curl -sS -X POST 'https://ipaynotifyserver.onrender.com/api/payments/hubtel/callback' \
  -H 'Content-Type: application/json' \
  -d @samples/sample-callback-failed.json
```

Screenshot those Render lines into the pack (or replace `sample-merchant-log-*.txt` with the live paste).

Also do one **real** Hubtel checkout success + one cancelled/failed payment so Hubtel-originated callbacks appear with real `clientReference` values.

## Important honesty note

JSON samples are **representative** of the Hubtel formats our system accepts (aligned with Hubtel docs + our callback parser). After one successful UAT payment on production, replace/add the **raw** callback from that payment and a **live** Status Check response (once IPs are whitelisted — Status Check is currently **403** from non-whitelisted IPs).
