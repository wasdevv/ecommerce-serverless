'use strict';

// Gera os embeddings do catálogo para a busca do assistente. Incremental:
// rodar de novo só processa produto novo ou editado. Na AWS o equivalente é
// a Lambda ops com {"action":"index-products"}.
//
//   npm run index:products
const { resolveConfig } = require('../src/config');
const { createPool } = require('../src/db/pool');
const { createEmbedder } = require('../src/assistant/embeddings');
const { indexProducts } = require('../src/assistant/retriever');

(async () => {
  const config = await resolveConfig();
  const pool = createPool(config.database);
  try {
    const { indexed, model } = await indexProducts(pool, createEmbedder(config.embeddings));
    console.log(`${indexed} products indexed with ${model}`);
  } finally {
    await pool.end();
  }
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
