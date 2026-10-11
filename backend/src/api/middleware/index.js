'use strict';

const { AppError, badRequest, forbidden, unauthorized } = require('../../errors');
const { currentContext, runWithContext, sanitizeCorrelationId } = require('../../observability/context');

// Abre o contexto da requisição (correlation ID) e devolve o ID no header,
// para que o cliente possa citá-lo num chamado e achar o log correspondente.
function correlation() {
  return (req, res, next) => {
    const correlationId = sanitizeCorrelationId(req.get('x-correlation-id'));
    res.set('X-Correlation-Id', correlationId);
    runWithContext({ correlationId }, next);
  };
}

// Uma linha de log por requisição: rota (template, não a URL com IDs), status
// e duração. Nada de corpo, query string ou headers — é onde mora dado pessoal.
function requestLog(log) {
  return (req, res, next) => {
    const started = process.hrtime.bigint();
    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
      const route = req.route ? `${req.routeBase || ''}${req.route.path}` : 'unmatched';
      const entry = { method: req.method, route, status: res.statusCode, durationMs: Math.round(durationMs * 10) / 10 };
      if (res.statusCode >= 500) log.error(entry, 'request failed');
      else log.info(entry, 'request completed');
    });
    next();
  };
}

function validate(schema, source = 'body') {
  return (req, _res, next) => {
    const { error, value } = schema.validate(req[source], { abortEarly: false, stripUnknown: false });
    if (error) {
      throw badRequest(
        'Request validation failed',
        error.details.map((d) => ({ field: d.path.join('.'), message: d.message })),
      );
    }
    req.valid = { ...req.valid, [source]: value };
    next();
  };
}

function authenticate(authService) {
  return (req, _res, next) => {
    const header = req.get('authorization') || '';
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token) throw unauthorized();
    req.user = authService.verify(token);
    next();
  };
}

function requireRole(role) {
  return (req, _res, next) => {
    if (!req.user || req.user.role !== role) throw forbidden();
    next();
  };
}

function notFoundHandler(_req, _res, next) {
  next(new AppError(404, 'not_found', 'Route not found'));
}

// Formato único de erro. 5xx nunca leva mensagem interna nem stack: só o
// correlation ID, que liga a resposta à linha de log com o detalhe.
function errorHandler(log) {
  return (err, req, res, _next) => {
    const { correlationId } = currentContext();
    let error = err;
    if (err.type === 'entity.parse.failed') error = badRequest('Malformed JSON body');
    else if (err.type === 'entity.too.large') error = new AppError(413, 'payload_too_large', 'Request body too large');

    if (!(error instanceof AppError)) {
      log.error({ err: { message: err.message, stack: err.stack, code: err.code } }, 'unhandled error');
      return res.status(500).json({ error: { code: 'internal_error', message: 'Internal server error', correlationId } });
    }
    const body = { code: error.code, message: error.message, correlationId };
    if (error.details) body.details = error.details;
    return res.status(error.status).json({ error: body });
  };
}

module.exports = {
  authenticate,
  correlation,
  errorHandler,
  notFoundHandler,
  requestLog,
  requireRole,
  validate,
};
