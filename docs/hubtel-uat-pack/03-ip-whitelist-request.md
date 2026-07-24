# IP whitelist request — Transaction Status Check API

**Merchant:** Qaretech Innovative / iPay  
**API used:** `https://api-txnstatus.hubtel.com/transactions/{Collection_Account_Number}/status`  

Please whitelist the following public IP address(es) for Status Check (max 4 per Hubtel policy):

| # | IP / range | Purpose |
|---|------------|---------|
| 1 | **_(fill Render outbound IP)_** | Production API host `ipaynotifyserver.onrender.com` |
| 2 | **_(optional office / VPN IP)_** | Developer UAT / support laptop |
| 3 | | |
| 4 | | |

### How we obtained / will obtain the Render IP

1. Open a Render Shell on service **ipaynotifyserver**, or  
2. From the server run: `curl -s https://api.ipify.org`  
3. Paste the IPv4 into row 1 above before sending.

### Evidence of current block

From a non-whitelisted network, Status Check returns **HTTP 403 Forbidden** (HTML body), which matches Hubtel’s documented behaviour for non-whitelisted callers.

### Callback URL (already live — does not require Status Check whitelist)

`https://ipaynotifyserver.onrender.com/api/payments/hubtel/callback`
