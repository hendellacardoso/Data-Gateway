'use strict';

const { QueryBuilder } = require('../query-builder/builder');

/**
 * Interface abstrata de driver de banco.
 * Cada banco implementa: connect, disconnect, query, execute e os métodos de descoberta.
 * As operações CRUD (select/insert/update/delete) são genéricas e usam o QueryBuilder + dialeto.
 *
 * Formatos normalizados de descoberta:
 *  getTables()             → [{ schema, name, type: 'TABLE'|'VIEW' }]
 *  getColumns(schema, t)   → [{ name, dataType, length, precision, scale, nullable, isPrimaryKey,
 *                               isAutoIncrement, defaultValue, ordinal }]
 *  getPrimaryKeys(s, t)    → ['COL', ...]
 *  getForeignKeys(s, t)    → [{ name, column, refSchema, refTable, refColumn }]
 *  getIndexes(s, t)        → [{ name, unique, columns: [] }]
 */
class DatabaseDriver {
  constructor(config) {
    this.config = config;
    this.type = config.type;
    this.builder = new QueryBuilder(config.type);
    this.connected = false;
  }

  async connect() { throw new Error('connect() não implementado'); }
  async disconnect() { throw new Error('disconnect() não implementado'); }

  /** @returns {Promise<object[]>} linhas */
  async query(/* sql, params */) { throw new Error('query() não implementado'); }

  /** @returns {Promise<{rows: object[], rowsAffected: number, insertId: any}>} */
  async execute(/* sql, params */) { throw new Error('execute() não implementado'); }

  /**
   * Executa SELECT em modo somente leitura (transação read-only ou desfeita ao final).
   * @returns {Promise<{rows: object[], columns: string[]}>}
   */
  async queryReadOnly(/* sql, params */) { throw new Error('queryReadOnly() não implementado'); }

  async getTables() { throw new Error('getTables() não implementado'); }
  async getColumns() { throw new Error('getColumns() não implementado'); }
  async getPrimaryKeys() { throw new Error('getPrimaryKeys() não implementado'); }
  async getForeignKeys() { return []; }
  async getIndexes() { return []; }

  async testConnection() {
    const started = Date.now();
    await this.connect();
    const version = await this.getServerVersion().catch(() => null);
    return { ok: true, elapsedMs: Date.now() - started, version };
  }

  async getServerVersion() { return null; }

  /** Descrição completa de uma tabela/view. */
  async describeTable(schema, table) {
    const [columns, primaryKeys, foreignKeys, indexes] = await Promise.all([
      this.getColumns(schema, table),
      this.getPrimaryKeys(schema, table).catch(() => []),
      this.getForeignKeys(schema, table).catch(() => []),
      this.getIndexes(schema, table).catch(() => [])
    ]);
    const pkSet = new Set(primaryKeys);
    for (const c of columns) if (pkSet.has(c.name)) c.isPrimaryKey = true;
    return { schema, name: table, columns, primaryKeys, foreignKeys, indexes };
  }

  // ---------- CRUD genérico ----------

  async select(spec) {
    const q = this.builder.select(spec);
    const [rows, countRows] = await Promise.all([
      this.query(q.sql, q.params),
      spec.pagination ? this.query(q.countSql, q.countParams) : Promise.resolve(null)
    ]);
    const total = countRows ? Number(countRows[0].total ?? countRows[0].TOTAL ?? 0) : rows.length;
    return { rows, total };
  }

  async selectByKey(spec) {
    const q = this.builder.selectByKey(spec);
    const rows = await this.query(q.sql, q.params);
    return rows[0] || null;
  }

  async selectIn(spec) {
    const q = this.builder.selectIn(spec);
    return this.query(q.sql, q.params);
  }

  async insert(spec) {
    const q = this.builder.insert(spec);
    const res = await this.execute(q.sql, q.params);
    let id = null;
    if (res.rows && res.rows[0] && res.rows[0].__gw_id !== undefined) id = res.rows[0].__gw_id;
    else if (res.insertId !== undefined && res.insertId !== null) id = res.insertId;
    return { id, rowsAffected: res.rowsAffected };
  }

  async update(spec) {
    const q = this.builder.update(spec);
    const res = await this.execute(q.sql, q.params);
    return { rowsAffected: res.rowsAffected };
  }

  async delete(spec) {
    const q = this.builder.delete(spec);
    const res = await this.execute(q.sql, q.params);
    return { rowsAffected: res.rowsAffected };
  }
}

/** Extrai tamanho de tipos no formato "VARCHAR(150)". */
function parseTypeLength(type) {
  const m = /\((\d+)(?:\s*,\s*(\d+))?\)/.exec(String(type || ''));
  if (!m) return { length: null, precision: null, scale: null };
  return { length: Number(m[1]), precision: Number(m[1]), scale: m[2] ? Number(m[2]) : null };
}

module.exports = { DatabaseDriver, parseTypeLength };
