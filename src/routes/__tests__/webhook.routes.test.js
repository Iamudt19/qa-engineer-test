import { test } from 'node:test';
import assert from 'node:assert';
import request from 'supertest';
import crypto from 'crypto';
import app from '../../server.js';
import { db } from '../../db/database.js';

const WEBHOOK_SECRET = 'test-webhook-secret-key';

function computeSignature(payload) {
  return crypto
    .createHmac('sha256', WEBHOOK_SECRET)
    .update(JSON.stringify(payload))
    .digest('hex');
}

test('WEBHOOK (Bug D): POST /api/webhooks/payment-status rejects request without signature', async () => {
  const payload = {
    payment_id: '1',
    status: 'completed',
    event_id: `evt_${Date.now()}`
  };

  const res = await request(app)
    .post('/api/webhooks/payment-status')
    .send(payload);

  assert.strictEqual(res.status, 401);
  assert.strictEqual(res.body.error, 'Webhook signature required');
});

test('WEBHOOK (Bug D): POST /api/webhooks/payment-status rejects request with forged signature', async () => {
  const payload = {
    payment_id: '1',
    status: 'completed',
    event_id: `evt_${Date.now()}`
  };

  const res = await request(app)
    .post('/api/webhooks/payment-status')
    .set('x-webhook-signature', 'forged-invalid-signature-hex')
    .send(payload);

  assert.strictEqual(res.status, 401);
  assert.strictEqual(res.body.error, 'Invalid signature');
});

test('WEBHOOK: POST /api/webhooks/payment-status processes valid signed webhook', async () => {
  const payload = {
    payment_id: '2',
    status: 'completed',
    event_id: `evt_valid_${Date.now()}`
  };
  const signature = computeSignature(payload);

  const res = await request(app)
    .post('/api/webhooks/payment-status')
    .set('x-webhook-signature', signature)
    .send(payload);

  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.success, true);
  assert.strictEqual(res.body.new_status, 'completed');

  const updatedPayment = db.payments.find(p => p.id === '2');
  assert.strictEqual(updatedPayment.status, 'completed');
});

test('WEBHOOK (Bug E): POST /api/webhooks/payment-status enforces idempotency on duplicate event_id', async () => {
  const eventId = `evt_idempotent_${Date.now()}`;
  const payload = {
    payment_id: '1',
    status: 'completed',
    event_id: eventId
  };
  const signature = computeSignature(payload);

  // First delivery
  const firstRes = await request(app)
    .post('/api/webhooks/payment-status')
    .set('x-webhook-signature', signature)
    .send(payload);
  assert.strictEqual(firstRes.status, 200);
  assert.strictEqual(firstRes.body.message, 'Webhook processed');

  // Second delivery (duplicate delivery / retry)
  const duplicateRes = await request(app)
    .post('/api/webhooks/payment-status')
    .set('x-webhook-signature', signature)
    .send(payload);

  assert.strictEqual(duplicateRes.status, 200);
  assert.strictEqual(duplicateRes.body.message, 'Already processed');
  assert.strictEqual(duplicateRes.body.event_id, eventId);
});

test('WEBHOOK: POST /api/webhooks/payment-status returns 404 for non-existent payment', async () => {
  const payload = {
    payment_id: 'non_existent_9999',
    status: 'completed',
    event_id: `evt_${Date.now()}`
  };
  const signature = computeSignature(payload);

  const res = await request(app)
    .post('/api/webhooks/payment-status')
    .set('x-webhook-signature', signature)
    .send(payload);

  assert.strictEqual(res.status, 404);
  assert.strictEqual(res.body.error, 'Payment not found');
});

test('WEBHOOK: POST /api/webhooks/payment-status rejects payload missing required fields', async () => {
  const payload = {
    event_id: `evt_${Date.now()}`
    // missing payment_id and status
  };
  const signature = computeSignature(payload);

  const res = await request(app)
    .post('/api/webhooks/payment-status')
    .set('x-webhook-signature', signature)
    .send(payload);

  assert.strictEqual(res.status, 400);
  assert.ok(res.body.error.includes('required'));
});

test('WEBHOOK: POST /api/webhooks/e-invoice updates invoice status from tax authority', async () => {
  const invoiceId = `inv_test_${Date.now()}`;
  if (!db.invoices) db.invoices = [];
  db.invoices.push({
    id: invoiceId,
    merchant_id: '1',
    invoice_number: 'INV-100',
    amount: 50.0,
    currency: 'EUR',
    status: 'draft'
  });

  const res = await request(app)
    .post('/api/webhooks/e-invoice')
    .send({
      invoice_id: invoiceId,
      status: 'accepted',
      submission_id: 'SUB-12345',
      tax_authority_id: 'FR-DGFIP-999'
    });

  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.success, true);
  assert.strictEqual(res.body.status, 'accepted');

  const inv = db.invoices.find(i => i.id === invoiceId);
  assert.strictEqual(inv.einvoice_status, 'accepted');
  assert.strictEqual(inv.tax_authority_id, 'FR-DGFIP-999');
});

test('WEBHOOK: POST /api/webhooks/e-invoice returns 404 for unknown invoice', async () => {
  const res = await request(app)
    .post('/api/webhooks/e-invoice')
    .send({
      invoice_id: 'non-existent-inv-999',
      status: 'rejected'
    });

  assert.strictEqual(res.status, 404);
  assert.strictEqual(res.body.error, 'Invoice not found');
});
