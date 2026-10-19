'use strict';

const { Router } = require('express');
const schemas = require('../schemas');
const { authenticate, validate } = require('../middleware');

module.exports = function assistantRoutes({ authService, assistantService }) {
  const router = Router();

  // Exige login: cada pergunta pode custar uma chamada de LLM.
  // X-Assistant-Source: llm (resposta gerada e checada), retrieval (só a
  // busca, sem LLM disponível) ou none (nada no catálogo combina).
  router.post('/', authenticate(authService), validate(schemas.assistantAsk), async (req, res) => {
    const { answer, products, source } = await assistantService.ask(req.valid.body.question);
    res.set('X-Assistant-Source', source).json({ data: { answer, products } });
  });

  return router;
};
