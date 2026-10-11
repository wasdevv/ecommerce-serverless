'use strict';

// Exporta o histórico de compras (anonimizado) para o treino do recomendador.
// Na AWS o equivalente é a Lambda ops com {"action":"export-training-data"},
// que grava no bucket de ML.
//
//   npm run export:training-data -- ../ml/data/order_items.csv
//   npm run -s export:training-data -- -     (CSV no stdout, para encadear no treino)
const fs = require('node:fs');
const path = require('node:path');
const { resolveConfig } = require('../src/config');
const { createPool } = require('../src/db/pool');
const { exportTrainingData } = require('../src/services/recommendations');

(async () => {
  const out = process.argv[2];
  if (!out) throw new Error('usage: export-training-data <output.csv>');
  const config = await resolveConfig();
  const pool = createPool(config.database);
  try {
    const { csv, rows } = await exportTrainingData(pool);
    if (out === '-') {
      process.stdout.write(csv);
    } else {
      fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
      fs.writeFileSync(out, csv);
    }
    console.error(`${rows} rows -> ${out === '-' ? 'stdout' : out}`);
  } finally {
    await pool.end();
  }
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
