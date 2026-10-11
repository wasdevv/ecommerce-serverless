'use strict';

const request = require('supertest');
const { baseConfig } = require('../src/config');
const { createPool } = require('../src/db/pool');
const { migrate } = require('../src/db/migrate');
const { createCache } = require('../src/cache/cache');
const { createApp } = require('../src/app');
const { upsertAdmin } = require('../src/services/auth');

const TABLES = [
  'notifications',
  'processed_events',
  'outbox_events',
  'idempotency_keys',
  'order_items',
  'orders',
  'products',
  'users',
];

// Contexto de teste com PostgreSQL e Redis reais: o que se testa aqui
// (locks, constraints, transações) não existe num mock.
async function setupTestContext() {
  const config = { ...baseConfig(), jwt: { ...baseConfig().jwt, secret: process.env.JWT_SECRET } };
  const db = createPool(config.database);
  await migrate(db);
  const cache = createCache(config.redis);
  const ctx = {
    config,
    db,
    cache,
    app: createApp({ config, db, cache }),
    async reset() {
      await db.query(`TRUNCATE ${TABLES.join(', ')} CASCADE`);
      await cache.client?.flushdb().catch(() => {});
    },
    async close() {
      await cache.close();
      await db.end();
    },
    http() {
      return request(ctx.app);
    },
    async user(email = `user-${Math.random().toString(36).slice(2)}@example.test`, password = 'correct horse battery') {
      await request(ctx.app).post('/api/v1/auth/register').send({ email, password }).expect(201);
      const res = await request(ctx.app).post('/api/v1/auth/login').send({ email, password }).expect(200);
      return { email, token: res.body.data.accessToken, auth: `Bearer ${res.body.data.accessToken}` };
    },
    async admin() {
      const email = 'admin@example.test';
      const password = 'admin password for tests';
      await upsertAdmin(db, { email, password });
      const res = await request(ctx.app).post('/api/v1/auth/login').send({ email, password }).expect(200);
      return { auth: `Bearer ${res.body.data.accessToken}` };
    },
    async product(overrides = {}) {
      const { rows } = await db.query(
        `INSERT INTO products (sku, name, price_cents, stock) VALUES ($1, $2, $3, $4) RETURNING id`,
        [
          overrides.sku || `SKU-${Math.random().toString(36).slice(2)}`,
          overrides.name || 'Test product',
          overrides.priceCents || 1000,
          overrides.stock ?? 10,
        ],
      );
      return rows[0].id;
    },
  };
  return ctx;
}

module.exports = { setupTestContext };
