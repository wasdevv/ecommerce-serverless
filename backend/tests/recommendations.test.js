'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawn } = require('node:child_process');
const readline = require('node:readline');
const { once } = require('node:events');
const request = require('supertest');
const { setupTestContext } = require('./helpers');
const { createApp } = require('../src/app');
const { exportTrainingData } = require('../src/services/recommendations');
const { createRecommender, HttpRecommender, SageMakerRecommender } = require('../src/recommender/client');

const ML_DIR = path.resolve(__dirname, '../../ml');

let ctx;
beforeAll(async () => {
  ctx = await setupTestContext();
});
beforeEach(() => ctx.reset());
afterAll(() => ctx.close());

async function userId(email) {
  const { rows } = await ctx.db.query('SELECT id FROM users WHERE email = $1', [email]);
  return rows[0].id;
}

// Histórico direto no banco: o que se testa aqui é a leitura do histórico, não
// o fluxo de pedido (coberto em orders.test.js).
async function buy(uid, productIds, quantity = 1) {
  const { rows } = await ctx.db.query(
    'INSERT INTO orders (user_id, total_cents) VALUES ($1, $2) RETURNING id',
    [uid, 1000 * productIds.length * quantity],
  );
  for (const pid of productIds) {
    await ctx.db.query(
      'INSERT INTO order_items (order_id, product_id, quantity, unit_price_cents) VALUES ($1, $2, $3, 1000)',
      [rows[0].id, pid, quantity],
    );
  }
}

function appWith(recommender) {
  return createApp({ config: ctx.config, db: ctx.db, cache: ctx.cache, recommender });
}

function fakeRecommender(respond) {
  return {
    kind: 'fake',
    calls: [],
    async recommend(input) {
      this.calls.push(input);
      return respond(input);
    },
  };
}

describe('GET /api/v1/recommendations', () => {
  it('requires authentication and validates the limit', async () => {
    await ctx.http().get('/api/v1/recommendations').expect(401);
    const user = await ctx.user();
    await ctx.http().get('/api/v1/recommendations?limit=21').set('Authorization', user.auth).expect(400);
  });

  it('falls back to best sellers in stock when there is no model', async () => {
    const [low, top, soldOut, never] = [
      await ctx.product({ sku: 'LOW' }),
      await ctx.product({ sku: 'TOP' }),
      await ctx.product({ sku: 'SOLD-OUT', stock: 0 }),
      await ctx.product({ sku: 'NEVER' }),
    ];
    const buyer = await ctx.user();
    await buy(await userId(buyer.email), [top, soldOut], 5);
    await buy(await userId(buyer.email), [low], 1);

    const user = await ctx.user();
    const res = await ctx.http().get('/api/v1/recommendations?limit=3').set('Authorization', user.auth).expect(200);
    expect(res.headers['x-recommendation-source']).toBe('popular');
    expect(res.body.data.map((p) => p.id)).toEqual([top, low, never]);
    expect(res.body.data[0]).toMatchObject({ sku: 'TOP', priceCents: 1000, score: null });
  });

  it('uses the model for users with history, keeps its order and drops what cannot be sold', async () => {
    const [owned, a, b, soldOut, filler] = [
      await ctx.product({ sku: 'OWNED' }),
      await ctx.product({ sku: 'A' }),
      await ctx.product({ sku: 'B' }),
      await ctx.product({ sku: 'SOLD-OUT', stock: 0 }),
      await ctx.product({ sku: 'FILLER' }),
    ];
    const user = await ctx.user();
    await buy(await userId(user.email), [owned]);

    const model = fakeRecommender(() => ({
      recommendations: [
        { productId: soldOut, score: 0.99 },
        { productId: b, score: 0.9 },
        { productId: 'not-a-uuid', score: 0.8 },
        { productId: '00000000-0000-4000-8000-000000000000', score: 0.7 },
        null,
        { productId: a, score: 0.5 },
      ],
      modelVersion: 'test',
    }));

    const res = await request(appWith(model))
      .get('/api/v1/recommendations?limit=3')
      .set('Authorization', user.auth)
      .expect(200);

    expect(model.calls).toEqual([{ productIds: [owned], k: 6 }]);
    expect(res.headers['x-recommendation-source']).toBe('model+popular');
    expect(res.body.data.map((p) => [p.id, p.score])).toEqual([
      [b, 0.9],
      [a, 0.5],
      [filler, null],
    ]);
  });

  it('answers with best sellers when the model is down', async () => {
    const [owned, other] = [await ctx.product({ sku: 'OWNED' }), await ctx.product({ sku: 'OTHER' })];
    const user = await ctx.user();
    await buy(await userId(user.email), [owned]);
    const broken = fakeRecommender(() => {
      throw new Error('endpoint timed out');
    });

    const res = await request(appWith(broken)).get('/api/v1/recommendations').set('Authorization', user.auth).expect(200);
    expect(res.headers['x-recommendation-source']).toBe('popular');
    expect(res.body.data.map((p) => p.id)).toEqual([other]);
  });

  it('skips the model for users without history', async () => {
    await ctx.product();
    const model = fakeRecommender(() => ({ recommendations: [] }));
    const user = await ctx.user();
    await request(appWith(model)).get('/api/v1/recommendations').set('Authorization', user.auth).expect(200);
    expect(model.calls).toEqual([]);
  });
});

describe('training data export', () => {
  it('sums quantities per user and product and pseudonymizes users per export', async () => {
    const [p1, p2] = [await ctx.product(), await ctx.product()];
    const [u1, u2] = [await ctx.user(), await ctx.user()];
    await buy(await userId(u1.email), [p1, p2], 1);
    await buy(await userId(u1.email), [p1], 2);
    await buy(await userId(u2.email), [p2], 1);

    const first = await exportTrainingData(ctx.db);
    const lines = first.csv.trim().split('\n');
    expect(lines[0]).toBe('user,product_id,quantity');
    expect(first.rows).toBe(3);
    expect(first.csv).not.toContain(await userId(u1.email));

    const rows = lines.slice(1).map((l) => l.split(','));
    const u1Rows = rows.filter((r) => r[0] === rows.find((x) => x[1] === p1)[0]);
    expect(u1Rows.map((r) => [r[1], r[2]]).sort()).toEqual([[p1, '3'], [p2, '1']].sort());

    const second = await exportTrainingData(ctx.db);
    expect(second.csv.split('\n')[1].split(',')[0]).not.toBe(lines[1].split(',')[0]);
  });
});

// Contrato Node <-> Python de verdade: exporta do PostgreSQL, treina com o
// train.py, sobe o serve.py (mesmo contrato do container SageMaker) e a API
// consulta por HTTP. Nenhum lado é simulado.
describe('recommender contract with the Python model server', () => {
  let tmp;
  let server;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'recommender-'));
  });
  afterEach(() => {
    server?.kill();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  async function startServer() {
    server = spawn('python3', ['-m', 'recommender.serve', '--model-dir', tmp, '--host', '127.0.0.1', '--port', '0'], {
      cwd: ML_DIR,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const [line] = await once(readline.createInterface({ input: server.stdout }), 'line');
    return `http://${line.replace('listening on ', '')}`;
  }

  it('recommends what similar customers bought once the model is trained', async () => {
    const [tshirt, hoodie, mug, book] = [
      await ctx.product({ sku: 'TSHIRT' }),
      await ctx.product({ sku: 'HOODIE' }),
      await ctx.product({ sku: 'MUG' }),
      await ctx.product({ sku: 'BOOK' }),
    ];
    for (let i = 0; i < 3; i++) {
      const u = await ctx.user();
      await buy(await userId(u.email), [tshirt, hoodie]);
    }
    // Caneca e livro vendem mais: sem modelo, seriam eles os recomendados.
    for (let i = 0; i < 4; i++) {
      const u = await ctx.user();
      await buy(await userId(u.email), [mug, book], 3);
    }
    const shopper = await ctx.user();
    await buy(await userId(shopper.email), [tshirt]);

    const app = appWith(new HttpRecommender({ url: await startServer(), timeoutMs: 2000 }));
    const ask = () => request(app).get('/api/v1/recommendations?limit=1').set('Authorization', shopper.auth).expect(200);

    // Servidor no ar, modelo ainda não treinado: 503 dele vira fallback aqui.
    const before = await ask();
    expect(before.headers['x-recommendation-source']).toBe('popular');
    expect([mug, book]).toContain(before.body.data[0].id);

    const csvPath = path.join(tmp, 'order_items.csv');
    fs.writeFileSync(csvPath, (await exportTrainingData(ctx.db)).csv);
    execFileSync('python3', ['-m', 'recommender.train', csvPath, tmp], { cwd: ML_DIR, stdio: 'ignore' });

    const after = await ask();
    expect(after.headers['x-recommendation-source']).toBe('model');
    // 3 dos 4 compradores de camiseta levaram moletom: 3 / sqrt(4 * 3).
    expect(after.body.data).toEqual([expect.objectContaining({ id: hoodie, sku: 'HOODIE', score: expect.closeTo(0.866025, 5) })]);
  });
});

describe('recommender clients', () => {
  it('picks the transport from configuration', () => {
    expect(createRecommender({})).toBeNull();
    expect(createRecommender({ url: 'http://localhost:8080', timeoutMs: 1 })).toBeInstanceOf(HttpRecommender);
    expect(createRecommender({ endpointName: 'ep', url: 'http://x', timeoutMs: 1 })).toBeInstanceOf(SageMakerRecommender);
  });

  it('calls InvokeEndpoint with the JSON contract and a timeout', async () => {
    const sent = [];
    const client = {
      async send(command, options) {
        sent.push({ input: command.input, options });
        return { Body: new TextEncoder().encode(JSON.stringify({ recommendations: [{ productId: 'p', score: 1 }] })) };
      },
    };
    const sm = new SageMakerRecommender({ endpointName: 'ecommerce-dev-recommender', timeoutMs: 800, client });
    await expect(sm.recommend({ productIds: ['a'], k: 4 })).resolves.toEqual({
      recommendations: [{ productId: 'p', score: 1 }],
    });
    expect(sent[0].input).toMatchObject({
      EndpointName: 'ecommerce-dev-recommender',
      ContentType: 'application/json',
      Body: JSON.stringify({ productIds: ['a'], k: 4 }),
    });
    expect(sent[0].options.abortSignal).toBeInstanceOf(AbortSignal);
  });

  it('rejects bodies outside the contract', async () => {
    for (const body of ['[]', 'null', '{"recommendations": "x"}']) {
      const client = { send: async () => ({ Body: new TextEncoder().encode(body) }) };
      const sm = new SageMakerRecommender({ endpointName: 'ep', timeoutMs: 1, client });
      await expect(sm.recommend({ productIds: [], k: 1 })).rejects.toThrow(/unexpected body/);
    }
  });
});
