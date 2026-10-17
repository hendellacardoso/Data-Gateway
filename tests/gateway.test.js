'use strict';

/**
 * Teste de integração ponta a ponta usando um banco SQLite externo.
 * Executar fora do Electron:  npm run rebuild:node && npm test
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const { createContext } = require('../src/server/context');
const { createAdmin } = require('../src/server/admin');
const { GatewayServer } = require('../src/server/server');

const PORT = 18000 + Math.floor(Math.random() * 1000);
const BASE = `http://127.0.0.1:${PORT}`;

let ctx, admin, server, session, tokenFull, tokenRead, dir;

async function call(method, url, { token, body, headers = {} } = {}) {
  const h = { ...headers };
  if (token) h.Authorization = 'Bearer ' + token;
  if (body !== undefined) h['Content-Type'] = 'application/json';
  const res = await fetch(BASE + url, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, json, text, headers: res.headers };
}

test.before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gw-test-'));
  const extFile = path.join(dir, 'erp.db');
  const ext = new Database(extFile);
  ext.exec(`
    CREATE TABLE CLIENTES (
      ID INTEGER PRIMARY KEY AUTOINCREMENT,
      NOME VARCHAR(150) NOT NULL,
      CPF VARCHAR(11) NOT NULL UNIQUE,
      EMAIL VARCHAR(150),
      ATIVO BOOLEAN NOT NULL DEFAULT 1,
      DATA_CADASTRO DATE
    );
    CREATE TABLE CLIENTE_ENDERECO (
      ID INTEGER PRIMARY KEY AUTOINCREMENT,
      CLIENTE_ID INTEGER NOT NULL REFERENCES CLIENTES(ID),
      CIDADE VARCHAR(80),
      UF CHAR(2)
    );
    INSERT INTO CLIENTES (NOME, CPF, EMAIL, ATIVO, DATA_CADASTRO) VALUES
      ('João da Silva', '00000000001', 'joao@email.com', 1, '2026-01-10'),
      ('Maria Souza', '00000000002', 'maria@email.com', 1, '2026-02-11'),
      ('Pedro 100% Teste', '00000000003', NULL, 0, '2026-03-12');
    INSERT INTO CLIENTE_ENDERECO (CLIENTE_ID, CIDADE, UF) VALUES (1, 'Lajeado', 'RS'), (2, 'Porto Alegre', 'RS');
  `);
  ext.close();

  ctx = createContext({ dataDir: path.join(dir, 'data') });
  ctx.config.set('api', { port: PORT, host: '127.0.0.1' });
  server = new GatewayServer(ctx);
  admin = createAdmin(ctx, { serverStatus: () => server.status(), serverControl: (a) => server[a]() });
  const A = admin.actions;

  A['auth.setup'].fn({ usuario: 'admin', senha: 'Senha123', confirmar: 'Senha123' });
  session = A['auth.login'].fn({ usuario: 'admin', senha: 'Senha123' });

  const { id: bancoId } = await A['bancos.save'].fn({ nome: 'ERP', tipo: 'sqlite', arquivo: extFile }, session);
  const t = await A['bancos.test'].fn({ tipo: 'sqlite', arquivo: extFile });
  assert.ok(t.ok, 'teste de conexão');

  const objs = await A['bancos.objects'].fn({ id: bancoId });
  assert.deepStrictEqual(objs.map((o) => o.name).sort(), ['CLIENTES', 'CLIENTE_ENDERECO']);

  const dc = await A['bancos.describe'].fn({ id: bancoId, schema: null, table: 'CLIENTES' });
  const id = dc.columns.find((c) => c.nome === 'ID');
  assert.ok(id.pk && id.auto, 'PK autoincrement detectada');
  assert.strictEqual(dc.columns.find((c) => c.nome === 'ATIVO').tipoLogico, 'BOOLEANO');
  assert.strictEqual(dc.columns.find((c) => c.nome === 'DATA_CADASTRO').tipoLogico, 'DATA');
  assert.strictEqual(dc.columns.find((c) => c.nome === 'NOME').tamanho, 150);

  const ep = A['endpoints.save'].fn({
    bancoId, esquema: null, tabela: 'CLIENTES', tipoObjeto: 'TABLE', descricao: 'Cadastro de clientes', slug: 'clientes',
    publicar: true,
    ops: { listar: true, buscar: true, incluir: true, alterar: true, patch: false, excluir: true },
    exclusao: { modo: 'LOGICA', campo: 'ATIVO', valorAtivo: '1', valorExcluido: '0' },
    paginacao: { padrao: 2, max: 50 },
    upload: { ativo: true, extensoes: 'pdf, png, txt', tamanhoMaxMb: 1, qtdMax: 2, armazenamento: 'FS', padraoNome: 'UUID' },
    campos: dc.columns,
    filtros: [
      { campo: 'NOME', operador: 'contains', parametro: 'nome' },
      { campo: 'CPF', operador: 'eq', parametro: 'cpf' },
      { campo: 'DATA_CADASTRO', operador: 'gte', parametro: 'dataInicio' }
    ],
    ordens: [{ campo: 'NOME', padrao: true, direcao: 'ASC' }, { campo: 'ID' }]
  }, session);

  const dc2 = await A['bancos.describe'].fn({ id: bancoId, table: 'CLIENTE_ENDERECO' });
  const ep2 = A['endpoints.save'].fn({
    bancoId, tabela: 'CLIENTE_ENDERECO', slug: 'enderecos', publicar: true, descricao: 'Endereços',
    ops: { listar: true, buscar: true }, exclusao: { modo: 'FISICA' }, paginacao: { padrao: 50, max: 100 },
    campos: dc2.columns, filtros: [], ordens: []
  }, session);

  const tabs = A['relationships.tables'].fn({}, session);
  const tc = tabs.find((x) => x.nome === 'CLIENTES');
  const te = tabs.find((x) => x.nome === 'CLIENTE_ENDERECO');
  A['relationships.save'].fn({
    nome: 'enderecos', tabelaOrigemId: tc.id, campoOrigemId: tc.campos.find((c) => c.nome === 'ID').id,
    tabelaDestinoId: te.id, campoDestinoId: te.campos.find((c) => c.nome === 'CLIENTE_ID').id, cardinalidade: 'MUITOS'
  }, session);

  const all = { listar: true, buscar: true, incluir: true, alterar: true, excluir: true, upload: true };
  tokenFull = A['tokens.create'].fn({ nome: 'Sistema ERP', permissoes: [{ endpointId: ep.endpointId, ...all }, { endpointId: ep2.endpointId, listar: true }] }, session).token;
  tokenRead = A['tokens.create'].fn({ nome: 'Somente leitura', permissoes: [{ endpointId: ep.endpointId, listar: true, buscar: true }] }, session).token;

  await server.start();
});

test.after(async () => {
  await server.stop();
  await ctx.close();
});

test('autenticação', async () => {
  assert.strictEqual((await call('GET', '/api/v1/clientes')).status, 401);
  assert.strictEqual((await call('GET', '/api/v1/clientes', { token: 'gw_invalido_123456' })).status, 401);
  const r = await call('GET', '/api/v1/clientes?token=abc', { token: tokenFull });
  assert.strictEqual(r.status, 400);
  assert.strictEqual(r.json.error.code, 'AUTHENTICATION_ERROR');
});

test('consulta com paginação, ordenação e exclusão lógica', async () => {
  const r = await call('GET', '/api/v1/clientes', { token: tokenRead });
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(r.json.pagination, { page: 1, pageSize: 2, total: 2, totalPages: 1 });
  assert.deepStrictEqual(r.json.data.map((x) => x.nome), ['João da Silva', 'Maria Souza']);
  assert.strictEqual(r.json.data[0].ativo, true);
  assert.strictEqual(r.json.data[0].data_cadastro, '2026-01-10');
  const d = await call('GET', '/api/v1/clientes?sort=nome&direction=desc', { token: tokenRead });
  assert.strictEqual(d.json.data[0].nome, 'Maria Souza');
  const bad = await call('GET', '/api/v1/clientes?pageSize=999', { token: tokenRead });
  assert.strictEqual(bad.status, 400);
  const badSort = await call('GET', '/api/v1/clientes?sort=email', { token: tokenRead });
  assert.strictEqual(badSort.status, 400);
});

test('filtros e proteção contra SQL injection', async () => {
  const r = await call('GET', '/api/v1/clientes?nome=' + encodeURIComponent('joão'), { token: tokenRead });
  assert.strictEqual(r.json.data.length, 1);
  const inj = await call('GET', '/api/v1/clientes?nome=' + encodeURIComponent("' OR 1=1 --"), { token: tokenRead });
  assert.strictEqual(inj.status, 200);
  assert.strictEqual(inj.json.data.length, 0);
  const pct = await call('GET', '/api/v1/clientes?nome=' + encodeURIComponent('%'), { token: tokenRead });
  assert.strictEqual(pct.json.data.length, 0, '% tratado como literal');
  const unk = await call('GET', '/api/v1/clientes?table=USUARIOS', { token: tokenRead });
  assert.strictEqual(unk.status, 400);
  const date = await call('GET', '/api/v1/clientes?dataInicio=2026-02-01', { token: tokenRead });
  assert.strictEqual(date.json.data.length, 1);
  const badDate = await call('GET', '/api/v1/clientes?dataInicio=ontem', { token: tokenRead });
  assert.strictEqual(badDate.status, 400);
});

test('consulta por ID, relacionamentos e 404', async () => {
  const r = await call('GET', '/api/v1/clientes/1?expand=enderecos', { token: tokenFull });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.data.enderecos[0].cidade, 'Lajeado');
  const nf = await call('GET', '/api/v1/clientes/999', { token: tokenFull });
  assert.strictEqual(nf.status, 404);
  assert.strictEqual(nf.json.error.code, 'NOT_FOUND');
  const deleted = await call('GET', '/api/v1/clientes/3', { token: tokenFull });
  assert.strictEqual(deleted.status, 404, 'registro logicamente excluído não aparece');
  const noPerm = await call('GET', '/api/v1/clientes/1?expand=enderecos', { token: tokenRead });
  assert.strictEqual(noPerm.status, 403);
  const badId = await call('GET', '/api/v1/clientes/abc', { token: tokenFull });
  assert.strictEqual(badId.status, 400);
});

test('inclusão com validação', async () => {
  const v = await call('POST', '/api/v1/clientes', { token: tokenFull, body: { email: 'x@x.com', id: 5, foo: 1 } });
  assert.strictEqual(v.status, 400);
  assert.strictEqual(v.json.error.code, 'VALIDATION_ERROR');
  assert.ok(v.json.error.details.length >= 3);
  const ok = await call('POST', '/api/v1/clientes', { token: tokenFull, body: { nome: 'Ana', cpf: '00000000009', email: 'ana@x.com' } });
  assert.strictEqual(ok.status, 201, ok.text);
  assert.strictEqual(ok.json.data.nome, 'Ana');
  assert.strictEqual(ok.json.data.ativo, true);
  assert.ok(ok.json.data.id > 3);
  const dup = await call('POST', '/api/v1/clientes', { token: tokenFull, body: { nome: 'Ana 2', cpf: '00000000009' } });
  assert.strictEqual(dup.status, 409);
  const big = await call('POST', '/api/v1/clientes', { token: tokenFull, body: { nome: 'x'.repeat(151), cpf: '1' } });
  assert.strictEqual(big.status, 400);
  const ro = await call('POST', '/api/v1/clientes', { token: tokenRead, body: { nome: 'Z', cpf: '7' } });
  assert.strictEqual(ro.status, 403);
  const badJson = await fetch(BASE + '/api/v1/clientes', { method: 'POST', headers: { Authorization: 'Bearer ' + tokenFull, 'Content-Type': 'application/json' }, body: '{nome:' });
  assert.strictEqual(badJson.status, 400);
});

test('alteração, PATCH desabilitado e exclusão lógica', async () => {
  const u = await call('PUT', '/api/v1/clientes/2', { token: tokenFull, body: { nome: 'Maria Cardoso', cpf: '00000000002', email: 'maria@empresa.com' } });
  assert.strictEqual(u.status, 200, u.text);
  assert.strictEqual(u.json.data.email, 'maria@empresa.com');
  const pk = await call('PUT', '/api/v1/clientes/2', { token: tokenFull, body: { id: 99, nome: 'X', cpf: '00000000002' } });
  assert.strictEqual(pk.status, 400, 'PK automática não pode ser alterada');
  const p = await call('PATCH', '/api/v1/clientes/2', { token: tokenFull, body: { nome: 'X' } });
  assert.strictEqual(p.status, 405);
  const del = await call('DELETE', '/api/v1/clientes/2', { token: tokenFull });
  assert.strictEqual(del.status, 200);
  assert.strictEqual(del.json.data.mode, 'logical');
  const after = await call('GET', '/api/v1/clientes/2', { token: tokenFull });
  assert.strictEqual(after.status, 404);
});

test('upload de arquivos', async () => {
  const fd = new FormData();
  fd.append('arquivos', new Blob(['olá mundo'], { type: 'text/plain' }), 'nota.txt');
  const r = await fetch(BASE + '/api/v1/clientes/1/arquivos', { method: 'POST', headers: { Authorization: 'Bearer ' + tokenFull }, body: fd });
  const j = await r.json();
  assert.strictEqual(r.status, 201, JSON.stringify(j));
  assert.strictEqual(j.data[0].nome, 'nota.txt');
  const fd2 = new FormData();
  fd2.append('arquivos', new Blob(['MZ'], { type: 'application/octet-stream' }), 'virus.exe');
  const r2 = await fetch(BASE + '/api/v1/clientes/1/arquivos', { method: 'POST', headers: { Authorization: 'Bearer ' + tokenFull }, body: fd2 });
  assert.strictEqual(r2.status, 400);
  const list = await call('GET', '/api/v1/clientes/1/arquivos', { token: tokenFull });
  assert.strictEqual(list.json.data.length, 1);
  const dl = await fetch(BASE + `/api/v1/clientes/1/arquivos/${list.json.data[0].id}`, { headers: { Authorization: 'Bearer ' + tokenFull } });
  assert.strictEqual(await dl.text(), 'olá mundo');
});

test('OpenAPI, logs e auditoria', async () => {
  const spec = await call('GET', '/openapi.json');
  assert.strictEqual(spec.status, 200);
  assert.ok(spec.json.paths['/api/v1/clientes'].get);
  assert.ok(!spec.json.paths['/api/v1/clientes/{id}'].patch, 'PATCH desabilitado não aparece');
  const docs = await fetch(BASE + '/docs');
  assert.strictEqual(docs.status, 200);
  const logs = admin.actions['logs.list'].fn({});
  assert.ok(logs.total > 10);
  assert.ok(logs.rows.every((l) => !String(l.endpoint).includes('joão')), 'valores de filtros não são gravados');
  const aud = admin.actions['audit.list'].fn({ origem: 'API' });
  assert.ok(aud.rows.some((a) => a.acao === 'EXCLUSAO'));
  const dash = admin.actions['dashboard.get'].fn({});
  assert.strictEqual(dash.endpoints, 2);
  assert.ok(dash.requisicoesHoje > 0);
});

test('backup exporta sem senha e reimporta', async () => {
  const exp = admin.actions['backup.export'].fn({}, session);
  assert.ok(exp.dados.GW_BANCO.every((b) => !b.SENHA_CRIPT));
  assert.ok(exp.dados.GW_TOKEN.every((t) => t.TOKEN_HASH && !('token' in t)));
  const r = admin.actions['backup.import'].fn({ conteudo: JSON.stringify(exp) }, session);
  assert.ok(r.ok);
  const again = await call('GET', '/api/v1/clientes', { token: tokenRead });
  assert.strictEqual(again.status, 200, 'tokens continuam válidos após importação');
});
