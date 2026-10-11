'use strict';

const { Router } = require('express');
const schemas = require('../schemas');
const { authenticate, validate } = require('../middleware');

module.exports = function uploadRoutes({ authService, uploadService, uploadsConfig }) {
  const router = Router();

  router.post(
    '/presign',
    authenticate(authService),
    validate(schemas.uploadPresign(uploadsConfig.maxBytes)),
    async (req, res) => {
      res.status(201).json({ data: await uploadService.presign(req.user.id, req.valid.body) });
    },
  );

  return router;
};
