# Hubtel UAT submission — iPay (QareFi Billing)

**To:** Hubtel Retail Systems / Onboarding  
**From:** Qaretech Innovative / iPay  
**Subject:** UAT pack — Online Checkout (External) — ready for go-live review  

---

Dear Hubtel team,

Please find below our UAT submission for **Hubtel Online Checkout (External integration)** used by our subscriber billing product **iPay**.

We use your Checkout JS SDK (`@hubteljs/checkout`, modal) for customer payments (PPPoE renewal and hotspot vouchers). Our backend prepares a unique `clientReference`, opens checkout with merchant account + Basic Auth, receives callbacks on our public HTTPS API, and fulfills service after successful payment.

## Live links (item 4)

| Item | URL |
|------|-----|
| Customer app | https://ipaysub.vercel.app |
| Renew (end-user flow) | https://ipaysub.vercel.app/portal/renew |
| API | https://ipaynotifyserver.onrender.com |
| API health | https://ipaynotifyserver.onrender.com/api/health |
| **Payment callback** | https://ipaynotifyserver.onrender.com/api/payments/hubtel/callback |

## Enclosed in this pack

1. `02-integration-flow.md` — predesigned flow of how our app interfaces with Hubtel (also available as printable HTML).  
2. `samples/sample-callback-success.json` — callback payload format our system processes (success).  
3. `samples/sample-callback-failed.json` — callback payload format (failed / unpaid).  
4. `samples/sample-transaction-status-paid.json` — Transaction Status Check response (Paid).  
5. `samples/sample-transaction-status-unpaid.json` — Transaction Status Check response (Unpaid).  
6. `03-ip-whitelist-request.md` — request to whitelist our server IP(s) for Status Check.  
7. `04-uat-meeting-script.md` — end-user test script for the UAT meeting.

## Notes

- **Integration type:** External Checkout (`integrationType: "External"`).  
- **Callback methods accepted:** `POST` and `GET` on the callback URL above.  
- **clientReference:** unique per attempt, prefix `QF-`, never reused.  
- **Status Check:** we call  
  `GET https://api-txnstatus.hubtel.com/transactions/{Collection_Account_Number}/status?clientReference=…`  
  with Basic Auth. Our current calls return **403 Forbidden** until IPs are whitelisted — please whitelist the IPs in `03-ip-whitelist-request.md`, after which we can attach live Status Check captures from production.  
- Live callback samples from production payments can be attached as addenda once you confirm the UAT meeting date; our handler stores Hubtel’s callback body against the transaction for audit.

We are available for the **end-user UAT meeting** at your earliest convenience.

Kind regards,  
**Qaretech Innovative — iPay**  
App: https://ipaysub.vercel.app  
API: https://ipaynotifyserver.onrender.com  
