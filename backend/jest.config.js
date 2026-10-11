'use strict';

// Limiar de 80% nas quatro métricas sobre todo código de runtime (src/),
// incluindo handlers. server.js e tracing.js ficam de fora: são boot de
// processo, exercitados pelo smoke do docker compose no CI, não por Jest.
module.exports = {
  testEnvironment: 'node',
  testTimeout: 20_000,
  setupFiles: ['<rootDir>/tests/setup-env.js'],
  collectCoverageFrom: ['src/**/*.js', '!src/server.js', '!src/observability/tracing.js'],
  coverageThreshold: {
    global: { lines: 80, branches: 80, functions: 80, statements: 80 },
  },
  coverageReporters: ['text-summary', 'text', 'lcov'],
};
