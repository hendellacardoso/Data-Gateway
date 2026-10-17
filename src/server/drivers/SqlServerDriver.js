'use strict';

const { DatabaseDriver } = require('./DatabaseDriver');

class SqlServerDriver extends DatabaseDriver {
  async connect() {
    if (this.pool && this.pool.connected) return;
    const sql = require('mssql');
    const c = this.config;
    const params = c.params || {};
    const cfg = {
      server: c.host,
      port: c.port ? Number(c.port) : undefined,
      database: c.database,
      user: c.user,
      password: c.password,
      connectionTimeout: c.timeout || 15000,
      requestTimeout: c.queryTimeout || 30000,
      pool: { max: Number(params.poolMax || 10), min: 0, idleTimeoutMillis: 30000 },
      options: {
        encrypt: !!c.ssl,
        trustServerCertificate: params.trustServerCertificate !== 'false',
        enableArithAbort: true,
        useUTC: true
      }
    };
    if (params.instanceName) {
      cfg.options.instanceName = params.instanceName;
      delete cfg.port;
    }
    this.pool = new sql.ConnectionPool(cfg);
    this.pool.on('error', () => { this.connected = false; });
    await this.pool.connect();
    this.connected = true;
  }

  async disconnect() {
    if (this.pool) await this.pool.close().catch(() => {});
    this.pool = null;
    this.connected = false;
  }

  async _request(sqlText, params) {
    await this.connect();
    const req = this.pool.request();
    (params || []).forEach((v, i) => req.input('p' + (i + 1), v));
    return req.query(sqlText);
  }

  async query(sqlText, params) {
    const r = await this._request(sqlText, params);
    return r.recordset || [];
  }

  async execute(sqlText, params) {
    const r = await this._request(sqlText, params);
    const rowsAffected = (r.rowsAffected || []).reduce((a, b) => a + b, 0);
    return { rows: r.recordset || [], rowsAffected, insertId: null };
  }

  async getServerVersion() {
    const r = await this.query("SELECT CAST(SERVERPROPERTY('ProductVersion') AS NVARCHAR(128)) AS v");
    return 'SQL Server ' + (r[0] && r[0].v);
  }

  async getTables() {
    const rows = await this.query(`
      SELECT TABLE_SCHEMA AS [schema], TABLE_NAME AS [name],
             CASE TABLE_TYPE WHEN 'VIEW' THEN 'VIEW' ELSE 'TABLE' END AS [type]
      FROM INFORMATION_SCHEMA.TABLES
      ORDER BY TABLE_SCHEMA, TABLE_NAME`);
    return rows;
  }

  _objectName(schema, table) {
    const q = this.builder.dialect.quote;
    return (schema ? q(schema) + '.' : '') + q(table);
  }

  async getColumns(schema, table) {
    const rows = await this.query(`
      SELECT c.name, t.name AS dataType, c.max_length, c.precision, c.scale, c.is_nullable,
             c.is_identity, c.is_computed, dc.definition AS defaultValue, c.column_id
      FROM sys.columns c
      JOIN sys.types t ON c.user_type_id = t.user_type_id
      LEFT JOIN sys.default_constraints dc ON dc.object_id = c.default_object_id
      WHERE c.object_id = OBJECT_ID(@p1)
      ORDER BY c.column_id`, [this._objectName(schema, table)]);
    return rows.map((r) => {
      const unicode = ['nvarchar', 'nchar', 'ntext'].includes(r.dataType);
      let length = r.max_length === -1 ? null : r.max_length;
      if (length && unicode) length = length / 2;
      const isChar = /char|text|binary/.test(r.dataType);
      return {
        name: r.name,
        dataType: r.dataType,
        length: isChar ? length : null,
        precision: isChar ? null : r.precision,
        scale: isChar ? null : r.scale,
        nullable: !!r.is_nullable,
        isPrimaryKey: false,
        isAutoIncrement: !!r.is_identity,
        isComputed: !!r.is_computed,
        defaultValue: r.defaultValue,
        ordinal: r.column_id
      };
    });
  }

  async getPrimaryKeys(schema, table) {
    const rows = await this.query(`
      SELECT c.name
      FROM sys.indexes i
      JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
      JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
      WHERE i.is_primary_key = 1 AND i.object_id = OBJECT_ID(@p1)
      ORDER BY ic.key_ordinal`, [this._objectName(schema, table)]);
    return rows.map((r) => r.name);
  }

  async getForeignKeys(schema, table) {
    return this.query(`
      SELECT fk.name AS [name], pc.name AS [column], SCHEMA_NAME(rt.schema_id) AS [refSchema],
             rt.name AS [refTable], rc.name AS [refColumn]
      FROM sys.foreign_key_columns fkc
      JOIN sys.foreign_keys fk ON fk.object_id = fkc.constraint_object_id
      JOIN sys.columns pc ON pc.object_id = fkc.parent_object_id AND pc.column_id = fkc.parent_column_id
      JOIN sys.tables rt ON rt.object_id = fkc.referenced_object_id
      JOIN sys.columns rc ON rc.object_id = fkc.referenced_object_id AND rc.column_id = fkc.referenced_column_id
      WHERE fkc.parent_object_id = OBJECT_ID(@p1)`, [this._objectName(schema, table)]);
  }

  async getIndexes(schema, table) {
    const rows = await this.query(`
      SELECT i.name, i.is_unique, c.name AS col
      FROM sys.indexes i
      JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
      JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
      WHERE i.object_id = OBJECT_ID(@p1) AND i.name IS NOT NULL
      ORDER BY i.name, ic.key_ordinal`, [this._objectName(schema, table)]);
    return groupIndexes(rows.map((r) => ({ name: r.name, unique: !!r.is_unique, col: r.col })));
  }
}

function groupIndexes(rows) {
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.name)) map.set(r.name, { name: r.name, unique: r.unique, columns: [] });
    map.get(r.name).columns.push(r.col);
  }
  return [...map.values()];
}

module.exports = { SqlServerDriver, groupIndexes };
