# UAT meeting — end-user test script

**Goal:** Demonstrate payment from a customer’s perspective on the live app.

## Prep (before the call)

- [ ] Hubtel test/live credentials configured on Render (`HUBTEL_*`, `HUBTEL_MOCK=false`)  
- [ ] Callback URL set to `https://ipaynotifyserver.onrender.com/api/payments/hubtel/callback`  
- [ ] A PPPoE test account with a priced package exists in iPay  
- [ ] Small amount available (e.g. GHS 1) for MoMo test  
- [ ] Share screen + phone for MoMo approval  

## Demo steps

1. Open **https://ipaysub.vercel.app/portal/renew**  
2. Enter PPPoE username → **Look up account**  
3. Confirm package, amount, expiry on screen  
4. Tap **Proceed to checkout**  
5. Complete payment in the **Hubtel modal** (enter MoMo number / approve on phone)  
6. Wait for success on portal return / confirmation  
7. Show in admin (optional): transaction **paid**, PPPoE expiry extended  
8. (Optional) Show SMS to customer / email to admin  

## What Hubtel should see

- Checkout branding / merchant account  
- Successful payment  
- Callback delivered to our HTTPS endpoint  
- **Merchant success log** on Render (`HUBTEL CALLBACK SUCCESS` / `[hubtel.callback.SUCCESS]`)  
- **Merchant failed log** on Render (`HUBTEL CALLBACK FAILED` / `[hubtel.callback.FAILED]`) — cancel/decline one payment or POST the sample failed body  
- Service fulfilled on our side  

## Capture logs during / after the call

1. Keep Render → your API service → **Logs** open  
2. Filter / search: `hubtel.callback`  
3. Success payment → screenshot `HUBTEL CALLBACK SUCCESS` block (full payload)  
4. Failed/declined payment (or curl `samples/sample-callback-failed.json`) → screenshot `HUBTEL CALLBACK FAILED`  
5. Attach both screenshots + raw JSON to Hubtel  

## After the meeting

Attach to Hubtel (addendum):

1. Raw callback JSON from the successful UAT payment  
2. Merchant Render logs — **success** and **failed**  
3. Status Check JSON for the same `clientReference` (after IP whitelist)  
