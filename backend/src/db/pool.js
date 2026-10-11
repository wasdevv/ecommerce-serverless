'use strict';

const { Pool } = require('pg');

// Na Lambda cada ambiente de execução atende uma requisição por vez, então o
// pool é pequeno (DB_POOL_MAX=2) e o RDS Proxy multiplexa as conexões.
function createPool(dbConfig) {
  const options = dbConfig.url
    ? { connectionString: dbConfig.url }
    : {
        host: dbConfig.host,
        port: dbConfig.port,
        database: dbConfig.name,
        user: dbConfig.user,
        password: dbConfig.password,
      };
  return new Pool({
    ...options,
    max: dbConfig.poolMax,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    // RDS Proxy usa certificado de CA pública da Amazon (ACM), que já está na
    // trust store do Node — verificação completa, sem rejectUnauthorized:false.
    ssl: dbConfig.ssl ? { rejectUnauthorized: true } : undefined,
  });
}

async function withTransaction(pool, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { createPool, withTransaction };
