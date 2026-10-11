'use strict';

const { conflict, notFound } = require('../errors');

const NAMESPACE = 'products';

function toProduct(row) {
  return {
    id: row.id,
    sku: row.sku,
    name: row.name,
    description: row.description,
    priceCents: row.price_cents,
    stock: row.stock,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const COLUMNS = 'id, sku, name, description, price_cents, stock, created_at, updated_at';

class ProductService {
  constructor({ db, cache }) {
    this.db = db;
    this.cache = cache;
  }

  async list({ page, pageSize }) {
    const version = await this.cache.version(NAMESPACE);
    const key = `${NAMESPACE}:v${version}:list:${page}:${pageSize}`;
    const cached = await this.cache.getJson(key);
    if (cached) return { ...cached, cache: 'hit' };

    const offset = (page - 1) * pageSize;
    const [{ rows }, count] = await Promise.all([
      this.db.query(`SELECT ${COLUMNS} FROM products ORDER BY created_at, id LIMIT $1 OFFSET $2`, [
        pageSize,
        offset,
      ]),
      this.db.query('SELECT count(*)::int AS total FROM products'),
    ]);
    const result = { data: rows.map(toProduct), page, pageSize, total: count.rows[0].total };
    await this.cache.setJson(key, result);
    return { ...result, cache: 'miss' };
  }

  async get(id) {
    const version = await this.cache.version(NAMESPACE);
    const key = `${NAMESPACE}:v${version}:item:${id}`;
    const cached = await this.cache.getJson(key);
    if (cached) return cached;

    const { rows } = await this.db.query(`SELECT ${COLUMNS} FROM products WHERE id = $1`, [id]);
    if (!rows[0]) throw notFound('Product not found');
    const product = toProduct(rows[0]);
    await this.cache.setJson(key, product);
    return product;
  }

  async create(input) {
    try {
      const { rows } = await this.db.query(
        `INSERT INTO products (sku, name, description, price_cents, stock)
         VALUES ($1, $2, $3, $4, $5) RETURNING ${COLUMNS}`,
        [input.sku, input.name, input.description || '', input.priceCents, input.stock],
      );
      await this.cache.bump(NAMESPACE);
      return toProduct(rows[0]);
    } catch (error) {
      if (error.code === '23505') throw conflict('sku_taken', 'SKU already exists');
      throw error;
    }
  }

  async update(id, input) {
    const fields = { name: 'name', description: 'description', priceCents: 'price_cents', stock: 'stock' };
    const sets = [];
    const values = [];
    for (const [prop, column] of Object.entries(fields)) {
      if (input[prop] !== undefined) {
        values.push(input[prop]);
        sets.push(`${column} = $${values.length}`);
      }
    }
    values.push(id);
    const { rows } = await this.db.query(
      `UPDATE products SET ${sets.join(', ')}, updated_at = now()
       WHERE id = $${values.length} RETURNING ${COLUMNS}`,
      values,
    );
    if (!rows[0]) throw notFound('Product not found');
    // Invalida antes de responder: a próxima leitura já vê o valor novo.
    await this.cache.bump(NAMESPACE);
    return toProduct(rows[0]);
  }
}

module.exports = { ProductService, NAMESPACE };
