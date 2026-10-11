'use strict';

// Catálogo fictício para desenvolvimento local. Idempotente: rodar de novo
// só reabastece o estoque dos mesmos SKUs.
const { resolveConfig } = require('../src/config');
const { createPool } = require('../src/db/pool');

const PRODUCTS = [
  ['TSHIRT-001', 'Camiseta Lambda', 'Algodão, estampa de função anônima', 7990, 50],
  ['MUG-001', 'Caneca Terraform', 'Cerâmica 350 ml, plan antes do café', 4990, 30],
  ['STICKER-001', 'Adesivo X-Ray', 'Vinil fosco 6 cm', 990, 500],
  ['HOODIE-001', 'Moletom Cold Start', 'Para os primeiros 300 ms', 18990, 10],
  ['BOOK-001', 'Livro: Outbox na prática', 'Edição de bolso, 120 páginas', 5990, 1],
];

(async () => {
  const config = await resolveConfig();
  const pool = createPool(config.database);
  try {
    for (const [sku, name, description, price, stock] of PRODUCTS) {
      await pool.query(
        `INSERT INTO products (sku, name, description, price_cents, stock) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (sku) DO UPDATE SET stock = EXCLUDED.stock, updated_at = now()`,
        [sku, name, description, price, stock],
      );
    }
    console.log(`${PRODUCTS.length} products seeded`);
  } finally {
    await pool.end();
  }
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
