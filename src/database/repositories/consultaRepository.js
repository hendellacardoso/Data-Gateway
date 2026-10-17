'use strict';

const { GatewayError } = require('../../server/errors');
const { analyze, RESERVED_PARAMS, PARAM_RE } = require('../../server/services/sqlConsulta');
const { parseInput } = require('../../server/services/valueCodec');

const SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,62}$/;
const PARAM_TYPES = ['TEXTO', 'INTEIRO', 'NUMERO', 'DECIMAL', 'BOOLEANO', 'DATA', 'DATAHORA'];
const b = (v) => (v ? 1 : 0);

class ConsultaRepository {
  constructor(db) {
    this.db = db;
  }

  bancoTipo(bancoId) {
    const r = this.db.prepare('SELECT TIPO FROM GW_BANCO WHERE ID = ?').get(bancoId);
    if (!r) throw new GatewayError('VALIDATION_ERROR', 'Selecione o banco de dados.');
    return r.TIPO;
  }

  list() {
    return this.db.prepare(`
      SELECT c.ID AS id, c.NOME AS nome, c.SLUG AS slug, c.DESCRICAO AS descricao, c.ATIVO AS ativo, c.PUBLICADO AS publicado,
             c.ATUALIZADO_EM AS atualizadoEm, b.ID AS bancoId, b.NOME AS banco, b.TIPO AS bancoTipo,
             (SELECT COUNT(*) FROM GW_CONSULTA_PARAMETRO p WHERE p.CONSULTA_ID = c.ID) AS totalParametros,
             (SELECT COUNT(*) FROM GW_TOKEN_PERMISSAO_CONSULTA t WHERE t.CONSULTA_ID = c.ID) AS totalTokens,
             (SELECT GROUP_CONCAT(NOME, ', ') FROM GW_CONSULTA_PARAMETRO p WHERE p.CONSULTA_ID = c.ID) AS parametros
      FROM GW_CONSULTA c JOIN GW_BANCO b ON b.ID = c.BANCO_ID
      ORDER BY c.NOME`).all().map((r) => ({ ...r, ativo: !!r.ativo, publicado: !!r.publicado }));
  }

  get(id) {
    const c = this.db.prepare('SELECT * FROM GW_CONSULTA WHERE ID = ?').get(id);
    if (!c) throw new GatewayError('NOT_FOUND', 'Consulta não encontrada.');
    let modelo = null;
    try { modelo = c.MODELO_VISUAL ? JSON.parse(c.MODELO_VISUAL) : null; } catch { modelo = null; }
    return {
      id: c.ID,
      bancoId: c.BANCO_ID,
      nome: c.NOME,
      slug: c.SLUG,
      descricao: c.DESCRICAO || '',
      sql: c.SQL_TEXTO,
      modeloVisual: modelo,
      ativo: !!c.ATIVO,
      publicado: !!c.PUBLICADO,
      paginacao: { padrao: c.PAGE_SIZE_PADRAO, max: c.PAGE_SIZE_MAX },
      calcularTotal: !!c.CALCULAR_TOTAL,
      parametros: this.db.prepare('SELECT * FROM GW_CONSULTA_PARAMETRO WHERE CONSULTA_ID = ? ORDER BY ORDEM, ID').all(id).map((p) => ({
        nome: p.NOME, tipo: p.TIPO_LOGICO, obrigatorio: !!p.OBRIGATORIO, padrao: p.VALOR_PADRAO ?? '', descricao: p.DESCRICAO || ''
      })),
      permissoes: this.db.prepare('SELECT TOKEN_ID FROM GW_TOKEN_PERMISSAO_CONSULTA WHERE CONSULTA_ID = ?').all(id).map((r) => r.TOKEN_ID)
    };
  }

  /** Valida e normaliza os parâmetros de acordo com os :nomes encontrados no SQL. */
  normalizeParams(names, defs, dbType) {
    const byName = new Map((defs || []).map((p) => [p.nome, p]));
    const errors = [];
    const out = names.map((nome, i) => {
      const d = byName.get(nome) || {};
      const tipo = PARAM_TYPES.includes(d.tipo) ? d.tipo : 'TEXTO';
      const padrao = d.padrao === undefined || d.padrao === null ? '' : String(d.padrao);
      if (padrao !== '') {
        try { parseInput({ api: nome, tipo }, padrao, dbType); } catch (e) { errors.push(`Valor padrão de ${nome}: ${e.message}`); }
      }
      return { nome, tipo, obrigatorio: !!d.obrigatorio, padrao, descricao: d.descricao || '', ordem: i };
    });
    return { params: out, errors };
  }

  validate(p) {
    const errors = [];
    if (!p.nome || !String(p.nome).trim()) errors.push('Informe o nome da consulta.');
    if (!SLUG_RE.test(p.slug || '')) errors.push('Endereço inválido: use letras minúsculas, números, "-" ou "_".');
    const dup = this.db.prepare('SELECT ID FROM GW_CONSULTA WHERE SLUG = ? AND ID <> ?').get(p.slug || '', p.id || 0);
    if (dup) errors.push(`Já existe uma consulta "${p.slug}".`);
    const dbType = this.bancoTipo(p.bancoId);
    const a = analyze(p.sql, dbType);
    errors.push(...a.errors);
    const { params, errors: pe } = this.normalizeParams(a.params, p.parametros, dbType);
    errors.push(...pe);
    for (const n of a.params) if (RESERVED_PARAMS.has(n) || !PARAM_RE.test(n)) errors.push(`Parâmetro inválido: ${n}.`);
    const pg = p.paginacao || {};
    if (!(pg.padrao >= 1 && pg.max >= pg.padrao && pg.max <= 10000)) errors.push('Paginação inválida (padrão ≥ 1, máximo entre padrão e 10000).');
    if (errors.length) throw new GatewayError('VALIDATION_ERROR', errors[0], { details: [...new Set(errors)] });
    return params;
  }

  save(p) {
    const params = this.validate(p);
    const db = this.db;
    return db.transaction(() => {
      const vals = [
        p.bancoId, String(p.nome).trim(), p.slug, p.descricao || null, String(p.sql),
        p.modeloVisual ? JSON.stringify(p.modeloVisual) : null, b(p.ativo !== false), b(p.publicar ?? p.publicado),
        p.paginacao.padrao, p.paginacao.max, b(p.calcularTotal !== false)
      ];
      let id = p.id;
      if (id) {
        const r = db.prepare(`UPDATE GW_CONSULTA SET BANCO_ID=?, NOME=?, SLUG=?, DESCRICAO=?, SQL_TEXTO=?, MODELO_VISUAL=?, ATIVO=?, PUBLICADO=?,
          PAGE_SIZE_PADRAO=?, PAGE_SIZE_MAX=?, CALCULAR_TOTAL=?, ATUALIZADO_EM=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE ID=?`).run(...vals, id);
        if (!r.changes) throw new GatewayError('NOT_FOUND', 'Consulta não encontrada.');
      } else {
        id = Number(db.prepare(`INSERT INTO GW_CONSULTA (BANCO_ID, NOME, SLUG, DESCRICAO, SQL_TEXTO, MODELO_VISUAL, ATIVO, PUBLICADO,
          PAGE_SIZE_PADRAO, PAGE_SIZE_MAX, CALCULAR_TOTAL) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(...vals).lastInsertRowid);
      }
      db.prepare('DELETE FROM GW_CONSULTA_PARAMETRO WHERE CONSULTA_ID = ?').run(id);
      const ins = db.prepare('INSERT INTO GW_CONSULTA_PARAMETRO (CONSULTA_ID, NOME, TIPO_LOGICO, OBRIGATORIO, VALOR_PADRAO, DESCRICAO, ORDEM) VALUES (?,?,?,?,?,?,?)');
      for (const x of params) ins.run(id, x.nome, x.tipo, b(x.obrigatorio), x.padrao === '' ? null : x.padrao, x.descricao || null, x.ordem);
      if (Array.isArray(p.permissoes)) {
        db.prepare('DELETE FROM GW_TOKEN_PERMISSAO_CONSULTA WHERE CONSULTA_ID = ?').run(id);
        const insP = db.prepare('INSERT OR IGNORE INTO GW_TOKEN_PERMISSAO_CONSULTA (TOKEN_ID, CONSULTA_ID) VALUES (?, ?)');
        for (const t of p.permissoes) if (t) insP.run(Number(t), id);
      }
      return { id, parametros: params };
    })();
  }

  setPublished(id, publicado) {
    const r = this.db.prepare(`UPDATE GW_CONSULTA SET PUBLICADO=?, ATUALIZADO_EM=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE ID=?`).run(b(publicado), id);
    if (!r.changes) throw new GatewayError('NOT_FOUND', 'Consulta não encontrada.');
  }

  delete(id) {
    this.db.prepare('DELETE FROM GW_CONSULTA WHERE ID = ?').run(id);
  }

  /** Configuração de execução usada pela API. */
  loadRuntime(slug) {
    const c = this.db.prepare(`SELECT c.*, b.NOME AS BANCO_NOME, b.TIPO AS BANCO_TIPO, b.ATIVO AS BANCO_ATIVO
      FROM GW_CONSULTA c JOIN GW_BANCO b ON b.ID = c.BANCO_ID WHERE c.SLUG = ?`).get(slug);
    if (!c) return null;
    return {
      id: c.ID,
      slug: c.SLUG,
      nome: c.NOME,
      descricao: c.DESCRICAO,
      sql: c.SQL_TEXTO,
      ativo: !!c.ATIVO && !!c.BANCO_ATIVO,
      publicado: !!c.PUBLICADO,
      paginacao: { padrao: c.PAGE_SIZE_PADRAO, max: c.PAGE_SIZE_MAX },
      calcularTotal: !!c.CALCULAR_TOTAL,
      banco: { id: c.BANCO_ID, nome: c.BANCO_NOME, tipo: c.BANCO_TIPO },
      parametros: this.db.prepare('SELECT * FROM GW_CONSULTA_PARAMETRO WHERE CONSULTA_ID = ? ORDER BY ORDEM, ID').all(c.ID).map((p) => ({
        nome: p.NOME, tipo: p.TIPO_LOGICO, obrigatorio: !!p.OBRIGATORIO, padrao: p.VALOR_PADRAO, descricao: p.DESCRICAO
      }))
    };
  }

  listPublishedSlugs() {
    return this.db.prepare('SELECT SLUG FROM GW_CONSULTA WHERE PUBLICADO = 1 AND ATIVO = 1 ORDER BY SLUG').all().map((r) => r.SLUG);
  }
}

module.exports = { ConsultaRepository, PARAM_TYPES };
