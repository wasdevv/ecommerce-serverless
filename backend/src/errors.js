'use strict';

// Erro de domínio com status HTTP explícito. Tudo que não for AppError vira 500
// genérico no errorHandler — a mensagem original só vai para o log.
class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const badRequest = (message, details) => new AppError(400, 'validation_error', message, details);
const unauthorized = (message = 'Authentication required') => new AppError(401, 'unauthorized', message);
const forbidden = (message = 'Insufficient role') => new AppError(403, 'forbidden', message);
const notFound = (message = 'Resource not found') => new AppError(404, 'not_found', message);
const conflict = (code, message, details) => new AppError(409, code, message, details);

module.exports = { AppError, badRequest, unauthorized, forbidden, notFound, conflict };
