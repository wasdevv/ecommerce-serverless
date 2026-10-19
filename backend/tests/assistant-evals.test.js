'use strict';

const { setupTestContext } = require('./helpers');
const { HashingEmbedder } = require('../src/assistant/embeddings');
const { evalRetrieval, seedCatalog } = require('../evals/lib');

// Gate de regressão da recuperação, com o embedder de hashing (o do CI). Os
// pisos são o desempenho medido hoje: mexer na busca e piorar quebra o build.
// A categoria "semantic" fica fora de propósito — hashing não entende
// sinônimo; ela é medida com o Titan pelo runner (evals/run.js).

let ctx;
beforeAll(async () => {
  ctx = await setupTestContext();
});
afterAll(() => ctx.close());

it('hybrid retrieval holds its floor on the eval dataset', async () => {
  await ctx.reset();
  const embedder = new HashingEmbedder();
  await seedCatalog(ctx.db, embedder);
  const { summary } = await evalRetrieval({ db: ctx.db, embedder, mode: 'hybrid', k: 5 });

  expect(summary.byCategory.lexical.hitRate).toBe(1);
  expect(summary.byCategory.morphology.hitRate).toBe(1);
  expect(summary.abstention.rate).toBe(1);
  expect(summary.forbiddenRetrievals).toBe(0);
});

it('refuses to seed a database that is not for tests or evals', async () => {
  const db = { query: async () => ({ rows: [{ name: 'ecommerce' }] }) };
  await expect(seedCatalog(db, new HashingEmbedder())).rejects.toThrow(/refusing/);
});
