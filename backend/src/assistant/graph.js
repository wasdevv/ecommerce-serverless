'use strict';

const { Annotation, END, START, StateGraph } = require('@langchain/langgraph');
const { logger } = require('../observability/logger');

// Fluxo do assistente como grafo LangGraph. Cada nó lê o estado e devolve só
// o que mudou; as arestas condicionais decidem o próximo passo:
//
//   START -> retrieve -+-> empty ----------------------> END   (nada recuperado: sem chamar o LLM)
//                      +-> extractive -----------------> END   (sem LLM configurado)
//                      +-> generate -+-> ground -------> END   (resposta do LLM checada)
//                                    +-> extractive ---> END   (LLM falhou, recusou ou estourou o timeout)
//
// O LLM é dependência opcional, como o recomendador: falhar nele degrada a
// resposta, nunca vira erro para o cliente.

const State = Annotation.Root({
  question: Annotation(),
  documents: Annotation(),
  draft: Annotation(),
  answer: Annotation(),
  products: Annotation(),
  source: Annotation(),
  droppedIds: Annotation(),
});

const toProduct = (d) => ({
  id: d.metadata.id,
  sku: d.metadata.sku,
  name: d.metadata.name,
  priceCents: d.metadata.priceCents,
  stock: d.metadata.stock,
});

function listNames(names) {
  return names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} e ${names.at(-1)}`;
}

function buildAssistantGraph({ retriever, answerer, log = logger }) {
  const retrieve = async ({ question }) => ({ documents: await retriever.invoke(question) });

  const generate = async ({ question, documents }) => {
    try {
      return { draft: await answerer.answer({ question, documents }) };
    } catch (error) {
      log.warn({ err: error }, 'assistant llm unavailable, answering from retrieval');
      return { draft: null };
    }
  };

  // Guarda de grounding: o LLM só pode citar produto que a recuperação trouxe.
  // Id inventado ou de fora da lista é descartado e contado (o eval mede isso).
  const ground = ({ documents, draft }) => {
    const byId = new Map(documents.map((d) => [d.metadata.id, d]));
    const cited = [...new Set(draft.productIds)];
    const droppedIds = cited.filter((id) => !byId.has(id));
    if (droppedIds.length > 0) log.warn({ droppedIds }, 'assistant llm cited products outside the retrieved set');
    return {
      answer: draft.answer,
      products: cited.filter((id) => byId.has(id)).map((id) => toProduct(byId.get(id))),
      source: 'llm',
      droppedIds,
    };
  };

  const extractive = ({ documents }) => ({
    answer: `Encontrei estes produtos relacionados à sua pergunta: ${listNames(documents.map((d) => d.metadata.name))}.`,
    products: documents.map(toProduct),
    source: 'retrieval',
    droppedIds: [],
  });

  const empty = () => ({
    answer: 'Não encontrei nenhum produto em estoque que combine com a sua pergunta.',
    products: [],
    source: 'none',
    droppedIds: [],
  });

  return new StateGraph(State)
    .addNode('retrieve', retrieve)
    .addNode('generate', generate)
    .addNode('ground', ground)
    .addNode('extractive', extractive)
    .addNode('empty', empty)
    .addEdge(START, 'retrieve')
    .addConditionalEdges(
      'retrieve',
      ({ documents }) => {
        if (documents.length === 0) return 'empty';
        return answerer ? 'generate' : 'extractive';
      },
      ['empty', 'generate', 'extractive'],
    )
    .addConditionalEdges('generate', ({ draft }) => (draft ? 'ground' : 'extractive'), ['ground', 'extractive'])
    .addEdge('ground', END)
    .addEdge('extractive', END)
    .addEdge('empty', END)
    .compile();
}

module.exports = { buildAssistantGraph };
