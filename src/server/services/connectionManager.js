'use strict';

const { createDriver } = require('../drivers');
const secrets = require('../security/secrets');
const { GatewayError } = require('../errors');

/**
 * Mantém um driver (com pool) por conexão cadastrada.
 * Conexões são reutilizadas entre requisições; são recriadas quando a configuração muda.
 */
class ConnectionManager {
  constructor(db, configRepo) {
    this.db = db;
    this.configRepo = configRepo;
    this.drivers = new Map();
    this.lastError = new Map();
  }

  static rowToDriverConfig(row, password, queryTimeout) {
    return {
      type: row.TIPO,
      host: row.SERVIDOR,
      port: row.PORTA,
      database: row.BANCO,
      user: row.USUARIO,
      password,
      ssl: !!row.SSL,
      timeout: row.TIMEOUT || 15000,
      queryTimeout,
      file: row.ARQUIVO,
      params: row.params || {}
    };
  }

  loadRow(bancoId) {
    const row = this.db.prepare('SELECT * FROM GW_BANCO WHERE ID = ?').get(bancoId);
    if (!row) throw new GatewayError('NOT_FOUND', 'Conexão de banco não encontrada.');
    row.params = Object.fromEntries(
      this.db.prepare('SELECT CHAVE, VALOR FROM GW_BANCO_PARAMETRO WHERE BANCO_ID = ?').all(bancoId).map((p) => [p.CHAVE, p.VALOR])
    );
    return row;
  }

  async getDriver(bancoId) {
    let drv = this.drivers.get(bancoId);
    if (drv) return drv;
    const row = this.loadRow(bancoId);
    if (!row.ATIVO) throw new GatewayError('CONNECTION_ERROR', 'Conexão de banco inativa.');
    const queryTimeout = this.configRepo.get('api').timeoutMs;
    drv = createDriver(ConnectionManager.rowToDriverConfig(row, secrets.decrypt(row.SENHA_CRIPT), queryTimeout));
    try {
      await drv.connect();
      this.lastError.delete(bancoId);
    } catch (err) {
      this.lastError.set(bancoId, { message: err.message, at: new Date().toISOString() });
      await drv.disconnect().catch(() => {});
      throw new GatewayError('CONNECTION_ERROR', 'Não foi possível conectar ao banco de dados.', { cause: err });
    }
    this.drivers.set(bancoId, drv);
    return drv;
  }

  /** Cria um driver temporário a partir de dados do formulário (para "Testar conexão"). */
  static async testDraft(draft) {
    const drv = createDriver(draft);
    try {
      return await drv.testConnection();
    } finally {
      await drv.disconnect().catch(() => {});
    }
  }

  async invalidate(bancoId) {
    const drv = this.drivers.get(bancoId);
    this.drivers.delete(bancoId);
    if (drv) await drv.disconnect().catch(() => {});
  }

  async closeAll() {
    const all = [...this.drivers.values()];
    this.drivers.clear();
    await Promise.all(all.map((d) => d.disconnect().catch(() => {})));
  }

  status() {
    const rows = this.db.prepare('SELECT ID, NOME, TIPO, ATIVO FROM GW_BANCO ORDER BY NOME').all();
    return rows.map((r) => ({
      id: r.ID,
      nome: r.NOME,
      tipo: r.TIPO,
      ativo: !!r.ATIVO,
      conectado: this.drivers.has(r.ID) && this.drivers.get(r.ID).connected,
      ultimoErro: this.lastError.get(r.ID) || null
    }));
  }
}

module.exports = { ConnectionManager };
