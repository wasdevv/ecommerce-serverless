'use strict';

// Precisa vir antes de qualquer require de http/express/pg/ioredis para que a
// instrumentação consiga envolver os módulos.
require('./observability/tracing').startTracing();

const { createApp } = require('./app');
const { getRuntime } = require('./runtime');
const { logger } = require('./observability/logger');

async function main() {
  const runtime = await getRuntime();
  const app = createApp(runtime);
  const server = app.listen(runtime.config.port, () => {
    logger.info({ port: runtime.config.port }, 'api listening');
  });

  const shutdown = () => {
    server.close(async () => {
      await runtime.db.end();
      await runtime.cache.close();
      process.exit(0);
    });
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((error) => {
  logger.fatal({ err: { message: error.message } }, 'failed to start');
  process.exit(1);
});
