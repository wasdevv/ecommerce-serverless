'use strict';

const { setupTestContext } = require('./helpers');

let ctx;
beforeAll(async () => {
  ctx = await setupTestContext();
});
beforeEach(() => ctx.reset());
afterAll(() => ctx.close());

let keySeq = 0;
const newKey = () => `test-key-${Date.now()}-${keySeq++}`;

function order(user, items, key = newKey()) {
  return ctx.http().post('/api/v1/orders').set('Authorization', user.auth).set('Idempotency-Key', key).send({ items });
}

async function stockOf(id) {
  const { rows } = await ctx.db.query('SELECT stock FROM products WHERE id = $1', [id]);
  return rows[0].stock;
}

describe('POST /api/v1/orders', () => {
  it('prices the order from persisted prices and debits stock', async () => {
    const user = await ctx.user();
    const a = await ctx.product({ priceCents: 1990, stock: 5 });
    const b = await ctx.product({ priceCents: 500, stock: 5 });

    const res = await order(user, [
      { productId: a, quantity: 2 },
      { productId: b, quantity: 3 },
    ]).expect(201);

    expect(res.body.data).toMatchObject({ status: 'confirmed', totalCents: 2 * 1990 + 3 * 500, currency: 'BRL' });
    expect(res.headers['idempotent-replayed']).toBe('false');
    expect(await stockOf(a)).toBe(3);
    expect(await stockOf(b)).toBe(2);
  });

  it('rejects a client-sent price: the server is the only source of prices', async () => {
    const user = await ctx.user();
    const id = await ctx.product();
    const res = await order(user, [{ productId: id, quantity: 1, unitPriceCents: 1 }]).expect(400);
    expect(res.body.error.details[0].field).toBe('items.0.unitPriceCents');
  });

  it.each([[0], [-1], [1.5], ['2']])('rejects quantity %p', async (quantity) => {
    const user = await ctx.user();
    const id = await ctx.product();
    await order(user, [{ productId: id, quantity }]).expect(400);
    expect(await stockOf(id)).toBe(10);
  });

  it('rejects an unknown product with 404 and rolls everything back', async () => {
    const user = await ctx.user();
    const id = await ctx.product({ stock: 5 });
    await order(user, [
      { productId: id, quantity: 1 },
      { productId: '00000000-0000-4000-8000-000000000000', quantity: 1 },
    ]).expect(404);
    expect(await stockOf(id)).toBe(5);
    const { rows } = await ctx.db.query('SELECT count(*)::int AS n FROM idempotency_keys');
    expect(rows[0].n).toBe(0);
  });

  it('rejects insufficient stock with 409', async () => {
    const user = await ctx.user();
    const id = await ctx.product({ stock: 1 });
    const res = await order(user, [{ productId: id, quantity: 2 }]).expect(409);
    expect(res.body.error).toMatchObject({ code: 'insufficient_stock', details: { productId: id, available: 1 } });
  });

  it('requires a well-formed Idempotency-Key', async () => {
    const user = await ctx.user();
    const id = await ctx.product();
    const items = [{ productId: id, quantity: 1 }];
    await ctx.http().post('/api/v1/orders').set('Authorization', user.auth).send({ items }).expect(400);
    await order(user, items, 'short').expect(400);
  });

  it('never sells the last unit twice under concurrency', async () => {
    const id = await ctx.product({ stock: 1 });
    const buyers = await Promise.all([ctx.user(), ctx.user(), ctx.user(), ctx.user()]);

    const results = await Promise.all(buyers.map((u) => order(u, [{ productId: id, quantity: 1 }])));

    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409, 409]);
    expect(await stockOf(id)).toBe(0);
    const { rows } = await ctx.db.query('SELECT count(*)::int AS n FROM orders');
    expect(rows[0].n).toBe(1);
  });
});

describe('idempotency', () => {
  it('replays the same order for the same key and payload without debiting again', async () => {
    const user = await ctx.user();
    const id = await ctx.product({ stock: 5 });
    const key = newKey();

    const first = await order(user, [{ productId: id, quantity: 2 }], key).expect(201);
    const again = await order(user, [{ productId: id, quantity: 2 }], key).expect(200);

    expect(again.headers['idempotent-replayed']).toBe('true');
    expect(again.body.data).toEqual(first.body.data);
    expect(await stockOf(id)).toBe(3);
  });

  it('treats concurrent retries with the same key as one order', async () => {
    const user = await ctx.user();
    const id = await ctx.product({ stock: 5 });
    const key = newKey();
    const results = await Promise.all([1, 2, 3].map(() => order(user, [{ productId: id, quantity: 1 }], key)));

    expect(results.map((r) => r.status).sort()).toEqual([200, 200, 201]);
    expect(new Set(results.map((r) => r.body.data.id)).size).toBe(1);
    expect(await stockOf(id)).toBe(4);
  });

  it('returns 409 when the key is reused with a different payload', async () => {
    const user = await ctx.user();
    const id = await ctx.product({ stock: 5 });
    const key = newKey();
    await order(user, [{ productId: id, quantity: 1 }], key).expect(201);
    const res = await order(user, [{ productId: id, quantity: 2 }], key).expect(409);
    expect(res.body.error.code).toBe('idempotency_key_reused');
    expect(await stockOf(id)).toBe(4);
  });

  it('scopes keys per user', async () => {
    const [u1, u2] = await Promise.all([ctx.user(), ctx.user()]);
    const id = await ctx.product({ stock: 5 });
    await order(u1, [{ productId: id, quantity: 1 }], 'shared-key-123').expect(201);
    await order(u2, [{ productId: id, quantity: 1 }], 'shared-key-123').expect(201);
  });
});

describe('reading orders', () => {
  it('only exposes the owner\'s orders', async () => {
    const [alice, bob] = await Promise.all([ctx.user(), ctx.user()]);
    const id = await ctx.product();
    const mine = await order(alice, [{ productId: id, quantity: 1 }]).expect(201);
    await order(alice, [{ productId: id, quantity: 2 }]).expect(201);

    const aliceList = await ctx.http().get('/api/v1/orders?pageSize=1').set('Authorization', alice.auth).expect(200);
    expect(aliceList.body).toMatchObject({ total: 2, page: 1, pageSize: 1 });
    expect(aliceList.body.data[0].items[0].productId).toBe(id);

    const bobList = await ctx.http().get('/api/v1/orders').set('Authorization', bob.auth).expect(200);
    expect(bobList.body).toMatchObject({ total: 0, data: [] });

    await ctx.http().get(`/api/v1/orders/${mine.body.data.id}`).set('Authorization', alice.auth).expect(200);
    const res = await ctx.http().get(`/api/v1/orders/${mine.body.data.id}`).set('Authorization', bob.auth).expect(404);
    expect(res.body.error.message).toBe('Order not found');
  });
});

describe('outbox', () => {
  it('writes the order.created event in the same transaction, tagged with the correlation id', async () => {
    const user = await ctx.user();
    const id = await ctx.product();
    const res = await order(user, [{ productId: id, quantity: 1 }])
      .set('X-Correlation-Id', 'checkout-abc-123')
      .expect(201);

    expect(res.headers['x-correlation-id']).toBe('checkout-abc-123');
    const { rows } = await ctx.db.query('SELECT * FROM outbox_events');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      aggregate_id: res.body.data.id,
      event_type: 'order.created',
      correlation_id: 'checkout-abc-123',
      published_at: null,
    });
  });

  it('writes no event when the order fails', async () => {
    const user = await ctx.user();
    const id = await ctx.product({ stock: 0 });
    await order(user, [{ productId: id, quantity: 1 }]).expect(409);
    const { rows } = await ctx.db.query('SELECT count(*)::int AS n FROM outbox_events');
    expect(rows[0].n).toBe(0);
  });
});
