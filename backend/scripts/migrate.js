'use strict';

// Aplica as migrações pendentes no banco de DATABASE_URL (uso local/CI).
// Na AWS o equivalente é invocar a Lambda ops com {"action":"migrate"}.
const { resolveConfig } = require('../src/config');
const { createPool } = require('../src/db/pool');
const { migrate } = require('../src/db/migrate');

(async () => {
  const config = await resolveConfig();
  const pool = createPool(config.database);
  try {
    const applied = await migrate(pool, { log: console.log });
    console.log(applied.length ? `${applied.length} migration(s) applied` : 'schema up to date');
  } finally {
    await pool.end();
  }
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
