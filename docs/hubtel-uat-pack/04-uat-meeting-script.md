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
- Service fulfilled on our side  

## After the meeting

Attach to Hubtel (addendum):

1. Raw callback JSON from the successful UAT payment  
2. Status Check JSON for the same `clientReference` (after IP whitelist)  
