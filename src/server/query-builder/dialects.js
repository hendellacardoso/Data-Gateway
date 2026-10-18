'use strict';

/**
 * Dialetos SQL. Cada dialeto sabe:
 *  - citar identificadores (nomes de tabela/coluna vindos SEMPRE da configuração salva);
 *  - gerar placeholders de parâmetros;
 *  - montar paginação;
 *  - operador de LIKE case-insensitive.
 */

function assertIdentifier(name) {
  const s = String(name || '');
  // Identificadores vêm da descoberta do banco; ainda assim rejeitamos caracteres de controle e tamanhos absurdos.
  if (!s || s.length > 128 || /[\u0000-\u001f]/.test(s)) {
    throw new Error('Identificador inválido: ' + JSON.stringify(s));
  }
  return s;
}

const sqlserver = {
  name: 'sqlserver',
  quote: (id) => '[' + assertIdentifier(id).replace(/]/g, ']]') + ']',
  placeholder: (i) => '@p' + i,
  likeOp: 'LIKE',
  likeEscapeClause: " ESCAPE '!'",
  /** SQL Server exige ORDER BY para OFFSET/FETCH */
  paginate(sql, orderBy, ph) {
    const ob = orderBy || 'ORDER BY (SELECT NULL)';
    return `${sql} ${ob} OFFSET ${ph.offset} ROWS FETCH NEXT ${ph.limit} ROWS ONLY`;
  },
  supportsReturning: false
};

const postgres = {
  name: 'postgres',
  quote: (id) => '"' + assertIdentifier(id).replace(/"/g, '""') + '"',
  placeholder: (i) => '$' + i,
  likeOp: 'ILIKE',
  likeEscapeClause: " ESCAPE '!'",
  textCast: (expr) => expr + '::text',
  paginate(sql, orderBy, ph) {
    return `${sql}${orderBy ? ' ' + orderBy : ''} LIMIT ${ph.limit} OFFSET ${ph.offset}`;
  },
  supportsReturning: true
};

const mysql = {
  name: 'mysql',
  quote: (id) => '`' + assertIdentifier(id).replace(/`/g, '``') + '`',
  placeholder: () => '?',
  likeOp: 'LIKE',
  likeEscapeClause: " ESCAPE '!'",
  paginate(sql, orderBy, ph) {
    return `${sql}${orderBy ? ' ' + orderBy : ''} LIMIT ${ph.limit} OFFSET ${ph.offset}`;
  },
  supportsReturning: false
};

const sqlite = {
  name: 'sqlite',
  quote: (id) => '"' + assertIdentifier(id).replace(/"/g, '""') + '"',
  placeholder: () => '?',
  likeOp: 'LIKE',
  likeEscapeClause: " ESCAPE '!'",
  paginate(sql, orderBy, ph) {
    return `${sql}${orderBy ? ' ' + orderBy : ''} LIMIT ${ph.limit} OFFSET ${ph.offset}`;
  },
  supportsReturning: false
};

// Palavras reservadas do Firebird (2.5 a 5.0) que não podem ser usadas sem aspas como identificador.
const FIREBIRD_RESERVED = new Set(('ADD ADMIN ALL ALTER AND ANY AS AT AVG BEGIN BETWEEN BIGINT BIT_LENGTH BLOB BOOLEAN BOTH BY CASE CAST ' +
  'CHAR CHAR_LENGTH CHARACTER CHARACTER_LENGTH CHECK CLOSE COLLATE COLUMN COMMIT CONNECT CONSTRAINT CORR COUNT COVAR_POP ' +
  'COVAR_SAMP CREATE CROSS CURRENT CURRENT_CONNECTION CURRENT_DATE CURRENT_ROLE CURRENT_TIME CURRENT_TIMESTAMP ' +
  'CURRENT_TRANSACTION CURRENT_USER CURSOR DATE DAY DEC DECFLOAT DECIMAL DECLARE DEFAULT DELETE DELETING DETERMINISTIC ' +
  'DISCONNECT DISTINCT DOUBLE DROP ELSE END ESCAPE EXECUTE EXISTS EXTERNAL EXTRACT FALSE FETCH FILTER FLOAT FOR FOREIGN ' +
  'FROM FULL FUNCTION GDSCODE GLOBAL GRANT GROUP HAVING HOUR IN INDEX INNER INSENSITIVE INSERT INSERTING INT INT128 ' +
  'INTEGER INTO IS JOIN LEADING LEFT LIKE LOCAL LOCALTIME LOCALTIMESTAMP LONG LOWER MAX MERGE MIN MINUTE MONTH NATIONAL ' +
  'NATURAL NCHAR NO NOT NULL NUMERIC OCTET_LENGTH OF OFFSET ON ONLY OPEN OR ORDER OUTER OVER PARAMETER PLAN POSITION ' +
  'POST_EVENT PRECISION PRIMARY PROCEDURE PUBLICATION RDB$DB_KEY RDB$ERROR RDB$GET_CONTEXT RDB$GET_TRANSACTION_CN ' +
  'RDB$RECORD_VERSION RDB$ROLE_IN_USE RDB$SET_CONTEXT RDB$SYSTEM_PRIVILEGE REAL RECORD_VERSION RECREATE RECURSIVE ' +
  'REFERENCES REGR_AVGX REGR_AVGY REGR_COUNT REGR_INTERCEPT REGR_R2 REGR_SLOPE REGR_SXX REGR_SXY REGR_SYY RELEASE RESETTING ' +
  'RETURN RETURNING_VALUES RETURNS REVOKE RIGHT ROLLBACK ROW ROW_COUNT ROWS SAVEPOINT SCROLL SECOND SELECT SENSITIVE SET ' +
  'SIMILAR SMALLINT SOME SQLCODE SQLSTATE START STDDEV_POP STDDEV_SAMP SUM TABLE THEN TIME TIMESTAMP TIMEZONE_HOUR ' +
  'TIMEZONE_MINUTE TO TRAILING TRIGGER TRIM TRUE UNBOUNDED UNION UNIQUE UNKNOWN UPDATE UPDATING UPPER USER USING VALUE ' +
  'VALUES VAR_POP VAR_SAMP VARBINARY VARCHAR VARIABLE VARYING VIEW WHEN WHERE WHILE WINDOW WITH WITHOUT YEAR').split(' '));

/**
 * Firebird / InterBase.
 * Nomes simples em maiúsculas vão SEM aspas: funciona no dialeto 3 e também no dialeto 1
 * (bancos antigos, que não aceitam identificadores entre aspas). Aspas só quando necessárias.
 * Paginação com ROWS m TO n (Firebird 2.0+), parâmetros "?".
 */
const firebird = {
  name: 'firebird',
  quote(id) {
    const s = assertIdentifier(id);
    if (/^[A-Z][A-Z0-9_$]*$/.test(s) && !FIREBIRD_RESERVED.has(s)) return s;
    return '"' + s.replace(/"/g, '""') + '"';
  },
  placeholder: () => '?',
  likeOp: 'LIKE',
  likeEscapeClause: " ESCAPE '!'",
  // LIKE sem diferenciar maiúsculas; o CAST evita "string truncation" quando o padrão é maior que a coluna (ex.: CHAR(2)).
  likeExpr: (col, ph) => `UPPER(${col}) LIKE UPPER(CAST(${ph} AS VARCHAR(1000)))`,
  /** Valores de paginação em ROWS inicio TO fim (1-based). */
  pageParams: (params, size, offset) => ({ from: params.add(offset + 1), to: params.add(offset + size) }),
  paginate(sql, orderBy, ph) {
    return `${sql}${orderBy ? ' ' + orderBy : ''} ROWS ${ph.from} TO ${ph.to}`;
  },
  supportsReturning: false
};

const DIALECTS = { sqlserver, postgres, mysql, mariadb: mysql, sqlite, firebird };

function getDialect(type) {
  const d = DIALECTS[type];
  if (!d) throw new Error('Dialeto não suportado: ' + type);
  return d;
}

module.exports = { getDialect, DIALECTS, assertIdentifier, FIREBIRD_RESERVED };
