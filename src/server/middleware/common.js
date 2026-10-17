'use strict';

const crypto = require('crypto');
const { rateLimit } = require('express-rate-limit');
const { GatewayError, toErrorResponse } = require('../errors');

function sendError(res, err) {
  const { status, body } = toErrorResponse(err);
  res.locals.gw = res.locals.gw || {};
  if (!res.locals.gw.erro) res.locals.gw.erro = err && (err.cause ? `${err.message} | ${err.cause.message || err.cause}` : err.message);
  if (err && err.status === 405 && err.allow) res.set('Allow', err.allow);
  res.status(status).json(body);
}

function securityHeaders(req, res, next) {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
    'Cross-Origin-Resource-Policy': 'same-site'
  });
  if (req.path.startsWith('/api/')) res.set('Cache-Control', 'no-store');
  next();
}

function cors(getConfig) {
  return (req, res, next) => {
    const origin = req.headers.origin;
    const allowed = getConfig().corsOrigins || [];
    if (origin && (allowed.includes('*') || allowed.includes(origin))) {
      res.set('Access-Control-Allow-Origin', allowed.includes('*') ? '*' : origin);
      res.set('Vary', 'Origin');
      res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
      res.set('Access-Control-Max-Age', '600');
    }
    if (req.method === 'OPTIONS') return res.status(204).end();
    next();
  };
}

/** Registra cada requisição da API em GW_LOG ao final da resposta. */
function requestLog(logger) {
  return (req, res, next) => {
    const t0 = process.hrtime.bigint();
    res.locals.gw = {};
    res.on('finish', () => {
      const gw = res.locals.gw || {};
      const keys = Object.keys(req.query || {});
      logger.request({
        ip: req.ip,
        tokenId: gw.token && gw.token.id,
        tokenNome: gw.token && gw.token.nome,
        metodo: req.method,
        // Valores da query string não são gravados (podem conter dados pessoais); somente os nomes dos parâmetros.
        endpoint: req.baseUrl + req.path + (keys.length ? '?' + keys.join('&') : ''),
        banco: gw.banco,
        tabela: gw.tabela,
        operacao: gw.operacao,
        status: res.statusCode,
        tempoMs: Number((process.hrtime.bigint() - t0) / 1000000n),
        erro: res.statusCode >= 400 ? gw.erro : null
      });
    });
    next();
  };
}

function rateLimiter(getConfig) {
  return rateLimit({
    windowMs: 60 * 1000,
    limit: () => Math.max(1, Number(getConfig().rateLimitPerMinute) || 300),
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req) => {
      const auth = req.headers.authorization;
      return auth ? 't:' + crypto.createHash('sha256').update(auth).digest('hex').slice(0, 32) : 'ip:' + req.ip;
    },
    handler: (req, res) => sendError(res, new GatewayError('RATE_LIMIT', 'Limite de requisições excedido. Tente novamente em instantes.'))
  });
}

/** Tratador final de erros do Express (inclui JSON malformado e corpo grande demais). */
function errorHandler(err, req, res, _next) {
  if (err && err.type === 'entity.parse.failed') return sendError(res, new GatewayError('VALIDATION_ERROR', 'JSON inválido no corpo da requisição.'));
  if (err && err.type === 'entity.too.large') return sendError(res, new GatewayError('VALIDATION_ERROR', 'Corpo da requisição excede o tamanho máximo.', { status: 413 }));
  if (!(err instanceof GatewayError)) console.error('[api]', err);
  sendError(res, err);
}

module.exports = { securityHeaders, cors, requestLog, rateLimiter, errorHandler, sendError };
