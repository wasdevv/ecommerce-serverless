'use strict';

const { Router } = require('express');
const schemas = require('../schemas');
const { authenticate, requireRole, validate } = require('../middleware');

module.exports = function productRoutes({ authService, productService }) {
  const router = Router();
  const admin = [authenticate(authService), requireRole('admin')];

  router.get('/', validate(schemas.pagination, 'query'), async (req, res) => {
    const { cache, ...page } = await productService.list(req.valid.query);
    res.set('X-Cache', cache).json(page);
  });

  router.get('/:id', validate(schemas.idParam, 'params'), async (req, res) => {
    res.json({ data: await productService.get(req.valid.params.id) });
  });

  router.post('/', ...admin, validate(schemas.productCreate), async (req, res) => {
    res.status(201).json({ data: await productService.create(req.valid.body) });
  });

  router.patch('/:id', ...admin, validate(schemas.idParam, 'params'), validate(schemas.productUpdate), async (req, res) => {
    res.json({ data: await productService.update(req.valid.params.id, req.valid.body) });
  });

  return router;
};
