'use strict';

// Configuração única do processo. Localmente tudo vem do ambiente (.env via
// docker compose). Na Lambda, segredos chegam por ARN do Secrets Manager e são
// resolvidos uma vez por cold start em resolveConfig() — nunca por variável
// de ambiente em texto puro.

const { GetSecretValueCommand, SecretsManagerClient } = require('@aws-sdk/client-secrets-manager');

function int(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value)) throw new Error(`${name} must be an integer`);
  return value;
}

function float(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`${name} must be a number`);
  return value;
}

function bool(name, fallback = false) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return raw === 'true' || raw === '1';
}

function baseConfig() {
  return {
    env: process.env.APP_ENV || 'local',
    port: int('PORT', 3000),
    logLevel: process.env.LOG_LEVEL || 'info',
    serviceName: process.env.OTEL_SERVICE_NAME || 'ecommerce-api',
    database: {
      url: process.env.DATABASE_URL,
      host: process.env.DB_HOST,
      port: int('DB_PORT', 5432),
      name: process.env.DB_NAME || 'ecommerce',
      ssl: bool('DB_SSL'),
      poolMax: int('DB_POOL_MAX', 10),
      secretArn: process.env.DB_SECRET_ARN,
    },
    redis: {
      url: process.env.REDIS_URL,
      tls: bool('REDIS_TLS'),
      ttlSeconds: int('CACHE_TTL_SECONDS', 60),
    },
    jwt: {
      secret: process.env.JWT_SECRET,
      secretArn: process.env.JWT_SECRET_ARN,
      expiresIn: process.env.JWT_EXPIRES_IN || '1h',
      issuer: 'ecommerce-serverless',
    },
    queue: {
      url: process.env.ORDER_EVENTS_QUEUE_URL,
      endpoint: process.env.AWS_ENDPOINT_URL_SQS,
    },
    uploads: {
      bucket: process.env.UPLOADS_BUCKET,
      endpoint: process.env.AWS_ENDPOINT_URL_S3,
      maxBytes: int('UPLOAD_MAX_BYTES', 5 * 1024 * 1024),
      expiresSeconds: int('UPLOAD_URL_TTL_SECONDS', 300),
    },
    // Endpoint SageMaker (AWS) ou URL do serve.py (local). Nenhum dos dois =
    // recomendação só por mais vendidos.
    recommender: {
      endpointName: process.env.RECOMMENDER_ENDPOINT_NAME,
      url: process.env.RECOMMENDER_URL,
      timeoutMs: int('RECOMMENDER_TIMEOUT_MS', 800),
    },
    ml: {
      bucket: process.env.ML_BUCKET,
    },
    // Assistente de compras (RAG). Sem chave da Anthropic o assistente
    // responde só com a recuperação, sem texto gerado.
    assistant: {
      apiKey: process.env.ANTHROPIC_API_KEY,
      apiKeySecretArn: process.env.ANTHROPIC_API_KEY_SECRET_ARN,
      model: process.env.ASSISTANT_MODEL || 'claude-opus-5-5',
      timeoutMs: int('ASSISTANT_TIMEOUT_MS', 10_000),
      retrieval: {
        k: int('ASSISTANT_TOP_K', 5),
        minVectorScore: float('ASSISTANT_MIN_VECTOR_SCORE', 0.2),
      },
    },
    // hashing = local/CI, sem custo; bedrock = Titan Embeddings na AWS.
    embeddings: {
      provider: process.env.EMBEDDINGS_PROVIDER || 'hashing',
      modelId: process.env.EMBEDDINGS_MODEL_ID || 'amazon.titan-embed-text-v2:0',
    },
    admin: {
      email: process.env.ADMIN_EMAIL,
      passwordSecretArn: process.env.ADMIN_PASSWORD_SECRET_ARN,
    },
    currency: 'BRL',
  };
}

async function fetchSecret(client, arn) {
  const out = await client.send(new GetSecretValueCommand({ SecretId: arn }));
  return out.SecretString;
}

let resolved;

// Lê os segredos referenciados por ARN e devolve a config completa. Memoizado:
// a Lambda paga o GetSecretValue só no cold start.
async function resolveConfig({ secrets = new SecretsManagerClient({}) } = {}) {
  if (resolved) return resolved;
  const config = baseConfig();

  if (config.database.secretArn) {
    const parsed = JSON.parse(await fetchSecret(secrets, config.database.secretArn));
    config.database.user = parsed.username;
    config.database.password = parsed.password;
  }
  if (!config.jwt.secret && config.jwt.secretArn) {
    config.jwt.secret = await fetchSecret(secrets, config.jwt.secretArn);
  }
  if (!config.jwt.secret) throw new Error('JWT_SECRET or JWT_SECRET_ARN is required');
  // O Terraform cria o segredo vazio; a chave entra depois, fora do state.
  // Segredo ainda sem valor = assistente sem LLM, não cold start quebrado.
  if (!config.assistant.apiKey && config.assistant.apiKeySecretArn) {
    config.assistant.apiKey = await fetchSecret(secrets, config.assistant.apiKeySecretArn).catch(() => undefined);
  }

  resolved = config;
  return config;
}

function resetConfig() {
  resolved = undefined;
}

module.exports = { baseConfig, resolveConfig, resetConfig };
