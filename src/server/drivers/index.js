'use strict';

const { SqlServerDriver } = require('./SqlServerDriver');
const { PostgresDriver } = require('./PostgresDriver');
const { MySqlDriver } = require('./MySqlDriver');
const { SqliteDriver } = require('./SqliteDriver');

/**
 * Registro de drivers. Para adicionar um novo banco:
 *  1. crie uma classe que estenda DatabaseDriver;
 *  2. adicione um dialeto em query-builder/dialects.js;
 *  3. registre aqui.
 */
const DRIVERS = {
  sqlserver: { label: 'SQL Server', cls: SqlServerDriver, defaultPort: 1433 },
  postgres:  { label: 'PostgreSQL', cls: PostgresDriver, defaultPort: 5432 },
  mysql:     { label: 'MySQL', cls: MySqlDriver, defaultPort: 3306 },
  mariadb:   { label: 'MariaDB', cls: MySqlDriver, defaultPort: 3306 },
  sqlite:    { label: 'SQLite', cls: SqliteDriver, defaultPort: null }
};

function createDriver(config) {
  const d = DRIVERS[config.type];
  if (!d) throw new Error('Tipo de banco não suportado: ' + config.type);
  return new d.cls(config);
}

/** Tipos lógicos da API */
const LOGICAL_TYPES = ['TEXTO', 'NUMERO', 'INTEIRO', 'DECIMAL', 'BOOLEANO', 'DATA', 'DATAHORA', 'JSON', 'ARQUIVO'];

/** Sugere o tipo lógico a partir do tipo físico do banco. */
function inferLogicalType(dataType) {
  const t = String(dataType || '').toLowerCase();
  if (t === 'tinyint(1)' || /^(bit|bool|boolean)$/.test(t)) return 'BOOLEANO';
  if (/^(tinyint|smallint|mediumint|int|integer|bigint|int2|int4|int8|serial|bigserial|smallserial)/.test(t)) return 'INTEIRO';
  if (/^(decimal|numeric|money|smallmoney)/.test(t)) return 'DECIMAL';
  if (/^(float|real|double|float4|float8)/.test(t)) return 'NUMERO';
  if (/^date$/.test(t)) return 'DATA';
  if (/(datetime|timestamp|smalldatetime|datetimeoffset)/.test(t)) return 'DATAHORA';
  if (/^jsonb?$/.test(t)) return 'JSON';
  if (/(binary|image|blob|bytea)/.test(t)) return 'ARQUIVO';
  return 'TEXTO';
}

module.exports = { DRIVERS, createDriver, LOGICAL_TYPES, inferLogicalType };
