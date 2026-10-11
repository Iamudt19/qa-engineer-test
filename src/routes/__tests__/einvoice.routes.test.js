import { test } from 'node:test';
import assert from 'node:assert';
import request from 'supertest';
import app from '../../server.js';
import { db } from '../../db/database.js';

async function getAuthToken() {
  const res = await request(app)
    .post('/api/auth/login')
    .send({ email: 'merchant@test.com', password: 'Test123!' });
  return res.body.token;
}

test('EINVOICE: POST /api/einvoice/submit submits invoice with valid 14-digit SIRET', async () => {
  const token = await getAuthToken();
  const invoiceId = `inv_submit_${Date.now()}`;

  const res = await request(app)
    .post('/api/einvoice/submit')
    .set('Authorization', `Bearer ${token}`)
    .send({
      invoice_id: invoiceId,
      customer_siret: '12345678901234'
    });

  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.success, true);
  assert.strictEqual(res.body.data.status, 'submitted');
  assert.ok(res.body.data.submission_id);
});

test('EINVOICE (Bug G): POST /api/einvoice/submit rejects duplicate submission of already submitted invoice', async () => {
  const token = await getAuthToken();
  const invoiceId = `inv_duplicate_${Date.now()}`;

  // First submission
  const firstRes = await request(app)
    .post('/api/einvoice/submit')
    .set('Authorization', `Bearer ${token}`)
    .send({
      invoice_id: invoiceId,
      customer_siret: '12345678901234'
    });
  assert.strictEqual(firstRes.status, 200);

  // Second submission for the same invoice must be rejected with 409
  const duplicateRes = await request(app)
    .post('/api/einvoice/submit')
    .set('Authorization', `Bearer ${token}`)
    .send({
      invoice_id: invoiceId,
      customer_siret: '12345678901234'
    });

  assert.strictEqual(duplicateRes.status, 409);
  assert.strictEqual(duplicateRes.body.error, 'Invoice already submitted to tax authority');
});

test('EINVOICE: POST /api/einvoice/submit rejects invalid customer SIRET length', async () => {
  const token = await getAuthToken();

  const res = await request(app)
    .post('/api/einvoice/submit')
    .set('Authorization', `Bearer ${token}`)
    .send({
      invoice_id: `inv_invalid_siret_${Date.now()}`,
      customer_siret: '12345' // Invalid length (not 14)
    });

  assert.strictEqual(res.status, 400);
  assert.ok(res.body.error.includes('SIRET required'));
});

test('EINVOICE: POST /api/einvoice/submit rejects missing invoice_id', async () => {
  const token = await getAuthToken();

  const res = await request(app)
    .post('/api/einvoice/submit')
    .set('Authorization', `Bearer ${token}`)
    .send({
      customer_siret: '12345678901234'
    });

  assert.strictEqual(res.status, 400);
  assert.strictEqual(res.body.error, 'invoice_id required');
});

test('EINVOICE: GET /api/einvoice/status/:invoice_id retrieves submission details', async () => {
  const token = await getAuthToken();
  const invoiceId = `inv_status_check_${Date.now()}`;

  await request(app)
    .post('/api/einvoice/submit')
    .set('Authorization', `Bearer ${token}`)
    .send({
      invoice_id: invoiceId,
      customer_siret: '12345678901234'
    });

  const res = await request(app)
    .get(`/api/einvoice/status/${invoiceId}`)
    .set('Authorization', `Bearer ${token}`);

  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.success, true);
  assert.strictEqual(res.body.data.einvoice_status, 'submitted');
  assert.ok(res.body.data.submission_id);
});

test('EINVOICE: GET /api/einvoice/status/:invoice_id returns 404 for non-existent invoice', async () => {
  const token = await getAuthToken();

  const res = await request(app)
    .get('/api/einvoice/status/unknown_inv_999')
    .set('Authorization', `Bearer ${token}`);

  assert.strictEqual(res.status, 404);
  assert.strictEqual(res.body.error, 'Invoice not found');
});

test('EINVOICE: Endpoints require JWT authentication', async () => {
  const res = await request(app)
    .post('/api/einvoice/submit')
    .send({
      invoice_id: 'test_unauth',
      customer_siret: '12345678901234'
    });

  assert.strictEqual(res.status, 401);
});
