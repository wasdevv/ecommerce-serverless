'use strict';

const { setupTestContext } = require('./helpers');
const { createCache } = require('../src/cache/cache');
const { createApp } = require('../src/app');
const request = require('supertest');

let ctx;
beforeAll(async () => {
  ctx = await setupTestContext();
});
beforeEach(() => ctx.reset());
afterAll(() => ctx.close());

describe('GET /api/v1/products', () => {
  it('paginates persisted products', async () => {
    for (let i = 0; i < 3; i++) await ctx.product({ sku: `P-${i}`, name: `Product ${i}` });

    const res = await ctx.http().get('/api/v1/products?page=2&pageSize=2').expect(200);
    expect(res.body).toMatchObject({ page: 2, pageSize: 2, total: 3 });
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({ sku: 'P-2', priceCents: 1000, stock: 10 });
  });

  it('rejects invalid pagination', async () => {
    await ctx.http().get('/api/v1/products?pageSize=1000').expect(400);
  });

  it('serves the second read from Redis', async () => {
    await ctx.product();
    expect((await ctx.http().get('/api/v1/products')).headers['x-cache']).toBe('miss');
    expect((await ctx.http().get('/api/v1/products')).headers['x-cache']).toBe('hit');
  });
});

describe('GET /api/v1/products/:id', () => {
  it('returns the product', async () => {
    const id = await ctx.product({ name: 'Mug' });
    const res = await ctx.http().get(`/api/v1/products/${id}`).expect(200);
    expect(res.body.data).toMatchObject({ id, name: 'Mug' });
    // segunda leitura vem do cache e tem o mesmo conteúdo
    expect((await ctx.http().get(`/api/v1/products/${id}`)).body).toEqual(res.body);
  });

  it('returns 404 for an unknown id and 400 for a malformed one', async () => {
    const res = await ctx.http().get('/api/v1/products/00000000-0000-4000-8000-000000000000').expect(404);
    expect(res.body.error.code).toBe('not_found');
    await ctx.http().get('/api/v1/products/not-a-uuid').expect(400);
  });
});

describe('catalog writes', () => {
  const body = { sku: 'NEW-1', name: 'New', priceCents: 2500, stock: 5 };

  it('require authentication (401) and the admin role (403)', async () => {
    await ctx.http().post('/api/v1/products').send(body).expect(401);
    const customer = await ctx.user();
    const res = await ctx.http().post('/api/v1/products').set('Authorization', customer.auth).send(body).expect(403);
    expect(res.body.error.code).toBe('forbidden');
    const id = await ctx.product();
    await ctx.http().patch(`/api/v1/products/${id}`).set('Authorization', customer.auth).send({ stock: 1 }).expect(403);
  });

  it('let an admin create and update, rejecting duplicate SKUs', async () => {
    const admin = await ctx.admin();
    const created = await ctx.http().post('/api/v1/products').set('Authorization', admin.auth).send(body).expect(201);
    expect(created.body.data).toMatchObject({ sku: 'NEW-1', priceCents: 2500 });
    await ctx.http().post('/api/v1/products').set('Authorization', admin.auth).send(body).expect(409);

    const updated = await ctx.http()
      .patch(`/api/v1/products/${created.body.data.id}`)
      .set('Authorization', admin.auth)
      .send({ priceCents: 3000, description: 'updated' })
      .expect(200);
    expect(updated.body.data).toMatchObject({ priceCents: 3000, description: 'updated' });

    await ctx.http()
      .patch('/api/v1/products/00000000-0000-4000-8000-000000000000')
      .set('Authorization', admin.auth)
      .send({ stock: 1 })
      .expect(404);
    await ctx.http().patch(`/api/v1/products/${created.body.data.id}`).set('Authorization', admin.auth).send({}).expect(400);
  });

  it('invalidate cached list and detail entries', async () => {
    const admin = await ctx.admin();
    const id = await ctx.product({ priceCents: 1000 });
    await ctx.http().get('/api/v1/products');
    await ctx.http().get(`/api/v1/products/${id}`);
    expect((await ctx.http().get('/api/v1/products')).headers['x-cache']).toBe('hit');

    await ctx.http().patch(`/api/v1/products/${id}`).set('Authorization', admin.auth).send({ priceCents: 1500 }).expect(200);

    const list = await ctx.http().get('/api/v1/products');
    expect(list.headers['x-cache']).toBe('miss');
    expect(list.body.data[0].priceCents).toBe(1500);
    expect((await ctx.http().get(`/api/v1/products/${id}`)).body.data.priceCents).toBe(1500);
  });
});

describe('when Redis is down', () => {
  it('keeps serving the catalog from PostgreSQL', async () => {
    const id = await ctx.product({ name: 'Still here' });
    // Porta sem nada escutando: todo comando falha rápido.
    const deadCache = createCache({ url: 'redis://127.0.0.1:1/0', ttlSeconds: 60 }, { log: { warn() {}, debug() {} } });
    const app = createApp({ config: ctx.config, db: ctx.db, cache: deadCache });
    const admin = await ctx.admin();

    const list = await request(app).get('/api/v1/products').expect(200);
    expect(list.body.data[0].name).toBe('Still here');
    await request(app).get(`/api/v1/products/${id}`).expect(200);
    await request(app).patch(`/api/v1/products/${id}`).set('Authorization', admin.auth).send({ stock: 3 }).expect(200);
    deadCache.client.disconnect();
  });
});
