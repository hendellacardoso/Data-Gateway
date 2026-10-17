'use strict';

const { createAuthAdmin } = require('./authAdmin');
const { createBancosAdmin } = require('./bancosAdmin');
const { createApiAdmin } = require('./apiAdmin');
const { createSystemAdmin } = require('./systemAdmin');
const { GatewayError } = require('../errors');

const ALLOWED_TEST_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

/**
 * Registro de ações do painel. Cada ação declara se exige sessão autenticada.
 * O processo principal do Electron expõe estas ações via um único canal IPC (whitelist por nome).
 *
 * @param ctx contexto do gateway
 * @param hooks { serverStatus(), serverControl(action), onConfigSaved(section, value) }
 */
function createAdmin(ctx, hooks = {}) {
  const auth = createAuthAdmin(ctx);
  const bancos = createBancosAdmin(ctx);
  const api = createApiAdmin(ctx);
  const sys = createSystemAdmin(ctx, hooks);

  /** Testador de API: executa a requisição a partir do processo principal (sem CORS, sem expor Node ao renderer). */
  async function sendTestRequest({ method, url, token, body, files }) {
    const m = String(method || 'GET').toUpperCase();
    if (!ALLOWED_TEST_METHODS.includes(m)) throw new GatewayError('VALIDATION_ERROR', 'Método inválido.');
    let u;
    try { u = new URL(url); } catch { throw new GatewayError('VALIDATION_ERROR', 'URL inválida.'); }
    if (!['http:', 'https:'].includes(u.protocol)) throw new GatewayError('VALIDATION_ERROR', 'Somente http/https.');
    const headers = {};
    if (token) headers.Authorization = 'Bearer ' + String(token).trim();
    let payload;
    if (files && files.length) {
      const fd = new FormData();
      for (const f of files) fd.append('arquivos', new Blob([Buffer.from(f.data)], { type: f.type || 'application/octet-stream' }), f.name);
      payload = fd;
    } else if (body && !['GET', 'DELETE'].includes(m)) {
      try { JSON.parse(body); } catch { throw new GatewayError('VALIDATION_ERROR', 'O corpo não é um JSON válido.'); }
      headers['Content-Type'] = 'application/json';
      payload = body;
    }
    const t0 = Date.now();
    const res = await fetch(u, { method: m, headers, body: payload, signal: AbortSignal.timeout(60000) });
    const ct = res.headers.get('content-type') || '';
    const buf = Buffer.from(await res.arrayBuffer());
    let text;
    if (/json/.test(ct)) {
      try { text = JSON.stringify(JSON.parse(buf.toString('utf8')), null, 2); } catch { text = buf.toString('utf8'); }
    } else if (/text|html|javascript|xml/.test(ct)) text = buf.toString('utf8');
    else text = `(${buf.length} bytes — ${ct || 'binário'})`;
    return {
      status: res.status,
      statusText: res.statusText,
      timeMs: Date.now() - t0,
      headers: Object.fromEntries(res.headers.entries()),
      body: text.length > 2_000_000 ? text.slice(0, 2_000_000) + '\n… (truncado)' : text
    };
  }

  const pub = (fn) => ({ auth: false, fn });
  const priv = (fn) => ({ auth: true, fn });

  const actions = {
    'auth.status': pub(() => auth.status()),
    'auth.setup': pub((p) => auth.setup(p)),
    // login/logout/me são tratados pela camada IPC (gerencia a sessão), mas a validação fica aqui:
    'auth.login': pub((p) => auth.login(p)),
    'auth.changePassword': priv((p, s) => auth.changePassword(s, p)),

    'users.list': priv(() => auth.listUsers()),
    'users.save': priv((p, s) => auth.saveUser(s, p)),
    'users.delete': priv((p, s) => auth.deleteUser(s, p)),

    'dashboard.get': priv(() => sys.dashboard()),
    'statusbar.get': priv(() => sys.statusBar()),

    'bancos.types': priv(() => bancos.types()),
    'bancos.list': priv(() => bancos.list()),
    'bancos.get': priv((p) => bancos.get(p)),
    'bancos.save': priv((p, s) => bancos.save(s, p)),
    'bancos.delete': priv((p, s) => bancos.remove(s, p)),
    'bancos.test': priv((p) => bancos.test(p)),
    'bancos.status': priv(() => bancos.status()),
    'bancos.reconnect': priv((p) => bancos.reconnect(p)),
    'bancos.objects': priv((p) => bancos.listObjects(p)),
    'bancos.describe': priv((p) => bancos.describe(p)),

    'api.operators': priv(() => api.operators()),
    'endpoints.list': priv(() => api.listEndpoints()),
    'endpoints.get': priv((p) => api.getEndpoint(p)),
    'endpoints.preview': priv((p) => api.preview(p)),
    'endpoints.save': priv((p, s) => api.saveEndpoint(s, p)),
    'endpoints.publish': priv((p, s) => api.setPublished(s, p)),
    'endpoints.delete': priv((p, s) => api.deleteEndpoint(s, p)),

    'tokens.list': priv(() => api.listTokens()),
    'tokens.create': priv((p, s) => api.createToken(s, p)),
    'tokens.update': priv((p, s) => api.updateToken(s, p)),
    'tokens.revoke': priv((p, s) => api.revokeToken(s, p)),
    'tokens.delete': priv((p, s) => api.deleteToken(s, p)),
    'tokens.permissions': priv((p) => api.getPermissions(p)),
    'tokens.savePermissions': priv((p, s) => api.savePermissions(s, p)),

    'relationships.list': priv(() => api.listRelationships()),
    'relationships.tables': priv(() => api.configuredTables()),
    'relationships.save': priv((p, s) => api.saveRelationship(s, p)),
    'relationships.delete': priv((p, s) => api.deleteRelationship(s, p)),

    'files.list': priv((p) => api.listFiles(p)),

    'logs.list': priv((p) => sys.logs(p)),
    'logs.clear': priv((p, s) => sys.clearLogs(s)),
    'audit.list': priv((p) => sys.audit(p)),

    'config.get': priv(() => sys.getConfig()),
    'config.save': priv((p, s) => sys.saveConfig(s, p)),
    'backup.export': priv((p, s) => sys.exportConfig(s, p)),
    'backup.import': priv((p, s) => sys.importConfig(s, p)),

    'docs.spec': priv(() => ctx.buildSpec((hooks.serverStatus && hooks.serverStatus().url) || 'http://127.0.0.1:8787')),
    'tester.send': priv((p) => sendTestRequest(p)),

    'server.status': priv(() => (hooks.serverStatus ? hooks.serverStatus() : null)),
    'server.control': priv(async (p, s) => {
      if (!['start', 'stop', 'restart'].includes(p.action)) throw new GatewayError('VALIDATION_ERROR', 'Ação inválida.');
      const r = await hooks.serverControl(p.action);
      ctx.logger.audit({ usuarioId: s.userId, usuario: s.usuario, acao: 'SERVICO_' + p.action.toUpperCase() });
      return r;
    })
  };

  return { actions, auth };
}

module.exports = { createAdmin };
