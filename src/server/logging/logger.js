'use strict';

/** Registro de logs de requisições (GW_LOG) e auditoria (GW_AUDITORIA). */
class GatewayLogger {
  constructor(db) {
    this.db = db;
    this.insLog = db.prepare(`INSERT INTO GW_LOG (IP, TOKEN_ID, TOKEN_NOME, METODO, ENDPOINT, BANCO, TABELA, OPERACAO, STATUS, TEMPO_MS, ERRO)
      VALUES (@ip, @tokenId, @tokenNome, @metodo, @endpoint, @banco, @tabela, @operacao, @status, @tempoMs, @erro)`);
    this.insAudit = db.prepare(`INSERT INTO GW_AUDITORIA (ORIGEM, USUARIO_ID, USUARIO, ACAO, ENTIDADE, ENTIDADE_ID, DETALHES, IP)
      VALUES (@origem, @usuarioId, @usuario, @acao, @entidade, @entidadeId, @detalhes, @ip)`);
  }

  request(entry) {
    try {
      this.insLog.run({
        ip: entry.ip || null, tokenId: entry.tokenId || null, tokenNome: entry.tokenNome || null,
        metodo: entry.metodo || null, endpoint: entry.endpoint || null, banco: entry.banco || null,
        tabela: entry.tabela || null, operacao: entry.operacao || null, status: entry.status || null,
        tempoMs: entry.tempoMs ?? null, erro: entry.erro ? String(entry.erro).slice(0, 2000) : null
      });
    } catch (err) {
      console.error('[log] falha ao gravar log:', err.message);
    }
  }

  audit({ origem = 'PAINEL', usuarioId = null, usuario = null, acao, entidade = null, entidadeId = null, detalhes = null, ip = null }) {
    try {
      this.insAudit.run({
        origem, usuarioId, usuario, acao, entidade,
        entidadeId: entidadeId === null || entidadeId === undefined ? null : String(entidadeId),
        detalhes: detalhes ? JSON.stringify(detalhes).slice(0, 8000) : null,
        ip
      });
    } catch (err) {
      console.error('[audit] falha ao gravar auditoria:', err.message);
    }
  }

  purge({ retencaoDias, auditoriaRetencaoDias }) {
    if (retencaoDias > 0) {
      this.db.prepare(`DELETE FROM GW_LOG WHERE DATA_HORA < strftime('%Y-%m-%dT%H:%M:%fZ','now', ?)`).run(`-${retencaoDias} days`);
    }
    if (auditoriaRetencaoDias > 0) {
      this.db.prepare(`DELETE FROM GW_AUDITORIA WHERE DATA_HORA < strftime('%Y-%m-%dT%H:%M:%fZ','now', ?)`).run(`-${auditoriaRetencaoDias} days`);
    }
  }
}

module.exports = { GatewayLogger };
