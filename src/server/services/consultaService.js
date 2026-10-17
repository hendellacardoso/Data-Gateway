'use strict';

const { GatewayError } = require('../errors');
const { analyze, build, normalizeRows } = require('./sqlConsulta');
const { parseInput } = require('./valueCodec');
const { mapDbError } = require('./crudService');

/** Execução de consultas SQL personalizadas (API e teste no painel). */
class ConsultaService {
  constructor({ connections }) {
    this.connections = connections;
  }

  /**
   * Converte os valores recebidos (query string ou teste) para os tipos dos parâmetros.
   * @param {object} c runtime da consulta ({parametros, banco})
   * @param {object} raw mapa nome → texto
   * @param {boolean} strict rejeita parâmetros desconhecidos (API)
   */
  resolveValues(c, raw, strict) {
    const errors = [];
    const values = {};
    const allowed = new Set(['page', 'pageSize', ...c.parametros.map((p) => p.nome)]);
    if (strict) {
      const unknown = Object.keys(raw).filter((k) => !allowed.has(k));
      if (unknown.length) {
        throw new GatewayError('VALIDATION_ERROR', `Parâmetro não permitido: ${unknown[0]}.`, {
          details: [`Parâmetros aceitos: ${[...allowed].join(', ')}`]
        });
      }
    }
    for (const p of c.parametros) {
      let v = raw[p.nome];
      if (Array.isArray(v)) { errors.push(`Parâmetro ${p.nome} informado mais de uma vez.`); continue; }
      if (v === undefined || v === '') v = p.padrao === null || p.padrao === undefined || p.padrao === '' ? undefined : p.padrao;
      if (v === undefined) {
        if (p.obrigatorio) errors.push(`O parâmetro ${p.nome} é obrigatório.`);
        values[p.nome] = null;
        continue;
      }
      try {
        values[p.nome] = parseInput({ api: p.nome, tipo: p.tipo }, v, c.banco.tipo);
      } catch (e) {
        errors.push(e.message);
      }
    }
    if (errors.length) throw new GatewayError('VALIDATION_ERROR', errors[0], { details: errors });
    return values;
  }

  parsePage(c, raw) {
    const errors = [];
    let page = 1;
    let pageSize = c.paginacao.padrao;
    if (raw.page !== undefined) {
      page = Number(raw.page);
      if (!Number.isInteger(page) || page < 1) errors.push('page deve ser um inteiro maior ou igual a 1.');
    }
    if (raw.pageSize !== undefined) {
      pageSize = Number(raw.pageSize);
      if (!Number.isInteger(pageSize) || pageSize < 1) errors.push('pageSize deve ser um inteiro maior ou igual a 1.');
      else if (pageSize > c.paginacao.max) errors.push(`pageSize máximo permitido: ${c.paginacao.max}.`);
    }
    if (errors.length) throw new GatewayError('VALIDATION_ERROR', errors[0], { details: errors });
    return { page, pageSize };
  }

  /**
   * Executa a consulta paginada.
   * @param {object} c runtime ({sql, banco, calcularTotal})
   * @param {object} values valores dos parâmetros
   * @param {{page, pageSize}} pg
   * @param {{rawErrors?: boolean}} opts rawErrors=true devolve a mensagem real do banco (somente painel)
   */
  async execute(c, values, pg, opts = {}) {
    const a = analyze(c.sql, c.banco.tipo);
    if (a.errors.length) throw new GatewayError('VALIDATION_ERROR', a.errors[0], { details: a.errors });
    const drv = await this.connections.getDriver(c.banco.id);
    // Busca uma linha a mais para saber se existe próxima página
    const types = Object.fromEntries(c.parametros.map((p) => [p.nome, p.tipo]));
    const q = build(a, c.banco.tipo, values, { offset: (pg.page - 1) * pg.pageSize, limit: pg.pageSize + 1 }, types);
    const t0 = Date.now();
    try {
      const r = await drv.queryReadOnly(q.sql, q.params);
      const hasMore = r.rows.length > pg.pageSize;
      const rows = normalizeRows(hasMore ? r.rows.slice(0, pg.pageSize) : r.rows);
      let total = null;
      if (c.calcularTotal && q.countSql) {
        const cr = await drv.queryReadOnly(q.countSql, q.countParams);
        const row = cr.rows[0] || {};
        total = Number(row.total ?? row.TOTAL ?? Object.values(row)[0] ?? 0);
      }
      return {
        data: rows,
        columns: r.columns && r.columns.length ? r.columns : Object.keys(rows[0] || {}),
        pagination: {
          page: pg.page,
          pageSize: pg.pageSize,
          total,
          totalPages: total === null ? null : Math.ceil(total / pg.pageSize),
          hasMore
        },
        elapsedMs: Date.now() - t0,
        sqlExecutado: opts.rawErrors ? q.sql : undefined
      };
    } catch (err) {
      if (opts.rawErrors && !(err instanceof GatewayError)) {
        throw new GatewayError('DATABASE_ERROR', 'Erro ao executar a consulta: ' + (err.message || err), { cause: err, details: [String(err.message || err)] });
      }
      throw mapDbError(err, this.connections, c.banco.id);
    }
  }
}

module.exports = { ConsultaService };
