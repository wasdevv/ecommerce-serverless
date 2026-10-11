'use strict';

const { GetSecretValueCommand, SecretsManagerClient } = require('@aws-sdk/client-secrets-manager');
const { getRuntime } = require('../runtime');
const { migrate } = require('../db/migrate');
const { upsertAdmin } = require('../services/auth');
const { logger } = require('../observability/logger');

// Lambda de operação, sem rota HTTP: só quem tem lambda:InvokeFunction (o
// pipeline de deploy) chega aqui. É o único caminho até o RDS, que vive em
// sub-rede privada. Ações aceitas são uma lista fechada.
const ACTIONS = {
  async migrate({ db }) {
    const applied = await migrate(db, { log: (m) => logger.info(m) });
    return { applied };
  },

  // Senha lida do Secrets Manager (gerada pelo Terraform), nunca do payload.
  async 'bootstrap-admin'({ db, config }) {
    if (!config.admin.email || !config.admin.passwordSecretArn) {
      throw new Error('ADMIN_EMAIL and ADMIN_PASSWORD_SECRET_ARN must be configured');
    }
    const secrets = new SecretsManagerClient({});
    const out = await secrets.send(new GetSecretValueCommand({ SecretId: config.admin.passwordSecretArn }));
    const admin = await upsertAdmin(db, { email: config.admin.email, password: out.SecretString });
    return { adminId: admin.id };
  },

  // Produto dedicado ao smoke test: SKU reservado e estoque reabastecido a cada
  // execução, para o smoke nunca tocar em produto real.
  async 'smoke-fixture'({ db }) {
    const { rows } = await db.query(
      `INSERT INTO products (sku, name, description, price_cents, stock)
       VALUES ('SMOKE-TEST', 'Smoke test product', 'Reserved for deploy smoke tests', 100, 1000)
       ON CONFLICT (sku) DO UPDATE SET stock = 1000, updated_at = now()
       RETURNING id`,
    );
    return { productId: rows[0].id };
  },
};

exports.handler = async (event) => {
  const action = ACTIONS[event?.action];
  if (!action) throw new Error(`unknown action; expected one of ${Object.keys(ACTIONS).join(', ')}`);
  const runtime = await getRuntime();
  const result = await action(runtime);
  logger.info({ action: event.action }, 'ops action completed');
  return { action: event.action, ...result };
};
