'use strict';

const { Anthropic } = require('@anthropic-ai/sdk');
const { renderPrompt } = require('../src/assistant/llm');

// Juiz LLM (LLM-as-a-judge): lê a pergunta, os produtos que o assistente
// recebeu e a resposta, e dá duas notas binárias. Binário em vez de escala
// 1-5 porque "passou/não passou" é mais estável entre execuções e mais fácil
// de conferir à mão. É um modelo diferente do gerador, para o juiz não
// avaliar com os mesmos vieses de quem escreveu.

const SYSTEM = `Você avalia respostas de um assistente de compras. Ele só pode usar os produtos dentro de <produtos>.

Dê duas notas, cada uma true ou false:
- faithful: toda afirmação sobre produtos é sustentada pelo texto de <produtos>. Produto, característica, preço ou prazo que não está lá = false. Dizer com franqueza que nada serve é fiel.
- helpful: a resposta trata da pergunta. Se algum produto listado atende, ela o indica; se nenhum atende, ela diz isso em vez de empurrar um produto que não serve.

Em reason, uma frase justificando as notas, citando o trecho problemático quando houver.`;

const SCHEMA = {
  type: 'object',
  properties: {
    faithful: { type: 'boolean' },
    helpful: { type: 'boolean' },
    reason: { type: 'string' },
  },
  required: ['faithful', 'helpful', 'reason'],
  additionalProperties: false,
};

class ClaudeJudge {
  constructor({ model, client = new Anthropic() }) {
    this.model = model;
    this.client = client;
  }

  async grade({ question, documents, answer }) {
    const res = await this.client.messages.create({
      model: this.model,
      max_tokens: 4096,
      system: SYSTEM,
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
      messages: [
        { role: 'user', content: `${renderPrompt(question, documents)}\n\n<resposta>\n${answer}\n</resposta>` },
      ],
    });
    if (res.stop_reason !== 'end_turn') throw new Error(`judge stopped with ${res.stop_reason}`);
    const verdict = JSON.parse(res.content.find((b) => b.type === 'text').text);
    return { ...verdict, usage: res.usage };
  }
}

module.exports = { ClaudeJudge };
