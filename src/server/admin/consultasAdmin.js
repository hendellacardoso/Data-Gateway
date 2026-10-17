'use strict';

const { GatewayError } = require('../errors');
const { analyze } = require('../services/sqlConsulta');

const MAX_TEST_ROWS = 1000;

/** Consultas SQL personalizadas (somente leitura) — ações do painel. */
function createConsultasAdmin(ctx) {
  const { db, logger, consultas, consultaService } = ctx;
  const who = (s) => ({ usuarioId: s.userId, usuario: s.usuario });

  return {
    list() {
      return consultas.list();
    },

    get({ id }) {
      return consultas.get(id);
    },

    /** Análise em tempo real do SQL digitado: erros de validação e parâmetros encontrados. */
    analisar({ bancoId, sql }) {
      const tipo = consultas.bancoTipo(bancoId);
      const a = analyze(sql, tipo);
      return { errors: a.errors, params: a.params, tipo };
    },

    /** Execução de teste (não precisa estar salva). Erros do banco são exibidos por completo ao administrador. */
    async executar(session, { bancoId, sql, parametros, valores, limite, page }) {
      const tipo = consultas.bancoTipo(bancoId);
      const bancoRow = db.prepare('SELECT NOME FROM GW_BANCO WHERE ID = ?').get(bancoId);
      const a = analyze(sql, tipo);
      if (a.errors.length) throw new GatewayError('VALIDATION_ERROR', a.errors[0], { details: a.errors });
      const { params } = consultas.normalizeParams(a.params, parametros, tipo);
      const runtime = {
        sql,
        banco: { id: bancoId, nome: bancoRow && bancoRow.NOME, tipo },
        calcularTotal: true,
        parametros: params,
        paginacao: { padrao: 100, max: MAX_TEST_ROWS }
      };
      const values = consultaService.resolveValues(runtime, valores || {}, false);
      const pageSize = Math.min(MAX_TEST_ROWS, Math.max(1, Number(limite) || 100));
      const r = await consultaService.execute(runtime, values, { page: Math.max(1, Number(page) || 1), pageSize }, { rawErrors: true });
      logger.audit({ ...who(session), acao: 'CONSULTA_TESTADA', entidade: 'BANCO', entidadeId: bancoId, detalhes: { linhas: r.data.length, tempoMs: r.elapsedMs } });
      return r;
    },

    save(session, payload) {
      const isNew = !payload.id;
      const r = consultas.save(payload);
      logger.audit({ ...who(session), acao: isNew ? 'CONSULTA_CRIADA' : 'CONSULTA_ALTERADA', entidade: 'CONSULTA', entidadeId: r.id,
        detalhes: { slug: payload.slug, publicado: !!payload.publicar } });
      return r;
    },

    publish(session, { id, publicado }) {
      consultas.setPublished(id, publicado);
      logger.audit({ ...who(session), acao: publicado ? 'CONSULTA_PUBLICADA' : 'CONSULTA_DESPUBLICADA', entidade: 'CONSULTA', entidadeId: id });
      return { ok: true };
    },

    remove(session, { id }) {
      const c = db.prepare('SELECT SLUG FROM GW_CONSULTA WHERE ID = ?').get(id);
      consultas.delete(id);
      logger.audit({ ...who(session), acao: 'CONSULTA_EXCLUIDA', entidade: 'CONSULTA', entidadeId: id, detalhes: { slug: c && c.SLUG } });
      return { ok: true };
    },

    /** Permissões de consultas por token (usado na tela de Tokens). */
    tokenPermissions({ tokenId }) {
      return db.prepare(`SELECT c.ID AS consultaId, c.SLUG AS slug, c.NOME AS nome, c.PUBLICADO AS publicado,
          CASE WHEN p.ID IS NULL THEN 0 ELSE 1 END AS permitido
        FROM GW_CONSULTA c LEFT JOIN GW_TOKEN_PERMISSAO_CONSULTA p ON p.CONSULTA_ID = c.ID AND p.TOKEN_ID = ?
        ORDER BY c.SLUG`).all(tokenId).map((r) => ({ ...r, publicado: !!r.publicado, permitido: !!r.permitido }));
    },

    saveTokenPermissions(session, { tokenId, consultaIds }) {
      db.transaction(() => {
        db.prepare('DELETE FROM GW_TOKEN_PERMISSAO_CONSULTA WHERE TOKEN_ID = ?').run(tokenId);
        const ins = db.prepare('INSERT OR IGNORE INTO GW_TOKEN_PERMISSAO_CONSULTA (TOKEN_ID, CONSULTA_ID) VALUES (?, ?)');
        for (const id of consultaIds || []) ins.run(tokenId, Number(id));
      })();
      logger.audit({ ...who(session), acao: 'TOKEN_PERMISSOES_CONSULTAS', entidade: 'TOKEN', entidadeId: tokenId });
      return { ok: true };
    }
  };
}

module.exports = { createConsultasAdmin, MAX_TEST_ROWS };
