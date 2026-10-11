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

test('TABLE ORDER: POST /api/table-orders creates new order with valid items', async () => {
  const tableNumber = 101;
  const res = await request(app)
    .post('/api/table-orders')
    .send({
      merchant_id: '1',
      table_number: tableNumber,
      items: [
        { name: 'Pasta Carbonara', price: 16.5, quantity: 2 },
        { name: 'Sparkling Water', price: 4.0, quantity: 1 }
      ],
      customer_name: 'Alice',
      order_type: 'dine_in'
    });

  assert.strictEqual(res.status, 201);
  assert.strictEqual(res.body.success, true);
  assert.strictEqual(res.body.data.table_number, tableNumber);
  assert.strictEqual(res.body.data.total, 37.0);
  assert.strictEqual(res.body.data.status, 'pending');
});

test('TABLE ORDER (Bug F): POST /api/table-orders rejects duplicate pending order for same table', async () => {
  const tableNumber = 102;

  // First order: creates pending order
  const firstRes = await request(app)
    .post('/api/table-orders')
    .send({
      merchant_id: '1',
      table_number: tableNumber,
      items: [{ name: 'Espresso', price: 3.5, quantity: 1 }]
    });
  assert.strictEqual(firstRes.status, 201);

  // Second order for same table while first is still pending: must reject
  const duplicateRes = await request(app)
    .post('/api/table-orders')
    .send({
      merchant_id: '1',
      table_number: tableNumber,
      items: [{ name: 'Croissant', price: 4.0, quantity: 2 }]
    });

  assert.strictEqual(duplicateRes.status, 409);
  assert.strictEqual(duplicateRes.body.error, 'Table already has a pending order');
});

test('TABLE ORDER: POST /api/table-orders rejects order with empty items array', async () => {
  const res = await request(app)
    .post('/api/table-orders')
    .send({
      merchant_id: '1',
      table_number: 103,
      items: []
    });

  assert.strictEqual(res.status, 400);
  assert.ok(res.body.error.includes('at least one item'));
});

test('TABLE ORDER: POST /api/table-orders rejects missing required fields', async () => {
  const res = await request(app)
    .post('/api/table-orders')
    .send({
      customer_name: 'Bob'
      // missing merchant_id, table_number, items
    });

  assert.strictEqual(res.status, 400);
});

test('TABLE ORDER: GET /api/table-orders returns list of orders for authenticated merchant', async () => {
  const token = await getAuthToken();

  const res = await request(app)
    .get('/api/table-orders')
    .set('Authorization', `Bearer ${token}`);

  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.success, true);
  assert.ok(Array.isArray(res.body.data));
});

test('TABLE ORDER: PATCH /api/table-orders/:id/status updates status and allows new order afterwards', async () => {
  const token = await getAuthToken();
  const tableNumber = 104;

  // Create initial order
  const orderRes = await request(app)
    .post('/api/table-orders')
    .send({
      merchant_id: '1',
      table_number: tableNumber,
      items: [{ name: 'Pizza Margherita', price: 12.0, quantity: 1 }]
    });
  assert.strictEqual(orderRes.status, 201);
  const orderId = orderRes.body.data.id;

  // Update status to 'confirmed'
  const patchRes = await request(app)
    .patch(`/api/table-orders/${orderId}/status`)
    .set('Authorization', `Bearer ${token}`)
    .send({ status: 'confirmed' });

  assert.strictEqual(patchRes.status, 200);
  assert.strictEqual(patchRes.body.data.status, 'confirmed');

  // Once first order is confirmed (not pending), a new order for that table is permitted
  const nextOrderRes = await request(app)
    .post('/api/table-orders')
    .send({
      merchant_id: '1',
      table_number: tableNumber,
      items: [{ name: 'Tiramisu', price: 7.0, quantity: 1 }]
    });
  assert.strictEqual(nextOrderRes.status, 201);
});

test('TABLE ORDER: PATCH /api/table-orders/:id/status rejects invalid status', async () => {
  const token = await getAuthToken();

  const res = await request(app)
    .patch('/api/table-orders/1/status')
    .set('Authorization', `Bearer ${token}`)
    .send({ status: 'unknown_invalid_status' });

  assert.strictEqual(res.status, 400);
  assert.ok(res.body.error.includes('Valid status required'));
});
