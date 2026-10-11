'use strict';

const Redis = require('ioredis');
const { logger } = require('../observability/logger');

// Cache-aside tolerante a falha: qualquer erro do Redis vira "miss" e a
// requisição segue para o PostgreSQL. O cache acelera, nunca derruba a API.
class Cache {
  constructor(client, { ttlSeconds = 60, log = logger } = {}) {
    this.client = client;
    this.ttlSeconds = ttlSeconds;
    this.log = log;
  }

  async getJson(key) {
    if (!this.client) return null;
    try {
      const raw = await this.client.get(key);
      return raw ? JSON.parse(raw) : null;
    } catch (error) {
      this.log.warn({ err: error.message, op: 'cache.get' }, 'cache unavailable, falling back to database');
      return null;
    }
  }

  async setJson(key, value) {
    if (!this.client) return;
    try {
      await this.client.set(key, JSON.stringify(value), 'EX', this.ttlSeconds);
    } catch (error) {
      this.log.warn({ err: error.message, op: 'cache.set' }, 'cache write skipped');
    }
  }

  async del(...keys) {
    if (!this.client || keys.length === 0) return;
    try {
      await this.client.del(...keys);
    } catch (error) {
      this.log.warn({ err: error.message, op: 'cache.del' }, 'cache invalidation skipped');
    }
  }

  // Versão do namespace: incrementar invalida todas as páginas de uma vez sem
  // precisar de SCAN/KEYS.
  async version(namespace) {
    if (!this.client) return '0';
    try {
      return (await this.client.get(`${namespace}:version`)) || '0';
    } catch {
      return 'unavailable';
    }
  }

  async bump(namespace) {
    if (!this.client) return;
    try {
      await this.client.incr(`${namespace}:version`);
    } catch (error) {
      this.log.warn({ err: error.message, op: 'cache.bump' }, 'cache invalidation skipped');
    }
  }

  async close() {
    if (this.client) await this.client.quit().catch(() => this.client.disconnect());
  }
}

function createCache(redisConfig, options = {}) {
  if (!redisConfig.url) return new Cache(null, options);
  const client = new Redis(redisConfig.url, {
    tls: redisConfig.tls ? {} : undefined,
    // Falhar rápido: sem fila offline e sem retry longo por comando.
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    connectTimeout: 1_000,
    commandTimeout: 500,
    lazyConnect: false,
  });
  client.on('error', (error) => (options.log || logger).debug({ err: error.message }, 'redis error'));
  return new Cache(client, { ttlSeconds: redisConfig.ttlSeconds, ...options });
}

module.exports = { Cache, createCache };
