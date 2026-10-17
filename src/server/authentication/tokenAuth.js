'use strict';

const { hashToken } = require('../security/hashing');
const { GatewayError } = require('../errors');

const OPS = ['listar', 'buscar', 'incluir', 'alterar', 'excluir', 'upload'];

/** Autenticação por Bearer token e verificação de permissões por endpoint/operação. */
class TokenAuth {
  constructor(db) {
    this.db = db;
    this.lastUseWrite = new Map();
  }

  authenticate(authorizationHeader) {
    const m = /^Bearer\s+([A-Za-z0-9_\-]{10,200})\s*$/.exec(String(authorizationHeader || ''));
    if (!m) throw new GatewayError('AUTHENTICATION_ERROR', 'Token ausente ou inválido. Use o cabeçalho Authorization: Bearer <token>.');
    const row = this.db.prepare('SELECT * FROM GW_TOKEN WHERE TOKEN_HASH = ?').get(hashToken(m[1]));
    if (!row) throw new GatewayError('AUTHENTICATION_ERROR', 'Token inválido.');
    if (!row.ATIVO || row.REVOGADO_EM) throw new GatewayError('AUTHENTICATION_ERROR', 'Token inativo ou revogado.');
    if (row.EXPIRA_EM && Date.parse(row.EXPIRA_EM) < Date.now()) throw new GatewayError('AUTHENTICATION_ERROR', 'Token expirado.');

    const perms = new Map();
    for (const p of this.db.prepare('SELECT * FROM GW_TOKEN_PERMISSAO WHERE TOKEN_ID = ?').all(row.ID)) {
      perms.set(p.ENDPOINT_ID, {
        listar: !!p.LISTAR, buscar: !!p.BUSCAR, incluir: !!p.INCLUIR, alterar: !!p.ALTERAR, excluir: !!p.EXCLUIR, upload: !!p.UPLOAD
      });
    }
    const consultas = new Set(this.db.prepare('SELECT CONSULTA_ID FROM GW_TOKEN_PERMISSAO_CONSULTA WHERE TOKEN_ID = ?').all(row.ID).map((r) => r.CONSULTA_ID));
    // Atualiza "último uso" no máximo uma vez por minuto por token
    const now = Date.now();
    if ((this.lastUseWrite.get(row.ID) || 0) < now - 60000) {
      this.lastUseWrite.set(row.ID, now);
      this.db.prepare('UPDATE GW_TOKEN SET ULTIMO_USO = ? WHERE ID = ?').run(new Date(now).toISOString(), row.ID);
    }
    return { id: row.ID, nome: row.NOME, perms, consultas };
  }

  can(token, endpointId, op) {
    if (!token || !OPS.includes(op)) return false;
    const p = token.perms.get(endpointId);
    return !!(p && p[op]);
  }

  requireConsulta(token, consultaId) {
    if (!token || !token.consultas || !token.consultas.has(consultaId)) {
      throw new GatewayError('AUTHORIZATION_ERROR', 'Token sem permissão para esta consulta.');
    }
  }

  require(token, endpointId, op) {
    if (!this.can(token, endpointId, op)) {
      throw new GatewayError('AUTHORIZATION_ERROR', 'Token sem permissão para esta operação.');
    }
  }
}

module.exports = { TokenAuth, OPS };
