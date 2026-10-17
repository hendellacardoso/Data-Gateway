'use strict';

/**
 * Query Builder seguro.
 *
 * Regras:
 *  - Recebe SOMENTE estruturas já resolvidas a partir da configuração do Gateway
 *    (nomes de tabela/coluna vêm do SQLite interno, nunca da requisição).
 *  - Todo valor vindo do cliente vira parâmetro (placeholder) — nunca é concatenado no SQL.
 *  - Operadores são validados contra whitelist.
 */
const { getDialect } = require('./dialects');

const OPERATORS = {
  eq:         { label: 'igual',            sql: '=' },
  neq:        { label: 'diferente',        sql: '<>' },
  gt:         { label: 'maior que',        sql: '>' },
  gte:        { label: 'maior ou igual',   sql: '>=' },
  lt:         { label: 'menor que',        sql: '<' },
  lte:        { label: 'menor ou igual',   sql: '<=' },
  contains:   { label: 'contém',           like: (v) => '%' + escapeLike(v) + '%' },
  startsWith: { label: 'começa com',       like: (v) => escapeLike(v) + '%' },
  endsWith:   { label: 'termina com',      like: (v) => '%' + escapeLike(v) },
  in:         { label: 'em lista',         list: true },
  isNull:     { label: 'é nulo (true/false)', nullCheck: true }
};

const MAX_IN_ITEMS = 100;

function escapeLike(v) {
  return String(v).replace(/[!%_\[]/g, (c) => '!' + c);
}

class Params {
  constructor(dialect) {
    this.dialect = dialect;
    this.values = [];
  }
  add(value) {
    this.values.push(value);
    return this.dialect.placeholder(this.values.length);
  }
}

class QueryBuilder {
  constructor(dbType) {
    this.dialect = getDialect(dbType);
  }

  table(t) {
    const q = this.dialect.quote;
    return t.schema ? `${q(t.schema)}.${q(t.name)}` : q(t.name);
  }

  col(c) {
    return this.dialect.quote(c);
  }

  /** Monta cláusula WHERE a partir de filtros [{column, operator, value}] */
  where(filters, params) {
    const parts = [];
    for (const f of filters || []) {
      const op = OPERATORS[f.operator];
      if (!op) throw new Error('Operador não permitido: ' + f.operator);
      const c = this.col(f.column);
      if (op.nullCheck) {
        const yes = f.value === true || ['true', '1', 'sim'].includes(String(f.value).toLowerCase());
        parts.push(`${c} IS ${yes ? '' : 'NOT '}NULL`);
      } else if (op.list) {
        const arr = Array.isArray(f.value) ? f.value : String(f.value).split(',');
        const items = arr.map((v) => (typeof v === 'string' ? v.trim() : v)).filter((v) => v !== '');
        if (!items.length) continue;
        if (items.length > MAX_IN_ITEMS) throw new Error(`Máximo de ${MAX_IN_ITEMS} valores no filtro.`);
        parts.push(`${c} IN (${items.map((v) => params.add(v)).join(', ')})`);
      } else if (op.like) {
        const expr = this.dialect.textCast ? this.dialect.textCast(c) : c;
        parts.push(`${expr} ${this.dialect.likeOp} ${params.add(op.like(f.value))}${this.dialect.likeEscapeClause}`);
      } else {
        parts.push(`${c} ${op.sql} ${params.add(f.value)}`);
      }
    }
    return parts.length ? ' WHERE ' + parts.join(' AND ') : '';
  }

  orderBy(order) {
    if (!order || !order.length) return '';
    return 'ORDER BY ' + order.map((o) => `${this.col(o.column)} ${o.direction === 'DESC' ? 'DESC' : 'ASC'}`).join(', ');
  }

  /**
   * SELECT paginado + COUNT.
   * @param {{table, fields:string[], filters, orderBy, pagination:{page,pageSize}}} spec
   */
  select(spec) {
    const { table, fields, filters, orderBy, pagination } = spec;
    if (!fields || !fields.length) throw new Error('Nenhum campo configurado para retorno.');
    const cols = fields.map((f) => this.col(f)).join(', ');

    const countParams = new Params(this.dialect);
    const countWhere = this.where(filters, countParams);
    const countSql = `SELECT COUNT(*) AS total FROM ${this.table(table)}${countWhere}`;

    const params = new Params(this.dialect);
    const where = this.where(filters, params);
    let sql = `SELECT ${cols} FROM ${this.table(table)}${where}`;
    if (pagination) {
      const page = Math.max(1, pagination.page | 0);
      const size = Math.max(1, pagination.pageSize | 0);
      const ph = { limit: params.add(size), offset: params.add((page - 1) * size) };
      sql = this.dialect.paginate(sql, this.orderBy(orderBy), ph);
    } else if (orderBy && orderBy.length) {
      sql += ' ' + this.orderBy(orderBy);
    }
    return { sql, params: params.values, countSql, countParams: countParams.values };
  }

  /** SELECT de um registro pela chave primária (com filtros extras opcionais, ex.: exclusão lógica). */
  selectByKey({ table, fields, key, extraFilters }) {
    const params = new Params(this.dialect);
    const filters = [{ column: key.column, operator: 'eq', value: key.value }, ...(extraFilters || [])];
    const sql = `SELECT ${fields.map((f) => this.col(f)).join(', ')} FROM ${this.table(table)}${this.where(filters, params)}`;
    return { sql, params: params.values };
  }

  /** SELECT para relacionamentos: WHERE coluna IN (...) */
  selectIn({ table, fields, column, values, extraFilters, limit }) {
    const params = new Params(this.dialect);
    const filters = [{ column, operator: 'in', value: values }, ...(extraFilters || [])];
    let sql = `SELECT ${fields.map((f) => this.col(f)).join(', ')} FROM ${this.table(table)}${this.where(filters, params)}`;
    if (limit) {
      const ph = { limit: params.add(limit), offset: params.add(0) };
      sql = this.dialect.paginate(sql, this.orderBy([{ column, direction: 'ASC' }]), ph);
    }
    return { sql, params: params.values };
  }

  /**
   * INSERT parametrizado.
   * @param {{table, values:object, returning?:string, autoKey?:boolean}} spec
   */
  insert({ table, values, returning, autoKey }) {
    const cols = Object.keys(values);
    const params = new Params(this.dialect);
    const t = this.table(table);
    const d = this.dialect;
    let sql;
    if (!cols.length) {
      sql = d.name === 'mysql' ? `INSERT INTO ${t} () VALUES ()` : `INSERT INTO ${t} DEFAULT VALUES`;
    } else {
      const ph = cols.map((c) => params.add(values[c]));
      sql = `INSERT INTO ${t} (${cols.map((c) => this.col(c)).join(', ')}) VALUES (${ph.join(', ')})`;
      if (d.name === 'sqlserver' && returning && !autoKey) {
        // OUTPUT INSERTED só para chaves não-identity (ex.: DEFAULT NEWID()).
        sql = sql.replace(') VALUES (', `) OUTPUT INSERTED.${this.col(returning)} AS ${this.col('__gw_id')} VALUES (`);
      }
    }
    if (d.name === 'sqlserver' && returning && autoKey) {
      // SCOPE_IDENTITY é seguro com triggers (diferente de OUTPUT sem INTO).
      sql += `; SELECT CAST(SCOPE_IDENTITY() AS BIGINT) AS ${this.col('__gw_id')}`;
    }
    if (d.supportsReturning && returning) sql += ` RETURNING ${this.col(returning)} AS ${this.col('__gw_id')}`;
    return { sql, params: params.values };
  }

  update({ table, values, key, extraFilters }) {
    const cols = Object.keys(values);
    if (!cols.length) throw new Error('Nenhum campo para alterar.');
    const params = new Params(this.dialect);
    const sets = cols.map((c) => `${this.col(c)} = ${params.add(values[c])}`).join(', ');
    const filters = [{ column: key.column, operator: 'eq', value: key.value }, ...(extraFilters || [])];
    const sql = `UPDATE ${this.table(table)} SET ${sets}${this.where(filters, params)}`;
    return { sql, params: params.values };
  }

  delete({ table, key, extraFilters }) {
    const params = new Params(this.dialect);
    const filters = [{ column: key.column, operator: 'eq', value: key.value }, ...(extraFilters || [])];
    return { sql: `DELETE FROM ${this.table(table)}${this.where(filters, params)}`, params: params.values };
  }
}

module.exports = { QueryBuilder, OPERATORS, escapeLike };
