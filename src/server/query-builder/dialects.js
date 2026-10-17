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

const DIALECTS = { sqlserver, postgres, mysql, mariadb: mysql, sqlite };

function getDialect(type) {
  const d = DIALECTS[type];
  if (!d) throw new Error('Dialeto não suportado: ' + type);
  return d;
}

module.exports = { getDialect, DIALECTS, assertIdentifier };
