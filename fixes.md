# EU Pay Bug Fixes Documentation

This document explains the technical implementation, architectural rationale, code diffs, and verification steps for all bug fixes in the EU Pay QA Engineer test codebase.

---

## Fix 1: Payment Amount Data Type (Bug A)

**Bug:** `amount` returned as string instead of number in `GET /api/payments` and `GET /api/payments/:id`.

**Files Changed:**
- `src/routes/payment.routes.js`

**Code Changes:**
```diff
--- a/src/routes/payment.routes.js
+++ b/src/routes/payment.routes.js
@@ -13,7 +13,7 @@ router.get('/', authenticate, (req, res) => {
-      amount: p.amount.toString(), // ← BUG: Should be number, not string
+      amount: Number(p.amount), // Fixed: returned as numeric type
       currency: p.currency,
       status: p.status,
@@ -48,7 +48,7 @@ router.get('/:id', authenticate, (req, res) => {
-        amount: payment.amount.toString(), // Same bug as above
+        amount: Number(payment.amount), // Fixed: returned as numeric type
         currency: payment.currency,
```

**Why This Fix:**
In REST API contracts, financial transaction amounts represent continuous numerical values. Returning strings leads to type coercion errors in frontend JavaScript (e.g. `10 + "25.5" = "1025.5"`) or `NaN` in client-side calculations. Wrapping `p.amount` with `Number()` guarantees consistent numeric representation in JSON payloads without altering precision.

**Testing:**
```bash
# Automated assertion in src/routes/__tests__/payment.routes.test.js
assert.strictEqual(typeof res.body.data[0].amount, 'number');
assert.strictEqual(res.body.data[0].amount, 25.5);
```

---

## Fix 2: Enforce Maximum Transaction Limit (€50,000) (Bug B)

**Bug:** Missing upper-bound validation on payment amount allowed arbitrary sums (e.g., €999,999,999).

**Files Changed:**
- `src/routes/payment.routes.js`

**Code Changes:**
```diff
--- a/src/routes/payment.routes.js
+++ b/src/routes/payment.routes.js
@@ -74,6 +74,12 @@ router.post('/', authenticate, (req, res) => {
     if (!amount || isNaN(amount) || amount <= 0) {
       return res.status(400).json({ error: 'Valid amount is required' });
     }
+
+    // FIX B: Enforce maximum transaction amount limit (€50,000)
+    const MAX_AMOUNT = 50000;
+    if (amount > 50000) {
+      return res.status(400).json({ error: 'Amount exceeds maximum allowed limit (€50,000)' });
+    }
```

**Why This Fix:**
Financial compliance standards (AML/KYC) and merchant risk control frameworks mandate strict single-transaction limits. Rejecting payments exceeding €50,000 prevents catastrophic accidental overbilling, payment gateway rejections, and fraud attacks.

**Testing:**
```bash
# Automated assertion in src/routes/__tests__/payment.routes.test.js
const res = await request(app)
  .post('/api/payments')
  .set('Authorization', `Bearer ${token}`)
  .send({ amount: 999999, currency: 'EUR', customer_email: 'customer@test.com' });
assert.strictEqual(res.status, 400);
assert.ok(res.body.error.toLowerCase().includes('maximum'));
```

---

## Fix 3: Strict Domain and TLD Email Validation (Bug C)

**Bug:** Email validation regex allowed addresses without a top-level domain (e.g. `user@domain`).

**Files Changed:**
- `src/routes/auth.routes.js`

**Code Changes:**
```diff
--- a/src/routes/auth.routes.js
+++ b/src/routes/auth.routes.js
@@ -9,7 +9,8 @@ const JWT_SECRET = 'test-secret-key-do-not-use-in-production';
-// BUG C: Email validation is too permissive
+// FIX C: Email validation requires valid domain and TLD (e.g., user@domain.com)
 function validateEmail(email) {
-  // BUG: This regex allows emails without TLD like "user@domain"
-  const emailRegex = /^[^\s@]+@[^\s@]+$/;
+  // RFC 5322 compliant regex requiring valid domain and TLD of at least 2 characters
+  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
   return emailRegex.test(email);
 }
```

**Why This Fix:**
Validating standard email syntax including domain labels and TLD (minimum 2 letters) ensures that registered merchant accounts can receive operational emails, webhook error reports, invoices, and password reset tokens.

**Testing:**
```bash
# Automated assertion in src/routes/__tests__/auth.routes.test.js
const res = await request(app)
  .post('/api/auth/register')
  .send({ email: 'user@domain', password: 'Password123!', business_name: 'Co' });
assert.strictEqual(res.status, 400);
assert.strictEqual(res.body.error, 'Invalid email format');
```

---

## Fix 4: HMAC-SHA256 Webhook Signature Verification (Bug D)

**Bug:** Webhooks were accepted without verifying cryptographic authenticity, permitting webhook spoofing.

**Files Changed:**
- `src/routes/webhook.routes.js`

**Code Changes:**
```diff
--- a/src/routes/webhook.routes.js
+++ b/src/routes/webhook.routes.js
@@ -21,18 +21,18 @@ router.post('/payment-status', (req, res) => {
-    // BUG D: No signature verification
-    // Real systems MUST verify webhook signatures to prevent spoofing
-    // Missing validation below:
-    
-    // const expectedSignature = crypto
-    //   .createHmac('sha256', WEBHOOK_SECRET)
-    //   .update(JSON.stringify(req.body))
-    //   .digest('hex');
-    // 
-    // if (signature !== expectedSignature) {
-    //   return res.status(401).json({ error: 'Invalid signature' });
-    // }
+    // FIX D: Verify HMAC-SHA256 signature to prevent webhook spoofing
+    if (!signature) {
+      return res.status(401).json({ error: 'Webhook signature required' });
+    }
+
+    const expectedSignature = crypto
+      .createHmac('sha256', WEBHOOK_SECRET)
+      .update(JSON.stringify(req.body))
+      .digest('hex');
+
+    if (signature !== expectedSignature) {
+      return res.status(401).json({ error: 'Invalid signature' });
+    }
```

**Why This Fix:**
Payment webhooks trigger irreversible business operations (e.g., fulfilling orders, crediting merchants). Without HMAC signature verification, anyone with HTTP access could mark arbitrary pending transactions as completed.

**Testing:**
```bash
# Automated assertion in src/routes/__tests__/webhook.routes.test.js
const res = await request(app)
  .post('/api/webhooks/payment-status')
  .set('x-webhook-signature', 'forged-signature')
  .send({ payment_id: '1', status: 'completed' });
assert.strictEqual(res.status, 401);
```

---

## Fix 5: Webhook Idempotency by Event ID (Bug E)

**Bug:** Multiple webhook deliveries for the same `event_id` triggered repeated processing.

**Files Changed:**
- `src/routes/webhook.routes.js`

**Code Changes:**
```diff
--- a/src/routes/webhook.routes.js
+++ b/src/routes/webhook.routes.js
@@ -36,11 +36,14 @@ router.post('/payment-status', (req, res) => {
-    // BUG E: No idempotency check
-    // Webhooks can be delivered multiple times - must be idempotent
-    // Missing check below:
-    
-    // if (db.processed_webhooks.includes(event_id)) {
-    //   return res.status(200).json({ message: 'Already processed' });
-    // }
+    // FIX E: Idempotency check - ignore repeated deliveries of the same event_id
+    if (event_id && db.processed_webhooks.includes(event_id)) {
+      return res.status(200).json({
+        success: true,
+        message: 'Already processed',
+        event_id,
+        payment_id
+      });
+    }
@@ -52,3 +55,5 @@ router.post('/payment-status', (req, res) => {
-    // Mark webhook as processed (if idempotency was implemented)
-    // db.processed_webhooks.push(event_id);
+    // Mark webhook as processed for idempotency
+    if (event_id) {
+      db.processed_webhooks.push(event_id);
+    }
```

**Why This Fix:**
Payment providers implement retry mechanisms when network timeouts occur. Idempotent processing guarantees that retried webhooks safely return HTTP 200 without duplicate state transitions, duplicate customer notifications, or accounting discrepancies.

**Testing:**
```bash
# Automated assertion in src/routes/__tests__/webhook.routes.test.js
const duplicateRes = await request(app)
  .post('/api/webhooks/payment-status')
  .set('x-webhook-signature', signature)
  .send({ payment_id: '1', status: 'completed', event_id: 'evt_100' });
assert.strictEqual(duplicateRes.status, 200);
assert.strictEqual(duplicateRes.body.message, 'Already processed');
```

---

## Fix 6: Prevent Duplicate Pending Table Orders (Bug F)

**Bug:** Tables could create multiple concurrent orders while an existing order was still `pending`.

**Files Changed:**
- `src/routes/table-order.routes.js`

**Code Changes:**
```diff
--- a/src/routes/table-order.routes.js
+++ b/src/routes/table-order.routes.js
@@ -44,13 +44,11 @@ router.post('/', (req, res) => {
-    // BUG F: No duplicate order prevention
-    // Should check if table already has a pending order
-    // Missing validation below:
-    
-    // const existingOrder = (db.table_orders || []).find(
-    //   o => o.merchant_id === merchant_id && 
-    //        o.table_number === table_number && 
-    //        o.status === 'pending'
-    // );
-    // if (existingOrder) {
-    //   return res.status(409).json({ error: 'Table already has a pending order' });
-    // }
+    // FIX F: Prevent duplicate orders for the same table while status is pending
+    const existingOrder = (db.table_orders || []).find(
+      o => o.merchant_id === merchant_id && 
+           o.table_number === table_number && 
+           o.status === 'pending'
+    );
+    if (existingOrder) {
+      return res.status(409).json({ error: 'Table already has a pending order' });
+    }
```

**Why This Fix:**
In dining and hospitality operations, customers frequently press "Order" multiple times if a network request buffers. Rejecting duplicate pending orders with HTTP 409 protects the kitchen from double-preparing food and prevents customer billing disputes. Once the kitchen moves the status forward (e.g. `confirmed`), subsequent items can be ordered.

**Testing:**
```bash
# Automated assertion in src/routes/__tests__/table-order.routes.test.js
const res = await request(app).post('/api/table-orders').send({
  merchant_id: '1', table_number: 5, items: [{ name: 'Dish', price: 10, quantity: 1 }]
});
assert.strictEqual(res.status, 409);
assert.strictEqual(res.body.error, 'Table already has a pending order');
```

---

## Fix 7: Prevent Duplicate E-Invoice Submission (Bug G)

**Bug:** Invoices already submitted or accepted by the tax authority could be submitted again.

**Files Changed:**
- `src/routes/einvoice.routes.js`

**Code Changes:**
```diff
--- a/src/routes/einvoice.routes.js
+++ b/src/routes/einvoice.routes.js
@@ -50,11 +50,7 @@ router.post('/submit', authenticate, async (req, res) => {
-    // BUG G: No duplicate submission check
-    // Should prevent submitting the same invoice twice
-    // Missing validation below:
-    
-    // if (invoice.einvoice_status === 'submitted' || invoice.einvoice_status === 'accepted') {
-    //   return res.status(409).json({ 
-    //     error: 'Invoice already submitted to tax authority' 
-    //   });
-    // }
+    // FIX G: Prevent duplicate invoice submission to tax authority
+    if (invoice.einvoice_status === 'submitted' || invoice.einvoice_status === 'accepted') {
+      return res.status(409).json({ 
+        error: 'Invoice already submitted to tax authority' 
+      });
+    }
```

**Why This Fix:**
Under European electronic invoicing regulations (e.g. French PDP / Seqino), an invoice is a legal fiscal document with a unique legal identifier. Submitting the same invoice twice violates fiscal compliance, triggers gateway rejections, and risks duplicate tax reporting.

**Testing:**
```bash
# Automated assertion in src/routes/__tests__/einvoice.routes.test.js
const res = await request(app)
  .post('/api/einvoice/submit')
  .set('Authorization', `Bearer ${token}`)
  .send({ invoice_id: 'inv_101', customer_siret: '12345678901234' });
assert.strictEqual(res.status, 409);
assert.strictEqual(res.body.error, 'Invoice already submitted to tax authority');
```

---

## Fix 8: Correct Seeded Merchant Password Hash (Bonus Fix)

**Bug:** Seeded test merchant password hash did not match `Test123!`.

**Files Changed:**
- `src/db/database.js`

**Code Changes:**
```diff
--- a/src/db/database.js
+++ b/src/db/database.js
@@ -19,3 +19,3 @@ export function initDatabase() {
-    password: "$2a$10$8Z3KxGXvGqJQZ.ZF9Z3KxGXvGqJQZ.ZF9Z3KxGXvGqJQZ.ZF9", // password: Test123!
+    password: "$2a$10$JZVKH1FLeGVdnR3Af/kisO1cDAzZzCHHSxqIfFUoas75vSMEOiXSi", // password: Test123!
```

**Why This Fix:**
Enables test suites and manual curl/Postman testing to authenticate as the pre-configured test merchant documented in the README without needing manual database seed manipulation.
