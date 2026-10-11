'use strict';

const crypto = require('node:crypto');
const { logger } = require('../observability/logger');

const COLUMNS = 'id, sku, name, description, price_cents, stock, created_at, updated_at';
const { NAMESPACE } = require('./products');
const POPULAR_POOL = 50;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toRecommendation(row, score) {
  return {
    id: row.id,
    sku: row.sku,
    name: row.name,
    description: row.description,
    priceCents: row.price_cents,
    stock: row.stock,
    score,
  };
}

// Recomendação = modelo quando há histórico e o modelo responde; mais vendidos
// para completar a lista ou quando o modelo não está disponível. O modelo só
// devolve ids: preço e estoque vêm sempre do banco, e produto sem estoque
// nunca é recomendado, mesmo que o modelo (treinado ontem) o sugira.
class RecommendationService {
  constructor({ db, cache, recommender, log = logger }) {
    this.db = db;
    this.cache = cache;
    this.recommender = recommender;
    this.log = log;
  }

  async forUser(userId, { limit }) {
    const owned = await this.history(userId);
    const fromModel = owned.length > 0 && this.recommender ? await this.fromModel(owned, limit) : [];

    let fill = [];
    if (fromModel.length < limit) {
      const skip = new Set([...owned, ...fromModel.map((p) => p.id)]);
      fill = (await this.popular()).filter((p) => !skip.has(p.id)).slice(0, limit - fromModel.length);
    }

    let source = 'popular';
    if (fromModel.length > 0) source = fill.length > 0 ? 'model+popular' : 'model';
    return { data: [...fromModel, ...fill], source };
  }

  async history(userId) {
    const { rows } = await this.db.query(
      `SELECT DISTINCT oi.product_id
         FROM order_items oi JOIN orders o ON o.id = oi.order_id
        WHERE o.user_id = $1`,
      [userId],
    );
    return rows.map((r) => r.product_id);
  }

  async fromModel(owned, limit) {
    let ranked;
    try {
      // Pede o dobro: parte pode estar sem estoque ou ter sido removida.
      const out = await this.recommender.recommend({ productIds: owned, k: Math.min(limit * 2, 100) });
      ranked = out.recommendations;
    } catch (error) {
      this.log.warn({ err: error, recommender: this.recommender.kind }, 'recommender unavailable, using fallback');
      return [];
    }
    // O modelo é outro sistema: item que não traz um UUID nem chega na query.
    const valid = ranked.filter((r) => typeof r?.productId === 'string' && UUID.test(r.productId));
    if (valid.length === 0) return [];

    const { rows } = await this.db.query(`SELECT ${COLUMNS} FROM products WHERE id = ANY($1::uuid[]) AND stock > 0`, [
      valid.map((r) => r.productId),
    ]);
    const byId = new Map(rows.map((r) => [r.id, r]));
    return valid
      .filter((r) => byId.has(r.productId))
      .slice(0, limit)
      .map((r) => toRecommendation(byId.get(r.productId), r.score));
  }

  // Mais vendidos com estoque. Mesma versão de cache do catálogo: editar um
  // produto invalida a lista; vender só muda o ranking quando o TTL vence.
  async popular() {
    const key = `${NAMESPACE}:v${await this.cache.version(NAMESPACE)}:popular`;
    const cached = await this.cache.getJson(key);
    if (cached) return cached;
    const { rows } = await this.db.query(
      `SELECT ${COLUMNS.split(', ').map((c) => `p.${c}`).join(', ')}
         FROM products p
         LEFT JOIN order_items oi ON oi.product_id = p.id
        WHERE p.stock > 0
        GROUP BY p.id
        ORDER BY coalesce(sum(oi.quantity), 0) DESC, p.created_at, p.id
        LIMIT $1`,
      [POPULAR_POOL],
    );
    const popular = rows.map((r) => toRecommendation(r, null));
    await this.cache.setJson(key, popular);
    return popular;
  }
}

// Histórico de compras para o treino, em CSV. O usuário sai como HMAC com um
// sal aleatório por export: o modelo só precisa saber que duas compras são da
// mesma pessoa, não de quem, e dois exports não podem ser cruzados entre si.
async function exportTrainingData(db, { salt = crypto.randomBytes(16) } = {}) {
  const { rows } = await db.query(
    `SELECT o.user_id, oi.product_id, sum(oi.quantity)::int AS quantity
       FROM order_items oi JOIN orders o ON o.id = oi.order_id
      GROUP BY o.user_id, oi.product_id
      ORDER BY o.user_id, oi.product_id`,
  );
  const lines = rows.map((r) => {
    const user = crypto.createHmac('sha256', salt).update(r.user_id).digest('hex').slice(0, 16);
    return `${user},${r.product_id},${r.quantity}`;
  });
  return { csv: ['user,product_id,quantity', ...lines].join('\n') + '\n', rows: rows.length };
}

module.exports = { RecommendationService, exportTrainingData };
