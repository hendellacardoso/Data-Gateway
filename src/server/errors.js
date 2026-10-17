'use strict';

const HTTP_STATUS = {
  AUTHENTICATION_ERROR: 401,
  AUTHORIZATION_ERROR: 403,
  VALIDATION_ERROR: 400,
  NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  CONFLICT: 409,
  PAYLOAD_TOO_LARGE: 413,
  DATABASE_ERROR: 500,
  CONNECTION_ERROR: 503,
  UPLOAD_ERROR: 400,
  RATE_LIMIT: 429,
  INTERNAL_ERROR: 500
};

class GatewayError extends Error {
  /**
   * @param {string} code  um dos códigos padronizados
   * @param {string} message mensagem segura para o cliente
   * @param {object} [opts] { details, status, cause }
   */
  constructor(code, message, opts = {}) {
    super(message);
    this.code = code;
    this.status = opts.status || HTTP_STATUS[code] || 500;
    this.details = opts.details || [];
    if (opts.cause) this.cause = opts.cause;
  }
}

const isProduction = () => process.env.NODE_ENV !== 'development';

/** Converte qualquer erro em resposta padronizada, sem vazar stack/detalhes internos em produção. */
function toErrorResponse(err) {
  if (err instanceof GatewayError) {
    const body = { success: false, error: { code: err.code, message: err.message, details: err.details } };
    if (!isProduction() && err.cause) body.error.debug = String(err.cause.message || err.cause);
    return { status: err.status, body };
  }
  const body = { success: false, error: { code: 'INTERNAL_ERROR', message: 'Erro interno no Gateway.', details: [] } };
  if (!isProduction()) body.error.debug = String(err && (err.stack || err.message || err));
  return { status: 500, body };
}

module.exports = { GatewayError, toErrorResponse, HTTP_STATUS, isProduction };
