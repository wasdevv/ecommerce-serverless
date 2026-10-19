'use strict';

// Runner dos evals do assistente. Sobe o catálogo de eval num banco dedicado,
// indexa e mede a recuperação nos três modos (fts, vector, hybrid) — a
// comparação lado a lado é o que justifica a busca híbrida. Com --llm, mede
// também as respostas (gerador + juiz): isso chama a API da Anthropic e custa.
//
//   EVAL_DATABASE_URL=postgres://.../ecommerce_eval npm run eval
//   EVAL_DATABASE_URL=... ANTHROPIC_API_KEY=... npm run eval -- --llm --out evals/report.json
//   EMBEDDINGS_PROVIDER=bedrock (credenciais AWS) para medir com o Titan.

const fs = require('node:fs');
const { parseArgs } = require('node:util');
const { baseConfig } = require('../src/config');
const { createPool } = require('../src/db/pool');
const { migrate } = require('../src/db/migrate');
const { createEmbedder } = require('../src/assistant/embeddings');
const { createAnswerer } = require('../src/assistant/llm');
const { ClaudeJudge } = require('./judge');
const { evalAnswers, evalRetrieval, seedCatalog } = require('./lib');

const pct = (x) => (x === null ? '   -' : `${(x * 100).toFixed(0).padStart(3)}%`);

function printRetrieval(results) {
  const categories = Object.keys(results[0].summary.byCategory);
  console.log(`\nRetrieval (k=${results[0].k})`);
  console.log(['mode   ', 'hit@k', 'recall', ' MRR', ...categories.map((c) => c.slice(0, 6).padStart(6)), 'abstain', 'stock'].join('  '));
  for (const { mode, summary: s } of results) {
    console.log(
      [
        mode.padEnd(7),
        pct(s.answerable.hitRate).padStart(5),
        pct(s.answerable.recall).padStart(6),
        pct(s.answerable.mrr),
        ...categories.map((c) => pct(s.byCategory[c].hitRate).padStart(6)),
        pct(s.abstention.rate).padStart(7),
        String(s.forbiddenRetrievals).padStart(5),
      ].join('  '),
    );
  }
  const misses = results.at(-1).cases.filter((c) => c.category !== 'none' && c.category !== 'stock' && !c.hit);
  for (const c of misses) console.log(`  miss [${c.category}] "${c.question}" -> ${c.retrieved.join(', ') || '(nada)'}`);
}

(async () => {
  const { values } = parseArgs({
    options: { llm: { type: 'boolean', default: false }, k: { type: 'string', default: '5' }, out: { type: 'string' } },
  });
  const url = process.env.EVAL_DATABASE_URL;
  if (!url) throw new Error('EVAL_DATABASE_URL is required (a database ending in _eval or _test; it gets wiped)');

  const config = baseConfig();
  const db = createPool({ ...config.database, url });
  const embedder = createEmbedder(config.embeddings);
  const k = Number(values.k);
  const report = { embeddings: embedder.model, k };
  try {
    await migrate(db);
    await seedCatalog(db, embedder);

    const { minVectorScore } = config.assistant.retrieval;
    report.retrieval = [];
    for (const mode of ['fts', 'vector', 'hybrid']) {
      report.retrieval.push(await evalRetrieval({ db, embedder, mode, k, minVectorScore }));
    }
    console.log(`embeddings: ${embedder.model}`);
    printRetrieval(report.retrieval);

    if (values.llm) {
      const answerer = createAnswerer(config.assistant);
      if (!answerer) throw new Error('--llm needs ANTHROPIC_API_KEY');
      const judge = new ClaudeJudge({ model: process.env.EVAL_JUDGE_MODEL || 'claude-sonnet-5-5' });
      report.answers = await evalAnswers({ db, embedder, answerer, judge, retrieval: { k, minVectorScore } });
      report.answers.models = { generator: config.assistant.model, judge: judge.model };
      const s = report.answers.summary;
      console.log(`\nAnswers (gerador ${config.assistant.model}, juiz ${judge.model}, n=${s.n})`);
      console.log(`  respondidas pelo LLM ${pct(s.llmAnswered)}   grounded ${pct(s.grounded)}   citações corretas ${pct(s.citationsCorrect)}`);
      console.log(`  fiel (juiz) ${pct(s.faithful)}   útil (juiz) ${pct(s.helpful)}   tokens ${s.tokens.input} in / ${s.tokens.output} out`);
      for (const c of report.answers.cases.filter((c) => c.verdict && !(c.verdict.faithful && c.verdict.helpful))) {
        console.log(`  reprovada "${c.question}": ${c.verdict.reason}`);
      }
    }

    if (values.out) {
      fs.writeFileSync(values.out, JSON.stringify(report, null, 2));
      console.log(`\nrelatório: ${values.out}`);
    }
  } finally {
    await db.end();
  }
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
