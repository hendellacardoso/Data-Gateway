'use strict';

/** Consultas SQL personalizadas: validação, execução somente leitura, parâmetros, paginação e API. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const { createContext } = require('../src/server/context');
const { createAdmin } = require('../src/server/admin');
const { GatewayServer } = require('../src/server/server');
const { analyze } = require('../src/server/services/sqlConsulta');

const PORT = 17000 + Math.floor(Math.random() * 900);
const BASE = `http://127.0.0.1:${PORT}`;
let ctx, A, server, s, token, tokenSem, bancoId, extFile;

const get = async (url, tk = token) => {
  const r = await fetch(BASE + url, { headers: tk ? { Authorization: 'Bearer ' + tk } : {} });
  return { status: r.status, json: await r.json() };
};

test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gw-cons-'));
  extFile = path.join(dir, 'erp.db');
  const e = new Database(extFile);
  e.exec(`CREATE TABLE CLIENTES (ID INTEGER PRIMARY KEY, NOME TEXT, ATIVO INTEGER, CIDADE TEXT);
    CREATE TABLE PEDIDOS (ID INTEGER PRIMARY KEY, CLIENTE_ID INTEGER, VALOR REAL);`);
  const ins = e.prepare('INSERT INTO CLIENTES (NOME, ATIVO, CIDADE) VALUES (?, ?, ?)');
  for (let i = 1; i <= 25; i++) ins.run('Cliente ' + String(i).padStart(2, '0'), i % 5 === 0 ? 0 : 1, i % 2 ? 'Goiânia' : 'Lajeado');
  e.exec('INSERT INTO PEDIDOS (CLIENTE_ID, VALOR) VALUES (1, 10), (1, 15.5), (2, 7)');
  e.close();
  ctx = createContext({ dataDir: path.join(dir, 'data') });
  ctx.config.set('api', { port: PORT });
  server = new GatewayServer(ctx);
  A = createAdmin(ctx, { serverStatus: () => server.status() }).actions;
  A['auth.setup'].fn({ usuario: 'admin', senha: 'Senha123', confirmar: 'Senha123' });
  s = A['auth.login'].fn({ usuario: 'admin', senha: 'Senha123' });
  bancoId = (await A['bancos.save'].fn({ nome: 'ERP', tipo: 'sqlite', arquivo: extFile }, s)).id;
  token = A['tokens.create'].fn({ nome: 'App' }, s).token;
  tokenSem = A['tokens.create'].fn({ nome: 'Sem acesso' }, s).token;
  await server.start();
});

test.after(async () => {
  await server.stop();
  await ctx.close();
});

test('análise bloqueia comandos de escrita e múltiplos comandos', () => {
  const bad = [
    'DELETE FROM CLIENTES', 'SELECT 1; DELETE FROM CLIENTES', 'UPDATE CLIENTES SET NOME = 1',
    'SELECT * INTO X FROM CLIENTES', 'WITH d AS (DELETE FROM t RETURNING *) SELECT * FROM d',
    'SELECT * FROM CLIENTES LIMIT 10', 'PRAGMA table_info(CLIENTES)', 'SELECT * FROM CLIENTES WHERE ID = ?'
  ];
  for (const q of bad) assert.ok(analyze(q, 'sqlite').errors.length, 'deveria bloquear: ' + q);
  const ok = analyze("SELECT NOME AS \"DELETE\", ';' AS x FROM CLIENTES -- UPDATE\nWHERE ID = :id ORDER BY NOME;", 'sqlite');
  assert.deepStrictEqual(ok.errors, []);
  assert.deepStrictEqual(ok.params, ['id']);
});

test('execução de teste no painel com parâmetros e limite', async () => {
  const r = await A['consultas.executar'].fn({
    bancoId, sql: 'SELECT ID, NOME, CIDADE FROM CLIENTES WHERE ATIVO = :ativo AND (:cidade IS NULL OR CIDADE = :cidade) ORDER BY ID',
    parametros: [{ nome: 'ativo', tipo: 'INTEIRO' }], valores: { ativo: '1', cidade: 'Lajeado' }, limite: 5
  }, s);
  assert.deepStrictEqual(r.columns, ['ID', 'NOME', 'CIDADE']);
  assert.strictEqual(r.data.length, 5);
  assert.strictEqual(r.pagination.total, 10);
  assert.strictEqual(r.pagination.hasMore, true);
  await assert.rejects(() => A['consultas.executar'].fn({ bancoId, sql: 'SELECT * FROM NAO_EXISTE' }, s), /no such table/);
});

test('execução no SQLite é realmente somente leitura', async () => {
  // Mesmo que algo escape da análise, a conexão read-only impede escrita
  const drv = await ctx.connections.getDriver(bancoId);
  await assert.rejects(() => drv.queryReadOnly('DELETE FROM CLIENTES', []));
  await assert.rejects(() => drv.queryReadOnly("INSERT INTO CLIENTES (NOME) VALUES ('x') RETURNING ID", []));
  const n = (await drv.query('SELECT COUNT(*) AS n FROM CLIENTES'))[0].n;
  assert.strictEqual(n, 25);
});

test('salvar valida e publica como GET com permissões por token', async () => {
  await assert.rejects(() => Promise.resolve().then(() => A['consultas.save'].fn({
    bancoId, nome: 'X', slug: 'x', sql: 'DELETE FROM CLIENTES', paginacao: { padrao: 10, max: 100 }
  }, s)), /não permitido|SELECT ou WITH/);

  const tokens = A['tokens.list'].fn({}, s);
  const appId = tokens.find((t) => t.nome === 'App').id;
  const r = A['consultas.save'].fn({
    bancoId, nome: 'Clientes por cidade', slug: 'clientes-por-cidade', descricao: 'Lista clientes ativos',
    sql: `SELECT c.ID AS codigo, c.NOME AS nome, c.CIDADE AS cidade, COUNT(p.ID) AS pedidos, COALESCE(SUM(p.VALOR), 0) AS total
          FROM CLIENTES c LEFT JOIN PEDIDOS p ON p.CLIENTE_ID = c.ID
          WHERE c.ATIVO = 1 AND (:cidade IS NULL OR c.CIDADE = :cidade) AND c.ID >= :desde
          GROUP BY c.ID, c.NOME, c.CIDADE
          ORDER BY c.ID`,
    parametros: [{ nome: 'cidade', tipo: 'TEXTO' }, { nome: 'desde', tipo: 'INTEIRO', obrigatorio: true }],
    paginacao: { padrao: 5, max: 50 }, publicar: true, permissoes: [appId]
  }, s);
  assert.ok(r.id);
  assert.deepStrictEqual(r.parametros.map((p) => p.nome), ['cidade', 'desde']);

  const ok = await get('/api/v1/consultas/clientes-por-cidade?desde=1&cidade=Goi%C3%A2nia');
  assert.strictEqual(ok.status, 200, JSON.stringify(ok.json));
  assert.strictEqual(ok.json.data[0].codigo, 1);
  assert.strictEqual(ok.json.data[0].pedidos, 2);
  assert.strictEqual(ok.json.data[0].total, 25.5);
  assert.deepStrictEqual(ok.json.pagination, { page: 1, pageSize: 5, total: 10, totalPages: 2, hasMore: true });

  const p2 = await get('/api/v1/consultas/clientes-por-cidade?desde=1&cidade=Goi%C3%A2nia&page=2');
  assert.strictEqual(p2.json.data.length, 5);
  assert.strictEqual(p2.json.pagination.hasMore, false);

  assert.strictEqual((await get('/api/v1/consultas/clientes-por-cidade')).status, 400, 'obrigatório');
  assert.strictEqual((await get('/api/v1/consultas/clientes-por-cidade?desde=abc')).status, 400, 'tipo');
  assert.strictEqual((await get('/api/v1/consultas/clientes-por-cidade?desde=1&sql=DROP')).status, 400, 'parâmetro desconhecido');
  assert.strictEqual((await get("/api/v1/consultas/clientes-por-cidade?desde=1&cidade=' OR 1=1 --")).json.data.length, 0, 'injeção vira valor');
  assert.strictEqual((await get('/api/v1/consultas/clientes-por-cidade?desde=1', tokenSem)).status, 403);
  assert.strictEqual((await get('/api/v1/consultas/clientes-por-cidade?desde=1', null)).status, 401);
  assert.strictEqual((await get('/api/v1/consultas/nao-existe')).status, 404);
  const post = await fetch(BASE + '/api/v1/consultas/clientes-por-cidade', { method: 'POST', headers: { Authorization: 'Bearer ' + token } });
  assert.strictEqual(post.status, 405);

  const spec = await get('/openapi.json', null);
  assert.ok(spec.json.paths['/api/v1/consultas/clientes-por-cidade'].get.parameters.some((p) => p.name === 'desde' && p.required));

  A['consultas.publish'].fn({ id: r.id, publicado: false }, s);
  assert.strictEqual((await get('/api/v1/consultas/clientes-por-cidade?desde=1')).status, 404);
});

test('endpoint não pode usar o endereço reservado "consultas" e backup inclui consultas', async () => {
  const d = await A['bancos.describe'].fn({ id: bancoId, table: 'CLIENTES' });
  assert.throws(() => A['endpoints.save'].fn({
    bancoId, tabela: 'CLIENTES', slug: 'consultas', ops: { listar: true }, paginacao: { padrao: 10, max: 100 }, campos: d.columns
  }, s), /reservado/);
  const exp = A['backup.export'].fn({}, s);
  assert.strictEqual(exp.dados.GW_CONSULTA.length, 1);
});
