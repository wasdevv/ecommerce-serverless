'use strict';

const { AsyncLocalStorage } = require('node:async_hooks');
const crypto = require('node:crypto');

// Contexto por requisição/mensagem: o logger lê daqui, então nenhuma função de
// serviço precisa receber o correlation ID por parâmetro.
const storage = new AsyncLocalStorage();

const CORRELATION_ID = /^[A-Za-z0-9._-]{8,128}$/;

function newCorrelationId() {
  return crypto.randomUUID();
}

// Aceita o ID do cliente só se tiver formato seguro — evita log injection e
// headers gigantes.
function sanitizeCorrelationId(value) {
  return typeof value === 'string' && CORRELATION_ID.test(value) ? value : newCorrelationId();
}

function runWithContext(context, fn) {
  return storage.run({ ...context }, fn);
}

function currentContext() {
  return storage.getStore() || {};
}

// Trace ID: span ativo do OpenTelemetry (local/ADOT) ou o header que o runtime
// da Lambda injeta quando o X-Ray está ativo.
function currentTraceId() {
  try {
    const api = require('@opentelemetry/api');
    const span = api.trace.getActiveSpan();
    const traceId = span && span.spanContext().traceId;
    if (traceId && traceId !== '00000000000000000000000000000000') return traceId;
  } catch {
    // @opentelemetry/api é opcional (o zip da Lambda não o inclui).
  }
  const amzn = process.env._X_AMZN_TRACE_ID;
  const match = amzn && /Root=([^;]+)/.exec(amzn);
  return match ? match[1] : undefined;
}

module.exports = {
  currentContext,
  currentTraceId,
  newCorrelationId,
  runWithContext,
  sanitizeCorrelationId,
};
