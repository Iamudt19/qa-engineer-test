import { test } from 'node:test';
import assert from 'node:assert';
import request from 'supertest';
import app from '../../server.js';

test('AUTH: POST /api/auth/register creates user with valid email and password', async () => {
  const uniqueEmail = `merchant_${Date.now()}@business.com`;
  const res = await request(app)
    .post('/api/auth/register')
    .send({
      email: uniqueEmail,
      password: 'StrongPassword123!',
      business_name: 'Test Merchant BV'
    });

  assert.strictEqual(res.status, 201);
  assert.strictEqual(res.body.message, 'Registration successful');
  assert.strictEqual(res.body.user.email, uniqueEmail);
  assert.ok(res.body.token, 'Token should be returned');
});

test('AUTH (Bug C): POST /api/auth/register rejects email without TLD (e.g. user@domain)', async () => {
  const res = await request(app)
    .post('/api/auth/register')
    .send({
      email: 'user@domain',
      password: 'StrongPassword123!',
      business_name: 'Test Store'
    });

  assert.strictEqual(res.status, 400);
  assert.strictEqual(res.body.error, 'Invalid email format');
});

test('AUTH: POST /api/auth/register rejects email with missing @ symbol', async () => {
  const res = await request(app)
    .post('/api/auth/register')
    .send({
      email: 'plainaddress.com',
      password: 'StrongPassword123!',
      business_name: 'Test Store'
    });

  assert.strictEqual(res.status, 400);
  assert.strictEqual(res.body.error, 'Invalid email format');
});

test('AUTH: POST /api/auth/register rejects password shorter than 8 characters', async () => {
  const res = await request(app)
    .post('/api/auth/register')
    .send({
      email: 'valid.user@store.eu',
      password: 'short',
      business_name: 'Test Store'
    });

  assert.strictEqual(res.status, 400);
  assert.ok(res.body.error.includes('8 characters'));
});

test('AUTH: POST /api/auth/register rejects duplicate email registration with 409', async () => {
  const email = `duplicate_${Date.now()}@eupay.eu`;
  await request(app)
    .post('/api/auth/register')
    .send({
      email,
      password: 'ValidPassword123!',
      business_name: 'Original Store'
    });

  const duplicateRes = await request(app)
    .post('/api/auth/register')
    .send({
      email,
      password: 'ValidPassword123!',
      business_name: 'Clone Store'
    });

  assert.strictEqual(duplicateRes.status, 409);
  assert.strictEqual(duplicateRes.body.error, 'Email already registered');
});

test('AUTH: POST /api/auth/login succeeds with registered credentials and returns JWT token', async () => {
  const email = `login_${Date.now()}@testmerchant.com`;
  const password = 'CorrectPassword123!';

  await request(app)
    .post('/api/auth/register')
    .send({
      email,
      password,
      business_name: 'Login Test Corp'
    });

  const loginRes = await request(app)
    .post('/api/auth/login')
    .send({ email, password });

  assert.strictEqual(loginRes.status, 200);
  assert.strictEqual(loginRes.body.message, 'Login successful');
  assert.ok(loginRes.body.token, 'Token should be returned on successful login');
});

test('AUTH: POST /api/auth/login fails with wrong password with 401', async () => {
  const res = await request(app)
    .post('/api/auth/login')
    .send({
      email: 'merchant@test.com',
      password: 'WrongPassword999!'
    });

  assert.strictEqual(res.status, 401);
  assert.strictEqual(res.body.error, 'Invalid credentials');
});

test('AUTH: POST /api/auth/login fails with non-existent user with 401', async () => {
  const res = await request(app)
    .post('/api/auth/login')
    .send({
      email: 'nonexistent_user_999@test.com',
      password: 'SomePassword123!'
    });

  assert.strictEqual(res.status, 401);
  assert.strictEqual(res.body.error, 'Invalid credentials');
});
