'use strict';

const { DatabaseDriver } = require('./DatabaseDriver');
const { groupIndexes } = require('./SqlServerDriver');

/**
 * Firebird / InterBase (2.5, 3.0, 4.0 e 5.0) — muito usado por sistemas em Delphi.
 *
 * - Cliente 100% JavaScript (node-firebird): não precisa de fbclient.dll.
 * - Firebird 3+: autenticação SRP e criptografia de conexão negociadas automaticamente.
 * - Charset: "auto" usa UTF8, ou WIN1252 quando o banco foi criado com charset NONE (comum em sistemas antigos).
 * - Dialeto 1 e 3: o dialeto SQL gera nomes sem aspas sempre que possível.
 * - DATE volta como "AAAA-MM-DD"; TIMESTAMP como data/hora local "AAAA-MM-DDTHH:mm:ss" (Firebird não guarda fuso).
 * - CHAR vem sem os espaços de preenchimento; BLOB texto vem como string e BLOB binário como Buffer.
 */

const FB_TYPES = {
  7: 'smallint', 8: 'integer', 10: 'float', 12: 'date', 13: 'time', 14: 'char', 16: 'bigint', 23: 'boolean',
  24: 'decfloat', 25: 'decfloat', 26: 'int128', 27: 'double precision', 28: 'time with time zone',
  29: 'timestamp with time zone', 35: 'timestamp', 37: 'varchar', 40: 'cstring', 261: 'blob'
};

const pad = (n, l = 2) => String(n).padStart(l, '0');
const localDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const localDateTime = (d) => {
  const ms = d.getMilliseconds();
  return `${localDate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${ms ? '.' + pad(ms, 3) : ''}`;
};

/** Ajusta valores na decodificação (roda para cada valor de cada linha). */
function typeCast(column, next) {
  const v = next();
  if (v === null || v === undefined) return v;
  switch (column.typeName) {
    case 'TEXT': return typeof v === 'string' ? v.replace(/ +$/, '') : v; // CHAR(n) vem com espaços à direita
    case 'TYPE_DATE': case 'DATE': return v instanceof Date ? localDate(v) : v;
    case 'TIMESTAMP': return v instanceof Date ? localDateTime(v) : v;
    case 'TIME': return v instanceof Date ? `${pad(v.getHours())}:${pad(v.getMinutes())}:${pad(v.getSeconds())}` : v;
    default: return v;
  }
}

/** Lê um BLOB binário (a lib entrega uma função assíncrona) para Buffer. */
function readBlob(fn) {
  return new Promise((resolve, reject) => {
    fn((err, _name, e) => {
      if (err) return reject(err);
      if (!e) return resolve(null);
      const chunks = [];
      e.on('data', (c) => chunks.push(c));
      e.on('end', () => resolve(Buffer.concat(chunks)));
      e.on('error', reject);
    });
  });
}

async function resolveBlobs(rows) {
  if (!Array.isArray(rows)) return rows;
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;
    for (const k of Object.keys(r)) if (typeof r[k] === 'function') r[k] = await readBlob(r[k]);
  }
  return rows;
}

function socketsAbertos() {
  try {
    const net = require('net');
    return new Set((process._getActiveHandles ? process._getActiveHandles() : []).filter((h) => h instanceof net.Socket));
  } catch {
    return new Set();
  }
}

function friendlyError(e) {
  const msg = String((e && e.message) || e);
  if (/user name and password are not defined|Your user name and password/i.test(msg)) {
    e.message = 'Usuário ou senha do Firebird inválidos.';
  } else if (/I\/O error.*(open|CreateFile)|No such file|cannot find|file .* not found/i.test(msg)) {
    e.message = 'Arquivo do banco não encontrado no servidor. Informe o caminho como o SERVIDOR enxerga (ex.: C:\\Dados\\SISTEMA.FDB) ou um alias. ' + msg;
  } else if (/ECONNREFUSED|connect ETIMEDOUT|EHOSTUNREACH/i.test(msg)) {
    e.message = 'Não foi possível conectar ao servidor Firebird (verifique servidor, porta 3050 e firewall). ' + msg;
  } else if (/wire encryption|Incompatible wire encryption|plugin/i.test(msg)) {
    e.message = msg + ' — No servidor Firebird 3+, verifique WireCrypt e AuthServer no firebird.conf.';
  }
  return e;
}

class FirebirdDriver extends DatabaseDriver {
  _options(encoding) {
    const c = this.config;
    const Firebird = require('node-firebird');
    const params = c.params || {};
    const opts = {
      host: c.host,
      port: c.port ? Number(c.port) : 3050,
      database: c.database,
      user: c.user,
      password: c.password,
      role: params.role || undefined,
      encoding,
      lowercase_keys: false,
      blobAsText: true,
      numericMode: Firebird.NUMERIC_MODE_SAFE,
      typeCast,
      pageSize: 4096,
      retryConnectionInterval: 1000
    };
    if (params.wireCrypt === 'false') opts.wireCrypt = Firebird.WIRE_CRYPT_DISABLE;
    return opts;
  }

  async _withTimeout(promise, ms, what) {
    let t;
    const timeout = new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`Tempo esgotado ao ${what} (${ms} ms).`)), ms); });
    try { return await Promise.race([promise, timeout]); } finally { clearTimeout(t); }
  }

  async connect() {
    if (this.pool) return;
    const Firebird = require('node-firebird');
    const params = this.config.params || {};
    const max = Number(params.poolMax || 10);
    const pedido = String(params.charset || 'auto').toUpperCase();
    let encoding = pedido === 'AUTO' ? 'UTF8' : pedido;
    const antes = socketsAbertos();
    let pool = Firebird.pool(max, this._options(encoding));
    try {
      const info = await this._withTimeout(pool.withConnection(async (db) => {
        const r = await db.queryAsync(
          "SELECT TRIM(d.RDB$CHARACTER_SET_NAME) AS CS, rdb$get_context('SYSTEM', 'ENGINE_VERSION') AS VER FROM RDB$DATABASE d");
        let dialect = 3;
        try {
          const m = await db.queryAsync('SELECT MON$SQL_DIALECT AS D FROM MON$DATABASE');
          dialect = Number(m[0] && m[0].D) || 3;
        } catch { /* sem tabelas MON$ (InterBase / Firebird antigo) */ }
        let identity = false;
        try {
          const i = await db.queryAsync("SELECT COUNT(*) AS N FROM RDB$RELATION_FIELDS WHERE RDB$RELATION_NAME = 'RDB$RELATION_FIELDS' AND RDB$FIELD_NAME = 'RDB$IDENTITY_TYPE'");
          identity = Number(i[0].N) > 0;
        } catch { /* ignora */ }
        return { charset: r[0] && r[0].CS, version: r[0] && r[0].VER, dialect, identity };
      }), this.config.timeout || 15000, 'conectar ao Firebird');

      // Banco com charset NONE (padrão de muitos sistemas Delphi antigos): os textos estão em Windows-1252
      if (pedido === 'AUTO' && (!info.charset || info.charset === 'NONE')) {
        await pool.destroyAsync().catch(() => {});
        encoding = 'WIN1252';
        pool = Firebird.pool(max, this._options(encoding));
      }
      this.info = { ...info, encoding };
      this.pool = pool;
      this.connected = true;
    } catch (e) {
      await pool.destroyAsync().catch(() => {});
      // Com servidores antigos (2.5) a biblioteca deixa o socket aberto quando o login falha: fecha os que sobraram.
      const porta = this.config.port ? Number(this.config.port) : 3050;
      for (const sk of socketsAbertos()) if (!antes.has(sk) && sk.remotePort === porta) sk.destroy();
      throw friendlyError(e);
    }
  }

  async disconnect() {
    if (this.pool) await this.pool.destroyAsync().catch(() => {});
    this.pool = null;
    this.connected = false;
  }

  _queryOpts(extra) {
    const ms = this.config.queryTimeout || 30000;
    const o = { ...(extra || {}) };
    if (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) o.signal = AbortSignal.timeout(ms);
    return o;
  }

  /** Executa dentro de uma transação explícita (BLOBs binários são lidos antes do COMMIT). */
  async _run(sql, params, { meta = false, readOnly = false } = {}) {
    await this.connect();
    const Firebird = require('node-firebird');
    try {
      return await this.pool.withConnection(async (db) => {
        const tx = await db.transactionAsync({ isolation: Firebird.ISOLATION_READ_COMMITTED, readOnly, wait: true, waitTimeout: 10 });
        try {
          const r = await tx.queryAsync(sql, params || [], this._queryOpts(meta ? { withMeta: true } : null));
          if (meta) {
            if (Array.isArray(r.rows)) await resolveBlobs(r.rows);
            else if (r.rows) await resolveBlobs([r.rows]);
          } else {
            await resolveBlobs(r);
          }
          if (readOnly) await tx.rollbackAsync(); else await tx.commitAsync();
          return r;
        } catch (e) {
          await tx.rollbackAsync().catch(() => {});
          throw e;
        }
      });
    } catch (e) {
      throw friendlyError(e);
    }
  }

  async query(sql, params) {
    const r = await this._run(sql, params);
    return Array.isArray(r) ? r : (r ? [r] : []);
  }

  async execute(sql, params) {
    const r = await this._run(sql, params, { meta: true });
    const rows = Array.isArray(r.rows) ? r.rows : (r.rows ? [r.rows] : []);
    return { rows, rowsAffected: Number(r.affectedRows) || 0, insertId: null };
  }

  /** Transação READ ONLY do próprio Firebird (o servidor recusa escrita) e ROLLBACK ao final. */
  async queryReadOnly(sql, params) {
    const r = await this._run(sql, params, { meta: true, readOnly: true });
    const rows = Array.isArray(r.rows) ? r.rows : (r.rows ? [r.rows] : []);
    return { rows, columns: (r.fields || []).map((f) => f.alias || f.field) };
  }

  /** INSERT ... RETURNING <chave>: devolve o código gerado pelo generator/trigger ou IDENTITY. */
  async insert(spec) {
    const q = this.builder.insert({ ...spec, returning: undefined });
    let sql = q.sql;
    if (spec.returning) sql += ` RETURNING ${this.builder.col(spec.returning)}`;
    const res = await this.execute(sql, q.params);
    let id = null;
    if (spec.returning && res.rows[0]) {
      const row = res.rows[0];
      id = row[spec.returning] !== undefined ? row[spec.returning] : Object.values(row)[0];
    }
    return { id, rowsAffected: res.rowsAffected || (spec.returning && res.rows.length ? 1 : 0) };
  }

  async getServerVersion() {
    await this.connect();
    const i = this.info || {};
    const parts = [`Firebird ${i.version || ''}`.trim(), `dialeto ${i.dialect}`];
    if (i.charset) parts.push(`charset ${i.charset}${i.encoding && i.encoding !== i.charset ? ' → ' + i.encoding : ''}`);
    return parts.join(' · ');
  }

  async getTables() {
    const rows = await this.query(`
      SELECT TRIM(r.RDB$RELATION_NAME) AS NAME,
             CASE WHEN r.RDB$VIEW_BLR IS NULL THEN 'TABLE' ELSE 'VIEW' END AS TIPO
      FROM RDB$RELATIONS r
      WHERE COALESCE(r.RDB$SYSTEM_FLAG, 0) = 0
        AND (r.RDB$RELATION_TYPE IS NULL OR r.RDB$RELATION_TYPE IN (0, 1))
      ORDER BY r.RDB$RELATION_NAME`).catch(async (e) => {
      // Firebird 2.0 / InterBase não têm RDB$RELATION_TYPE
      if (!/RDB\$RELATION_TYPE/i.test(e.message)) throw e;
      return this.query(`
        SELECT TRIM(r.RDB$RELATION_NAME) AS NAME,
               CASE WHEN r.RDB$VIEW_BLR IS NULL THEN 'TABLE' ELSE 'VIEW' END AS TIPO
        FROM RDB$RELATIONS r WHERE COALESCE(r.RDB$SYSTEM_FLAG, 0) = 0 ORDER BY r.RDB$RELATION_NAME`);
    });
    return rows.map((r) => ({ schema: null, name: r.NAME, type: r.TIPO }));
  }

  async getColumns(schema, table) {
    await this.connect();
    const identity = this.info && this.info.identity ? 'rf.RDB$IDENTITY_TYPE' : 'CAST(NULL AS SMALLINT)';
    const rows = await this.query(`
      SELECT TRIM(rf.RDB$FIELD_NAME) AS NAME, rf.RDB$FIELD_POSITION AS POS,
             f.RDB$FIELD_TYPE AS FTYPE, f.RDB$FIELD_SUB_TYPE AS SUBTYPE, f.RDB$FIELD_SCALE AS FSCALE,
             f.RDB$FIELD_PRECISION AS FPREC, f.RDB$CHARACTER_LENGTH AS CLEN, f.RDB$FIELD_LENGTH AS FLEN,
             COALESCE(rf.RDB$NULL_FLAG, f.RDB$NULL_FLAG, 0) AS NOTNULL,
             CAST(COALESCE(rf.RDB$DEFAULT_SOURCE, f.RDB$DEFAULT_SOURCE) AS VARCHAR(1000)) AS DEF,
             CASE WHEN f.RDB$COMPUTED_BLR IS NULL THEN 0 ELSE 1 END AS COMPUTED,
             ${identity} AS IDENT
      FROM RDB$RELATION_FIELDS rf
      JOIN RDB$FIELDS f ON f.RDB$FIELD_NAME = rf.RDB$FIELD_SOURCE
      WHERE rf.RDB$RELATION_NAME = ?
      ORDER BY rf.RDB$FIELD_POSITION`, [table]);
    const autoCols = await this._triggerAutoColumns(table).catch(() => new Set());
    return rows.map((r) => {
      const ftype = Number(r.FTYPE);
      const scale = r.FSCALE ? -Number(r.FSCALE) : 0;
      let dataType = FB_TYPES[ftype] || 'unknown';
      if ([7, 8, 16, 26].includes(ftype) && (scale > 0 || Number(r.SUBTYPE) > 0)) {
        dataType = Number(r.SUBTYPE) === 2 ? 'decimal' : 'numeric';
      }
      if (ftype === 261) dataType = Number(r.SUBTYPE) === 1 ? 'blob sub_type text' : 'blob';
      if (ftype === 35 && this.info && this.info.dialect === 1) dataType = 'timestamp'; // DATE do dialeto 1 tem hora
      const isText = ftype === 14 || ftype === 37;
      const def = r.DEF ? String(r.DEF).replace(/^\s*DEFAULT\s+/i, '').trim() : null;
      return {
        name: r.NAME,
        dataType,
        length: isText ? Number(r.CLEN || r.FLEN) : null,
        precision: r.FPREC !== null && r.FPREC !== undefined ? Number(r.FPREC) || null : null,
        scale: scale || (dataType === 'numeric' || dataType === 'decimal' ? 0 : null),
        nullable: Number(r.NOTNULL) !== 1,
        isPrimaryKey: false,
        isAutoIncrement: r.IDENT !== null && r.IDENT !== undefined ? true : autoCols.has(r.NAME),
        isComputed: Number(r.COMPUTED) === 1,
        defaultValue: def,
        ordinal: Number(r.POS) + 1
      };
    });
  }

  /**
   * Padrão Delphi/Firebird: generator + trigger BEFORE INSERT que preenche a chave
   * (NEW.CODIGO = GEN_ID(GEN_X, 1) ou NEXT VALUE FOR GEN_X). Essas colunas são tratadas como automáticas.
   */
  async _triggerAutoColumns(table) {
    const rows = await this.query(`
      SELECT CAST(t.RDB$TRIGGER_SOURCE AS VARCHAR(8000)) AS SRC
      FROM RDB$TRIGGERS t
      WHERE t.RDB$RELATION_NAME = ? AND COALESCE(t.RDB$TRIGGER_INACTIVE, 0) = 0
        AND t.RDB$TRIGGER_TYPE IN (1, 17, 25, 113)`, [table]);
    const cols = new Set();
    const re = /NEW\s*\.\s*("?)([A-Za-z0-9_$]+)\1\s*=\s*(GEN_ID\s*\(|NEXT\s+VALUE\s+FOR\b)/gi;
    for (const r of rows) {
      const src = String(r.SRC || '');
      let m;
      while ((m = re.exec(src))) cols.add(m[1] ? m[2] : m[2].toUpperCase());
    }
    return cols;
  }

  async getPrimaryKeys(schema, table) {
    const rows = await this.query(`
      SELECT TRIM(s.RDB$FIELD_NAME) AS COL
      FROM RDB$RELATION_CONSTRAINTS rc
      JOIN RDB$INDEX_SEGMENTS s ON s.RDB$INDEX_NAME = rc.RDB$INDEX_NAME
      WHERE rc.RDB$RELATION_NAME = ? AND rc.RDB$CONSTRAINT_TYPE = 'PRIMARY KEY'
      ORDER BY s.RDB$FIELD_POSITION`, [table]);
    return rows.map((r) => r.COL);
  }

  async getForeignKeys(schema, table) {
    const rows = await this.query(`
      SELECT TRIM(rc.RDB$CONSTRAINT_NAME) AS NAME, TRIM(s.RDB$FIELD_NAME) AS COL,
             TRIM(rc2.RDB$RELATION_NAME) AS REFTABLE, TRIM(s2.RDB$FIELD_NAME) AS REFCOL
      FROM RDB$RELATION_CONSTRAINTS rc
      JOIN RDB$REF_CONSTRAINTS ref ON ref.RDB$CONSTRAINT_NAME = rc.RDB$CONSTRAINT_NAME
      JOIN RDB$RELATION_CONSTRAINTS rc2 ON rc2.RDB$CONSTRAINT_NAME = ref.RDB$CONST_NAME_UQ
      JOIN RDB$INDEX_SEGMENTS s ON s.RDB$INDEX_NAME = rc.RDB$INDEX_NAME
      JOIN RDB$INDEX_SEGMENTS s2 ON s2.RDB$INDEX_NAME = rc2.RDB$INDEX_NAME AND s2.RDB$FIELD_POSITION = s.RDB$FIELD_POSITION
      WHERE rc.RDB$RELATION_NAME = ? AND rc.RDB$CONSTRAINT_TYPE = 'FOREIGN KEY'
      ORDER BY rc.RDB$CONSTRAINT_NAME, s.RDB$FIELD_POSITION`, [table]);
    return rows.map((r) => ({ name: r.NAME, column: r.COL, refSchema: null, refTable: r.REFTABLE, refColumn: r.REFCOL }));
  }

  async getIndexes(schema, table) {
    const rows = await this.query(`
      SELECT TRIM(i.RDB$INDEX_NAME) AS NAME, COALESCE(i.RDB$UNIQUE_FLAG, 0) AS UNIQ, TRIM(s.RDB$FIELD_NAME) AS COL
      FROM RDB$INDICES i
      JOIN RDB$INDEX_SEGMENTS s ON s.RDB$INDEX_NAME = i.RDB$INDEX_NAME
      WHERE i.RDB$RELATION_NAME = ?
      ORDER BY i.RDB$INDEX_NAME, s.RDB$FIELD_POSITION`, [table]);
    return groupIndexes(rows.map((r) => ({ name: r.NAME, unique: Number(r.UNIQ) === 1, col: r.COL })));
  }
}

module.exports = { FirebirdDriver, typeCast };
