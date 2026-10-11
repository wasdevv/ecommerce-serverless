'use strict';

// Cria (ou promove) um administrador local. A senha vem de ADMIN_PASSWORD e
// nunca tem valor padrão: sem ela o script recusa rodar.
//   ADMIN_EMAIL=admin@example.test ADMIN_PASSWORD='...' npm run bootstrap-admin
const { resolveConfig } = require('../src/config');
const { createPool } = require('../src/db/pool');
const { upsertAdmin } = require('../src/services/auth');

(async () => {
  const { ADMIN_EMAIL: email, ADMIN_PASSWORD: password } = process.env;
  if (!email || !password || password.length < 12) {
    throw new Error('set ADMIN_EMAIL and ADMIN_PASSWORD (12+ chars)');
  }
  const config = await resolveConfig();
  const pool = createPool(config.database);
  try {
    const admin = await upsertAdmin(pool, { email, password });
    console.log(`admin ready: ${admin.id}`);
  } finally {
    await pool.end();
  }
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
