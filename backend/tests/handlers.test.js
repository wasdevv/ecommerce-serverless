'use strict';

const { setupTestContext } = require('./helpers');
const { getRuntime } = require('../src/runtime');
const api = require('../src/handlers/api');
const dispatcher = require('../src/handlers/dispatcher');
const worker = require('../src/handlers/worker');
const ops = require('../src/handlers/ops');

let ctx;
beforeAll(async () => {
  ctx = await setupTestContext();
});
beforeEach(() => ctx.reset());
afterAll(async () => {
  const runtime = await getRuntime();
  await runtime.cache.close();
  await runtime.db.end();
  await ctx.close();
});

// Evento no formato real da API Gateway HTTP API (payload 2.0).
function httpApiEvent(method, path, { body, headers = {} } = {}) {
  return {
    version: '2.0',
    routeKey: '$default',
    rawPath: path,
    rawQueryString: '',
    headers: { 'content-type': 'application/json', host: 'abc123.execute-api.us-east-1.amazonaws.com', ...headers },
    requestContext: {
      accountId: '123456789012',
      apiId: 'abc123',
      domainName: 'abc123.execute-api.us-east-1.amazonaws.com',
      http: { method, path, protocol: 'HTTP/1.1', sourceIp: '203.0.113.10', userAgent: 'jest' },
      requestId: 'req-1',
      routeKey: '$default',
      stage: '$default',
      time: '10/Oct/2026:12:00:00 +0000',
      timeEpoch: 1791633600000,
    },
    body: body ? JSON.stringify(body) : undefined,
    isBase64Encoded: false,
  };
}

const lambdaContext = { getRemainingTimeInMillis: () => 30_000, functionName: 'test', awsRequestId: 'aws-req-1' };

describe('API Lambda handler', () => {
  it('serves health through the API Gateway adapter', async () => {
    const res = await api.handler(httpApiEvent('GET', '/api/v1/health'), lambdaContext);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ status: 'ok' });
    expect(res.headers['x-correlation-id']).toBeDefined();
  });

  it('runs a register + login round trip', async () => {
    const creds = { email: 'lambda@example.test', password: 'password123' };
    const reg = await api.handler(httpApiEvent('POST', '/api/v1/auth/register', { body: creds }), lambdaContext);
    expect(reg.statusCode).toBe(201);
    const login = await api.handler(httpApiEvent('POST', '/api/v1/auth/login', { body: creds }), lambdaContext);
    expect(login.statusCode).toBe(200);
    expect(JSON.parse(login.body).data.accessToken).toBeDefined();
  });

  it('maps errors to JSON responses', async () => {
    const res = await api.handler(httpApiEvent('GET', '/api/v1/orders'), lambdaContext);
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body).error.code).toBe('unauthorized');
  });
});

describe('dispatcher and worker handlers', () => {
  it('dispatcher finishes cleanly with an empty outbox', async () => {
    await expect(dispatcher.handler({}, lambdaContext)).resolves.toEqual({ scanned: 0, published: 0, failed: 0 });
  });

  it('worker handler returns partial batch failures', async () => {
    const res = await worker.handler({ Records: [{ messageId: 'm1', body: 'nope' }] });
    expect(res).toEqual({ batchItemFailures: [{ itemIdentifier: 'm1' }] });
    await expect(worker.handler({})).resolves.toEqual({ batchItemFailures: [] });
  });
});

describe('ops handler', () => {
  it('runs migrations idempotently', async () => {
    await expect(ops.handler({ action: 'migrate' })).resolves.toEqual({ action: 'migrate', applied: [] });
  });

  it('creates and restocks the smoke-test product', async () => {
    const first = await ops.handler({ action: 'smoke-fixture' });
    await ctx.db.query("UPDATE products SET stock = 3 WHERE sku = 'SMOKE-TEST'");
    const second = await ops.handler({ action: 'smoke-fixture' });
    expect(second.productId).toBe(first.productId);
    const { rows } = await ctx.db.query("SELECT stock FROM products WHERE sku = 'SMOKE-TEST'");
    expect(rows[0].stock).toBe(1000);
  });

  it('refuses unknown actions and unconfigured admin bootstrap', async () => {
    await expect(ops.handler({ action: 'drop-database' })).rejects.toThrow(/unknown action/);
    await expect(ops.handler({})).rejects.toThrow(/unknown action/);
    await expect(ops.handler({ action: 'bootstrap-admin' })).rejects.toThrow(/ADMIN_EMAIL/);
    await expect(ops.handler({ action: 'export-training-data' })).rejects.toThrow(/ML_BUCKET/);
  });
});
