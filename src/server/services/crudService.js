'use strict';

const { GatewayError } = require('../errors');
const { parseInput, formatOutput, parseFilterValue } = require('./valueCodec');

const BASE_PARAMS = new Set(['page', 'pageSize', 'sort', 'direction', 'expand']);
const MAX_EXPAND_ROWS = 1000;

/** Traduz erros de driver em erros padronizados, sem expor detalhes internos. */
function mapDbError(err, connections, bancoId) {
  if (err instanceof GatewayError) return err;
  const code = String(err.code || '');
  const num = Number(err.number || err.errno || 0);
  const msg = String(err.message || '');
  // Firebird: códigos GDS (isc_*)
  const gds = Number(err.gdscode || 0);
  if (gds) {
    if ([335544721, 335544726, 335544648, 335544741, 335544856].includes(gds)) {
      if (connections) connections.invalidate(bancoId);
      return new GatewayError('CONNECTION_ERROR', 'Falha de comunicação com o banco de dados.', { cause: err });
    }
    if (gds === 335544665 || gds === 335544349) {
      return new GatewayError('CONFLICT', 'Registro duplicado: já existe um registro com estes valores únicos.', { cause: err });
    }
    if (gds === 335544466 || gds === 335544838 || gds === 335544839) {
      return new GatewayError('CONFLICT', 'Operação viola um relacionamento (chave estrangeira) do banco.', { cause: err });
    }
    if (gds === 335544347) {
      return new GatewayError('VALIDATION_ERROR', 'Um campo obrigatório do banco não foi informado.', { cause: err });
    }
    if (gds === 335544794) {
      return new GatewayError('DATABASE_ERROR', 'Tempo limite da consulta excedido.', { cause: err });
    }
  }
  if (/^(ECONNREFUSED|ETIMEOUT|ESOCKET|ECONNRESET|ENOTFOUND|ECONNCLOSED|ELOGIN|PROTOCOL_CONNECTION_LOST)$/.test(code) ||
      /Connection is closed|connection terminated/i.test(msg)) {
    if (connections) connections.invalidate(bancoId);
    return new GatewayError('CONNECTION_ERROR', 'Falha de comunicação com o banco de dados.', { cause: err });
  }
  if (code === '23505' || num === 2627 || num === 2601 || num === 1062 || code === 'SQLITE_CONSTRAINT_UNIQUE' || code === 'SQLITE_CONSTRAINT_PRIMARYKEY') {
    return new GatewayError('CONFLICT', 'Registro duplicado: já existe um registro com estes valores únicos.', { cause: err });
  }
  if (code === '23503' || num === 547 || num === 1451 || num === 1452 || code === 'SQLITE_CONSTRAINT_FOREIGNKEY') {
    return new GatewayError('CONFLICT', 'Operação viola um relacionamento (chave estrangeira) do banco.', { cause: err });
  }
  if (code === '23502' || num === 515 || num === 1048 || code === 'SQLITE_CONSTRAINT_NOTNULL') {
    return new GatewayError('VALIDATION_ERROR', 'Um campo obrigatório do banco não foi informado.', { cause: err });
  }
  if (code === 'ETIMEOUT' || /timeout/i.test(msg)) {
    return new GatewayError('DATABASE_ERROR', 'Tempo limite da consulta excedido.', { cause: err });
  }
  return new GatewayError('DATABASE_ERROR', 'Erro ao executar operação no banco de dados.', { cause: err });
}

class CrudService {
  /**
   * @param {{connections, metadata, permissions}} deps
   */
  constructor({ connections, metadata, permissions }) {
    this.connections = connections;
    this.metadata = metadata;
    this.permissions = permissions;
  }

  async _run(ep, fn) {
    const drv = await this.connections.getDriver(ep.banco.id);
    try {
      return await fn(drv);
    } catch (err) {
      throw mapDbError(err, this.connections, ep.banco.id);
    }
  }

  serialize(ep, row) {
    const out = {};
    for (const c of ep.campos) if (c.retornar) out[c.api] = formatOutput(c, row[c.column]);
    return out;
  }

  returnColumns(ep, extra = []) {
    const cols = new Set(ep.campos.filter((c) => c.retornar).map((c) => c.column));
    for (const x of extra) if (x) cols.add(x);
    return [...cols];
  }

  softDeleteFilter(ep) {
    const ex = ep.exclusao;
    if (ex.modo !== 'LOGICA' || !ex.campo) return [];
    if (ex.valorAtivo !== null && ex.valorAtivo !== undefined && ex.valorAtivo !== '') {
      return [{ column: ex.campo.column, operator: 'eq', value: parseInput(ex.campo, ex.valorAtivo, ep.banco.tipo) }];
    }
    return [{ column: ex.campo.column, operator: 'neq', value: parseInput(ex.campo, ex.valorExcluido, ep.banco.tipo) }];
  }

  parseId(ep, raw) {
    if (!ep.pk) throw new GatewayError('NOT_FOUND', 'Recurso sem chave primária configurada.');
    try {
      return parseInput(ep.pk, raw, ep.banco.tipo);
    } catch {
      throw new GatewayError('VALIDATION_ERROR', `Identificador inválido para ${ep.pk.api}.`);
    }
  }

  parsePagination(ep, query) {
    const errors = [];
    let page = 1;
    let pageSize = ep.paginacao.padrao;
    if (query.page !== undefined) {
      page = Number(query.page);
      if (!Number.isInteger(page) || page < 1) errors.push('page deve ser um inteiro maior ou igual a 1.');
    }
    if (query.pageSize !== undefined) {
      pageSize = Number(query.pageSize);
      if (!Number.isInteger(pageSize) || pageSize < 1) errors.push('pageSize deve ser um inteiro maior ou igual a 1.');
      else if (pageSize > ep.paginacao.max) errors.push(`pageSize máximo permitido: ${ep.paginacao.max}.`);
    }
    if (errors.length) throw new GatewayError('VALIDATION_ERROR', errors[0], { details: errors });
    return { page, pageSize };
  }

  parseSort(ep, query) {
    if (query.sort !== undefined) {
      const o = ep.ordens.find((x) => x.campo.api.toLowerCase() === String(query.sort).toLowerCase());
      if (!o) {
        throw new GatewayError('VALIDATION_ERROR', `Ordenação não permitida por "${query.sort}".`, {
          details: ep.ordens.map((x) => `Permitido: ${x.campo.api}`)
        });
      }
      const dir = String(query.direction || o.direcao || 'asc').toUpperCase();
      if (!['ASC', 'DESC'].includes(dir)) throw new GatewayError('VALIDATION_ERROR', 'direction deve ser asc ou desc.');
      return [{ column: o.campo.column, direction: dir }];
    }
    const def = ep.ordens.find((x) => x.padrao);
    if (def) return [{ column: def.campo.column, direction: def.direcao }];
    if (ep.pk) return [{ column: ep.pk.column, direction: 'ASC' }];
    return [];
  }

  parseFilters(ep, query) {
    const allowed = new Set([...BASE_PARAMS, ...ep.filtros.map((f) => f.param)]);
    const unknown = Object.keys(query).filter((k) => !allowed.has(k));
    if (unknown.length) {
      throw new GatewayError('VALIDATION_ERROR', `Parâmetro não permitido: ${unknown[0]}.`, {
        details: [`Parâmetros aceitos: ${[...allowed].join(', ')}`]
      });
    }
    const filters = [];
    const errors = [];
    for (const f of ep.filtros) {
      const raw = query[f.param];
      if (raw === undefined || raw === '') continue;
      if (Array.isArray(raw)) { errors.push(`Parâmetro ${f.param} informado mais de uma vez.`); continue; }
      try {
        filters.push({ column: f.campo.column, operator: f.operador, value: parseFilterValue(f.campo, raw, f.operador, ep.banco.tipo) });
      } catch (e) {
        errors.push(`Filtro ${f.param}: ${e.message}`);
      }
    }
    if (errors.length) throw new GatewayError('VALIDATION_ERROR', errors[0], { details: errors });
    return filters;
  }

  parseExpand(ep, query, token) {
    if (!query.expand) return [];
    const names = String(query.expand).split(',').map((s) => s.trim()).filter(Boolean);
    return names.map((n) => {
      const rel = ep.relacionamentos.find((r) => r.nome.toLowerCase() === n.toLowerCase());
      if (!rel) throw new GatewayError('VALIDATION_ERROR', `Relacionamento desconhecido: ${n}.`);
      const dest = rel.destinoSlug && this.metadata.get(rel.destinoSlug);
      if (!dest || !dest.publicado || !dest.ativo) throw new GatewayError('VALIDATION_ERROR', `Relacionamento ${n} indisponível (tabela relacionada não publicada).`);
      if (!this.permissions.can(token, dest.id, 'listar')) {
        throw new GatewayError('AUTHORIZATION_ERROR', `Token sem permissão de consulta em ${dest.slug} (relacionamento ${n}).`);
      }
      return { rel, dest };
    });
  }

  async attachExpansions(ep, rows, items, expansions) {
    for (const { rel, dest } of expansions) {
      const keys = [...new Set(rows.map((r) => r[rel.origemColumn]).filter((v) => v !== null && v !== undefined))];
      const grouped = new Map();
      if (keys.length) {
        const related = [];
        for (let i = 0; i < keys.length; i += 100) {
          const chunk = keys.slice(i, i + 100);
          const part = await this._run(dest, (drv) => drv.selectIn({
            table: dest.tabela,
            fields: this.returnColumns(dest, [rel.destinoColumn]),
            column: rel.destinoColumn,
            values: chunk,
            extraFilters: this.softDeleteFilter(dest),
            limit: MAX_EXPAND_ROWS
          }));
          related.push(...part);
        }
        for (const r of related) {
          const k = String(r[rel.destinoColumn]);
          if (!grouped.has(k)) grouped.set(k, []);
          grouped.get(k).push(this.serialize(dest, r));
        }
      }
      rows.forEach((row, i) => {
        const list = grouped.get(String(row[rel.origemColumn])) || [];
        items[i][rel.nome] = rel.cardinalidade === 'UM' ? list[0] || null : list;
      });
    }
  }

  async list(ep, query, token) {
    const pagination = this.parsePagination(ep, query);
    const filters = [...this.parseFilters(ep, query), ...this.softDeleteFilter(ep)];
    const orderBy = this.parseSort(ep, query);
    const expansions = this.parseExpand(ep, query, token);
    const extraCols = expansions.map((x) => x.rel.origemColumn);
    const { rows, total } = await this._run(ep, (drv) => drv.select({
      table: ep.tabela, fields: this.returnColumns(ep, extraCols), filters, orderBy, pagination
    }));
    const data = rows.map((r) => this.serialize(ep, r));
    if (expansions.length) await this.attachExpansions(ep, rows, data, expansions);
    return {
      data,
      pagination: { page: pagination.page, pageSize: pagination.pageSize, total, totalPages: Math.ceil(total / pagination.pageSize) }
    };
  }

  async fetchRow(ep, id, columns) {
    return this._run(ep, (drv) => drv.selectByKey({
      table: ep.tabela,
      fields: columns || this.returnColumns(ep),
      key: { column: ep.pk.column, value: id },
      extraFilters: this.softDeleteFilter(ep)
    }));
  }

  async get(ep, rawId, query, token) {
    const unknown = Object.keys(query).filter((k) => k !== 'expand');
    if (unknown.length) throw new GatewayError('VALIDATION_ERROR', `Parâmetro não permitido: ${unknown[0]}.`);
    const id = this.parseId(ep, rawId);
    const expansions = this.parseExpand(ep, query, token);
    const row = await this.fetchRow(ep, id, this.returnColumns(ep, expansions.map((x) => x.rel.origemColumn)));
    if (!row) throw new GatewayError('NOT_FOUND', 'Registro não encontrado.');
    const item = this.serialize(ep, row);
    if (expansions.length) await this.attachExpansions(ep, [row], [item], expansions);
    return item;
  }

  /** Valida o corpo JSON contra a configuração dos campos. */
  buildValues(ep, body, mode) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new GatewayError('VALIDATION_ERROR', 'O corpo da requisição deve ser um objeto JSON.');
    }
    const flag = mode === 'insert' ? 'incluir' : 'alterar';
    const byApi = new Map(ep.campos.map((c) => [c.api.toLowerCase(), c]));
    const errors = [];
    const values = {};
    for (const key of Object.keys(body)) {
      const c = byApi.get(key.toLowerCase());
      if (!c) { errors.push(`Campo desconhecido: ${key}.`); continue; }
      if (!c[flag]) { errors.push(`O campo ${c.api} não pode ser ${mode === 'insert' ? 'informado na inclusão' : 'alterado'}.`); continue; }
      const v = body[key];
      if (v === null && (c.obrigatorio || !c.nulo)) { errors.push(`O campo ${c.api} não pode ser nulo.`); continue; }
      if (c.obrigatorio && typeof v === 'string' && v.trim() === '') { errors.push(`O campo ${c.api} é obrigatório.`); continue; }
      try {
        values[c.column] = parseInput(c, v, ep.banco.tipo);
      } catch (e) {
        errors.push(e.message);
      }
    }
    const checkRequired = mode === 'insert' || mode === 'put';
    if (checkRequired) {
      for (const c of ep.campos) {
        if (c.obrigatorio && c[flag] && !(c.column in values) && !errors.some((e) => e.includes(c.api))) {
          errors.push(`O campo ${c.api} é obrigatório.`);
        }
      }
    }
    if (errors.length) throw new GatewayError('VALIDATION_ERROR', errors[0], { details: errors });
    return values;
  }

  async create(ep, body) {
    const values = this.buildValues(ep, body, 'insert');
    const ex = ep.exclusao;
    if (ex.modo === 'LOGICA' && ex.campo && !(ex.campo.column in values) && ex.valorAtivo !== null && ex.valorAtivo !== '') {
      values[ex.campo.column] = parseInput(ex.campo, ex.valorAtivo, ep.banco.tipo);
    }
    const pk = ep.pk;
    const res = await this._run(ep, (drv) => drv.insert({
      table: ep.tabela, values, returning: pk ? pk.column : null, autoKey: pk ? pk.auto : false
    }));
    let id = res.id;
    if (pk && (id === null || id === undefined) && pk.column in values) id = values[pk.column];
    if (pk && id !== null && id !== undefined) {
      const row = await this.fetchRow(ep, id).catch(() => null);
      if (row) return { id, data: this.serialize(ep, row) };
    }
    return { id, data: pk ? { [pk.api]: id } : {} };
  }

  async update(ep, rawId, body, partial) {
    const id = this.parseId(ep, rawId);
    const values = this.buildValues(ep, body, partial ? 'patch' : 'put');
    if (!Object.keys(values).length) throw new GatewayError('VALIDATION_ERROR', 'Nenhum campo informado para alteração.');
    const exists = await this.fetchRow(ep, id, [ep.pk.column]);
    if (!exists) throw new GatewayError('NOT_FOUND', 'Registro não encontrado.');
    await this._run(ep, (drv) => drv.update({
      table: ep.tabela, values, key: { column: ep.pk.column, value: id }, extraFilters: this.softDeleteFilter(ep)
    }));
    const newId = ep.pk.column in values ? values[ep.pk.column] : id;
    const row = await this.fetchRow(ep, newId);
    return { id: newId, data: row ? this.serialize(ep, row) : null, changed: Object.keys(values) };
  }

  async remove(ep, rawId) {
    const id = this.parseId(ep, rawId);
    const exists = await this.fetchRow(ep, id, [ep.pk.column]);
    if (!exists) throw new GatewayError('NOT_FOUND', 'Registro não encontrado.');
    const ex = ep.exclusao;
    if (ex.modo === 'LOGICA' && ex.campo) {
      await this._run(ep, (drv) => drv.update({
        table: ep.tabela,
        values: { [ex.campo.column]: parseInput(ex.campo, ex.valorExcluido, ep.banco.tipo) },
        key: { column: ep.pk.column, value: id }
      }));
      return { id, modo: 'LOGICA' };
    }
    await this._run(ep, (drv) => drv.delete({ table: ep.tabela, key: { column: ep.pk.column, value: id } }));
    return { id, modo: 'FISICA' };
  }

  /** Garante que o registro existe (usado pelo upload). */
  async ensureExists(ep, rawId) {
    const id = this.parseId(ep, rawId);
    const row = await this.fetchRow(ep, id, [ep.pk.column]);
    if (!row) throw new GatewayError('NOT_FOUND', 'Registro não encontrado.');
    return id;
  }
}

module.exports = { CrudService, mapDbError };
