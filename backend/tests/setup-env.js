'use strict';

// Defaults para a suíte. CI e docker compose sobrescrevem via ambiente.
process.env.APP_ENV = 'test';
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'silent';
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL || 'postgres://postgres:postgres@127.0.0.1:5432/ecommerce_test';
process.env.REDIS_URL = process.env.TEST_REDIS_URL || 'redis://127.0.0.1:6379/15';
process.env.JWT_SECRET = 'test-only-secret-not-used-anywhere-else';
process.env.UPLOADS_BUCKET = 'test-uploads-bucket';
process.env.AWS_REGION = process.env.AWS_REGION || 'us-east-1';
process.env.AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID || 'test';
process.env.AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY || 'test';
// Nunca chamar a API da Anthropic de verdade na suíte, mesmo com a chave no shell.
process.env.ANTHROPIC_API_KEY = '';
process.env.ANTHROPIC_API_KEY_SECRET_ARN = '';
process.env.EMBEDDINGS_PROVIDER = 'hashing';
