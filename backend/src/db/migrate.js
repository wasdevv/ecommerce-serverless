'use strict';

const fs = require('node:fs');
const path = require('node:path');

const MIGRATIONS_DIR = path.join(__dirname, '..', '..', 'migrations');
// Número arbitrário e fixo: duas execuções simultâneas (dois deploys, ou local
// + CI) serializam no advisory lock em vez de aplicar a mesma migração duas vezes.
const LOCK_ID = 727274;

// Runner mínimo: aplica cada migrations/NNN_nome.sql uma vez, em ordem, dentro
// de transação própria. Só avança — rollback de schema é uma migração nova.
async function migrate(pool, { dir = MIGRATIONS_DIR, log = () => {} } = {}) {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_ID]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`);
    const { rows } = await client.query('SELECT name FROM schema_migrations');
    const applied = new Set(rows.map((r) => r.name));
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
    const ran = [];

    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = fs.readFileSync(path.join(dir, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(`migration ${file} failed: ${error.message}`, { cause: error });
      }
      log(`applied ${file}`);
      ran.push(file);
    }
    return ran;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]).catch(() => {});
    client.release();
  }
}

module.exports = { migrate, MIGRATIONS_DIR };
