#!/usr/bin/env node
// Smoke test ponta a ponta contra uma API rodando (compose local ou AWS):
// saúde -> cadastro -> login -> catálogo -> pedido -> replay idempotente ->
// leitura do pedido. Usa um usuário descartável e, se informado, o produto
// reservado SMOKE-TEST (SMOKE_PRODUCT_ID). Nunca imprime token nem senha.
//
//   node scripts/smoke.mjs http://localhost:3000
//   SMOKE_PRODUCT_ID=<uuid> node scripts/smoke.mjs https://xxx.execute-api.us-east-1.amazonaws.com

import { randomUUID } from 'node:crypto';

const base = `${(process.argv[2] || process.env.API_URL || 'http://localhost:3000').replace(/\/$/, '')}/api/v1`;
const runId = process.env.GITHUB_RUN_ID || Date.now();

async function call(method, path, { body, token, headers = {} } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token && { authorization: `Bearer ${token}` }),
      ...headers,
    },
    body: body && JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json, correlationId: res.headers.get('x-correlation-id') };
}

function expect(step, res, status) {
  if (res.status !== status) {
    console.error(`FAIL ${step}: expected ${status}, got ${res.status} (correlationId=${res.correlationId})`);
    console.error(JSON.stringify(res.json?.error ?? res.json));
    process.exit(1);
  }
  console.log(`ok   ${step} -> ${res.status} (correlationId=${res.correlationId})`);
  return res.json;
}

const email = `smoke+${runId}-${randomUUID().slice(0, 8)}@example.com`;
const password = randomUUID();

expect('health', await call('GET', '/health'), 200);
expect('register', await call('POST', '/auth/register', { body: { email, password } }), 201);
const { data: session } = expect('login', await call('POST', '/auth/login', { body: { email, password } }), 200);
expect('login with wrong password', await call('POST', '/auth/login', { body: { email, password: 'wrong-password' } }), 401);

const catalog = expect('list products', await call('GET', '/products?pageSize=100'), 200);
const productId = process.env.SMOKE_PRODUCT_ID || catalog.data.find((p) => p.stock > 0)?.id;
if (!productId) {
  console.error('FAIL no product with stock available (run the seed or the smoke-fixture ops action)');
  process.exit(1);
}
const product = expect('product detail', await call('GET', `/products/${productId}`), 200).data;

const key = `smoke-${randomUUID()}`;
const items = [{ productId, quantity: 1 }];
const created = await call('POST', '/orders', { body: { items }, token: session.accessToken, headers: { 'idempotency-key': key } });
const order = expect('create order', created, 201).data;
if (order.totalCents !== product.priceCents) {
  console.error(`FAIL total ${order.totalCents} != price ${product.priceCents}`);
  process.exit(1);
}
const replay = expect(
  'replay order (same Idempotency-Key)',
  await call('POST', '/orders', { body: { items }, token: session.accessToken, headers: { 'idempotency-key': key } }),
  200,
).data;
if (replay.id !== order.id) {
  console.error('FAIL replay returned a different order');
  process.exit(1);
}
expect('read own order', await call('GET', `/orders/${order.id}`, { token: session.accessToken }), 200);
expect('orders require auth', await call('GET', '/orders'), 401);

// Linha final legível por máquina: o CI usa o correlationId para achar o
// mesmo pedido nos logs do worker.
console.log(`SMOKE_OK orderId=${order.id} correlationId=${created.correlationId}`);
