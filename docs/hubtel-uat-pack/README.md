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
| `samples/sample-callback-*.json` | Item 2 — callbacks |
| `samples/sample-transaction-status-*.json` | Item 3 — status check |
| `03-ip-whitelist-request.md` | Status Check IP whitelist |
| `04-uat-meeting-script.md` | Item 1 — meeting script |

## Important honesty note

JSON samples are **representative** of the Hubtel formats our system accepts (aligned with Hubtel docs + our callback parser). After one successful UAT payment on production, replace/add the **raw** callback from that payment and a **live** Status Check response (once IPs are whitelisted — Status Check is currently **403** from non-whitelisted IPs).
