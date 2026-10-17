'use strict';

const crypto = require('crypto');

const SCRYPT = { N: 32768, r: 8, p: 1, keylen: 64, maxmem: 64 * 1024 * 1024 };

/** Hash de senha com scrypt + salt aleatório. Formato: scrypt$N$r$p$salt$hash */
function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, SCRYPT.keylen, SCRYPT);
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), hash.toString('base64')].join('$');
}

function verifyPassword(password, stored) {
  try {
    const [alg, N, r, p, saltB64, hashB64] = String(stored).split('$');
    if (alg !== 'scrypt') return false;
    const expected = Buffer.from(hashB64, 'base64');
    const actual = crypto.scryptSync(String(password), Buffer.from(saltB64, 'base64'), expected.length, {
      N: Number(N), r: Number(r), p: Number(p), maxmem: SCRYPT.maxmem
    });
    return crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

/** Gera um token de API. Retorna o valor em claro (exibido uma única vez), o hash e o prefixo. */
function generateApiToken() {
  const plain = 'gw_' + crypto.randomBytes(32).toString('base64url');
  return { plain, hash: hashToken(plain), prefix: plain.slice(0, 10) };
}

/** Tokens têm alta entropia, então SHA-256 é adequado (permite busca indexada). */
function hashToken(plain) {
  return crypto.createHash('sha256').update(String(plain)).digest('hex');
}

function validatePasswordStrength(pwd) {
  const s = String(pwd || '');
  if (s.length < 8) return 'A senha deve ter pelo menos 8 caracteres.';
  if (!/[A-Za-z]/.test(s) || !/[0-9]/.test(s)) return 'A senha deve conter letras e números.';
  return null;
}

module.exports = { hashPassword, verifyPassword, generateApiToken, hashToken, validatePasswordStrength };
