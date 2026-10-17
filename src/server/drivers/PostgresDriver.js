'use strict';

const { DatabaseDriver } = require('./DatabaseDriver');
const { groupIndexes } = require('./SqlServerDriver');

let typesConfigured = false;

class PostgresDriver extends DatabaseDriver {
  async connect() {
    if (this.pool) return;
    const pg = require('pg');
    if (!typesConfigured) {
      // DATE como string (evita deslocamento de fuso horário)
      pg.types.setTypeParser(1082, (v) => v);
      typesConfigured = true;
    }
    const c = this.config;
    const params = c.params || {};
    this.pool = new pg.Pool({
      host: c.host,
      port: c.port ? Number(c.port) : 5432,
      database: c.database,
      user: c.user,
      password: c.password,
      ssl: c.ssl ? { rejectUnauthorized: params.rejectUnauthorized === 'true' } : false,
      connectionTimeoutMillis: c.timeout || 15000,
      statement_timeout: c.queryTimeout || 30000,
      max: Number(params.poolMax || 10),
      idleTimeoutMillis: 30000
    });
    this.pool.on('error', () => {});
    const client = await this.pool.connect();
    client.release();
    this.connected = true;
  }

  async disconnect() {
    if (this.pool) await this.pool.end().catch(() => {});
    this.pool = null;
    this.connected = false;
  }

  async query(sql, params) {
    await this.connect();
    const r = await this.pool.query(sql, params || []);
    return r.rows;
  }

  async execute(sql, params) {
    await this.connect();
    const r = await this.pool.query(sql, params || []);
    return { rows: r.rows || [], rowsAffected: r.rowCount || 0, insertId: null };
  }

  /** PostgreSQL: transação READ ONLY (o banco recusa qualquer escrita) e ROLLBACK ao final. */
  async queryReadOnly(sql, params) {
    await this.connect();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN TRANSACTION READ ONLY');
      const r = await client.query(sql, params || []);
      return { rows: r.rows, columns: (r.fields || []).map((f) => f.name) };
    } finally {
      await client.query('ROLLBACK').catch(() => {});
      client.release();
    }
  }

  async getServerVersion() {
    const r = await this.query('SELECT version() AS v');
    return r[0] && String(r[0].v).split(',')[0];
  }

  async getTables() {
    return this.query(`
      SELECT table_schema AS "schema", table_name AS "name",
             CASE WHEN table_type = 'VIEW' THEN 'VIEW' ELSE 'TABLE' END AS "type"
      FROM information_schema.tables
      WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
      ORDER BY table_schema, table_name`);
  }

  async getColumns(schema, table) {
    const rows = await this.query(`
      SELECT column_name, data_type, udt_name, character_maximum_length, numeric_precision, numeric_scale,
             is_nullable, column_default, is_identity, is_generated, ordinal_position
      FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = $2
      ORDER BY ordinal_position`, [schema || 'public', table]);
    return rows.map((r) => ({
      name: r.column_name,
      dataType: r.data_type === 'USER-DEFINED' || r.data_type === 'ARRAY' ? r.udt_name : r.data_type,
      length: r.character_maximum_length,
      precision: r.numeric_precision,
      scale: r.numeric_scale,
      nullable: r.is_nullable === 'YES',
      isPrimaryKey: false,
      isAutoIncrement: r.is_identity === 'YES' || /^nextval\(/i.test(r.column_default || ''),
      isComputed: r.is_generated === 'ALWAYS',
      defaultValue: r.column_default,
      ordinal: r.ordinal_position
    }));
  }

  async getPrimaryKeys(schema, table) {
    const rows = await this.query(`
      SELECT kcu.column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
      WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = $1 AND tc.table_name = $2
      ORDER BY kcu.ordinal_position`, [schema || 'public', table]);
    return rows.map((r) => r.column_name);
  }

  async getForeignKeys(schema, table) {
    return this.query(`
      SELECT tc.constraint_name AS "name", kcu.column_name AS "column",
             ccu.table_schema AS "refSchema", ccu.table_name AS "refTable", ccu.column_name AS "refColumn"
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = tc.constraint_name AND ccu.constraint_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = $1 AND tc.table_name = $2`,
    [schema || 'public', table]);
  }

  async getIndexes(schema, table) {
    const rows = await this.query(`
      SELECT i.relname AS name, ix.indisunique AS uniq, a.attname AS col
      FROM pg_class t
      JOIN pg_namespace n ON n.oid = t.relnamespace
      JOIN pg_index ix ON ix.indrelid = t.oid
      JOIN pg_class i ON i.oid = ix.indexrelid
      JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
      WHERE n.nspname = $1 AND t.relname = $2
      ORDER BY i.relname`, [schema || 'public', table]);
    return groupIndexes(rows.map((r) => ({ name: r.name, unique: r.uniq, col: r.col })));
  }
}

module.exports = { PostgresDriver };
