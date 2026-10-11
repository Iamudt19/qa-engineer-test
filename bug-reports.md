# EU Pay QA Bug Reports

This document contains detailed bug reports for all intentional bugs identified in the EU Pay Payment API, discovered through API testing, security review, and edge case evaluation.

---

## Bug A: Payment Amount Returned as String Instead of Number

**Location:** `src/routes/payment.routes.js` (lines 16, 52)  
**Severity:** Medium  
**Component:** Payment API  

### How to Reproduce:
1. Start the server (`npm start`) or send request via test harness.
2. Authenticate as a merchant via `POST /api/auth/login` with `{"email":"merchant@test.com","password":"Test123!"}` to obtain a JWT token.
3. Send a request to list payments:
   ```bash
   curl http://localhost:3000/api/payments \
     -H "Authorization: Bearer <TOKEN>"
   ```
4. Or fetch a specific payment:
   ```bash
   curl http://localhost:3000/api/payments/1 \
     -H "Authorization: Bearer <TOKEN>"
   ```
5. Inspect the data type of the `amount` field in the JSON response.

### Expected Behavior:
The `amount` property should be returned as a numeric type (`number` in JSON, e.g. `25.5` or `100.0`), matching the API contract and underlying database representation.

### Actual Behavior:
The `amount` property is explicitly serialized as a string (`"25.5"`, `"100"`).
```json
{
  "id": "1",
  "amount": "25.5",
  "currency": "EUR",
  "status": "completed"
}
```

### Impact:
Downstream consumer applications (web dashboards, mobile apps, accounting services) performing financial arithmetic (e.g. `total + payment.amount`) experience string concatenation bugs (e.g., `100 + "25.5" = "10025.5"`) or `NaN` errors, leading to erroneous financial displays and calculations.

### Root Cause:
In `src/routes/payment.routes.js`, lines 16 and 52, `p.amount.toString()` and `payment.amount.toString()` are called when shaping the response payload instead of returning the numeric value.

### Suggested Fix:
Return the amount as a numeric value:
```javascript
amount: Number(p.amount)
```

---

## Bug B: Missing Maximum Transaction Amount Validation

**Location:** `src/routes/payment.routes.js` (line 71-78)  
**Severity:** High  
**Component:** Payment API  

### How to Reproduce:
1. Authenticate as a merchant to obtain a JWT token.
2. Send a `POST /api/payments` request with an excessively large amount:
   ```bash
   curl -X POST http://localhost:3000/api/payments \
     -H "Authorization: Bearer <TOKEN>" \
     -H "Content-Type: application/json" \
     -d '{
       "amount": 999999999,
       "currency": "EUR",
       "customer_email": "whale@buyer.com"
     }'
   ```
3. Observe the response status and returned payment object.

### Expected Behavior:
The API should enforce risk limits and reject single transaction amounts exceeding policy thresholds (e.g., max €50,000 per transaction) with HTTP 400 Bad Request and a descriptive error message:
```json
{
  "error": "Amount exceeds maximum allowed limit (€50,000)"
}
```

### Actual Behavior:
The API accepts any positive numeric amount regardless of size and responds with HTTP 201 Created:
```json
{
  "success": true,
  "message": "Payment created",
  "data": {
    "amount": 999999999,
    "currency": "EUR",
    "status": "pending"
  }
}
```

### Impact:
Lack of upper-bound transaction limits exposes the platform and merchants to high-risk transactions, credit card fraud, money laundering exposure (AML compliance breaches), and catastrophic fat-finger errors.

### Root Cause:
`src/routes/payment.routes.js` validates only that `amount` is non-empty, numeric, and positive (`amount <= 0`), but fails to validate an upper bound threshold against regulatory and business limits.

### Suggested Fix:
Add maximum amount limit validation in `src/routes/payment.routes.js`:
```javascript
const MAX_AMOUNT = 50000;
if (amount > MAX_AMOUNT) {
  return res.status(400).json({ error: 'Amount exceeds maximum allowed limit (€50,000)' });
}
```

---

## Bug C: Email Validation Regex Too Permissive (Missing TLD)

**Location:** `src/routes/auth.routes.js` (lines 10-14)  
**Severity:** Medium  
**Component:** Auth API  

### How to Reproduce:
1. Send a merchant registration request with an email missing a top-level domain (TLD):
   ```bash
   curl -X POST http://localhost:3000/api/auth/register \
     -H "Content-Type: application/json" \
     -d '{
       "email": "user@domain",
       "password": "Password123!",
       "business_name": "Acme Corp"
     }'
   ```
2. Observe the HTTP response code and response body.

### Expected Behavior:
The API should reject email addresses lacking a valid top-level domain with HTTP 400 Bad Request:
```json
{
  "error": "Invalid email format"
}
```

### Actual Behavior:
The request passes validation and registers the merchant account with HTTP 201 Created.

### Impact:
Users can register with invalid or unrouteable email addresses (e.g. `user@domain`, `user@localhost`). This prevents delivery of critical merchant notifications, e-invoices, chargeback alerts, password reset emails, and multi-factor authentication codes.

### Root Cause:
`validateEmail()` uses `/^[^\s@]+@[^\s@]+$/`, which only checks for characters on either side of the `@` symbol without verifying the domain name format or requiring a TLD.

### Suggested Fix:
Update the regular expression to enforce a proper domain name and TLD with at least 2 characters:
```javascript
function validateEmail(email) {
  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  return emailRegex.test(email);
}
```

---

## Bug D: Missing Webhook Signature Verification (HMAC-SHA256)

**Location:** `src/routes/webhook.routes.js` (lines 21-33)  
**Severity:** Critical  
**Component:** Webhooks  

### How to Reproduce:
1. Find an existing payment ID in the system (e.g. ID `"2"`, which has `status: "pending"`).
2. Send a POST request to `/api/webhooks/payment-status` with either no signature or an arbitrary fake signature:
   ```bash
   curl -X POST http://localhost:3000/api/webhooks/payment-status \
     -H "Content-Type: application/json" \
     -H "x-webhook-signature: fake-forged-signature" \
     -d '{
       "payment_id": "2",
       "status": "completed",
       "event_id": "evt_forged_1"
     }'
   ```
3. Observe that the endpoint returns 200 OK and marks payment `"2"` as `"completed"`.

### Expected Behavior:
The API must verify the incoming `x-webhook-signature` header against an HMAC-SHA256 signature generated using `WEBHOOK_SECRET` and the raw payload. If the signature is missing or does not match, it must reject with HTTP 401 Unauthorized:
```json
{
  "error": "Invalid signature"
}
```

### Actual Behavior:
Signature verification logic was commented out. Anyone without credentials or valid secret keys can manipulate payment statuses to `"completed"`.

### Impact:
Critical security exploit. Malicious actors can spoof payment confirmation webhooks from Powens or Bridge, fraudulently marking unpaid orders and invoices as completed, leading to direct monetary loss and illegal merchandise fulfillment.

### Root Cause:
In `src/routes/webhook.routes.js`, the signature verification block was commented out, allowing unsigned and forged webhooks to proceed.

### Suggested Fix:
Enforce HMAC-SHA256 signature verification on incoming webhooks:
```javascript
if (!signature) {
  return res.status(401).json({ error: 'Webhook signature required' });
}

const expectedSignature = crypto
  .createHmac('sha256', WEBHOOK_SECRET)
  .update(JSON.stringify(req.body))
  .digest('hex');

if (signature !== expectedSignature) {
  return res.status(401).json({ error: 'Invalid signature' });
}
```

---

## Bug E: Missing Webhook Idempotency Handling

**Location:** `src/routes/webhook.routes.js` (lines 38-45, 55-56)  
**Severity:** High  
**Component:** Webhooks  

### How to Reproduce:
1. Generate a valid HMAC signature for a webhook payload containing an `event_id`:
   ```json
   {
     "payment_id": "1",
     "status": "completed",
     "event_id": "evt_duplicate_test"
   }
   ```
2. Send the signed request to `POST /api/webhooks/payment-status`.
3. Send the exact same signed request a second time.
4. Observe that the second delivery executes full status updates again and returns `"Webhook processed"`.

### Expected Behavior:
Webhooks sent over the public internet follow at-least-once delivery and can be retried multiple times by payment service providers. Upon receiving an `event_id` that was already processed, the API must recognize the duplicate, skip duplicate state mutations, and return HTTP 200 with an idempotent acknowledgement:
```json
{
  "success": true,
  "message": "Already processed",
  "event_id": "evt_duplicate_test"
}
```

### Actual Behavior:
The idempotency check and recording into `db.processed_webhooks` were commented out. Every duplicate delivery executes downstream updates, updates timestamps, and triggers duplicate events.

### Impact:
Duplicate deliveries cause race conditions, duplicate socket emissions, redundant downstream ledger entries, and overwrite payment state unexpectedly.

### Root Cause:
The check `db.processed_webhooks.includes(event_id)` and the recording `db.processed_webhooks.push(event_id)` were commented out.

### Suggested Fix:
Active idempotency check and persist processed event IDs:
```javascript
if (event_id && db.processed_webhooks.includes(event_id)) {
  return res.status(200).json({
    success: true,
    message: 'Already processed',
    event_id,
    payment_id
  });
}

// After updating payment:
if (event_id) {
  db.processed_webhooks.push(event_id);
}
```

---

## Bug F: Missing Duplicate Table Order Prevention

**Location:** `src/routes/table-order.routes.js` (lines 44-56)  
**Severity:** Medium  
**Component:** Table Orders  

### How to Reproduce:
1. Create a table order for Table 5 with status `"pending"`:
   ```bash
   curl -X POST http://localhost:3000/api/table-orders \
     -H "Content-Type: application/json" \
     -d '{
       "merchant_id": "1",
       "table_number": 5,
       "items": [{"name": "Steak Frites", "price": 22.0, "quantity": 1}]
     }'
   ```
2. Immediately submit a second order for the same Table 5 while the first order remains `"pending"`.
3. Observe that both orders are created successfully.

### Expected Behavior:
If a table currently has an active order in `"pending"` status, subsequent order creation requests for that table must be rejected with HTTP 409 Conflict:
```json
{
  "error": "Table already has a pending order"
}
```

### Actual Behavior:
Duplicate orders are created simultaneously for the same table, leading to multiple independent active tickets for table 5.

### Impact:
Restaurants and bars experience duplicated kitchen tickets, wasted food preparation, confusion among floor staff, and incorrect billing disputes with dining patrons.

### Root Cause:
The check looking for an existing order with `o.merchant_id === merchant_id && o.table_number === table_number && o.status === 'pending'` was commented out.

### Suggested Fix:
Enable duplicate check before creating the order:
```javascript
const existingOrder = (db.table_orders || []).find(
  o => o.merchant_id === merchant_id && 
       o.table_number === table_number && 
       o.status === 'pending'
);
if (existingOrder) {
  return res.status(409).json({ error: 'Table already has a pending order' });
}
```

---

## Bug G: Missing Duplicate E-Invoice Submission Prevention

**Location:** `src/routes/einvoice.routes.js` (lines 50-58)  
**Severity:** Medium  
**Component:** E-Invoicing  

### How to Reproduce:
1. Authenticate with a merchant token.
2. Submit an e-invoice to the tax authority:
   ```bash
   curl -X POST http://localhost:3000/api/einvoice/submit \
     -H "Authorization: Bearer <TOKEN>" \
     -H "Content-Type: application/json" \
     -d '{
       "invoice_id": "inv_101",
       "customer_siret": "12345678901234"
     }'
   ```
3. Immediately send the exact same submission request again for `"invoice_id": "inv_101"`.
4. Observe that a new submission ID is generated and accepted again with status 200.

### Expected Behavior:
Once an invoice is marked as `"submitted"` or `"accepted"`, duplicate submissions to the tax authority should be prevented and rejected with HTTP 409 Conflict:
```json
{
  "error": "Invoice already submitted to tax authority"
}
```

### Actual Behavior:
The API allows the same invoice to be submitted multiple times, generating a new `submission_id` each time.

### Impact:
Under European e-invoicing mandates (e.g. French PDP/Seqino regulations), re-submitting an already submitted invoice results in regulatory penalties, duplicate VAT liabilities, and synchronization failures with tax portals.

### Root Cause:
The status validation checking `invoice.einvoice_status === 'submitted' || invoice.einvoice_status === 'accepted'` was commented out.

### Suggested Fix:
Uncomment and enforce duplicate check in `src/routes/einvoice.routes.js`:
```javascript
if (invoice.einvoice_status === 'submitted' || invoice.einvoice_status === 'accepted') {
  return res.status(409).json({ 
    error: 'Invoice already submitted to tax authority' 
  });
}
```

---

## Bonus Finding: Invalid Seeded Password Hash in Test Database

**Location:** `src/db/database.js` (line 19)  
**Severity:** Medium  
**Component:** Database / Test Fixtures  

### Observation:
The seeded merchant in `initDatabase()` had password hash:
`"$2a$10$8Z3KxGXvGqJQZ.ZF9Z3KxGXvGqJQZ.ZF9Z3KxGXvGqJQZ.ZF9"`
This hash is syntactically invalid/repetitive and fails `bcrypt.compare("Test123!", hash)`. Consequently, all manual and automated authentication attempts using the credentials documented in the README (`merchant@test.com` / `Test123!`) were failing with HTTP 401 Unauthorized.

### Fix:
Updated the hash with the legitimate bcrypt hash for `"Test123!"`:
`"$2a$10$JZVKH1FLeGVdnR3Af/kisO1cDAzZzCHHSxqIfFUoas75vSMEOiXSi"`.
