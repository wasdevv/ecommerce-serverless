'use strict';

const { resolveConfig, resetConfig, baseConfig } = require('../src/config');

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
  resetConfig();
});

function fakeSecrets(values) {
  const calls = [];
  return {
    calls,
    async send(command) {
      calls.push(command.input.SecretId);
      return { SecretString: values[command.input.SecretId] };
    },
  };
}

describe('resolveConfig', () => {
  it('reads database and JWT credentials from Secrets Manager once per process', async () => {
    delete process.env.JWT_SECRET;
    process.env.DB_SECRET_ARN = 'arn:db';
    process.env.JWT_SECRET_ARN = 'arn:jwt';
    const secrets = fakeSecrets({ 'arn:db': JSON.stringify({ username: 'app', password: 'pw' }), 'arn:jwt': 'jwt-secret' });

    const config = await resolveConfig({ secrets });
    await resolveConfig({ secrets });

    expect(config.database).toMatchObject({ user: 'app', password: 'pw' });
    expect(config.jwt.secret).toBe('jwt-secret');
    expect(secrets.calls).toEqual(['arn:db', 'arn:jwt']);
  });

  it('fails fast without a JWT secret', async () => {
    delete process.env.JWT_SECRET;
    delete process.env.JWT_SECRET_ARN;
    await expect(resolveConfig({ secrets: fakeSecrets({}) })).rejects.toThrow(/JWT_SECRET/);
  });

  it('reads the Anthropic key from Secrets Manager and tolerates a secret with no value yet', async () => {
    process.env.ANTHROPIC_API_KEY_SECRET_ARN = 'arn:anthropic';
    const config = await resolveConfig({ secrets: fakeSecrets({ 'arn:anthropic': 'sk-test' }) });
    expect(config.assistant.apiKey).toBe('sk-test');

    resetConfig();
    const empty = {
      async send() {
        throw new Error('ResourceNotFoundException: no secret value');
      },
    };
    await expect(resolveConfig({ secrets: empty })).resolves.toMatchObject({ assistant: { apiKey: undefined } });
  });

  it('parses typed env vars and rejects garbage', () => {
    process.env.ASSISTANT_MIN_VECTOR_SCORE = '0.35';
    expect(baseConfig().assistant.retrieval.minVectorScore).toBe(0.35);
    process.env.ASSISTANT_MIN_VECTOR_SCORE = 'high';
    expect(() => baseConfig()).toThrow(/ASSISTANT_MIN_VECTOR_SCORE/);
    delete process.env.ASSISTANT_MIN_VECTOR_SCORE;

    process.env.DB_POOL_MAX = '2';
    process.env.DB_SSL = 'true';
    expect(baseConfig().database).toMatchObject({ poolMax: 2, ssl: true });
    process.env.DB_POOL_MAX = 'lots';
    expect(() => baseConfig()).toThrow(/DB_POOL_MAX/);
  });
});
