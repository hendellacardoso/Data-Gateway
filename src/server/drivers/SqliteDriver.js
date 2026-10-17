'use strict';

const fs = require('fs');
const { DatabaseDriver, parseTypeLength } = require('./DatabaseDriver');

function toSqliteValue(v) {
  if (v === true) return 1;
  if (v === false) return 0;
  if (v instanceof Date) return v.toISOString();
  if (v !== null && typeof v === 'object' && !Buffer.isBuffer(v)) return JSON.stringify(v);
  return v === undefined ? null : v;
}

class SqliteDriver extends DatabaseDriver {
  async connect() {
    if (this.db) return;
    const Database = require('better-sqlite3');
    const file = this.config.file;
    if (!file || !fs.existsSync(file)) throw new Error('Arquivo SQLite não encontrado: ' + (file || '(vazio)'));
    this.db = new Database(file, { fileMustExist: true, timeout: this.config.timeout || 15000 });
    this.db.pragma('foreign_keys = ON');
    this.connected = true;
  }

  async disconnect() {
    if (this.db) this.db.close();
    this.db = null;
    this.connected = false;
  }

  async query(sql, params) {
    await this.connect();
    return this.db.prepare(sql).all(...(params || []).map(toSqliteValue));
  }

  async execute(sql, params) {
    await this.connect();
    const stmt = this.db.prepare(sql);
    const p = (params || []).map(toSqliteValue);
    if (stmt.reader) {
      const rows = stmt.all(...p);
      return { rows, rowsAffected: rows.length, insertId: null };
    }
    const info = stmt.run(...p);
    return { rows: [], rowsAffected: info.changes, insertId: info.lastInsertRowid !== undefined ? Number(info.lastInsertRowid) : null };
  }

  async getServerVersion() {
    const r = await this.query('SELECT sqlite_version() AS v');
    return 'SQLite ' + r[0].v;
  }

  async getTables() {
    const rows = await this.query(`
      SELECT name, UPPER(type) AS type FROM sqlite_master
      WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%'
      ORDER BY name`);
    return rows.map((r) => ({ schema: null, name: r.name, type: r.type }));
  }

  async getColumns(_schema, table) {
    const rows = await this.query('SELECT * FROM pragma_table_info(?)', [table]);
    const pkCount = rows.filter((r) => r.pk > 0).length;
    const sqlRow = (await this.query("SELECT sql FROM sqlite_master WHERE name = ?", [table]))[0];
    const hasAutoinc = /AUTOINCREMENT/i.test((sqlRow && sqlRow.sql) || '');
    return rows.map((r) => {
      const t = parseTypeLength(r.type);
      const isIntPk = r.pk > 0 && pkCount === 1 && /^INTEGER$/i.test(String(r.type).trim());
      return {
        name: r.name,
        dataType: String(r.type || '').replace(/\(.*\)/, '').trim() || 'TEXT',
        length: /CHAR|TEXT|CLOB/i.test(r.type) ? t.length : null,
        precision: /CHAR|TEXT|CLOB/i.test(r.type) ? null : t.precision,
        scale: t.scale,
        nullable: !r.notnull && !(r.pk > 0),
        isPrimaryKey: r.pk > 0,
        isAutoIncrement: isIntPk || (r.pk > 0 && hasAutoinc),
        isComputed: false,
        defaultValue: r.dflt_value,
        ordinal: r.cid + 1
      };
    });
  }

  async getPrimaryKeys(_schema, table) {
    const rows = await this.query('SELECT name, pk FROM pragma_table_info(?) WHERE pk > 0 ORDER BY pk', [table]);
    return rows.map((r) => r.name);
  }

  async getForeignKeys(_schema, table) {
    const rows = await this.query('SELECT * FROM pragma_foreign_key_list(?)', [table]);
    return rows.map((r) => ({ name: 'fk_' + r.id, column: r.from, refSchema: null, refTable: r.table, refColumn: r.to }));
  }

  async getIndexes(_schema, table) {
    const list = await this.query('SELECT name, "unique" AS uniq FROM pragma_index_list(?)', [table]);
    const out = [];
    for (const ix of list) {
      const cols = await this.query('SELECT name FROM pragma_index_info(?)', [ix.name]);
      out.push({ name: ix.name, unique: !!ix.uniq, columns: cols.map((c) => c.name) });
    }
    return out;
  }
}

module.exports = { SqliteDriver };
