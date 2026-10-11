'use strict';

const jwt = require('jsonwebtoken');
const { setupTestContext } = require('./helpers');

let ctx;
beforeAll(async () => {
  ctx = await setupTestContext();
});
beforeEach(() => ctx.reset());
afterAll(() => ctx.close());

describe('POST /api/v1/auth/register', () => {
  it('persists a bcrypt hash, never the password', async () => {
    const res = await ctx.http()
      .post('/api/v1/auth/register')
      .send({ email: 'Ana@Example.test', password: 'super secret 123' })
      .expect(201);

    expect(res.body.data).toMatchObject({ email: 'ana@example.test', role: 'customer' });
    expect(res.body.data).not.toHaveProperty('passwordHash');
    const { rows } = await ctx.db.query('SELECT password_hash FROM users');
    expect(rows[0].password_hash).toMatch(/^\$2[aby]\$10\$/);
    expect(rows[0].password_hash).not.toContain('super secret 123');
  });

  it('rejects a duplicate email regardless of case', async () => {
    await ctx.http().post('/api/v1/auth/register').send({ email: 'bia@example.test', password: 'password123' });
    const res = await ctx.http()
      .post('/api/v1/auth/register')
      .send({ email: 'BIA@example.test', password: 'password123' })
      .expect(409);
    expect(res.body.error.code).toBe('email_taken');
  });

  it('does not let public sign-up choose the admin role', async () => {
    const res = await ctx.http()
      .post('/api/v1/auth/register')
      .send({ email: 'eve@example.test', password: 'password123', role: 'admin' })
      .expect(400);
    expect(res.body.error.details[0].field).toBe('role');
    const { rows } = await ctx.db.query("SELECT count(*)::int AS n FROM users WHERE role = 'admin'");
    expect(rows[0].n).toBe(0);
  });

  it('validates email and password length', async () => {
    const res = await ctx.http().post('/api/v1/auth/register').send({ email: 'nope', password: 'short' }).expect(400);
    expect(res.body.error.code).toBe('validation_error');
    expect(res.body.error.details.map((d) => d.field).sort()).toEqual(['email', 'password']);
  });
});

describe('POST /api/v1/auth/login', () => {
  it('returns an expiring JWT for valid credentials', async () => {
    await ctx.http().post('/api/v1/auth/register').send({ email: 'caio@example.test', password: 'password123' });
    const res = await ctx.http()
      .post('/api/v1/auth/login')
      .send({ email: 'caio@example.test', password: 'password123' })
      .expect(200);

    const claims = jwt.decode(res.body.data.accessToken);
    expect(claims.role).toBe('customer');
    expect(claims.exp - claims.iat).toBe(3600);
    expect(new Date(res.body.data.expiresAt).getTime()).toBe(claims.exp * 1000);
  });

  it('answers wrong password and unknown email identically', async () => {
    await ctx.http().post('/api/v1/auth/register').send({ email: 'dani@example.test', password: 'password123' });
    const wrong = await ctx.http().post('/api/v1/auth/login').send({ email: 'dani@example.test', password: 'nope-nope' });
    const unknown = await ctx.http().post('/api/v1/auth/login').send({ email: 'ghost@example.test', password: 'nope-nope' });

    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    const strip = ({ correlationId, ...rest }) => rest; // eslint-disable-line no-unused-vars
    expect(strip(wrong.body.error)).toEqual(strip(unknown.body.error));
    expect(wrong.body.error.message).toBe('Invalid email or password');
  });

  it('rejects expired and tampered tokens with 401', async () => {
    const { rows } = await ctx.db.query(
      "INSERT INTO users (email, password_hash) VALUES ('old@example.test', 'x') RETURNING id",
    );
    const expired = jwt.sign({ role: 'customer' }, process.env.JWT_SECRET, {
      subject: rows[0].id,
      issuer: 'ecommerce-serverless',
      expiresIn: -10,
    });
    const forged = jwt.sign({ role: 'admin' }, 'some-other-secret', { subject: rows[0].id, issuer: 'ecommerce-serverless' });

    for (const token of [expired, forged]) {
      const res = await ctx.http().get('/api/v1/orders').set('Authorization', `Bearer ${token}`).expect(401);
      expect(res.body.error.code).toBe('unauthorized');
    }
    await ctx.http().get('/api/v1/orders').expect(401);
    await ctx.http().get('/api/v1/orders').set('Authorization', 'Basic abc').expect(401);
  });
});
