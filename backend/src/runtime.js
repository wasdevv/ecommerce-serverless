'use strict';

const { resolveConfig } = require('./config');
const { createPool } = require('./db/pool');
const { createCache } = require('./cache/cache');

let runtime;

// Dependências de longa duração (pool, Redis), criadas uma vez por processo.
// Na Lambda isso significa uma vez por cold start, reaproveitadas entre
// invocações do mesmo ambiente de execução.
async function getRuntime() {
  if (runtime) return runtime;
  const config = await resolveConfig();
  runtime = {
    config,
    db: createPool(config.database),
    cache: createCache(config.redis),
  };
  return runtime;
}

module.exports = { getRuntime };
