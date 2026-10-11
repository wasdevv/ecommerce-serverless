'use strict';

const pino = require('pino');
const { currentContext, currentTraceId } = require('./context');

// Campos que nunca podem sair no log, em qualquer profundidade conhecida.
// Redigir na origem é mais confiável do que lembrar de não logar.
const REDACT = [
  'password',
  'passwordHash',
  'password_hash',
  'token',
  'authorization',
  'secret',
  'email',
  '*.password',
  '*.passwordHash',
  '*.password_hash',
  '*.token',
  '*.authorization',
  '*.secret',
  '*.email',
  'req.headers.authorization',
  'req.headers.cookie',
];

function createLogger(options = {}) {
  return pino(
    {
      level: options.level || process.env.LOG_LEVEL || 'info',
      base: { service: options.service || process.env.OTEL_SERVICE_NAME || 'ecommerce-api' },
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: { level: (label) => ({ level: label }) },
      redact: { paths: REDACT, censor: '[REDACTED]' },
      mixin() {
        const { correlationId } = currentContext();
        const traceId = currentTraceId();
        return {
          ...(correlationId && { correlationId }),
          ...(traceId && { traceId }),
        };
      },
    },
    options.destination,
  );
}

const logger = createLogger();

module.exports = { createLogger, logger, REDACT };
