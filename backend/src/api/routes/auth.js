'use strict';

const { Router } = require('express');
const schemas = require('../schemas');
const { validate } = require('../middleware');

module.exports = function authRoutes({ authService }) {
  const router = Router();

  router.post('/register', validate(schemas.register), async (req, res) => {
    const user = await authService.register(req.valid.body);
    res.status(201).json({ data: user });
  });

  router.post('/login', validate(schemas.login), async (req, res) => {
    res.json({ data: await authService.login(req.valid.body) });
  });

  return router;
};
