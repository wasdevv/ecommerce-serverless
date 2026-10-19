'use strict';

// Núcleo dos evals do assistente, usado pelo runner (evals/run.js) e pelo
// gate da suíte (tests/assistant-evals.test.js).
//
// Dois níveis, porque falham por motivos diferentes:
//   retrieval -> a busca trouxe o produto certo? Determinístico, sem custo,
//                roda no CI a cada push.
//   answers   -> a resposta do LLM é fiel aos produtos e útil? Chama a API da
//                Anthropic (gerador + juiz): roda sob demanda, com chave.

const fs = require('node:fs');
const path = require('node:path');
const { CatalogRetriever, indexProducts } = require('../src/assistant/retriever');
const { buildAssistantGraph } = require('../src/assistant/graph');

const CATALOG = require('./catalog.json');
const DATASET = fs
  .readFileSync(path.join(__dirname, 'dataset.jsonl'), 'utf8')
  .split('\n')
  .filter((line) => line.trim())
  .map((line) => JSON.parse(line));
// Produto sem estoque nunca pode ser recuperado, em pergunta nenhuma.
const FORBIDDEN = new Set(CATALOG.filter(([, , , , stock]) => stock === 0).map(([sku]) => sku));

// Apaga o catálogo inteiro: só roda em banco de teste ou de eval.
async function seedCatalog(db, embedder) {
  const { rows } = await db.query('SELECT current_database() AS name');
  if (!/_(test|eval)$/.test(rows[0].name)) {
    throw new Error(`refusing to seed the eval catalog into "${rows[0].name}": use a database ending in _test or _eval`);
  }
  await db.query('TRUNCATE products CASCADE');
  for (const [sku, name, description, price, stock] of CATALOG) {
    await db.query('INSERT INTO products (sku, name, description, price_cents, stock) VALUES ($1, $2, $3, $4, $5)', [
      sku,
      name,
      description,
      price,
      stock,
    ]);
  }
  return indexProducts(db, embedder);
}

function scoreRetrieval(item, retrieved) {
  const expected = new Set(item.expected);
  const firstHit = retrieved.findIndex((sku) => expected.has(sku));
  return {
    id: item.id,
    category: item.category,
    question: item.question,
    retrieved,
    hit: firstHit >= 0,
    recall: expected.size === 0 ? null : retrieved.filter((sku) => expected.has(sku)).length / expected.size,
    reciprocalRank: firstHit >= 0 ? 1 / (firstHit + 1) : 0,
    abstained: retrieved.length === 0,
    forbidden: retrieved.filter((sku) => FORBIDDEN.has(sku)),
  };
}

const mean = (xs) => (xs.length === 0 ? null : xs.reduce((s, x) => s + x, 0) / xs.length);

// hit@k, recall@k e MRR nas perguntas que têm resposta, por categoria e no
// total; abstenção nas que não têm ("none"); violações de estoque em todas.
function summarizeRetrieval(cases) {
  const answerable = (cs) => cs.filter((c) => c.category !== 'none' && c.category !== 'stock');
  const block = (cs) => ({
    n: cs.length,
    hitRate: mean(cs.map((c) => (c.hit ? 1 : 0))),
    recall: mean(cs.map((c) => c.recall)),
    mrr: mean(cs.map((c) => c.reciprocalRank)),
  });
  const byCategory = {};
  for (const category of [...new Set(answerable(cases).map((c) => c.category))]) {
    byCategory[category] = block(cases.filter((c) => c.category === category));
  }
  const none = cases.filter((c) => c.category === 'none');
  return {
    answerable: block(answerable(cases)),
    byCategory,
    abstention: { n: none.length, rate: mean(none.map((c) => (c.abstained ? 1 : 0))) },
    forbiddenRetrievals: cases.reduce((s, c) => s + c.forbidden.length, 0),
  };
}

async function evalRetrieval({ db, embedder, mode, k = 5, minVectorScore, dataset = DATASET }) {
  const retriever = new CatalogRetriever({ db, embedder, k, mode, minVectorScore });
  const cases = [];
  for (const item of dataset) {
    const docs = await retriever.invoke(item.question);
    cases.push(scoreRetrieval(item, docs.map((d) => d.metadata.sku)));
  }
  return { mode, k, cases, summary: summarizeRetrieval(cases) };
}

// Resposta ponta a ponta pelo mesmo grafo da API. Métricas de código
// (grounding, precisão das citações) + duas notas do juiz LLM.
async function evalAnswers({ db, embedder, answerer, judge, retrieval = {}, dataset = DATASET }) {
  const retriever = new CatalogRetriever({ db, embedder, ...retrieval });
  const silent = { warn() {} };
  const graph = buildAssistantGraph({ retriever, answerer, log: silent });
  const cases = [];
  for (const item of dataset) {
    const state = await graph.invoke({ question: item.question });
    const cited = state.products.map((p) => p.sku);
    const expected = new Set(item.expected);
    const verdict = judge && state.source === 'llm' ? await judge.grade({ question: item.question, documents: state.documents, answer: state.answer }) : null;
    cases.push({
      id: item.id,
      category: item.category,
      question: item.question,
      source: state.source,
      answer: state.answer,
      cited,
      grounded: state.droppedIds.length === 0,
      // Pergunta sem resposta: acerto é não citar nada.
      citationsCorrect: expected.size === 0 ? cited.length === 0 : cited.length > 0 && cited.every((s) => expected.has(s)),
      verdict,
      usage: state.draft?.usage ?? null,
    });
  }
  const rate = (pred) => mean(cases.map((c) => (pred(c) ? 1 : 0)));
  const judged = cases.filter((c) => c.verdict);
  return {
    cases,
    summary: {
      n: cases.length,
      llmAnswered: rate((c) => c.source === 'llm'),
      grounded: rate((c) => c.grounded),
      citationsCorrect: rate((c) => c.citationsCorrect),
      faithful: mean(judged.map((c) => (c.verdict.faithful ? 1 : 0))),
      helpful: mean(judged.map((c) => (c.verdict.helpful ? 1 : 0))),
      // Gerador e juiz somados: é o custo de rodar este eval uma vez.
      tokens: cases
        .flatMap((c) => [c.usage, c.verdict?.usage])
        .filter(Boolean)
        .reduce((t, u) => ({ input: t.input + u.input_tokens, output: t.output + u.output_tokens }), { input: 0, output: 0 }),
    },
  };
}

module.exports = { CATALOG, DATASET, seedCatalog, evalRetrieval, evalAnswers, summarizeRetrieval };
