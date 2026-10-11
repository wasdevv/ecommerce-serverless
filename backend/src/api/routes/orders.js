'use strict';

const { Router } = require('express');
const schemas = require('../schemas');
const { badRequest } = require('../../errors');
const { authenticate, validate } = require('../middleware');

module.exports = function orderRoutes({ authService, orderService }) {
  const router = Router();
  router.use(authenticate(authService));

  router.post('/', validate(schemas.orderCreate), async (req, res) => {
    const { error, value: idempotencyKey } = schemas.idempotencyKey.validate(req.get('idempotency-key'));
    if (error) throw badRequest('Idempotency-Key header is required (8-128 chars: letters, digits, . _ : -)');

    const { order, replayed } = await orderService.create(req.user.id, { ...req.valid.body, idempotencyKey });
    res
      .status(replayed ? 200 : 201)
      .set('Idempotent-Replayed', String(replayed))
      .json({ data: order });
  });

  router.get('/', validate(schemas.pagination, 'query'), async (req, res) => {
    res.json(await orderService.list(req.user.id, req.valid.query));
  });

  router.get('/:id', validate(schemas.idParam, 'params'), async (req, res) => {
    res.json({ data: await orderService.get(req.user.id, req.valid.params.id) });
  });

  return router;
};
