'use strict';

/**
 * Testes opcionais contra bancos reais (PostgreSQL / MySQL / MariaDB).
 * Executam somente se as variáveis de ambiente estiverem definidas (veja README → Testes):
 *   GW_PG_PORT, GW_PG_PASSWORD  → PostgreSQL (schema "vendas")
 *   GW_MY_PORT, GW_MY_PASSWORD, GW_MY_TYPE (mysql|mariadb) → MySQL/MariaDB (database "erp", usuário "gw")
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createContext } = require('../src/server/context');
const { createAdmin } = require('../src/server/admin');
const { GatewayServer } = require('../src/server/server');

const TARGETS = [
  {
    label: 'PostgreSQL', enabled: !!process.env.GW_PG_PORT, schema: 'vendas',
    form: { nome: 'PG', tipo: 'postgres', servidor: '127.0.0.1', porta: process.env.GW_PG_PORT, banco: 'erp', usuario: 'postgres', senha: process.env.GW_PG_PASSWORD || 'pg123' }
  },
  {
    label: 'MySQL/MariaDB', enabled: !!process.env.GW_MY_PORT, schema: 'erp',
    form: { nome: 'MY', tipo: process.env.GW_MY_TYPE || 'mysql', servidor: '127.0.0.1', porta: process.env.GW_MY_PORT, banco: 'erp', usuario: 'gw', senha: process.env.GW_MY_PASSWORD || 'my123' }
  }
];
let PORT = 19000 + Math.floor(Math.random() * 500);

for (const T of TARGETS) test(`${T.label} ponta a ponta`, { skip: !T.enabled && 'variáveis de ambiente não definidas' }, async () => {
  PORT++;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gw-pg-'));
  const ctx = createContext({ dataDir: dir });
  ctx.config.set('api', { port: PORT });
  const server = new GatewayServer(ctx);
  const A = createAdmin(ctx, { serverStatus: () => server.status() }).actions;
  A['auth.setup'].fn({ usuario: 'admin', senha: 'Senha123', confirmar: 'Senha123' });
  const s = A['auth.login'].fn({ usuario: 'admin', senha: 'Senha123' });
  const form = T.form;
  assert.ok((await A['bancos.test'].fn(form)).ok);
  const fail = await A['bancos.test'].fn({ ...form, senha: 'errada', porta: '1' });
  assert.strictEqual(fail.ok, false);
  const { id: bancoId } = await A['bancos.save'].fn(form, s);
  const objs = await A['bancos.objects'].fn({ id: bancoId });
  assert.ok(objs.some((o) => o.name === 'v_clientes' && o.type === 'VIEW'));
  const d = await A['bancos.describe'].fn({ id: bancoId, schema: T.schema, table: 'clientes' });
  const byName = Object.fromEntries(d.columns.map((c) => [c.nome, c]));
  assert.ok(byName.id.pk && byName.id.auto);
  assert.strictEqual(byName.limite.tipoLogico, 'DECIMAL');
  assert.strictEqual(byName.criado_em.tipoLogico, 'DATAHORA');
  // MariaDB armazena JSON como LONGTEXT: o administrador ajusta o tipo lógico no wizard.
  if (byName.extra.tipoLogico === 'TEXTO') byName.extra.tipoLogico = 'JSON';
  assert.strictEqual(byName.extra.tipoLogico, 'JSON');
  assert.strictEqual(byName.ativo.tipoLogico, 'BOOLEANO');
  assert.ok(d.foreignKeys.length === 0 && d.indexes.length >= 1, JSON.stringify(d.indexes));
  const d2 = await A['bancos.describe'].fn({ id: bancoId, schema: T.schema, table: 'cliente_endereco' });
  assert.strictEqual(d2.foreignKeys[0].refTable, 'clientes');

  const ep = A['endpoints.save'].fn({
    bancoId, esquema: T.schema, tabela: 'clientes', slug: 'clientes', publicar: true,
    ops: { listar: true, buscar: true, incluir: true, alterar: true, patch: true, excluir: true },
    exclusao: { modo: 'FISICA' }, paginacao: { padrao: 10, max: 100 },
    campos: d.columns, filtros: [{ campo: 'nome', operador: 'contains', parametro: 'nome' }, { campo: 'id', operador: 'in', parametro: 'ids' }],
    ordens: [{ campo: 'nome', padrao: true }]
  }, s);
  const token = A['tokens.create'].fn({ nome: 't', permissoes: [{ endpointId: ep.endpointId, listar: true, buscar: true, incluir: true, alterar: true, excluir: true }] }, s).token;
  await server.start();
  const call = async (m, u, body) => {
    const r = await fetch(`http://127.0.0.1:${PORT}${u}`, { method: m, headers: { Authorization: 'Bearer ' + token, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body && JSON.stringify(body) });
    return { status: r.status, json: await r.json() };
  };
  try {
    const l = await call('GET', '/api/v1/clientes?nome=JOÃO');
    assert.strictEqual(l.status, 200, JSON.stringify(l.json));
    assert.strictEqual(l.json.data.length, 1);
    assert.strictEqual(l.json.data[0].limite, 1500.5);
    assert.strictEqual(l.json.data[0].data_cadastro, '2026-01-10');
    assert.deepStrictEqual(l.json.data[0].extra, { a: 1 });
    const ids = await call('GET', '/api/v1/clientes?ids=1,2');
    assert.strictEqual(ids.json.pagination.total, 2);
    const c = await call('POST', '/api/v1/clientes', { nome: 'Ana', cpf: '9', ativo: false, limite: 10.25, data_cadastro: '2026-10-17', extra: { x: [1] } });
    assert.strictEqual(c.status, 201, JSON.stringify(c.json));
    assert.strictEqual(c.json.data.ativo, false);
    const p = await call('PATCH', `/api/v1/clientes/${c.json.data.id}`, { email: 'ana@x.com' });
    assert.strictEqual(p.json.data.email, 'ana@x.com');
    const dup = await call('POST', '/api/v1/clientes', { nome: 'Ana', cpf: '9' });
    assert.strictEqual(dup.status, 409);
    const del = await call('DELETE', `/api/v1/clientes/${c.json.data.id}`);
    assert.strictEqual(del.status, 200);
    const fk = await call('DELETE', '/api/v1/clientes/1');
    assert.strictEqual(fk.status, 409, 'violação de FK vira CONFLICT');

    // Consultas SQL personalizadas
    const q = T.form.tipo === 'postgres'
      ? 'SELECT c.id, c.nome, COUNT(e.id) AS enderecos FROM vendas.clientes c LEFT JOIN vendas.cliente_endereco e ON e.cliente_id = c.id WHERE c.id >= :desde AND (:nome IS NULL OR c.nome ILIKE :nome) GROUP BY c.id, c.nome ORDER BY c.id'
      : 'SELECT c.id, c.nome, COUNT(e.id) AS enderecos FROM clientes c LEFT JOIN cliente_endereco e ON e.cliente_id = c.id WHERE c.id >= :desde AND (:nome IS NULL OR c.nome LIKE :nome) GROUP BY c.id, c.nome ORDER BY c.id';
    const ex = await A['consultas.executar'].fn({ bancoId, sql: q, parametros: [{ nome: 'desde', tipo: 'INTEIRO' }], valores: { desde: '1', nome: '%Silva%' }, limite: 10 }, s);
    assert.strictEqual(ex.data.length, 1, JSON.stringify(ex));
    assert.strictEqual(Number(ex.data[0].enderecos), 1);
    assert.strictEqual(ex.pagination.total, 1);
    const drv = await ctx.connections.getDriver(bancoId);
    const tbl = T.form.tipo === 'postgres' ? 'vendas.cliente_endereco' : 'cliente_endereco';
    await assert.rejects(() => drv.queryReadOnly(`DELETE FROM ${tbl}`, []), /read.only|READ ONLY/i, 'transação somente leitura');
    const still = await drv.query(`SELECT COUNT(*) AS n FROM ${tbl}`);
    assert.strictEqual(Number(still[0].n), 1);
  } finally {
    await server.stop();
    await ctx.close();
  }
});
