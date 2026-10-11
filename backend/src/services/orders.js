'use strict';

const crypto = require('node:crypto');
const { withTransaction } = require('../db/pool');
const { AppError, conflict, notFound } = require('../errors');
const { currentContext } = require('../observability/context');

const ORDER_CREATED = 'order.created';

// Hash canônico do payload: a ordem dos itens não muda o pedido, então
// também não muda a identidade da requisição idempotente.
function requestHash(items) {
  const canonical = [...items]
    .sort((a, b) => a.productId.localeCompare(b.productId))
    .map((i) => `${i.productId}:${i.quantity}`)
    .join('|');
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

function toOrder(order, items) {
  return {
    id: order.id,
    status: order.status,
    totalCents: order.total_cents,
    currency: order.currency.trim(),
    createdAt: order.created_at,
    items: items.map((i) => ({
      productId: i.product_id,
      quantity: i.quantity,
      unitPriceCents: i.unit_price_cents,
      subtotalCents: i.quantity * i.unit_price_cents,
    })),
  };
}

class OrderService {
  constructor({ db }) {
    this.db = db;
  }

  // Cria o pedido numa única transação:
  //   1. reserva a Idempotency-Key (a PK serializa requisições com a mesma chave);
  //   2. debita o estoque com UPDATE condicional — "stock >= qty" é avaliado
  //      sob o row lock, então duas compras da última unidade não passam juntas;
  //   3. grava pedido, itens e o evento na outbox.
  // Qualquer falha desfaz tudo, inclusive a reserva da chave.
  async create(userId, { items, idempotencyKey }) {
    const hash = requestHash(items);
    try {
      return await withTransaction(this.db, (client) => this.#createInTransaction(client, userId, items, idempotencyKey, hash));
    } catch (error) {
      if (error.code !== '23505' || error.constraint !== 'idempotency_keys_pkey') throw error;
      return this.#replay(userId, idempotencyKey, hash);
    }
  }

  async #createInTransaction(client, userId, items, idempotencyKey, hash) {
    await client.query('INSERT INTO idempotency_keys (user_id, key, request_hash) VALUES ($1, $2, $3)', [
      userId,
      idempotencyKey,
      hash,
    ]);

    // Ordem fixa de lock (por product_id) evita deadlock entre pedidos que
    // compartilham produtos.
    const sorted = [...items].sort((a, b) => a.productId.localeCompare(b.productId));
    const lines = [];
    for (const item of sorted) {
      const { rows } = await client.query(
        `UPDATE products SET stock = stock - $2, updated_at = now()
         WHERE id = $1 AND stock >= $2 RETURNING price_cents`,
        [item.productId, item.quantity],
      );
      if (!rows[0]) {
        const exists = await client.query('SELECT stock FROM products WHERE id = $1', [item.productId]);
        if (!exists.rows[0]) throw notFound(`Product ${item.productId} not found`);
        throw conflict('insufficient_stock', 'Insufficient stock', {
          productId: item.productId,
          available: exists.rows[0].stock,
        });
      }
      lines.push({ ...item, unitPriceCents: rows[0].price_cents });
    }

    const total = lines.reduce((sum, l) => sum + l.quantity * l.unitPriceCents, 0);
    const { rows: orderRows } = await client.query(
      `INSERT INTO orders (user_id, total_cents) VALUES ($1, $2)
       RETURNING id, status, total_cents, currency, created_at`,
      [userId, total],
    );
    const order = orderRows[0];
    const { rows: itemRows } = await client.query(
      `INSERT INTO order_items (order_id, product_id, quantity, unit_price_cents)
       SELECT $1, * FROM unnest($2::uuid[], $3::int[], $4::int[])
       RETURNING product_id, quantity, unit_price_cents`,
      [order.id, lines.map((l) => l.productId), lines.map((l) => l.quantity), lines.map((l) => l.unitPriceCents)],
    );
    await client.query('UPDATE idempotency_keys SET order_id = $1 WHERE user_id = $2 AND key = $3', [
      order.id,
      userId,
      idempotencyKey,
    ]);
    await client.query(
      `INSERT INTO outbox_events (aggregate_id, event_type, payload, correlation_id)
       VALUES ($1, $2, $3, $4)`,
      [order.id, ORDER_CREATED, { orderId: order.id, userId, totalCents: total }, currentContext().correlationId || null],
    );
    return { order: toOrder(order, itemRows), replayed: false };
  }

  async #replay(userId, idempotencyKey, hash) {
    const { rows } = await this.db.query(
      'SELECT request_hash, order_id FROM idempotency_keys WHERE user_id = $1 AND key = $2',
      [userId, idempotencyKey],
    );
    const saved = rows[0];
    if (!saved || saved.request_hash !== hash) {
      throw conflict('idempotency_key_reused', 'Idempotency-Key was already used with a different payload');
    }
    if (!saved.order_id) throw new AppError(409, 'request_in_progress', 'Request with this key is still in progress');
    return { order: await this.get(userId, saved.order_id), replayed: true };
  }

  async list(userId, { page, pageSize }) {
    const offset = (page - 1) * pageSize;
    const { rows } = await this.db.query(
      `SELECT id FROM orders WHERE user_id = $1 ORDER BY created_at DESC, id LIMIT $2 OFFSET $3`,
      [userId, pageSize, offset],
    );
    const { rows: countRows } = await this.db.query('SELECT count(*)::int AS total FROM orders WHERE user_id = $1', [
      userId,
    ]);
    const data = await Promise.all(rows.map((r) => this.get(userId, r.id)));
    return { data, page, pageSize, total: countRows[0].total };
  }

  // Filtra por dono na própria query: pedido de outro usuário é indistinguível
  // de pedido inexistente (404), sem vazar que o ID existe.
  async get(userId, orderId) {
    const { rows } = await this.db.query(
      'SELECT id, status, total_cents, currency, created_at FROM orders WHERE id = $1 AND user_id = $2',
      [orderId, userId],
    );
    if (!rows[0]) throw notFound('Order not found');
    const { rows: items } = await this.db.query(
      'SELECT product_id, quantity, unit_price_cents FROM order_items WHERE order_id = $1 ORDER BY product_id',
      [orderId],
    );
    return toOrder(rows[0], items);
  }
}

module.exports = { OrderService, ORDER_CREATED, requestHash };
