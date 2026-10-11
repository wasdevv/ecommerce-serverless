'use strict';

const { setupTestContext } = require('./helpers');
const { createApp } = require('../src/app');
const request = require('supertest');

let ctx;
beforeAll(async () => {
  ctx = await setupTestContext();
});
beforeEach(() => ctx.reset());
afterAll(() => ctx.close());

const decodePolicy = (fields) => JSON.parse(Buffer.from(fields.Policy, 'base64').toString('utf8'));

describe('POST /api/v1/uploads/presign', () => {
  it('signs a POST bound to the caller\'s prefix, type, size and a short expiry', async () => {
    const user = await ctx.user();
    const me = await ctx.db.query('SELECT id FROM users WHERE email = $1', [user.email]);
    const res = await ctx.http()
      .post('/api/v1/uploads/presign')
      .set('Authorization', user.auth)
      .send({ contentType: 'image/png', sizeBytes: 2048 })
      .expect(201);

    const { key, fields, url, expiresAt } = res.body.data;
    expect(key).toMatch(new RegExp(`^users/${me.rows[0].id}/[0-9a-f-]{36}\\.png$`));
    expect(url).toContain('test-uploads-bucket');
    const policy = decodePolicy(fields);
    expect(policy.conditions).toEqual(
      expect.arrayContaining([
        ['content-length-range', 1, 2048],
        ['eq', '$Content-Type', 'image/png'],
        ['eq', '$key', key],
      ]),
    );
    const ttl = new Date(policy.expiration).getTime() - Date.now();
    expect(ttl).toBeLessThanOrEqual(300_000);
    expect(new Date(expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('does not let the client choose the key', async () => {
    const user = await ctx.user();
    const res = await ctx.http()
      .post('/api/v1/uploads/presign')
      .set('Authorization', user.auth)
      .send({ contentType: 'image/png', sizeBytes: 10, key: 'users/someone-else/x.png' })
      .expect(400);
    expect(res.body.error.details[0].field).toBe('key');
  });

  it('enforces type and size limits and authentication', async () => {
    const user = await ctx.user();
    const send = (body) => ctx.http().post('/api/v1/uploads/presign').set('Authorization', user.auth).send(body);
    await send({ contentType: 'application/x-msdownload', sizeBytes: 10 }).expect(400);
    await send({ contentType: 'image/jpeg', sizeBytes: 5 * 1024 * 1024 + 1 }).expect(400);
    await send({ contentType: 'image/jpeg', sizeBytes: 0 }).expect(400);
    await ctx.http().post('/api/v1/uploads/presign').send({ contentType: 'image/png', sizeBytes: 1 }).expect(401);
  });

  it('answers 503 when no bucket is configured', async () => {
    const config = { ...ctx.config, uploads: { ...ctx.config.uploads, bucket: undefined } };
    const app = createApp({ config, db: ctx.db, cache: ctx.cache });
    const user = await ctx.user();
    await request(app)
      .post('/api/v1/uploads/presign')
      .set('Authorization', user.auth)
      .send({ contentType: 'image/png', sizeBytes: 1 })
      .expect(503);
  });
});
