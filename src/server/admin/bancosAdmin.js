'use strict';

const secrets = require('../security/secrets');
const { GatewayError } = require('../errors');
const { DRIVERS, inferLogicalType } = require('../drivers');
const { ConnectionManager } = require('../services/connectionManager');

const ALLOWED_PARAMS = ['trustServerCertificate', 'instanceName', 'rejectUnauthorized', 'poolMax'];

function toApiName(col) {
  let s = String(col).normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9_]/g, '_').toLowerCase();
  if (!/^[a-z_]/.test(s)) s = '_' + s;
  return s.slice(0, 64);
}

function createBancosAdmin(ctx) {
  const { db, logger, connections } = ctx;

  function rowToDto(r) {
    const params = Object.fromEntries(db.prepare('SELECT CHAVE, VALOR FROM GW_BANCO_PARAMETRO WHERE BANCO_ID = ?').all(r.ID).map((p) => [p.CHAVE, p.VALOR]));
    return {
      id: r.ID, nome: r.NOME, tipo: r.TIPO, servidor: r.SERVIDOR || '', porta: r.PORTA || '', banco: r.BANCO || '',
      usuario: r.USUARIO || '', temSenha: !!r.SENHA_CRIPT, ssl: !!r.SSL, timeout: r.TIMEOUT, arquivo: r.ARQUIVO || '',
      ativo: !!r.ATIVO, parametros: params, criadoEm: r.CRIADO_EM, atualizadoEm: r.ATUALIZADO_EM
    };
  }

  function validate(f) {
    if (!f.nome || !String(f.nome).trim()) throw new GatewayError('VALIDATION_ERROR', 'Informe o nome da conexão.');
    if (!DRIVERS[f.tipo]) throw new GatewayError('VALIDATION_ERROR', 'Tipo de banco inválido.');
    if (f.tipo === 'sqlite') {
      if (!f.arquivo) throw new GatewayError('VALIDATION_ERROR', 'Selecione o arquivo SQLite.');
    } else {
      if (!f.servidor) throw new GatewayError('VALIDATION_ERROR', 'Informe o servidor.');
      if (!f.banco) throw new GatewayError('VALIDATION_ERROR', 'Informe o nome do banco de dados.');
      if (f.porta && !(Number(f.porta) > 0 && Number(f.porta) < 65536)) throw new GatewayError('VALIDATION_ERROR', 'Porta inválida.');
    }
  }

  function draftConfig(f) {
    let password = f.senha;
    if ((password === undefined || password === '') && f.id) {
      const row = db.prepare('SELECT SENHA_CRIPT FROM GW_BANCO WHERE ID = ?').get(f.id);
      password = row ? secrets.decrypt(row.SENHA_CRIPT) : '';
    }
    return {
      type: f.tipo, host: f.servidor, port: f.porta || DRIVERS[f.tipo].defaultPort, database: f.banco, user: f.usuario,
      password, ssl: !!f.ssl, timeout: Number(f.timeout) || 15000, queryTimeout: 15000, file: f.arquivo, params: f.parametros || {}
    };
  }

  return {
    types() {
      return Object.entries(DRIVERS).map(([k, v]) => ({ value: k, label: v.label, defaultPort: v.defaultPort }));
    },

    list() {
      return db.prepare('SELECT * FROM GW_BANCO ORDER BY NOME').all().map(rowToDto).map((b) => ({
        ...b,
        endpoints: db.prepare('SELECT COUNT(*) AS n FROM GW_ENDPOINT e JOIN GW_TABELA t ON t.ID = e.TABELA_ID WHERE t.BANCO_ID = ?').get(b.id).n
      }));
    },

    get({ id }) {
      const r = db.prepare('SELECT * FROM GW_BANCO WHERE ID = ?').get(id);
      if (!r) throw new GatewayError('NOT_FOUND', 'Conexão não encontrada.');
      return rowToDto(r);
    },

    async save(session, f) {
      validate(f);
      const dup = db.prepare('SELECT ID FROM GW_BANCO WHERE NOME = ? AND ID <> ?').get(String(f.nome).trim(), f.id || 0);
      if (dup) throw new GatewayError('VALIDATION_ERROR', 'Já existe uma conexão com este nome.');
      const vals = [
        String(f.nome).trim(), f.tipo, f.tipo === 'sqlite' ? null : f.servidor, f.tipo === 'sqlite' ? null : (Number(f.porta) || null),
        f.tipo === 'sqlite' ? null : f.banco, f.tipo === 'sqlite' ? null : f.usuario || null, f.ssl ? 1 : 0,
        Number(f.timeout) || 15000, f.tipo === 'sqlite' ? f.arquivo : null, f.ativo === false ? 0 : 1
      ];
      let id = f.id;
      db.transaction(() => {
        if (id) {
          db.prepare(`UPDATE GW_BANCO SET NOME=?, TIPO=?, SERVIDOR=?, PORTA=?, BANCO=?, USUARIO=?, SSL=?, TIMEOUT=?, ARQUIVO=?, ATIVO=?,
            ATUALIZADO_EM=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE ID=?`).run(...vals, id);
          if (f.senha !== undefined && f.senha !== '') db.prepare('UPDATE GW_BANCO SET SENHA_CRIPT = ? WHERE ID = ?').run(secrets.encrypt(f.senha), id);
        } else {
          id = Number(db.prepare(`INSERT INTO GW_BANCO (NOME, TIPO, SERVIDOR, PORTA, BANCO, USUARIO, SSL, TIMEOUT, ARQUIVO, ATIVO, SENHA_CRIPT)
            VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(...vals, secrets.encrypt(f.senha)).lastInsertRowid);
        }
        db.prepare('DELETE FROM GW_BANCO_PARAMETRO WHERE BANCO_ID = ?').run(id);
        const ins = db.prepare('INSERT INTO GW_BANCO_PARAMETRO (BANCO_ID, CHAVE, VALOR) VALUES (?,?,?)');
        for (const [k, v] of Object.entries(f.parametros || {})) {
          if (ALLOWED_PARAMS.includes(k) && v !== '' && v !== null && v !== undefined) ins.run(id, k, String(v));
        }
      })();
      await connections.invalidate(id);
      ctx.invalidate();
      logger.audit({ acao: f.id ? 'BANCO_ALTERADO' : 'BANCO_CRIADO', usuarioId: session.userId, usuario: session.usuario, entidade: 'BANCO', entidadeId: id, detalhes: { nome: f.nome, tipo: f.tipo, senhaAlterada: !!f.senha } });
      return { id };
    },

    async remove(session, { id }) {
      const n = db.prepare('SELECT COUNT(*) AS n FROM GW_ENDPOINT e JOIN GW_TABELA t ON t.ID = e.TABELA_ID WHERE t.BANCO_ID = ?').get(id).n;
      if (n > 0) throw new GatewayError('VALIDATION_ERROR', `Esta conexão possui ${n} endpoint(s). Exclua-os antes.`);
      await connections.invalidate(id);
      db.prepare('DELETE FROM GW_BANCO WHERE ID = ?').run(id);
      ctx.invalidate();
      logger.audit({ acao: 'BANCO_EXCLUIDO', usuarioId: session.userId, usuario: session.usuario, entidade: 'BANCO', entidadeId: id });
      return { ok: true };
    },

    /** Testa a conexão com os dados do formulário (sem salvar). */
    async test(f) {
      validate({ nome: f.nome || 'teste', ...f });
      try {
        const r = await ConnectionManager.testDraft(draftConfig(f));
        return { ok: true, message: 'Conexão realizada com sucesso.', version: r.version, elapsedMs: r.elapsedMs };
      } catch (err) {
        return { ok: false, message: 'Falha na conexão.', details: err.message || String(err) };
      }
    },

    status() {
      return connections.status();
    },

    async reconnect({ id }) {
      await connections.invalidate(id);
      try {
        await connections.getDriver(id);
        return { ok: true };
      } catch (err) {
        return { ok: false, details: (err.cause && err.cause.message) || err.message };
      }
    },

    async listObjects({ id }) {
      const drv = await connections.getDriver(id);
      const tables = await drv.getTables();
      const configured = new Set(db.prepare(`SELECT COALESCE(t.ESQUEMA,'') || '.' || t.NOME AS k FROM GW_TABELA t JOIN GW_ENDPOINT e ON e.TABELA_ID = t.ID WHERE t.BANCO_ID = ?`).all(id).map((r) => r.k));
      return tables.map((t) => ({ ...t, configurado: configured.has(`${t.schema || ''}.${t.name}`) }));
    },

    /** Descreve tabela/view e sugere configuração inicial dos campos. */
    async describe({ id, schema, table }) {
      const drv = await connections.getDriver(id);
      const tables = await drv.getTables();
      const obj = tables.find((t) => (t.schema || null) === (schema || null) && t.name === table);
      if (!obj) throw new GatewayError('NOT_FOUND', 'Tabela/view não encontrada no banco.');
      const d = await drv.describeTable(schema || null, table);
      const columns = d.columns.map((c, i) => {
        const tipoLogico = inferLogicalType(c.dataType);
        const pk = !!c.isPrimaryKey;
        const auto = !!c.isAutoIncrement;
        const computed = !!c.isComputed;
        const writable = !auto && !computed && obj.type === 'TABLE' && tipoLogico !== 'ARQUIVO';
        return {
          nome: c.name,
          nomeApi: toApiName(c.name),
          descricao: '',
          tipoFisico: c.dataType,
          tipoLogico,
          tamanho: c.length,
          precisao: c.precision,
          escala: c.scale,
          nulo: !!c.nullable,
          pk,
          auto,
          padrao: c.defaultValue === undefined ? null : c.defaultValue,
          ordem: i,
          computado: computed,
          retornar: tipoLogico !== 'ARQUIVO',
          incluir: writable,
          alterar: writable && !pk,
          obrigatorio: !c.nullable && !auto && !computed && (c.defaultValue === null || c.defaultValue === undefined)
        };
      });
      return { schema: d.schema, name: d.name, type: obj.type, columns, primaryKeys: d.primaryKeys, foreignKeys: d.foreignKeys, indexes: d.indexes };
    }
  };
}

module.exports = { createBancosAdmin, toApiName };
