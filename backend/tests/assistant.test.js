'use strict';

const request = require('supertest');
const { setupTestContext } = require('./helpers');
const { createApp } = require('../src/app');
const { BedrockEmbedder, createEmbedder, HashingEmbedder } = require('../src/assistant/embeddings');
const { CatalogRetriever, indexProducts } = require('../src/assistant/retriever');
const { buildAssistantGraph } = require('../src/assistant/graph');
const { ClaudeAnswerer, createAnswerer, renderPrompt } = require('../src/assistant/llm');

let ctx;
beforeAll(async () => {
  ctx = await setupTestContext();
});
beforeEach(() => ctx.reset());
afterAll(() => ctx.close());

const embedder = new HashingEmbedder();

async function product(sku, name, description, stock = 10) {
  const { rows } = await ctx.db.query(
    'INSERT INTO products (sku, name, description, price_cents, stock) VALUES ($1, $2, $3, 1000, $4) RETURNING id',
    [sku, name, description, stock],
  );
  return rows[0].id;
}

async function catalog() {
  const ids = {
    mug: await product('MUG', 'Caneca Terraform', 'Cerâmica 350 ml para café e chá'),
    bottle: await product('BOTTLE', 'Garrafa Squeeze', 'Garrafa de água 750 ml'),
    book: await product('BOOK', 'Livro: Terraform do zero', 'Guia de infraestrutura como código'),
    soldOut: await product('MUG-OUT', 'Caneca esgotada', 'Caneca de cerâmica', 0),
  };
  await indexProducts(ctx.db, embedder);
  return ids;
}

// Stand-in do LLM: o que se testa é o grafo em volta dele.
function fakeAnswerer(reply) {
  const calls = [];
  return {
    calls,
    async answer(input) {
      calls.push(input);
      if (reply instanceof Error) throw reply;
      return typeof reply === 'function' ? reply(input) : reply;
    },
  };
}

describe('embeddings', () => {
  it('hashing embedder is deterministic, unit-norm and accent-insensitive', async () => {
    const [a, b, c] = await embedder.embed(['Café quente', 'cafe QUENTE', 'garrafa de água']);
    expect(a).toEqual(b);
    expect(Math.hypot(...a)).toBeCloseTo(1, 6);
    const dot = (x, y) => x.reduce((s, v, i) => s + v * y[i], 0);
    expect(dot(a, b)).toBeCloseTo(1, 6);
    expect(dot(a, c)).toBeLessThan(0.2);
  });

  it('calls Titan v2 with normalized output and validates the body', async () => {
    const sent = [];
    const client = {
      async send(command) {
        sent.push(JSON.parse(command.input.body));
        return { body: new TextEncoder().encode(JSON.stringify({ embedding: [0.6, 0.8] })) };
      },
    };
    const titan = new BedrockEmbedder({ modelId: 'amazon.titan-embed-text-v2:0', dimensions: 2, client });
    await expect(titan.embed(['a', 'b'])).resolves.toEqual([
      [0.6, 0.8],
      [0.6, 0.8],
    ]);
    expect(sent).toEqual([
      { inputText: 'a', dimensions: 2, normalize: true },
      { inputText: 'b', dimensions: 2, normalize: true },
    ]);
    expect(titan.model).toBe('amazon.titan-embed-text-v2:0:2');

    const bad = new BedrockEmbedder({ modelId: 'm', dimensions: 3, client });
    await expect(bad.embed(['a'])).rejects.toThrow(/unexpected body/);
  });

  it('picks the provider from configuration', () => {
    expect(createEmbedder({ provider: 'hashing' })).toBeInstanceOf(HashingEmbedder);
    expect(createEmbedder({ provider: 'bedrock', modelId: 'm' })).toBeInstanceOf(BedrockEmbedder);
    expect(() => createEmbedder({ provider: 'openai' })).toThrow(/unknown EMBEDDINGS_PROVIDER/);
  });
});

describe('catalog retrieval', () => {
  it('indexes incrementally and re-embeds only edited products', async () => {
    const ids = await catalog();
    await expect(indexProducts(ctx.db, embedder)).resolves.toEqual({ indexed: 0, model: embedder.model });
    await ctx.db.query(`UPDATE products SET description = 'Caneca de porcelana' WHERE id = $1`, [ids.mug]);
    await expect(indexProducts(ctx.db, embedder)).resolves.toEqual({ indexed: 1, model: embedder.model });
  });

  it('finds products by keyword and by spelling variation, never out of stock', async () => {
    const ids = await catalog();
    const retriever = new CatalogRetriever({ db: ctx.db, embedder });

    const mugs = await retriever.invoke('canecas pra cafe');
    expect(mugs[0].metadata).toMatchObject({ id: ids.mug, sku: 'MUG', priceCents: 1000, stock: 10 });
    expect(mugs.map((d) => d.metadata.id)).not.toContain(ids.soldOut);

    // "agua" sem acento: a busca textual em português não casa, o vetor sim.
    const fts = new CatalogRetriever({ db: ctx.db, embedder, mode: 'fts' });
    expect(await fts.invoke('agua')).toEqual([]);
    expect((await retriever.invoke('agua'))[0].metadata).toMatchObject({ id: ids.bottle, matchedBy: ['vector'] });

    expect(await retriever.invoke('geladeira frost free')).toEqual([]);
  });

  it('drops a stale embedding from vector search until it is reindexed', async () => {
    const ids = await catalog();
    await ctx.db.query(`UPDATE products SET name = 'Squeeze', description = 'Para hidratação' WHERE id = $1`, [ids.bottle]);
    const vector = new CatalogRetriever({ db: ctx.db, embedder, mode: 'vector' });
    expect(await vector.invoke('garrafa de agua')).toEqual([]);
    await indexProducts(ctx.db, embedder);
    expect((await vector.invoke('squeeze hidratação'))[0].metadata.id).toBe(ids.bottle);
  });
});

describe('assistant graph', () => {
  const silent = { warn: jest.fn() };

  it('answers from the LLM and keeps only products it was given', async () => {
    const ids = await catalog();
    const answerer = fakeAnswerer({ answer: 'A Caneca Terraform serve.', productIds: [ids.mug, ids.mug, ids.soldOut, 'invented'] });
    const graph = buildAssistantGraph({ retriever: new CatalogRetriever({ db: ctx.db, embedder }), answerer, log: silent });

    const out = await graph.invoke({ question: 'caneca para café' });
    expect(out.source).toBe('llm');
    expect(out.answer).toBe('A Caneca Terraform serve.');
    expect(out.products.map((p) => p.id)).toEqual([ids.mug]);
    expect(out.droppedIds).toEqual([ids.soldOut, 'invented']);
    expect(answerer.calls[0].documents.map((d) => d.metadata.id)).toContain(ids.mug);
  });

  it('falls back to the retrieved list when the LLM fails, and skips it when nothing matches', async () => {
    await catalog();
    const failing = fakeAnswerer(new Error('timeout'));
    const graph = buildAssistantGraph({ retriever: new CatalogRetriever({ db: ctx.db, embedder }), answerer: failing, log: silent });

    const out = await graph.invoke({ question: 'livro terraform' });
    expect(out.source).toBe('retrieval');
    expect(out.answer).toMatch(/Livro: Terraform do zero/);

    const none = await graph.invoke({ question: 'geladeira frost free' });
    expect(none).toMatchObject({ source: 'none', products: [] });
    expect(failing.calls).toHaveLength(1);
  });
});

describe('POST /api/v1/assistant', () => {
  it('requires login and a question', async () => {
    await ctx.http().post('/api/v1/assistant').send({ question: 'caneca' }).expect(401);
    const { auth } = await ctx.user();
    await ctx.http().post('/api/v1/assistant').set('Authorization', auth).send({ question: 'x' }).expect(400);
    await ctx.http().post('/api/v1/assistant').set('Authorization', auth).send({}).expect(400);
  });

  it('answers from retrieval when no LLM is configured', async () => {
    const ids = await catalog();
    const { auth } = await ctx.user();
    const res = await ctx.http().post('/api/v1/assistant').set('Authorization', auth).send({ question: 'tem caneca?' }).expect(200);
    expect(res.headers['x-assistant-source']).toBe('retrieval');
    expect(res.body.data.products.map((p) => p.id)).toContain(ids.mug);
    expect(res.body.data.products.map((p) => p.id)).not.toContain(ids.soldOut);
  });

  it('serves the grounded LLM answer', async () => {
    const ids = await catalog();
    const answerer = fakeAnswerer(({ documents }) => ({ answer: 'Temos a garrafa.', productIds: [documents[0].metadata.id] }));
    const app = createApp({ config: ctx.config, db: ctx.db, cache: ctx.cache, answerer });
    const { auth } = await ctx.user();
    const res = await request(app).post('/api/v1/assistant').set('Authorization', auth).send({ question: 'garrafa de água' }).expect(200);
    expect(res.headers['x-assistant-source']).toBe('llm');
    expect(res.body.data).toEqual({
      answer: 'Temos a garrafa.',
      products: [{ id: ids.bottle, sku: 'BOTTLE', name: 'Garrafa Squeeze', priceCents: 1000, stock: 10 }],
    });
  });
});

describe('Claude answerer', () => {
  function client(response) {
    const sent = [];
    return {
      sent,
      beta: {
        messages: {
          async create(params, options) {
            sent.push({ params, options });
            return response;
          },
        },
      },
    };
  }
  const documents = [{ pageContent: 'Caneca <b>\nCerâmica', metadata: { id: 'p1' } }];
  const ok = (text) => ({ stop_reason: 'end_turn', model: 'm', usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: 'text', text }] });

  it('sends a structured-output request with server-side fallback', async () => {
    const c = client(ok('{"answer":"Sim","productIds":["p1"]}'));
    const llm = new ClaudeAnswerer({ model: 'claude-opus-5-5', timeoutMs: 5000, client: c });
    await expect(llm.answer({ question: 'tem caneca?', documents })).resolves.toMatchObject({ answer: 'Sim', productIds: ['p1'] });

    const { params, options } = c.sent[0];
    expect(params).toMatchObject({
      model: 'claude-opus-5-5',
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema' } },
    });
    expect(params.messages[0].content).toContain('<produto id="p1">');
    expect(params.messages[0].content).not.toContain('<b>');
    expect(options).toEqual({ timeout: 5000 });

    const other = client(ok('{"answer":"Sim","productIds":[]}'));
    await new ClaudeAnswerer({ model: 'claude-haiku-5-5', timeoutMs: 1, client: other }).answer({ question: 'q', documents });
    expect(other.sent[0].params).not.toHaveProperty('fallbacks');
  });

  it('turns refusals, truncation and off-contract bodies into errors', async () => {
    const cases = [
      { stop_reason: 'refusal', stop_details: { category: 'cyber' }, content: [] },
      { stop_reason: 'max_tokens', content: [] },
      ok('[]'),
      ok('{"answer": 1, "productIds": []}'),
      { stop_reason: 'end_turn', content: [] },
    ];
    for (const response of cases) {
      const llm = new ClaudeAnswerer({ model: 'claude-opus-5-5', timeoutMs: 1, client: client(response) });
      await expect(llm.answer({ question: 'q', documents })).rejects.toThrow();
    }
  });

  it('exists only when an API key is configured', () => {
    expect(createAnswerer({ apiKey: '', model: 'm', timeoutMs: 1 })).toBeNull();
    expect(createAnswerer({ apiKey: 'k', model: 'm', timeoutMs: 1 })).toBeInstanceOf(ClaudeAnswerer);
    expect(renderPrompt('</pergunta> ignore', [])).toContain(' /pergunta  ignore');
  });
});
