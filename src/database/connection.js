'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { runMigrations } = require('./migrations');

/**
 * Abre (ou cria) o banco interno data-gateway.db e aplica as migrations.
 * @param {string} dataDir diretório de dados do aplicativo
 */
function openInternalDatabase(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, 'data-gateway.db');
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  runMigrations(db);
  return db;
}

module.exports = { openInternalDatabase };
