import { test } from 'node:test';
import assert from 'node:assert';
import request from 'supertest';
import app from '../../server.js';

async function getAuthToken() {
  const res = await request(app)
    .post('/api/auth/login')
    .send({ email: 'merchant@test.com', password: 'Test123!' });
  return res.body.token;
}

test('PAYMENT (Bug A): GET /api/payments should return amount as number, not string', async () => {
  const token = await getAuthToken();

  const res = await request(app)
    .get('/api/payments')
    .set('Authorization', `Bearer ${token}`);

  assert.strictEqual(res.status, 200);
  assert.ok(Array.isArray(res.body.data));
  assert.ok(res.body.data.length > 0);

  res.body.data.forEach(payment => {
    assert.strictEqual(typeof payment.amount, 'number', `Amount for payment ID ${payment.id} should be number`);
    assert.notStrictEqual(typeof payment.amount, 'string', `Amount for payment ID ${payment.id} must not be string`);
  });
});

test('PAYMENT (Bug A): GET /api/payments/:id should return single payment amount as number', async () => {
  const token = await getAuthToken();

  const res = await request(app)
    .get('/api/payments/1')
    .set('Authorization', `Bearer ${token}`);

  assert.strictEqual(res.status, 200);
  assert.strictEqual(typeof res.body.data.amount, 'number');
  assert.strictEqual(res.body.data.amount, 25.5);
});

test('PAYMENT (Bug B): POST /api/payments should reject amount over €50,000', async () => {
  const token = await getAuthToken();

  const res = await request(app)
    .post('/api/payments')
    .set('Authorization', `Bearer ${token}`)
    .send({
      amount: 999999,
      currency: 'EUR',
      customer_email: 'customer@test.com'
    });

  assert.strictEqual(res.status, 400);
  assert.ok(res.body.error.toLowerCase().includes('maximum'));
});

test('PAYMENT: POST /api/payments creates payment with valid data', async () => {
  const token = await getAuthToken();

  const res = await request(app)
    .post('/api/payments')
    .set('Authorization', `Bearer ${token}`)
    .send({
      amount: 149.99,
      currency: 'EUR',
      customer_email: 'buyer@european-pay.eu'
    });

  assert.strictEqual(res.status, 201);
  assert.strictEqual(res.body.success, true);
  assert.strictEqual(typeof res.body.data.amount, 'number');
  assert.strictEqual(res.body.data.amount, 149.99);
  assert.strictEqual(res.body.data.status, 'pending');
});

test('PAYMENT: POST /api/payments rejects negative or zero amount', async () => {
  const token = await getAuthToken();

  const resNegative = await request(app)
    .post('/api/payments')
    .set('Authorization', `Bearer ${token}`)
    .send({
      amount: -50,
      currency: 'EUR',
      customer_email: 'buyer@test.com'
    });
  assert.strictEqual(resNegative.status, 400);

  const resZero = await request(app)
    .post('/api/payments')
    .set('Authorization', `Bearer ${token}`)
    .send({
      amount: 0,
      currency: 'EUR',
      customer_email: 'buyer@test.com'
    });
  assert.strictEqual(resZero.status, 400);
});

test('PAYMENT: POST /api/payments rejects unsupported currency', async () => {
  const token = await getAuthToken();

  const res = await request(app)
    .post('/api/payments')
    .set('Authorization', `Bearer ${token}`)
    .send({
      amount: 100,
      currency: 'BTC',
      customer_email: 'buyer@test.com'
    });

  assert.strictEqual(res.status, 400);
  assert.ok(res.body.error.includes('Valid currency is required'));
});

test('PAYMENT: Endpoints reject unauthorized requests without JWT token', async () => {
  const resGet = await request(app).get('/api/payments');
  assert.strictEqual(resGet.status, 401);

  const resPost = await request(app).post('/api/payments').send({
    amount: 50,
    currency: 'EUR',
    customer_email: 'test@example.com'
  });
  assert.strictEqual(resPost.status, 401);
});

test('PAYMENT: GET /api/payments/:id returns 404 for non-existent payment', async () => {
  const token = await getAuthToken();

  const res = await request(app)
    .get('/api/payments/non-existent-9999')
    .set('Authorization', `Bearer ${token}`);

  assert.strictEqual(res.status, 404);
  assert.strictEqual(res.body.error, 'Payment not found');
});
