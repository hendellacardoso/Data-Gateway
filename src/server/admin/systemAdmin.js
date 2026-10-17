'use strict';

const secrets = require('../security/secrets');
const { GatewayError } = require('../errors');

const EXPORT_TABLES = [
  'GW_BANCO', 'GW_BANCO_PARAMETRO', 'GW_TABELA', 'GW_CAMPO', 'GW_RELACIONAMENTO', 'GW_ENDPOINT',
  'GW_ENDPOINT_CAMPO', 'GW_ENDPOINT_FILTRO', 'GW_ENDPOINT_ORDEM', 'GW_TOKEN', 'GW_TOKEN_PERMISSAO', 'GW_CONFIG',
  'GW_CONSULTA', 'GW_CONSULTA_PARAMETRO', 'GW_TOKEN_PERMISSAO_CONSULTA'
];

function startOfTodayIso() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

/** Dashboard, logs, auditoria, configurações e backup. */
function createSystemAdmin(ctx, hooks = {}) {
  const { db, logger, config } = ctx;
  const who = (s) => ({ usuarioId: s.userId, usuario: s.usuario });

  return {
    /** Resumo leve para a barra de status (consultado periodicamente pelo painel). */
    statusBar() {
      const today = startOfTodayIso();
      const req = db.prepare(`SELECT COUNT(*) AS total, SUM(CASE WHEN STATUS >= 400 THEN 1 ELSE 0 END) AS erros,
          AVG(TEMPO_MS) AS media, MAX(DATA_HORA) AS ultima FROM GW_LOG WHERE DATA_HORA >= ?`).get(today);
      const status = ctx.connections.status();
      const ativos = status.filter((s) => s.ativo);
      return {
        gateway: hooks.serverStatus ? hooks.serverStatus() : null,
        bancos: ativos.length,
        bancosConectados: ativos.filter((s) => s.conectado).length,
        bancosComErro: ativos.filter((s) => s.ultimoErro).length,
        endpoints: db.prepare('SELECT COUNT(*) AS n FROM GW_ENDPOINT WHERE PUBLICADO = 1 AND ATIVO = 1').get().n,
        consultas: db.prepare('SELECT COUNT(*) AS n FROM GW_CONSULTA WHERE PUBLICADO = 1 AND ATIVO = 1').get().n,
        tokens: db.prepare("SELECT COUNT(*) AS n FROM GW_TOKEN WHERE ATIVO = 1 AND REVOGADO_EM IS NULL AND (EXPIRA_EM IS NULL OR EXPIRA_EM > strftime('%Y-%m-%dT%H:%M:%fZ','now'))").get().n,
        requisicoesHoje: req.total || 0,
        errosHoje: req.erros || 0,
        tempoMedioMs: req.media ? Math.round(req.media) : 0,
        ultimaRequisicao: req.ultima || null,
        ambiente: process.env.NODE_ENV === 'development' ? 'development' : 'production',
        versao: ctx.version
      };
    },

    dashboard() {
      const today = startOfTodayIso();
      const req = db.prepare(`SELECT COUNT(*) AS total, SUM(CASE WHEN STATUS >= 400 THEN 1 ELSE 0 END) AS erros,
          AVG(TEMPO_MS) AS media FROM GW_LOG WHERE DATA_HORA >= ?`).get(today);
      const since = new Date(Date.now() - 23 * 3600 * 1000);
      since.setMinutes(0, 0, 0);
      const hourly = db.prepare(`SELECT substr(DATA_HORA, 1, 13) AS h, COUNT(*) AS n, SUM(CASE WHEN STATUS >= 400 THEN 1 ELSE 0 END) AS e
          FROM GW_LOG WHERE DATA_HORA >= ? GROUP BY h ORDER BY h`).all(since.toISOString());
      const map = new Map(hourly.map((r) => [r.h, r]));
      const series = [];
      for (let i = 0; i < 24; i++) {
        const d = new Date(since.getTime() + i * 3600 * 1000);
        const k = d.toISOString().slice(0, 13);
        series.push({ hora: d.toISOString(), requisicoes: map.get(k)?.n || 0, erros: map.get(k)?.e || 0 });
      }
      const top = db.prepare(`SELECT TABELA AS tabela, COUNT(*) AS n FROM GW_LOG WHERE DATA_HORA >= ? AND TABELA IS NOT NULL
          GROUP BY TABELA ORDER BY n DESC LIMIT 5`).all(today);
      const status = ctx.connections.status();
      return {
        gateway: hooks.serverStatus ? hooks.serverStatus() : null,
        bancos: db.prepare('SELECT COUNT(*) AS n FROM GW_BANCO WHERE ATIVO = 1').get().n,
        bancosConectados: status.filter((s) => s.conectado).length,
        bancosComErro: status.filter((s) => s.ultimoErro).length,
        endpoints: db.prepare('SELECT COUNT(*) AS n FROM GW_ENDPOINT WHERE PUBLICADO = 1 AND ATIVO = 1').get().n,
        endpointsRascunho: db.prepare('SELECT COUNT(*) AS n FROM GW_ENDPOINT WHERE PUBLICADO = 0').get().n,
        tokens: db.prepare("SELECT COUNT(*) AS n FROM GW_TOKEN WHERE ATIVO = 1 AND REVOGADO_EM IS NULL AND (EXPIRA_EM IS NULL OR EXPIRA_EM > strftime('%Y-%m-%dT%H:%M:%fZ','now'))").get().n,
        requisicoesHoje: req.total || 0,
        errosHoje: req.erros || 0,
        tempoMedioMs: req.media ? Math.round(req.media) : 0,
        serie24h: series,
        topTabelas: top
      };
    },

    logs({ page = 1, pageSize = 50, status, metodo, texto, desde, ate } = {}) {
      const where = [];
      const params = [];
      if (status === 'erro') where.push('STATUS >= 400');
      else if (status === 'ok') where.push('STATUS < 400');
      if (metodo) { where.push('METODO = ?'); params.push(metodo); }
      if (texto) { where.push('(ENDPOINT LIKE ? OR TOKEN_NOME LIKE ? OR TABELA LIKE ? OR ERRO LIKE ? OR IP LIKE ?)'); params.push(...Array(5).fill(`%${texto}%`)); }
      if (desde) { where.push('DATA_HORA >= ?'); params.push(new Date(desde).toISOString()); }
      if (ate) { where.push('DATA_HORA <= ?'); params.push(new Date(ate).toISOString()); }
      const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
      const total = db.prepare(`SELECT COUNT(*) AS n FROM GW_LOG ${w}`).get(...params).n;
      const rows = db.prepare(`SELECT ID AS id, DATA_HORA AS dataHora, IP AS ip, TOKEN_NOME AS token, METODO AS metodo, ENDPOINT AS endpoint,
          BANCO AS banco, TABELA AS tabela, OPERACAO AS operacao, STATUS AS status, TEMPO_MS AS tempoMs, ERRO AS erro
        FROM GW_LOG ${w} ORDER BY ID DESC LIMIT ? OFFSET ?`).all(...params, Math.min(500, pageSize), (Math.max(1, page) - 1) * pageSize);
      return { rows, total };
    },

    clearLogs(session) {
      db.prepare('DELETE FROM GW_LOG').run();
      logger.audit({ ...who(session), acao: 'LOGS_LIMPOS' });
      return { ok: true };
    },

    audit({ page = 1, pageSize = 50, texto, origem } = {}) {
      const where = [];
      const params = [];
      if (origem) { where.push('ORIGEM = ?'); params.push(origem); }
      if (texto) { where.push('(ACAO LIKE ? OR USUARIO LIKE ? OR ENTIDADE LIKE ? OR DETALHES LIKE ?)'); params.push(...Array(4).fill(`%${texto}%`)); }
      const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
      const total = db.prepare(`SELECT COUNT(*) AS n FROM GW_AUDITORIA ${w}`).get(...params).n;
      const rows = db.prepare(`SELECT ID AS id, DATA_HORA AS dataHora, ORIGEM AS origem, USUARIO AS usuario, ACAO AS acao,
          ENTIDADE AS entidade, ENTIDADE_ID AS entidadeId, DETALHES AS detalhes, IP AS ip
        FROM GW_AUDITORIA ${w} ORDER BY ID DESC LIMIT ? OFFSET ?`).all(...params, Math.min(500, pageSize), (Math.max(1, page) - 1) * pageSize);
      return { rows, total };
    },

    getConfig() {
      return { ...config.getAll(), paths: ctx.paths, ambiente: process.env.NODE_ENV === 'development' ? 'development' : 'production' };
    },

    async saveConfig(session, { section, value }) {
      if (!['api', 'app', 'logs'].includes(section)) throw new GatewayError('VALIDATION_ERROR', 'Seção de configuração inválida.');
      if (section === 'api') {
        const v = value || {};
        if (v.port !== undefined && !(Number(v.port) >= 1 && Number(v.port) <= 65535)) throw new GatewayError('VALIDATION_ERROR', 'Porta inválida.');
        if (v.host !== undefined && !/^[A-Za-z0-9.:\-\[\]]+$/.test(v.host)) throw new GatewayError('VALIDATION_ERROR', 'Host inválido.');
        if (v.port !== undefined) v.port = Number(v.port);
        if (v.corsOrigins !== undefined && !Array.isArray(v.corsOrigins)) {
          v.corsOrigins = String(v.corsOrigins).split(/[\s,;]+/).filter(Boolean);
        }
        for (const k of ['timeoutMs', 'rateLimitPerMinute', 'bodyLimitKb']) if (v[k] !== undefined) v[k] = Math.max(1, Number(v[k]) || 1);
      }
      const saved = config.set(section, value);
      logger.audit({ ...who(session), acao: 'CONFIG_ALTERADA', entidade: 'CONFIG', entidadeId: section, detalhes: section === 'api' ? { ...saved, keyPath: saved.keyPath ? '(definido)' : '' } : saved });
      if (hooks.onConfigSaved) await hooks.onConfigSaved(section, saved);
      return saved;
    },

    /** Exporta a configuração (.datagateway). Senhas de banco só são incluídas se protegidas por uma frase-senha. */
    exportConfig(session, { passphrase } = {}) {
      if (passphrase && String(passphrase).length < 8) throw new GatewayError('VALIDATION_ERROR', 'A frase-senha deve ter pelo menos 8 caracteres.');
      const data = {};
      for (const t of EXPORT_TABLES) data[t] = db.prepare(`SELECT * FROM ${t}`).all();
      data.GW_BANCO = data.GW_BANCO.map((b) => {
        const out = { ...b, SENHA_CRIPT: null, SENHA_EXPORT: null };
        if (passphrase && b.SENHA_CRIPT) out.SENHA_EXPORT = secrets.encryptWithPassphrase(secrets.decrypt(b.SENHA_CRIPT), passphrase);
        return out;
      });
      logger.audit({ ...who(session), acao: 'BACKUP_EXPORTADO', detalhes: { senhasIncluidas: !!passphrase } });
      return {
        formato: 'datagateway',
        versao: 1,
        aplicativo: ctx.version,
        exportadoEm: new Date().toISOString(),
        senhasProtegidas: !!passphrase,
        observacao: 'Tokens são exportados somente como hash (irreversível). Senhas de banco só aparecem criptografadas com frase-senha.',
        dados: data
      };
    },

    importConfig(session, { conteudo, passphrase }) {
      let doc;
      try { doc = typeof conteudo === 'string' ? JSON.parse(conteudo) : conteudo; } catch { throw new GatewayError('VALIDATION_ERROR', 'Arquivo inválido.'); }
      if (!doc || doc.formato !== 'datagateway' || !doc.dados) throw new GatewayError('VALIDATION_ERROR', 'Arquivo não é uma configuração do Data Gateway.');
      if (doc.senhasProtegidas && !passphrase) throw new GatewayError('VALIDATION_ERROR', 'Este arquivo contém senhas protegidas: informe a frase-senha.');
      const colsOf = (t) => new Set(db.prepare(`SELECT name FROM pragma_table_info('${t}')`).all().map((c) => c.name));
      let semSenha = 0;
      // FKs desligadas durante a importação para não apagar em cascata metadados de arquivos (GW_ARQUIVO).
      db.pragma('foreign_keys = OFF');
      try {
      db.transaction(() => {
        for (const t of [...EXPORT_TABLES].reverse()) db.prepare(`DELETE FROM ${t}`).run();
        for (const t of EXPORT_TABLES) {
          const allowed = colsOf(t);
          for (const raw of doc.dados[t] || []) {
            const row = { ...raw };
            if (t === 'GW_BANCO') {
              let senha = null;
              if (row.SENHA_EXPORT && passphrase) {
                try { senha = secrets.decryptWithPassphrase(row.SENHA_EXPORT, passphrase); } catch { throw new GatewayError('VALIDATION_ERROR', 'Frase-senha incorreta.'); }
              }
              row.SENHA_CRIPT = senha ? secrets.encrypt(senha) : null;
              if (!senha) semSenha++;
              delete row.SENHA_EXPORT;
            }
            const cols = Object.keys(row).filter((c) => allowed.has(c));
            if (!cols.length) continue;
            db.prepare(`INSERT INTO ${t} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(...cols.map((c) => row[c]));
          }
        }
        const broken = db.prepare('SELECT * FROM pragma_foreign_key_check').all().filter((r) => r.table !== 'GW_ARQUIVO');
        if (broken.length) throw new GatewayError('VALIDATION_ERROR', 'Arquivo de configuração inconsistente (referências inválidas).');
      })();
      } finally {
        db.pragma('foreign_keys = ON');
      }
      ctx.connections.closeAll();
      ctx.invalidate();
      logger.audit({ ...who(session), acao: 'BACKUP_IMPORTADO', detalhes: { exportadoEm: doc.exportadoEm } });
      return { ok: true, bancosSemSenha: semSenha };
    }
  };
}

module.exports = { createSystemAdmin };
