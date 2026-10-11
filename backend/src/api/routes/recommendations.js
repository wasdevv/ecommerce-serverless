'use strict';

const { Router } = require('express');
const schemas = require('../schemas');
const { authenticate, validate } = require('../middleware');

module.exports = function recommendationRoutes({ authService, recommendationService }) {
  const router = Router();

  // X-Recommendation-Source diz de onde veio a lista: model, model+popular ou
  // popular (sem histórico, sem modelo configurado ou modelo fora do ar).
  router.get('/', authenticate(authService), validate(schemas.recommendations, 'query'), async (req, res) => {
    const { data, source } = await recommendationService.forUser(req.user.id, req.valid.query);
    res.set('X-Recommendation-Source', source).json({ data });
  });

  return router;
};
