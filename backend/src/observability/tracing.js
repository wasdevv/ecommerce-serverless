'use strict';

// OpenTelemetry para execução local (node src/server.js / docker compose).
// Exporta OTLP/HTTP para o collector sidecar, que repassa para console/X-Ray.
//
// Na Lambda este arquivo NÃO é carregado: lá a instrumentação vem da layer
// ADOT (AWS_LAMBDA_EXEC_WRAPPER=/opt/otel-handler) ou do X-Ray ativo — ver
// docs/decisions.md. Os pacotes @opentelemetry/* são optionalDependencies e o
// build da Lambda os omite.

function startTracing() {
  if (!process.env.OTEL_EXPORTER_OTLP_ENDPOINT) return null;

  const { NodeSDK } = require('@opentelemetry/sdk-node');
  const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');
  const { AWSXRayIdGenerator } = require('@opentelemetry/id-generator-aws-xray');
  const { AWSXRayPropagator } = require('@opentelemetry/propagator-aws-xray');
  const { HttpInstrumentation } = require('@opentelemetry/instrumentation-http');
  const { ExpressInstrumentation } = require('@opentelemetry/instrumentation-express');
  const { PgInstrumentation } = require('@opentelemetry/instrumentation-pg');
  const { IORedisInstrumentation } = require('@opentelemetry/instrumentation-ioredis');
  const { AwsInstrumentation } = require('@opentelemetry/instrumentation-aws-sdk');

  const sdk = new NodeSDK({
    serviceName: process.env.OTEL_SERVICE_NAME || 'ecommerce-api',
    traceExporter: new OTLPTraceExporter(),
    // IDs no formato do X-Ray, para que o collector exporte sem conversão.
    idGenerator: new AWSXRayIdGenerator(),
    textMapPropagator: new AWSXRayPropagator(),
    instrumentations: [
      new HttpInstrumentation(),
      new ExpressInstrumentation(),
      new PgInstrumentation(),
      new IORedisInstrumentation(),
      new AwsInstrumentation(),
    ],
  });
  sdk.start();
  return sdk;
}

module.exports = { startTracing };
