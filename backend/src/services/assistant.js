'use strict';

const { CatalogRetriever } = require('../assistant/retriever');
const { buildAssistantGraph } = require('../assistant/graph');

// Assistente de compras: pergunta em linguagem natural -> produtos do catálogo
// + resposta. RAG (retriever.js) + geração com Claude (llm.js), orquestrados
// pelo grafo LangGraph (graph.js).
class AssistantService {
  constructor({ db, embedder, answerer, retrieval = {}, log }) {
    this.retriever = new CatalogRetriever({ db, embedder, ...retrieval });
    this.graph = buildAssistantGraph({ retriever: this.retriever, answerer, log });
  }

  async ask(question) {
    const { answer, products, source } = await this.graph.invoke({ question });
    return { answer, products, source };
  }
}

module.exports = { AssistantService };
