'use strict';

const { GatewayError } = require('../errors');
const { generateApiToken } = require('../security/hashing');
const { OPERATORS } = require('../query-builder/builder');

/** Endpoints, tokens, permissões e relacionamentos. */
function createApiAdmin(ctx) {
  const { db, logger, endpoints } = ctx;
  const who = (s) => ({ usuarioId: s.userId, usuario: s.usuario });

  function routesOf(cfg) {
    const base = `/api/v1/${cfg.slug}`;
    const r = [];
    if (cfg.ops.listar) r.push({ method: 'GET', path: base });
    if (cfg.ops.buscar) r.push({ method: 'GET', path: `${base}/:id` });
    if (cfg.ops.incluir) r.push({ method: 'POST', path: base });
    if (cfg.ops.alterar) r.push({ method: 'PUT', path: `${base}/:id` });
    if (cfg.ops.patch) r.push({ method: 'PATCH', path: `${base}/:id` });
    if (cfg.ops.excluir) r.push({ method: 'DELETE', path: `${base}/:id` });
    if (cfg.upload && cfg.upload.ativo) {
      r.push({ method: 'POST', path: `${base}/:id/arquivos` });
      r.push({ method: 'GET', path: `${base}/:id/arquivos` });
    }
    return r;
  }

  return {
    operators() {
      return Object.entries(OPERATORS).map(([value, o]) => ({ value, label: o.label }));
    },

    // ---------------- Endpoints ----------------
    listEndpoints() {
      return endpoints.listSummary().map((e) => ({
        ...e,
        ativo: !!e.ativo, publicado: !!e.publicado,
        routes: routesOf({ slug: e.slug, ops: e, upload: { ativo: e.upload } })
      }));
    },

    getEndpoint({ id }) {
      return endpoints.getFull(id);
    },

    preview(cfg) {
      return { routes: routesOf(cfg) };
    },

    saveEndpoint(session, payload) {
      const isNew = !payload.endpointId;
      const r = endpoints.saveFull(payload);
      ctx.invalidate();
      logger.audit({ ...who(session), acao: isNew ? 'ENDPOINT_CRIADO' : 'ENDPOINT_ALTERADO', entidade: 'ENDPOINT', entidadeId: r.endpointId,
        detalhes: { slug: payload.slug, tabela: payload.tabela, publicado: !!payload.publicar } });
      if (payload.publicar) logger.audit({ ...who(session), acao: 'ENDPOINT_PUBLICADO', entidade: 'ENDPOINT', entidadeId: r.endpointId, detalhes: { slug: payload.slug } });
      return { ...r, routes: routesOf(payload) };
    },

    setPublished(session, { id, publicado }) {
      endpoints.setPublished(id, publicado);
      ctx.invalidate();
      logger.audit({ ...who(session), acao: publicado ? 'ENDPOINT_PUBLICADO' : 'ENDPOINT_DESPUBLICADO', entidade: 'ENDPOINT', entidadeId: id });
      return { ok: true };
    },

    deleteEndpoint(session, { id }) {
      const e = db.prepare('SELECT SLUG FROM GW_ENDPOINT WHERE ID = ?').get(id);
      endpoints.delete(id);
      ctx.invalidate();
      logger.audit({ ...who(session), acao: 'ENDPOINT_EXCLUIDO', entidade: 'ENDPOINT', entidadeId: id, detalhes: { slug: e && e.SLUG } });
      return { ok: true };
    },

    // ---------------- Tokens ----------------
    listTokens() {
      return db.prepare(`SELECT t.ID AS id, t.NOME AS nome, t.DESCRICAO AS descricao, t.PREFIXO AS prefixo, t.EXPIRA_EM AS expiraEm,
          t.ATIVO AS ativo, t.REVOGADO_EM AS revogadoEm, t.ULTIMO_USO AS ultimoUso, t.CRIADO_EM AS criadoEm,
          (SELECT COUNT(*) FROM GW_TOKEN_PERMISSAO p WHERE p.TOKEN_ID = t.ID) AS endpoints
        FROM GW_TOKEN t ORDER BY t.REVOGADO_EM IS NOT NULL, t.NOME`).all().map((t) => ({
        ...t,
        ativo: !!t.ativo,
        expirado: !!(t.expiraEm && Date.parse(t.expiraEm) < Date.now()),
        status: t.revogadoEm ? 'REVOGADO' : !t.ativo ? 'INATIVO' : (t.expiraEm && Date.parse(t.expiraEm) < Date.now()) ? 'EXPIRADO' : 'ATIVO'
      }));
    },

    createToken(session, { nome, descricao, expiraEm, ativo, permissoes }) {
      if (!nome || !String(nome).trim()) throw new GatewayError('VALIDATION_ERROR', 'Informe o nome do token.');
      if (expiraEm && Number.isNaN(Date.parse(expiraEm))) throw new GatewayError('VALIDATION_ERROR', 'Data de expiração inválida.');
      if (expiraEm && Date.parse(expiraEm) < Date.now()) throw new GatewayError('VALIDATION_ERROR', 'A expiração deve ser uma data futura.');
      const t = generateApiToken();
      const id = Number(db.prepare('INSERT INTO GW_TOKEN (NOME, DESCRICAO, TOKEN_HASH, PREFIXO, EXPIRA_EM, ATIVO) VALUES (?,?,?,?,?,?)')
        .run(String(nome).trim(), descricao || null, t.hash, t.prefix, expiraEm ? new Date(expiraEm).toISOString() : null, ativo === false ? 0 : 1).lastInsertRowid);
      if (Array.isArray(permissoes)) this.savePermissions(session, { tokenId: id, permissoes }, true);
      logger.audit({ ...who(session), acao: 'TOKEN_CRIADO', entidade: 'TOKEN', entidadeId: id, detalhes: { nome, prefixo: t.prefix } });
      // O valor em claro é retornado somente aqui — apenas o hash fica armazenado.
      return { id, token: t.plain, prefixo: t.prefix };
    },

    updateToken(session, { id, nome, descricao, expiraEm, ativo }) {
      const row = db.prepare('SELECT * FROM GW_TOKEN WHERE ID = ?').get(id);
      if (!row) throw new GatewayError('NOT_FOUND', 'Token não encontrado.');
      if (row.REVOGADO_EM) throw new GatewayError('VALIDATION_ERROR', 'Token revogado não pode ser alterado.');
      if (expiraEm && Number.isNaN(Date.parse(expiraEm))) throw new GatewayError('VALIDATION_ERROR', 'Data de expiração inválida.');
      db.prepare(`UPDATE GW_TOKEN SET NOME=?, DESCRICAO=?, EXPIRA_EM=?, ATIVO=?, ATUALIZADO_EM=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE ID=?`)
        .run(String(nome || row.NOME).trim(), descricao ?? row.DESCRICAO, expiraEm ? new Date(expiraEm).toISOString() : null, ativo === false ? 0 : 1, id);
      logger.audit({ ...who(session), acao: 'TOKEN_ALTERADO', entidade: 'TOKEN', entidadeId: id, detalhes: { ativo: ativo !== false } });
      return { ok: true };
    },

    revokeToken(session, { id }) {
      const r = db.prepare("UPDATE GW_TOKEN SET ATIVO = 0, REVOGADO_EM = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE ID = ? AND REVOGADO_EM IS NULL").run(id);
      if (!r.changes) throw new GatewayError('NOT_FOUND', 'Token não encontrado ou já revogado.');
      logger.audit({ ...who(session), acao: 'TOKEN_REVOGADO', entidade: 'TOKEN', entidadeId: id });
      return { ok: true };
    },

    deleteToken(session, { id }) {
      db.prepare('DELETE FROM GW_TOKEN WHERE ID = ?').run(id);
      logger.audit({ ...who(session), acao: 'TOKEN_EXCLUIDO', entidade: 'TOKEN', entidadeId: id });
      return { ok: true };
    },

    /** Matriz de permissões do token: uma linha por endpoint. */
    getPermissions({ tokenId }) {
      return db.prepare(`SELECT e.ID AS endpointId, e.SLUG AS slug, e.DESCRICAO AS descricao, e.PUBLICADO AS publicado,
          e.PERMITE_LISTAR AS opListar, e.PERMITE_BUSCAR AS opBuscar, e.PERMITE_INCLUIR AS opIncluir,
          (e.PERMITE_ALTERAR OR e.PERMITE_PATCH) AS opAlterar, e.PERMITE_EXCLUIR AS opExcluir, e.UPLOAD_ATIVO AS opUpload,
          COALESCE(p.LISTAR,0) AS listar, COALESCE(p.BUSCAR,0) AS buscar, COALESCE(p.INCLUIR,0) AS incluir,
          COALESCE(p.ALTERAR,0) AS alterar, COALESCE(p.EXCLUIR,0) AS excluir, COALESCE(p.UPLOAD,0) AS upload
        FROM GW_ENDPOINT e LEFT JOIN GW_TOKEN_PERMISSAO p ON p.ENDPOINT_ID = e.ID AND p.TOKEN_ID = ?
        ORDER BY e.SLUG`).all(tokenId).map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'number' && k !== 'endpointId' ? !!v : v])));
    },

    savePermissions(session, { tokenId, permissoes }, silent) {
      const b = (v) => (v ? 1 : 0);
      db.transaction(() => {
        db.prepare('DELETE FROM GW_TOKEN_PERMISSAO WHERE TOKEN_ID = ?').run(tokenId);
        const ins = db.prepare('INSERT INTO GW_TOKEN_PERMISSAO (TOKEN_ID, ENDPOINT_ID, LISTAR, BUSCAR, INCLUIR, ALTERAR, EXCLUIR, UPLOAD) VALUES (?,?,?,?,?,?,?,?)');
        for (const p of permissoes || []) {
          if (![p.listar, p.buscar, p.incluir, p.alterar, p.excluir, p.upload].some(Boolean)) continue;
          ins.run(tokenId, p.endpointId, b(p.listar), b(p.buscar), b(p.incluir), b(p.alterar), b(p.excluir), b(p.upload));
        }
      })();
      if (!silent) logger.audit({ ...who(session), acao: 'TOKEN_PERMISSOES', entidade: 'TOKEN', entidadeId: tokenId });
      return { ok: true };
    },

    // ---------------- Relacionamentos ----------------
    listRelationships() {
      return db.prepare(`SELECT r.ID AS id, r.NOME AS nome, r.CARDINALIDADE AS cardinalidade, r.ATIVO AS ativo,
          r.TABELA_ORIGEM_ID AS tabelaOrigemId, tor.NOME AS tabelaOrigem, co.NOME AS campoOrigem, r.CAMPO_ORIGEM_ID AS campoOrigemId,
          r.TABELA_DESTINO_ID AS tabelaDestinoId, tde.NOME AS tabelaDestino, cd.NOME AS campoDestino, r.CAMPO_DESTINO_ID AS campoDestinoId,
          (SELECT SLUG FROM GW_ENDPOINT WHERE TABELA_ID = r.TABELA_ORIGEM_ID LIMIT 1) AS slugOrigem,
          (SELECT SLUG FROM GW_ENDPOINT WHERE TABELA_ID = r.TABELA_DESTINO_ID LIMIT 1) AS slugDestino
        FROM GW_RELACIONAMENTO r
        JOIN GW_TABELA tor ON tor.ID = r.TABELA_ORIGEM_ID JOIN GW_TABELA tde ON tde.ID = r.TABELA_DESTINO_ID
        JOIN GW_CAMPO co ON co.ID = r.CAMPO_ORIGEM_ID JOIN GW_CAMPO cd ON cd.ID = r.CAMPO_DESTINO_ID
        ORDER BY tor.NOME, r.NOME`).all().map((r) => ({ ...r, ativo: !!r.ativo }));
    },

    /** Tabelas configuradas e seus campos (para os selects da tela de relacionamentos). */
    configuredTables() {
      const tabelas = db.prepare(`SELECT t.ID AS id, t.NOME AS nome, t.ESQUEMA AS esquema, b.NOME AS banco, t.BANCO_ID AS bancoId,
          (SELECT SLUG FROM GW_ENDPOINT WHERE TABELA_ID = t.ID LIMIT 1) AS slug
        FROM GW_TABELA t JOIN GW_BANCO b ON b.ID = t.BANCO_ID ORDER BY b.NOME, t.NOME`).all();
      const campos = db.prepare('SELECT ID AS id, TABELA_ID AS tabelaId, NOME AS nome, NOME_API AS nomeApi FROM GW_CAMPO ORDER BY ORDEM').all();
      return tabelas.map((t) => ({ ...t, campos: campos.filter((c) => c.tabelaId === t.id) }));
    },

    saveRelationship(session, r) {
      if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(r.nome || '')) throw new GatewayError('VALIDATION_ERROR', 'Nome do relacionamento inválido (use letras, números e "_").');
      const co = db.prepare('SELECT * FROM GW_CAMPO WHERE ID = ?').get(r.campoOrigemId);
      const cd = db.prepare('SELECT * FROM GW_CAMPO WHERE ID = ?').get(r.campoDestinoId);
      if (!co || co.TABELA_ID !== Number(r.tabelaOrigemId)) throw new GatewayError('VALIDATION_ERROR', 'Campo de origem inválido.');
      if (!cd || cd.TABELA_ID !== Number(r.tabelaDestinoId)) throw new GatewayError('VALIDATION_ERROR', 'Campo de destino inválido.');
      const to = db.prepare('SELECT BANCO_ID FROM GW_TABELA WHERE ID = ?').get(r.tabelaOrigemId);
      const td = db.prepare('SELECT BANCO_ID FROM GW_TABELA WHERE ID = ?').get(r.tabelaDestinoId);
      if (!to || !td || to.BANCO_ID !== td.BANCO_ID) throw new GatewayError('VALIDATION_ERROR', 'As tabelas do relacionamento devem estar no mesmo banco.');
      const clash = db.prepare('SELECT 1 FROM GW_CAMPO WHERE TABELA_ID = ? AND LOWER(NOME_API) = LOWER(?)').get(r.tabelaOrigemId, r.nome);
      if (clash) throw new GatewayError('VALIDATION_ERROR', 'O nome do relacionamento conflita com um campo da tabela de origem.');
      const card = r.cardinalidade === 'UM' ? 'UM' : 'MUITOS';
      let id = r.id;
      try {
        if (id) {
          db.prepare(`UPDATE GW_RELACIONAMENTO SET NOME=?, TABELA_ORIGEM_ID=?, CAMPO_ORIGEM_ID=?, TABELA_DESTINO_ID=?, CAMPO_DESTINO_ID=?, CARDINALIDADE=?, ATIVO=? WHERE ID=?`)
            .run(r.nome, r.tabelaOrigemId, r.campoOrigemId, r.tabelaDestinoId, r.campoDestinoId, card, r.ativo === false ? 0 : 1, id);
        } else {
          id = Number(db.prepare(`INSERT INTO GW_RELACIONAMENTO (NOME, TABELA_ORIGEM_ID, CAMPO_ORIGEM_ID, TABELA_DESTINO_ID, CAMPO_DESTINO_ID, CARDINALIDADE, ATIVO) VALUES (?,?,?,?,?,?,?)`)
            .run(r.nome, r.tabelaOrigemId, r.campoOrigemId, r.tabelaDestinoId, r.campoDestinoId, card, r.ativo === false ? 0 : 1).lastInsertRowid);
        }
      } catch (err) {
        if (/UNIQUE/.test(err.message)) throw new GatewayError('VALIDATION_ERROR', 'Já existe um relacionamento com este nome na tabela de origem.');
        throw err;
      }
      ctx.invalidate();
      logger.audit({ ...who(session), acao: r.id ? 'RELACIONAMENTO_ALTERADO' : 'RELACIONAMENTO_CRIADO', entidade: 'RELACIONAMENTO', entidadeId: id, detalhes: { nome: r.nome } });
      return { id };
    },

    deleteRelationship(session, { id }) {
      db.prepare('DELETE FROM GW_RELACIONAMENTO WHERE ID = ?').run(id);
      ctx.invalidate();
      logger.audit({ ...who(session), acao: 'RELACIONAMENTO_EXCLUIDO', entidade: 'RELACIONAMENTO', entidadeId: id });
      return { ok: true };
    },

    // ---------------- Arquivos ----------------
    listFiles({ page = 1, pageSize = 50 } = {}) {
      const total = db.prepare('SELECT COUNT(*) AS n FROM GW_ARQUIVO').get().n;
      const rows = db.prepare(`SELECT a.ID AS id, e.SLUG AS endpoint, a.REGISTRO_ID AS registroId, a.NOME_ORIGINAL AS nome,
          a.NOME_ARMAZENADO AS armazenadoComo, a.CAMINHO AS caminho, a.MIME AS mime, a.TAMANHO AS tamanho,
          CASE WHEN a.CONTEUDO IS NULL THEN 'FS' ELSE 'DB' END AS armazenamento, a.CRIADO_EM AS criadoEm
        FROM GW_ARQUIVO a JOIN GW_ENDPOINT e ON e.ID = a.ENDPOINT_ID ORDER BY a.ID DESC LIMIT ? OFFSET ?`).all(pageSize, (page - 1) * pageSize);
      return { rows, total };
    }
  };
}

module.exports = { createApiAdmin };
