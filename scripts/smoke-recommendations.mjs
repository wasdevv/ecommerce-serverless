#!/usr/bin/env node
// Smoke da recomendação contra a stack local, depois de seed:history e do
// treino: um cliente novo compra a camiseta e deve receber o moletom vindo do
// modelo (no histórico demo, quem leva camiseta leva moletom).
//
//   node scripts/smoke-recommendations.mjs http://localhost:3000

import { randomUUID } from 'node:crypto';

const base = `${(process.argv[2] || 'http://localhost:3000').replace(/\/$/, '')}/api/v1`;
const json = { 'content-type': 'application/json' };

function fail(message) {
  console.error(`FAIL ${message}`);
  process.exit(1);
}

const email = `rec-smoke-${randomUUID().slice(0, 8)}@example.com`;
const password = randomUUID();
await fetch(`${base}/auth/register`, { method: 'POST', headers: json, body: JSON.stringify({ email, password }) });
const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: json, body: JSON.stringify({ email, password }) });
if (login.status !== 200) fail(`login -> ${login.status}`);
const auth = { authorization: `Bearer ${(await login.json()).data.accessToken}` };

const catalog = await (await fetch(`${base}/products?pageSize=100`)).json();
const tshirt = catalog.data.find((p) => p.sku === 'TSHIRT-001');
if (!tshirt) fail('TSHIRT-001 not found (run npm run seed)');

const order = await fetch(`${base}/orders`, {
  method: 'POST',
  headers: { ...json, ...auth, 'idempotency-key': `rec-smoke-${randomUUID()}` },
  body: JSON.stringify({ items: [{ productId: tshirt.id, quantity: 1 }] }),
});
if (order.status !== 201) fail(`order -> ${order.status}`);

const res = await fetch(`${base}/recommendations?limit=3`, { headers: auth });
const source = res.headers.get('x-recommendation-source');
const skus = (await res.json()).data.map((p) => p.sku);
console.log(`recommendations -> ${res.status} source=${source} ${skus.join(' ')}`);
if (res.status !== 200 || !source?.startsWith('model')) fail('expected recommendations from the model');
if (skus[0] !== 'HOODIE-001') fail(`expected HOODIE-001 first, got ${skus[0]}`);
if (skus.includes('TSHIRT-001')) fail('recommended a product the customer already owns');
console.log('RECOMMENDATIONS_OK');
