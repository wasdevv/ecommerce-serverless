-- Base de recuperação do assistente (RAG). Duas formas de achar um produto
-- pela pergunta do cliente, combinadas em src/assistant/retriever.js:
--   1. busca textual do próprio PostgreSQL (lexical, sempre em dia);
--   2. similaridade de embeddings (semântica, depende de indexação).

-- Coluna gerada: o índice textual acompanha qualquer INSERT/UPDATE do
-- produto, sem job nem gatilho. Nome pesa mais que descrição.
ALTER TABLE products ADD COLUMN search tsvector GENERATED ALWAYS AS (
  setweight(to_tsvector('portuguese', name), 'A') ||
  setweight(to_tsvector('portuguese', description), 'B')
) STORED;
CREATE INDEX products_search_idx ON products USING gin (search);

-- Um embedding por produto e modelo de embedding. content_hash é o md5 do
-- texto indexado: produto editado depois da indexação deixa de casar e sai
-- da busca vetorial (continua na textual) até ser reindexado.
-- Vetores gravados já normalizados (norma 1): cosseno = produto escalar.
-- real[] em vez de pgvector para rodar em qualquer PostgreSQL; com milhares
-- de produtos, o caminho é a extensão vector com índice HNSW (ver decisions.md).
CREATE TABLE product_embeddings (
  product_id uuid NOT NULL REFERENCES products (id) ON DELETE CASCADE,
  model text NOT NULL,
  content_hash text NOT NULL,
  embedding real[] NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (product_id, model)
);

CREATE FUNCTION dot_product(a real[], b real[]) RETURNS double precision
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  AS $$ SELECT sum(x * y) FROM unnest(a, b) AS t (x, y) $$;
