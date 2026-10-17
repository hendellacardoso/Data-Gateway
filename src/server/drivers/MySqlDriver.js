'use strict';

const { DatabaseDriver } = require('./DatabaseDriver');
const { groupIndexes } = require('./SqlServerDriver');

/** Atende MySQL e MariaDB (mesmo protocolo). */
class MySqlDriver extends DatabaseDriver {
  async connect() {
    if (this.pool) return;
    const mysql = require('mysql2/promise');
    const c = this.config;
    const params = c.params || {};
    this.pool = mysql.createPool({
      host: c.host,
      port: c.port ? Number(c.port) : 3306,
      database: c.database,
      user: c.user,
      password: c.password,
      ssl: c.ssl ? { rejectUnauthorized: params.rejectUnauthorized === 'true' } : undefined,
      connectTimeout: c.timeout || 15000,
      connectionLimit: Number(params.poolMax || 10),
      waitForConnections: true,
      dateStrings: ['DATE'],
      supportBigNumbers: true,
      bigNumberStrings: false,
      timezone: 'Z'
    });
    const conn = await this.pool.getConnection();
    conn.release();
    this.connected = true;
  }

  async disconnect() {
    if (this.pool) await this.pool.end().catch(() => {});
    this.pool = null;
    this.connected = false;
  }

  async _run(sql, params) {
    await this.connect();
    // query() com placeholders "?" faz escape seguro no cliente e aceita LIMIT ? (execute() tem limitações).
    const [result] = await this.pool.query({ sql, timeout: this.config.queryTimeout || 30000 }, params || []);
    return result;
  }

  async query(sql, params) {
    const r = await this._run(sql, params);
    return Array.isArray(r) ? r : [];
  }

  async execute(sql, params) {
    const r = await this._run(sql, params);
    if (Array.isArray(r)) return { rows: r, rowsAffected: r.length, insertId: null };
    return { rows: [], rowsAffected: r.affectedRows || 0, insertId: r.insertId || null };
  }

  async getServerVersion() {
    const r = await this.query('SELECT VERSION() AS v');
    return (this.type === 'mariadb' ? 'MariaDB ' : 'MySQL ') + (r[0] && r[0].v);
  }

  async getTables() {
    return this.query(`
      SELECT TABLE_SCHEMA AS \`schema\`, TABLE_NAME AS \`name\`,
             CASE WHEN TABLE_TYPE = 'VIEW' THEN 'VIEW' ELSE 'TABLE' END AS \`type\`
      FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
      ORDER BY TABLE_NAME`);
  }

  async getColumns(schema, table) {
    const rows = await this.query(`
      SELECT COLUMN_NAME, DATA_TYPE, COLUMN_TYPE, CHARACTER_MAXIMUM_LENGTH, NUMERIC_PRECISION, NUMERIC_SCALE,
             IS_NULLABLE, COLUMN_DEFAULT, EXTRA, COLUMN_KEY, ORDINAL_POSITION
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = COALESCE(?, DATABASE()) AND TABLE_NAME = ?
      ORDER BY ORDINAL_POSITION`, [schema || null, table]);
    return rows.map((r) => ({
      name: r.COLUMN_NAME,
      dataType: r.COLUMN_TYPE === 'tinyint(1)' ? 'tinyint(1)' : r.DATA_TYPE,
      length: r.CHARACTER_MAXIMUM_LENGTH !== null ? Number(r.CHARACTER_MAXIMUM_LENGTH) : null,
      precision: r.NUMERIC_PRECISION !== null ? Number(r.NUMERIC_PRECISION) : null,
      scale: r.NUMERIC_SCALE !== null ? Number(r.NUMERIC_SCALE) : null,
      nullable: r.IS_NULLABLE === 'YES',
      isPrimaryKey: r.COLUMN_KEY === 'PRI',
      isAutoIncrement: /auto_increment/i.test(r.EXTRA || ''),
      isComputed: /GENERATED/i.test(r.EXTRA || ''),
      defaultValue: r.COLUMN_DEFAULT,
      ordinal: r.ORDINAL_POSITION
    }));
  }

  async getPrimaryKeys(schema, table) {
    const rows = await this.query(`
      SELECT COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA = COALESCE(?, DATABASE()) AND TABLE_NAME = ? AND CONSTRAINT_NAME = 'PRIMARY'
      ORDER BY ORDINAL_POSITION`, [schema || null, table]);
    return rows.map((r) => r.COLUMN_NAME);
  }

  async getForeignKeys(schema, table) {
    return this.query(`
      SELECT CONSTRAINT_NAME AS name, COLUMN_NAME AS \`column\`, REFERENCED_TABLE_SCHEMA AS refSchema,
             REFERENCED_TABLE_NAME AS refTable, REFERENCED_COLUMN_NAME AS refColumn
      FROM information_schema.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA = COALESCE(?, DATABASE()) AND TABLE_NAME = ? AND REFERENCED_TABLE_NAME IS NOT NULL`,
    [schema || null, table]);
  }

  async getIndexes(schema, table) {
    const rows = await this.query(`
      SELECT INDEX_NAME AS name, NON_UNIQUE AS nonUnique, COLUMN_NAME AS col
      FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = COALESCE(?, DATABASE()) AND TABLE_NAME = ?
      ORDER BY INDEX_NAME, SEQ_IN_INDEX`, [schema || null, table]);
    return groupIndexes(rows.map((r) => ({ name: r.name, unique: Number(r.nonUnique) === 0, col: r.col })));
  }
}

module.exports = { MySqlDriver };
