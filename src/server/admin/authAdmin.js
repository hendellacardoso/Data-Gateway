'use strict';

const { hashPassword, verifyPassword, validatePasswordStrength } = require('../security/hashing');
const { GatewayError } = require('../errors');

const USER_RE = /^[A-Za-z0-9._@-]{3,50}$/;
const MAX_FAILS = 5;
const LOCK_MS = 5 * 60 * 1000;

function createAuthAdmin(ctx) {
  const { db, logger } = ctx;
  const fails = new Map();

  function needsSetup() {
    return db.prepare('SELECT COUNT(*) AS n FROM GW_USUARIO').get().n === 0;
  }

  function validateNew({ usuario, senha, confirmar }) {
    if (!USER_RE.test(usuario || '')) throw new GatewayError('VALIDATION_ERROR', 'Usuário inválido (3 a 50 caracteres: letras, números, ".", "_", "-", "@").');
    const weak = validatePasswordStrength(senha);
    if (weak) throw new GatewayError('VALIDATION_ERROR', weak);
    if (confirmar !== undefined && senha !== confirmar) throw new GatewayError('VALIDATION_ERROR', 'A confirmação da senha não confere.');
  }

  return {
    status() {
      return { needsSetup: needsSetup() };
    },

    /** Criação do administrador inicial (somente quando não há usuários). */
    setup({ usuario, senha, confirmar, nome }) {
      if (!needsSetup()) throw new GatewayError('AUTHORIZATION_ERROR', 'O administrador já foi criado.');
      validateNew({ usuario, senha, confirmar });
      const id = db.prepare("INSERT INTO GW_USUARIO (USUARIO, NOME, SENHA_HASH, PERFIL) VALUES (?, ?, ?, 'ADMIN')")
        .run(usuario.trim(), nome || 'Administrador', hashPassword(senha)).lastInsertRowid;
      logger.audit({ acao: 'ADMIN_CRIADO', usuarioId: Number(id), usuario, entidade: 'USUARIO', entidadeId: id });
      return { ok: true };
    },

    login({ usuario, senha }) {
      const key = String(usuario || '').toLowerCase();
      const f = fails.get(key);
      if (f && f.count >= MAX_FAILS && Date.now() - f.last < LOCK_MS) {
        throw new GatewayError('AUTHENTICATION_ERROR', 'Muitas tentativas. Aguarde alguns minutos e tente novamente.');
      }
      const row = db.prepare('SELECT * FROM GW_USUARIO WHERE USUARIO = ?').get(String(usuario || '').trim());
      const ok = row && row.ATIVO && verifyPassword(senha, row.SENHA_HASH);
      if (!ok) {
        const cur = fails.get(key) || { count: 0, last: 0 };
        fails.set(key, { count: Date.now() - cur.last > LOCK_MS ? 1 : cur.count + 1, last: Date.now() });
        logger.audit({ acao: 'LOGIN_FALHA', usuario: String(usuario || '').slice(0, 50) });
        throw new GatewayError('AUTHENTICATION_ERROR', 'Usuário ou senha inválidos.');
      }
      fails.delete(key);
      db.prepare('UPDATE GW_USUARIO SET ULTIMO_LOGIN = ? WHERE ID = ?').run(new Date().toISOString(), row.ID);
      logger.audit({ acao: 'LOGIN', usuarioId: row.ID, usuario: row.USUARIO });
      return { userId: row.ID, usuario: row.USUARIO, nome: row.NOME, perfil: row.PERFIL };
    },

    logout(session) {
      if (session) logger.audit({ acao: 'LOGOUT', usuarioId: session.userId, usuario: session.usuario });
    },

    changePassword(session, { senhaAtual, novaSenha, confirmar }) {
      const row = db.prepare('SELECT * FROM GW_USUARIO WHERE ID = ?').get(session.userId);
      if (!row || !verifyPassword(senhaAtual, row.SENHA_HASH)) throw new GatewayError('VALIDATION_ERROR', 'Senha atual incorreta.');
      const weak = validatePasswordStrength(novaSenha);
      if (weak) throw new GatewayError('VALIDATION_ERROR', weak);
      if (novaSenha !== confirmar) throw new GatewayError('VALIDATION_ERROR', 'A confirmação da senha não confere.');
      db.prepare("UPDATE GW_USUARIO SET SENHA_HASH = ?, ATUALIZADO_EM = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE ID = ?").run(hashPassword(novaSenha), row.ID);
      logger.audit({ acao: 'SENHA_ALTERADA', usuarioId: row.ID, usuario: row.USUARIO, entidade: 'USUARIO', entidadeId: row.ID });
      return { ok: true };
    },

    listUsers() {
      return db.prepare('SELECT ID AS id, USUARIO AS usuario, NOME AS nome, PERFIL AS perfil, ATIVO AS ativo, ULTIMO_LOGIN AS ultimoLogin, CRIADO_EM AS criadoEm FROM GW_USUARIO ORDER BY USUARIO').all()
        .map((u) => ({ ...u, ativo: !!u.ativo }));
    },

    saveUser(session, { id, usuario, nome, senha, ativo }) {
      if (id) {
        if (id === session.userId && ativo === false) throw new GatewayError('VALIDATION_ERROR', 'Você não pode desativar o próprio usuário.');
        db.prepare("UPDATE GW_USUARIO SET NOME = ?, ATIVO = ?, ATUALIZADO_EM = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE ID = ?").run(nome || null, ativo === false ? 0 : 1, id);
        if (senha) {
          const weak = validatePasswordStrength(senha);
          if (weak) throw new GatewayError('VALIDATION_ERROR', weak);
          db.prepare('UPDATE GW_USUARIO SET SENHA_HASH = ? WHERE ID = ?').run(hashPassword(senha), id);
        }
        logger.audit({ acao: 'USUARIO_ALTERADO', usuarioId: session.userId, usuario: session.usuario, entidade: 'USUARIO', entidadeId: id });
        return { id };
      }
      validateNew({ usuario, senha });
      if (db.prepare('SELECT 1 FROM GW_USUARIO WHERE USUARIO = ?').get(usuario)) throw new GatewayError('VALIDATION_ERROR', 'Usuário já existe.');
      const newId = Number(db.prepare("INSERT INTO GW_USUARIO (USUARIO, NOME, SENHA_HASH, PERFIL, ATIVO) VALUES (?, ?, ?, 'ADMIN', ?)")
        .run(usuario.trim(), nome || null, hashPassword(senha), ativo === false ? 0 : 1).lastInsertRowid);
      logger.audit({ acao: 'USUARIO_CRIADO', usuarioId: session.userId, usuario: session.usuario, entidade: 'USUARIO', entidadeId: newId, detalhes: { usuario } });
      return { id: newId };
    },

    deleteUser(session, { id }) {
      if (id === session.userId) throw new GatewayError('VALIDATION_ERROR', 'Você não pode excluir o próprio usuário.');
      const n = db.prepare('SELECT COUNT(*) AS n FROM GW_USUARIO WHERE ATIVO = 1 AND ID <> ?').get(id).n;
      if (n === 0) throw new GatewayError('VALIDATION_ERROR', 'É necessário manter ao menos um usuário ativo.');
      db.prepare('DELETE FROM GW_USUARIO WHERE ID = ?').run(id);
      logger.audit({ acao: 'USUARIO_EXCLUIDO', usuarioId: session.userId, usuario: session.usuario, entidade: 'USUARIO', entidadeId: id });
      return { ok: true };
    }
  };
}

module.exports = { createAuthAdmin };
