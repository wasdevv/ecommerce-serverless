'use strict';

const express = require('express');
const { logger: defaultLogger } = require('./observability/logger');
const { correlation, errorHandler, notFoundHandler, requestLog } = require('./api/middleware');
const { AuthService } = require('./services/auth');
const { ProductService } = require('./services/products');
const { OrderService } = require('./services/orders');
const { UploadService } = require('./services/uploads');

// Monta o app a partir das dependências já construídas. Não abre porta: o
// server.js (local) e o handlers/api.js (Lambda) decidem como servir.
function createApp({ config, db, cache, s3, log = defaultLogger }) {
  const authService = new AuthService({ db, jwtConfig: config.jwt });
  const deps = {
    authService,
    productService: new ProductService({ db, cache }),
    orderService: new OrderService({ db }),
    uploadService: new UploadService({ uploadsConfig: config.uploads, s3 }),
    uploadsConfig: config.uploads,
  };

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', true);
  app.use(correlation());
  app.use(requestLog(log));
  app.use(express.json({ limit: '32kb' }));

  const api = express.Router();
  // Guarda o prefixo montado para o log de requisição: o Express restaura
  // req.baseUrl ao sair do router, e o log só roda no 'finish'.
  const mount = (req, _res, next) => {
    req.routeBase = req.baseUrl;
    next();
  };
  api.use(mount);
  // Saúde do processo apenas — sem consultar banco nem expor versão/config.
  api.get('/health', (_req, res) => res.json({ status: 'ok' }));
  api.use('/auth', mount, require('./api/routes/auth')(deps));
  api.use('/products', mount, require('./api/routes/products')(deps));
  api.use('/orders', mount, require('./api/routes/orders')(deps));
  api.use('/uploads', mount, require('./api/routes/uploads')(deps));

  app.use('/api/v1', api);
  app.use(notFoundHandler);
  app.use(errorHandler(log));
  return app;
}

module.exports = { createApp };
