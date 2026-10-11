'use strict';

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { AppError, conflict, unauthorized } = require('../errors');

const BCRYPT_ROUNDS = 10;
// Hash de uma senha descartável: quando o email não existe ainda comparamos
// contra ele, para que "email inexistente" e "senha errada" levem o mesmo tempo.
const DUMMY_HASH = bcrypt.hashSync('timing-equalizer-not-a-password', BCRYPT_ROUNDS);

function publicUser(row) {
  return { id: row.id, email: row.email, role: row.role, createdAt: row.created_at };
}

class AuthService {
  constructor({ db, jwtConfig }) {
    this.db = db;
    this.jwtConfig = jwtConfig;
  }

  // Cadastro público sempre cria "customer". Administrador só nasce via
  // scripts/bootstrap-admin.js (local) ou ação "bootstrap-admin" da Lambda ops.
  async register({ email, password }) {
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    try {
      const { rows } = await this.db.query(
        `INSERT INTO users (email, password_hash, role) VALUES ($1, $2, 'customer')
         RETURNING id, email, role, created_at`,
        [email, passwordHash],
      );
      return publicUser(rows[0]);
    } catch (error) {
      if (error.code === '23505') throw conflict('email_taken', 'Email already registered');
      throw error;
    }
  }

  async login({ email, password }) {
    const { rows } = await this.db.query(
      'SELECT id, email, role, password_hash FROM users WHERE lower(email) = lower($1)',
      [email],
    );
    const user = rows[0];
    const ok = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH);
    // Mesma resposta para os dois casos: não revela quais emails existem.
    if (!user || !ok) throw new AppError(401, 'invalid_credentials', 'Invalid email or password');

    const token = jwt.sign({ role: user.role }, this.jwtConfig.secret, {
      subject: user.id,
      expiresIn: this.jwtConfig.expiresIn,
      issuer: this.jwtConfig.issuer,
      algorithm: 'HS256',
    });
    const { exp } = jwt.decode(token);
    return { accessToken: token, tokenType: 'Bearer', expiresAt: new Date(exp * 1000).toISOString() };
  }

  verify(token) {
    try {
      const claims = jwt.verify(token, this.jwtConfig.secret, {
        issuer: this.jwtConfig.issuer,
        algorithms: ['HS256'],
      });
      return { id: claims.sub, role: claims.role };
    } catch {
      throw unauthorized('Invalid or expired token');
    }
  }
}

// Usado pelos scripts de bootstrap: promove/cria admin com senha fornecida
// explicitamente (nunca uma senha padrão versionada).
async function upsertAdmin(db, { email, password }) {
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const { rows } = await db.query(
    `INSERT INTO users (email, password_hash, role) VALUES ($1, $2, 'admin')
     ON CONFLICT (lower(email)) DO UPDATE SET password_hash = EXCLUDED.password_hash, role = 'admin'
     RETURNING id, email, role, created_at`,
    [email, passwordHash],
  );
  return publicUser(rows[0]);
}

module.exports = { AuthService, upsertAdmin };
