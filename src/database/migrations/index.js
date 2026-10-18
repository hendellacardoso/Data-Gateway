'use strict';

/**
 * Migrations do banco interno (SQLite).
 * Cada migration roda uma única vez, em transação, e é registrada em GW_MIGRACAO.
 * Para evoluir o schema, adicione um novo objeto ao final do array — nunca altere uma já publicada.
 */
const migrations = [
  {
    version: 1,
    name: 'schema_inicial',
    up: `
      CREATE TABLE GW_USUARIO (
        ID            INTEGER PRIMARY KEY AUTOINCREMENT,
        USUARIO       TEXT NOT NULL UNIQUE COLLATE NOCASE,
        NOME          TEXT,
        SENHA_HASH    TEXT NOT NULL,
        PERFIL        TEXT NOT NULL DEFAULT 'ADMIN',
        ATIVO         INTEGER NOT NULL DEFAULT 1,
        ULTIMO_LOGIN  TEXT,
        CRIADO_EM     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        ATUALIZADO_EM TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );

      CREATE TABLE GW_BANCO (
        ID            INTEGER PRIMARY KEY AUTOINCREMENT,
        NOME          TEXT NOT NULL UNIQUE COLLATE NOCASE,
        TIPO          TEXT NOT NULL CHECK (TIPO IN ('sqlserver','postgres','mysql','mariadb','sqlite')),
        SERVIDOR      TEXT,
        PORTA         INTEGER,
        BANCO         TEXT,
        USUARIO       TEXT,
        SENHA_CRIPT   TEXT,
        SSL           INTEGER NOT NULL DEFAULT 0,
        TIMEOUT       INTEGER NOT NULL DEFAULT 15000,
        ARQUIVO       TEXT,
        ATIVO         INTEGER NOT NULL DEFAULT 1,
        CRIADO_EM     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        ATUALIZADO_EM TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );

      CREATE TABLE GW_BANCO_PARAMETRO (
        ID        INTEGER PRIMARY KEY AUTOINCREMENT,
        BANCO_ID  INTEGER NOT NULL REFERENCES GW_BANCO(ID) ON DELETE CASCADE,
        CHAVE     TEXT NOT NULL,
        VALOR     TEXT,
        UNIQUE (BANCO_ID, CHAVE)
      );

      CREATE TABLE GW_TABELA (
        ID            INTEGER PRIMARY KEY AUTOINCREMENT,
        BANCO_ID      INTEGER NOT NULL REFERENCES GW_BANCO(ID) ON DELETE CASCADE,
        ESQUEMA       TEXT,
        NOME          TEXT NOT NULL,
        TIPO_OBJETO   TEXT NOT NULL DEFAULT 'TABLE',
        DESCRICAO     TEXT,
        ATIVO         INTEGER NOT NULL DEFAULT 1,
        CRIADO_EM     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        ATUALIZADO_EM TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );

      CREATE TABLE GW_CAMPO (
        ID            INTEGER PRIMARY KEY AUTOINCREMENT,
        TABELA_ID     INTEGER NOT NULL REFERENCES GW_TABELA(ID) ON DELETE CASCADE,
        NOME          TEXT NOT NULL,
        NOME_API      TEXT NOT NULL,
        DESCRICAO     TEXT,
        TIPO_FISICO   TEXT,
        TIPO_LOGICO   TEXT NOT NULL DEFAULT 'TEXTO',
        TAMANHO       INTEGER,
        PRECISAO      INTEGER,
        ESCALA        INTEGER,
        NULO          INTEGER NOT NULL DEFAULT 1,
        PK            INTEGER NOT NULL DEFAULT 0,
        AUTO          INTEGER NOT NULL DEFAULT 0,
        VALOR_PADRAO  TEXT,
        ORDEM         INTEGER NOT NULL DEFAULT 0,
        UNIQUE (TABELA_ID, NOME),
        UNIQUE (TABELA_ID, NOME_API)
      );

      CREATE TABLE GW_RELACIONAMENTO (
        ID                 INTEGER PRIMARY KEY AUTOINCREMENT,
        NOME               TEXT NOT NULL,
        TABELA_ORIGEM_ID   INTEGER NOT NULL REFERENCES GW_TABELA(ID) ON DELETE CASCADE,
        CAMPO_ORIGEM_ID    INTEGER NOT NULL REFERENCES GW_CAMPO(ID) ON DELETE CASCADE,
        TABELA_DESTINO_ID  INTEGER NOT NULL REFERENCES GW_TABELA(ID) ON DELETE CASCADE,
        CAMPO_DESTINO_ID   INTEGER NOT NULL REFERENCES GW_CAMPO(ID) ON DELETE CASCADE,
        CARDINALIDADE      TEXT NOT NULL DEFAULT 'MUITOS' CHECK (CARDINALIDADE IN ('UM','MUITOS')),
        ATIVO              INTEGER NOT NULL DEFAULT 1,
        CRIADO_EM          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        UNIQUE (TABELA_ORIGEM_ID, NOME)
      );

      CREATE TABLE GW_ENDPOINT (
        ID                    INTEGER PRIMARY KEY AUTOINCREMENT,
        TABELA_ID             INTEGER NOT NULL REFERENCES GW_TABELA(ID) ON DELETE CASCADE,
        SLUG                  TEXT NOT NULL UNIQUE COLLATE NOCASE,
        DESCRICAO             TEXT,
        ATIVO                 INTEGER NOT NULL DEFAULT 1,
        PUBLICADO             INTEGER NOT NULL DEFAULT 0,
        PERMITE_LISTAR        INTEGER NOT NULL DEFAULT 1,
        PERMITE_BUSCAR        INTEGER NOT NULL DEFAULT 1,
        PERMITE_INCLUIR       INTEGER NOT NULL DEFAULT 0,
        PERMITE_ALTERAR       INTEGER NOT NULL DEFAULT 0,
        PERMITE_PATCH         INTEGER NOT NULL DEFAULT 0,
        PERMITE_EXCLUIR       INTEGER NOT NULL DEFAULT 0,
        MODO_EXCLUSAO         TEXT NOT NULL DEFAULT 'FISICA' CHECK (MODO_EXCLUSAO IN ('FISICA','LOGICA')),
        CAMPO_EXCLUSAO_ID     INTEGER REFERENCES GW_CAMPO(ID) ON DELETE SET NULL,
        VALOR_ATIVO           TEXT,
        VALOR_EXCLUIDO        TEXT,
        PAGE_SIZE_PADRAO      INTEGER NOT NULL DEFAULT 50,
        PAGE_SIZE_MAX         INTEGER NOT NULL DEFAULT 500,
        UPLOAD_ATIVO          INTEGER NOT NULL DEFAULT 0,
        UPLOAD_EXTENSOES      TEXT,
        UPLOAD_TAMANHO_MAX_MB INTEGER NOT NULL DEFAULT 10,
        UPLOAD_QTD_MAX        INTEGER NOT NULL DEFAULT 5,
        UPLOAD_DIRETORIO      TEXT,
        UPLOAD_ARMAZENAMENTO  TEXT NOT NULL DEFAULT 'FS' CHECK (UPLOAD_ARMAZENAMENTO IN ('FS','DB')),
        UPLOAD_PADRAO_NOME    TEXT NOT NULL DEFAULT 'UUID' CHECK (UPLOAD_PADRAO_NOME IN ('UUID','ORIGINAL','TIMESTAMP')),
        CRIADO_EM             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        ATUALIZADO_EM         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );

      CREATE TABLE GW_ENDPOINT_CAMPO (
        ID           INTEGER PRIMARY KEY AUTOINCREMENT,
        ENDPOINT_ID  INTEGER NOT NULL REFERENCES GW_ENDPOINT(ID) ON DELETE CASCADE,
        CAMPO_ID     INTEGER NOT NULL REFERENCES GW_CAMPO(ID) ON DELETE CASCADE,
        RETORNAR     INTEGER NOT NULL DEFAULT 1,
        INCLUIR      INTEGER NOT NULL DEFAULT 0,
        ALTERAR      INTEGER NOT NULL DEFAULT 0,
        OBRIGATORIO  INTEGER NOT NULL DEFAULT 0,
        UNIQUE (ENDPOINT_ID, CAMPO_ID)
      );

      CREATE TABLE GW_ENDPOINT_FILTRO (
        ID           INTEGER PRIMARY KEY AUTOINCREMENT,
        ENDPOINT_ID  INTEGER NOT NULL REFERENCES GW_ENDPOINT(ID) ON DELETE CASCADE,
        CAMPO_ID     INTEGER NOT NULL REFERENCES GW_CAMPO(ID) ON DELETE CASCADE,
        OPERADOR     TEXT NOT NULL,
        PARAMETRO    TEXT NOT NULL,
        UNIQUE (ENDPOINT_ID, PARAMETRO)
      );

      CREATE TABLE GW_ENDPOINT_ORDEM (
        ID              INTEGER PRIMARY KEY AUTOINCREMENT,
        ENDPOINT_ID     INTEGER NOT NULL REFERENCES GW_ENDPOINT(ID) ON DELETE CASCADE,
        CAMPO_ID        INTEGER NOT NULL REFERENCES GW_CAMPO(ID) ON DELETE CASCADE,
        PADRAO          INTEGER NOT NULL DEFAULT 0,
        DIRECAO_PADRAO  TEXT NOT NULL DEFAULT 'ASC' CHECK (DIRECAO_PADRAO IN ('ASC','DESC')),
        UNIQUE (ENDPOINT_ID, CAMPO_ID)
      );

      CREATE TABLE GW_TOKEN (
        ID           INTEGER PRIMARY KEY AUTOINCREMENT,
        NOME         TEXT NOT NULL,
        DESCRICAO    TEXT,
        TOKEN_HASH   TEXT NOT NULL UNIQUE,
        PREFIXO      TEXT NOT NULL,
        EXPIRA_EM    TEXT,
        ATIVO        INTEGER NOT NULL DEFAULT 1,
        REVOGADO_EM  TEXT,
        ULTIMO_USO   TEXT,
        CRIADO_EM    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        ATUALIZADO_EM TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );

      CREATE TABLE GW_TOKEN_PERMISSAO (
        ID           INTEGER PRIMARY KEY AUTOINCREMENT,
        TOKEN_ID     INTEGER NOT NULL REFERENCES GW_TOKEN(ID) ON DELETE CASCADE,
        ENDPOINT_ID  INTEGER NOT NULL REFERENCES GW_ENDPOINT(ID) ON DELETE CASCADE,
        LISTAR       INTEGER NOT NULL DEFAULT 0,
        BUSCAR       INTEGER NOT NULL DEFAULT 0,
        INCLUIR      INTEGER NOT NULL DEFAULT 0,
        ALTERAR      INTEGER NOT NULL DEFAULT 0,
        EXCLUIR      INTEGER NOT NULL DEFAULT 0,
        UPLOAD       INTEGER NOT NULL DEFAULT 0,
        UNIQUE (TOKEN_ID, ENDPOINT_ID)
      );

      CREATE TABLE GW_ARQUIVO (
        ID               INTEGER PRIMARY KEY AUTOINCREMENT,
        ENDPOINT_ID      INTEGER NOT NULL REFERENCES GW_ENDPOINT(ID) ON DELETE CASCADE,
        REGISTRO_ID      TEXT NOT NULL,
        NOME_ORIGINAL    TEXT NOT NULL,
        NOME_ARMAZENADO  TEXT NOT NULL,
        CAMINHO          TEXT,
        MIME             TEXT,
        TAMANHO          INTEGER NOT NULL,
        HASH_SHA256      TEXT NOT NULL,
        CONTEUDO         BLOB,
        TOKEN_ID         INTEGER,
        CRIADO_EM        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );
      CREATE INDEX IX_GW_ARQUIVO_REG ON GW_ARQUIVO (ENDPOINT_ID, REGISTRO_ID);

      CREATE TABLE GW_LOG (
        ID          INTEGER PRIMARY KEY AUTOINCREMENT,
        DATA_HORA   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        IP          TEXT,
        TOKEN_ID    INTEGER,
        TOKEN_NOME  TEXT,
        METODO      TEXT,
        ENDPOINT    TEXT,
        BANCO       TEXT,
        TABELA      TEXT,
        OPERACAO    TEXT,
        STATUS      INTEGER,
        TEMPO_MS    INTEGER,
        ERRO        TEXT
      );
      CREATE INDEX IX_GW_LOG_DATA ON GW_LOG (DATA_HORA);

      CREATE TABLE GW_AUDITORIA (
        ID           INTEGER PRIMARY KEY AUTOINCREMENT,
        DATA_HORA    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        ORIGEM       TEXT NOT NULL DEFAULT 'PAINEL',
        USUARIO_ID   INTEGER,
        USUARIO      TEXT,
        ACAO         TEXT NOT NULL,
        ENTIDADE     TEXT,
        ENTIDADE_ID  TEXT,
        DETALHES     TEXT,
        IP           TEXT
      );
      CREATE INDEX IX_GW_AUDITORIA_DATA ON GW_AUDITORIA (DATA_HORA);

      CREATE TABLE GW_CONFIG (
        CHAVE         TEXT PRIMARY KEY,
        VALOR         TEXT,
        ATUALIZADO_EM TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );
    `
  },
  {
    version: 2,
    name: 'consultas_sql',
    up: `
      CREATE TABLE GW_CONSULTA (
        ID                INTEGER PRIMARY KEY AUTOINCREMENT,
        BANCO_ID          INTEGER NOT NULL REFERENCES GW_BANCO(ID),
        NOME              TEXT NOT NULL,
        SLUG              TEXT NOT NULL UNIQUE COLLATE NOCASE,
        DESCRICAO         TEXT,
        SQL_TEXTO         TEXT NOT NULL,
        MODELO_VISUAL     TEXT,
        ATIVO             INTEGER NOT NULL DEFAULT 1,
        PUBLICADO         INTEGER NOT NULL DEFAULT 0,
        PAGE_SIZE_PADRAO  INTEGER NOT NULL DEFAULT 50,
        PAGE_SIZE_MAX     INTEGER NOT NULL DEFAULT 500,
        CALCULAR_TOTAL    INTEGER NOT NULL DEFAULT 1,
        CRIADO_EM         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        ATUALIZADO_EM     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );

      CREATE TABLE GW_CONSULTA_PARAMETRO (
        ID           INTEGER PRIMARY KEY AUTOINCREMENT,
        CONSULTA_ID  INTEGER NOT NULL REFERENCES GW_CONSULTA(ID) ON DELETE CASCADE,
        NOME         TEXT NOT NULL,
        TIPO_LOGICO  TEXT NOT NULL DEFAULT 'TEXTO',
        OBRIGATORIO  INTEGER NOT NULL DEFAULT 0,
        VALOR_PADRAO TEXT,
        DESCRICAO    TEXT,
        ORDEM        INTEGER NOT NULL DEFAULT 0,
        UNIQUE (CONSULTA_ID, NOME)
      );

      CREATE TABLE GW_TOKEN_PERMISSAO_CONSULTA (
        ID           INTEGER PRIMARY KEY AUTOINCREMENT,
        TOKEN_ID     INTEGER NOT NULL REFERENCES GW_TOKEN(ID) ON DELETE CASCADE,
        CONSULTA_ID  INTEGER NOT NULL REFERENCES GW_CONSULTA(ID) ON DELETE CASCADE,
        UNIQUE (TOKEN_ID, CONSULTA_ID)
      );
    `
  },
  {
    version: 3,
    name: 'banco_firebird',
    // Recria GW_BANCO para aceitar o tipo 'firebird' (SQLite não altera CHECK).
    // Roda com foreign_keys desligado para o DROP não apagar em cascata as tabelas filhas.
    semChavesEstrangeiras: true,
    up: `
      CREATE TABLE GW_BANCO_NOVO (
        ID            INTEGER PRIMARY KEY AUTOINCREMENT,
        NOME          TEXT NOT NULL UNIQUE COLLATE NOCASE,
        TIPO          TEXT NOT NULL CHECK (TIPO IN ('sqlserver','postgres','mysql','mariadb','sqlite','firebird')),
        SERVIDOR      TEXT,
        PORTA         INTEGER,
        BANCO         TEXT,
        USUARIO       TEXT,
        SENHA_CRIPT   TEXT,
        SSL           INTEGER NOT NULL DEFAULT 0,
        TIMEOUT       INTEGER NOT NULL DEFAULT 15000,
        ARQUIVO       TEXT,
        ATIVO         INTEGER NOT NULL DEFAULT 1,
        CRIADO_EM     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        ATUALIZADO_EM TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );
      INSERT INTO GW_BANCO_NOVO (ID, NOME, TIPO, SERVIDOR, PORTA, BANCO, USUARIO, SENHA_CRIPT, SSL, TIMEOUT, ARQUIVO, ATIVO, CRIADO_EM, ATUALIZADO_EM)
        SELECT ID, NOME, TIPO, SERVIDOR, PORTA, BANCO, USUARIO, SENHA_CRIPT, SSL, TIMEOUT, ARQUIVO, ATIVO, CRIADO_EM, ATUALIZADO_EM FROM GW_BANCO;
      DROP TABLE GW_BANCO;
      ALTER TABLE GW_BANCO_NOVO RENAME TO GW_BANCO;
    `
  }
];

function runMigrations(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS GW_MIGRACAO (
    VERSAO INTEGER PRIMARY KEY,
    NOME TEXT NOT NULL,
    APLICADA_EM TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  )`);
  const applied = new Set(db.prepare('SELECT VERSAO FROM GW_MIGRACAO').all().map(r => r.VERSAO));
  for (const m of migrations) {
    if (applied.has(m.version)) continue;
    const tx = db.transaction(() => {
      db.exec(m.up);
      if (m.semChavesEstrangeiras) {
        const problemas = db.pragma('foreign_key_check');
        if (problemas.length) throw new Error(`Migração ${m.version}: referências inválidas após recriar tabelas.`);
      }
      db.prepare('INSERT INTO GW_MIGRACAO (VERSAO, NOME) VALUES (?, ?)').run(m.version, m.name);
    });
    // PRAGMA foreign_keys não pode mudar dentro de transação
    const fkAntes = m.semChavesEstrangeiras ? db.pragma('foreign_keys', { simple: true }) : null;
    if (m.semChavesEstrangeiras) db.pragma('foreign_keys = OFF');
    try {
      tx();
    } finally {
      if (m.semChavesEstrangeiras && fkAntes) db.pragma('foreign_keys = ON');
    }
  }
}

module.exports = { runMigrations, migrations };
