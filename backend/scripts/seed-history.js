'use strict';

// Histórico de compras fictício para o recomendador ter o que aprender
// localmente. Rode depois do seed. Clientes demo-*@example.invalid com senha
// aleatória descartada (ninguém faz login com eles) e três "gostos":
//   camiseta + moletom (+ adesivo às vezes) / caneca + livro / camiseta + adesivo
// Grava só histórico: não debita estoque nem gera evento na outbox.
// Idempotente: cliente demo que já tem pedido é pulado.
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const { resolveConfig } = require('../src/config');
const { createPool, withTransaction } = require('../src/db/pool');

const BASKETS = [
  ...Array(6).fill(['TSHIRT-001', 'HOODIE-001']),
  ...Array(3).fill(['TSHIRT-001', 'HOODIE-001', 'STICKER-001']),
  ...Array(5).fill(['MUG-001', 'BOOK-001']),
  ...Array(4).fill(['TSHIRT-001', 'STICKER-001']),
];

(async () => {
  const config = await resolveConfig();
  const pool = createPool(config.database);
  try {
    const { rows: products } = await pool.query('SELECT id, sku, price_cents FROM products');
    const bySku = new Map(products.map((p) => [p.sku, p]));
    const missing = [...new Set(BASKETS.flat())].filter((sku) => !bySku.has(sku));
    if (missing.length) throw new Error(`run "npm run seed" first (missing ${missing.join(', ')})`);

    const passwordHash = await bcrypt.hash(crypto.randomUUID(), 10);
    let created = 0;
    for (const [i, basket] of BASKETS.entries()) {
      await withTransaction(pool, async (tx) => {
        const { rows } = await tx.query(
          `INSERT INTO users (email, password_hash) VALUES ($1, $2)
           ON CONFLICT ((lower(email))) DO UPDATE SET email = EXCLUDED.email RETURNING id`,
          [`demo-${i + 1}@example.invalid`, passwordHash],
        );
        const userId = rows[0].id;
        const existing = await tx.query('SELECT 1 FROM orders WHERE user_id = $1 LIMIT 1', [userId]);
        if (existing.rowCount > 0) return;

        const items = basket.map((sku) => bySku.get(sku));
        const total = items.reduce((sum, p) => sum + p.price_cents, 0);
        const order = await tx.query('INSERT INTO orders (user_id, total_cents) VALUES ($1, $2) RETURNING id', [
          userId,
          total,
        ]);
        for (const p of items) {
          await tx.query(
            'INSERT INTO order_items (order_id, product_id, quantity, unit_price_cents) VALUES ($1, $2, 1, $3)',
            [order.rows[0].id, p.id, p.price_cents],
          );
        }
        created += 1;
      });
    }
    console.log(`${created} demo orders created (${BASKETS.length - created} already existed)`);
  } finally {
    await pool.end();
  }
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
