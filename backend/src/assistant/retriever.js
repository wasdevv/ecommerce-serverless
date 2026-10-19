'use strict';

const { BaseRetriever } = require('@langchain/core/retrievers');
const { Document } = require('@langchain/core/documents');

// Texto que vira embedding e o hash que prova que o embedding está em dia.
// O md5 é calculado no SQL nos dois lados (indexação e busca) para nunca
// divergir de como o PostgreSQL concatena os campos.
const CONTENT_HASH = `md5(p.name || E'\\n' || p.description)`;
// Constante usual do Reciprocal Rank Fusion: amortece a diferença entre o 1º
// e o 2º lugar de cada lista, então concordância entre as buscas pesa mais.
const RRF_K = 60;

// Embeddings dos produtos novos ou editados desde a última indexação. Grava o
// hash lido no SELECT: se o produto mudar no meio, o registro nasce velho e
// a próxima execução refaz — nunca fica um vetor novo com hash antigo.
async function indexProducts(db, embedder, { batchSize = 32 } = {}) {
  const { rows } = await db.query(
    `SELECT p.id, p.name || E'\\n' || p.description AS content, ${CONTENT_HASH} AS hash
       FROM products p
       LEFT JOIN product_embeddings e ON e.product_id = p.id AND e.model = $1
      WHERE e.content_hash IS DISTINCT FROM ${CONTENT_HASH}
      ORDER BY p.id`,
    [embedder.model],
  );
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const vectors = await embedder.embed(batch.map((r) => r.content));
    for (const [j, row] of batch.entries()) {
      await db.query(
        `INSERT INTO product_embeddings (product_id, model, content_hash, embedding)
         VALUES ($1, $2, $3, $4::real[])
         ON CONFLICT (product_id, model)
         DO UPDATE SET content_hash = EXCLUDED.content_hash, embedding = EXCLUDED.embedding, updated_at = now()`,
        [row.id, embedder.model, row.hash, vectors[j]],
      );
    }
  }
  return { indexed: rows.length, model: embedder.model };
}

// Recuperação híbrida sobre o catálogo, como um Retriever do LangChain
// (retriever.invoke(pergunta) -> Document[]):
//   fts    -> busca textual do PostgreSQL; acha a palavra exata, ignora sinônimo
//   vector -> similaridade de embeddings; acha "caneca" por "xícara" (com Titan)
//   hybrid -> as duas listas fundidas por posição (RRF), sem calibrar escalas
// Só produto com estoque entra: o assistente não oferece o que não pode vender.
class CatalogRetriever extends BaseRetriever {
  lc_namespace = ['ecommerce', 'assistant', 'retrievers'];

  constructor({ db, embedder, k = 5, mode = 'hybrid', minVectorScore = 0.2, candidates = 20 }) {
    super({});
    this.db = db;
    this.embedder = embedder;
    this.k = k;
    this.mode = mode;
    this.minVectorScore = minVectorScore;
    this.candidates = candidates;
  }

  async _getRelevantDocuments(query) {
    const lists = [];
    if (this.mode !== 'vector') lists.push(['fts', await this.lexical(query)]);
    if (this.mode !== 'fts') lists.push(['vector', await this.semantic(query)]);

    const fused = new Map();
    for (const [name, ids] of lists) {
      ids.forEach((id, rank) => {
        const entry = fused.get(id) ?? { score: 0, matchedBy: [] };
        entry.score += 1 / (RRF_K + rank + 1);
        entry.matchedBy.push(name);
        fused.set(id, entry);
      });
    }
    const top = [...fused.entries()]
      .sort((a, b) => b[1].score - a[1].score || a[0].localeCompare(b[0]))
      .slice(0, this.k);
    if (top.length === 0) return [];

    const { rows } = await this.db.query(
      'SELECT id, sku, name, description, price_cents, stock FROM products WHERE id = ANY($1::uuid[])',
      [top.map(([id]) => id)],
    );
    const byId = new Map(rows.map((r) => [r.id, r]));
    return top
      .filter(([id]) => byId.has(id))
      .map(([id, { score, matchedBy }]) => {
        const p = byId.get(id);
        return new Document({
          pageContent: `${p.name}\n${p.description}`,
          metadata: { id, sku: p.sku, name: p.name, priceCents: p.price_cents, stock: p.stock, score, matchedBy },
        });
      });
  }

  // Termos da pergunta ligados por OU: "caneca para café" não pode exigir as
  // três palavras na descrição, como faria o E do plainto_tsquery.
  async lexical(query) {
    const { rows } = await this.db.query(
      `WITH t AS (SELECT replace(plainto_tsquery('portuguese', $1)::text, ' & ', ' | ')::tsquery AS q)
       SELECT p.id
         FROM products p, t
        WHERE p.stock > 0 AND p.search @@ t.q
        ORDER BY ts_rank_cd(p.search, t.q) DESC, p.id
        LIMIT $2`,
      [query, this.candidates],
    );
    return rows.map((r) => r.id);
  }

  async semantic(query) {
    const [vector] = await this.embedder.embed([query]);
    const { rows } = await this.db.query(
      `SELECT p.id, dot_product(e.embedding, $1::real[]) AS score
         FROM product_embeddings e JOIN products p ON p.id = e.product_id
        WHERE e.model = $2 AND p.stock > 0 AND e.content_hash = ${CONTENT_HASH}
        ORDER BY score DESC, p.id
        LIMIT $3`,
      [vector, this.embedder.model, this.candidates],
    );
    return rows.filter((r) => r.score >= this.minVectorScore).map((r) => r.id);
  }
}

module.exports = { CatalogRetriever, indexProducts };
