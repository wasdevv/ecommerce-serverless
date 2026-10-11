'use strict';

const { Writable } = require('node:stream');
const request = require('supertest');
const { setupTestContext } = require('./helpers');
const { createApp } = require('../src/app');
const { createLogger } = require('../src/observability/logger');
const { runWithContext, sanitizeCorrelationId } = require('../src/observability/context');

let ctx;
beforeAll(async () => {
  ctx = await setupTestContext();
});
beforeEach(() => ctx.reset());
afterAll(() => ctx.close());

function captureLogger() {
  const lines = [];
  const destination = new Writable({
    write(chunk, _enc, cb) {
      lines.push(JSON.parse(chunk.toString()));
      cb();
    },
  });
  return { lines, log: createLogger({ level: 'debug', destination }) };
}

describe('error responses', () => {
  it('hide internals on 500 but carry the correlation id that finds the log line', async () => {
    const { lines, log } = captureLogger();
    const brokenDb = { query: () => Promise.reject(new Error('password authentication failed for user "app"')) };
    const app = createApp({ config: ctx.config, db: brokenDb, cache: ctx.cache, log });

    const res = await request(app).get('/api/v1/products').set('X-Correlation-Id', 'trace-me-please').expect(500);

    expect(res.body).toEqual({
      error: { code: 'internal_error', message: 'Internal server error', correlationId: 'trace-me-please' },
    });
    expect(JSON.stringify(res.body)).not.toMatch(/password|stack|at /);
    const errorLine = lines.find((l) => l.msg === 'unhandled error');
    expect(errorLine).toMatchObject({ correlationId: 'trace-me-please', level: 'error' });
    expect(errorLine.err.stack).toBeDefined();
    expect(lines.find((l) => l.msg === 'request failed')).toMatchObject({
      route: '/api/v1/products/',
      status: 500,
      correlationId: 'trace-me-please',
    });
  });

  it('return 400 for malformed JSON and 404 for unknown routes', async () => {
    const res = await ctx.http()
      .post('/api/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"email":')
      .expect(400);
    expect(res.body.error.message).toBe('Malformed JSON body');
    await ctx.http().get('/api/v1/nope').expect(404);
    await ctx.http().post('/api/v1/auth/login').set('Content-Type', 'application/json').send(JSON.stringify({ email: 'x'.repeat(40_000) })).expect(413);
  });
});

describe('request logging', () => {
  it('never writes passwords, tokens or emails', async () => {
    const { lines, log } = captureLogger();
    const app = createApp({ config: ctx.config, db: ctx.db, cache: ctx.cache, log });
    await request(app).post('/api/v1/auth/register').send({ email: 'leak@example.test', password: 'hunter2hunter2' });
    const login = await request(app).post('/api/v1/auth/login').send({ email: 'leak@example.test', password: 'hunter2hunter2' });
    await request(app).get('/api/v1/orders').set('Authorization', `Bearer ${login.body.data.accessToken}`);

    const dump = JSON.stringify(lines);
    expect(lines.length).toBeGreaterThanOrEqual(3);
    expect(dump).not.toContain('hunter2');
    expect(dump).not.toContain('leak@example.test');
    expect(dump).not.toContain(login.body.data.accessToken);
    expect(lines[0]).toEqual(
      expect.objectContaining({ method: 'POST', route: '/api/v1/auth/register', status: 201, durationMs: expect.any(Number) }),
    );
  });

  it('redacts sensitive fields even when a developer logs them by mistake', () => {
    const { lines, log } = captureLogger();
    log.info({ password: 'p', token: 't', user: { email: 'e@x', secret: 's' } }, 'oops');
    expect(lines[0]).toMatchObject({ password: '[REDACTED]', token: '[REDACTED]', user: { email: '[REDACTED]', secret: '[REDACTED]' } });
  });

  it('includes the X-Ray trace id from the Lambda runtime when present', () => {
    const { lines, log } = captureLogger();
    process.env._X_AMZN_TRACE_ID = 'Root=1-5759e988-bd862e3fe1be46a994272793;Parent=53995c3f42cd8ad8;Sampled=1';
    runWithContext({ correlationId: 'abc12345' }, () => log.info('hello'));
    delete process.env._X_AMZN_TRACE_ID;
    expect(lines[0]).toMatchObject({ correlationId: 'abc12345', traceId: '1-5759e988-bd862e3fe1be46a994272793' });
  });
});

describe('correlation ids', () => {
  it('generate one when the client sends none or an unsafe value', async () => {
    const res = await ctx.http().get('/api/v1/health').expect(200);
    expect(res.body).toEqual({ status: 'ok' });
    expect(res.headers['x-correlation-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(sanitizeCorrelationId('bad\nvalue injected')).toMatch(/^[0-9a-f-]{36}$/);
    expect(sanitizeCorrelationId('good-id-123')).toBe('good-id-123');
  });
});
