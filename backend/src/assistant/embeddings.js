'use strict';

const { BedrockRuntimeClient, InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');

// Dois embedders com a mesma interface: embed(texts) -> vetores de norma 1.
//   bedrock -> Amazon Titan Text Embeddings v2 (semântico; AWS)
//   hashing -> feature hashing de palavras e 4-gramas (lexical; local e CI)
// O hashing não entende sinônimo nenhum: existe para o caminho vetorial rodar
// sem conta AWS e sem custo. O eval (evals/run.js) mostra a diferença.
// `model` identifica o espaço vetorial: vetores de modelos diferentes nunca
// são comparados (product_embeddings tem um registro por modelo).

const DIMENSIONS = 512;

function normalize(vector) {
  const norm = Math.sqrt(vector.reduce((s, x) => s + x * x, 0));
  return norm === 0 ? vector : vector.map((x) => x / norm);
}

// Palavras que aparecem em qualquer pergunta e só aproximariam textos sem
// relação ("algo PARA o inverno" ~ "pato PARA debugar").
const STOPWORDS = new Set(
  'de da do das dos para pra com sem em no na nos nas um uma uns umas os as ou que por pelo pela se meu minha tem ter voces quero algo ate mais'.split(' '),
);

// Minúsculas, sem acento, só letras e números: "Café" e "cafe" viram a mesma palavra.
function tokens(text) {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

function fnv1a(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

class HashingEmbedder {
  constructor({ dimensions = DIMENSIONS } = {}) {
    this.dimensions = dimensions;
    this.model = `hashing-v1-${dimensions}`;
  }

  embedOne(text) {
    const vector = new Array(this.dimensions).fill(0);
    const add = (feature, weight) => {
      const h = fnv1a(feature);
      // Um bit do hash decide o sinal: colisões tendem a se cancelar.
      vector[h % this.dimensions] += h & 0x80000000 ? -weight : weight;
    };
    for (const word of tokens(text)) {
      add(`w:${word}`, 1);
      // 4-gramas aproximam variações da mesma palavra (camiseta/camisetas).
      const padded = `_${word}_`;
      for (let i = 0; i + 4 <= padded.length; i++) add(`g:${padded.slice(i, i + 4)}`, 0.5);
    }
    return normalize(vector);
  }

  async embed(texts) {
    return texts.map((t) => this.embedOne(t));
  }
}

class BedrockEmbedder {
  constructor({ modelId, dimensions = DIMENSIONS, client = new BedrockRuntimeClient({}) }) {
    this.modelId = modelId;
    this.dimensions = dimensions;
    this.client = client;
    this.model = `${modelId}:${dimensions}`;
  }

  // Titan v2 aceita um texto por chamada.
  async embed(texts) {
    const out = [];
    for (const inputText of texts) {
      const res = await this.client.send(
        new InvokeModelCommand({
          modelId: this.modelId,
          contentType: 'application/json',
          accept: 'application/json',
          body: JSON.stringify({ inputText, dimensions: this.dimensions, normalize: true }),
        }),
      );
      const body = JSON.parse(new TextDecoder().decode(res.body));
      if (!Array.isArray(body?.embedding) || body.embedding.length !== this.dimensions) {
        throw new Error('embedding model returned an unexpected body');
      }
      out.push(body.embedding);
    }
    return out;
  }
}

function createEmbedder({ provider, modelId }) {
  if (provider === 'bedrock') return new BedrockEmbedder({ modelId });
  if (provider === 'hashing') return new HashingEmbedder();
  throw new Error(`unknown EMBEDDINGS_PROVIDER "${provider}"; expected bedrock or hashing`);
}

module.exports = { createEmbedder, HashingEmbedder, BedrockEmbedder, tokens };
