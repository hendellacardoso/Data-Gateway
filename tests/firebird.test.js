'use strict';

/**
 * Testes opcionais contra um Firebird real (padrão de sistemas Delphi).
 * Executam somente se GW_FB_HOST estiver definido. Variáveis:
 *   GW_FB_HOST, GW_FB_PORT (3050), GW_FB_USER (SYSDBA), GW_FB_PASSWORD (masterkey)
 *   GW_FB_DB        → banco WIN1252 com CLIENTES (generator + trigger) e PEDIDOS (IDENTITY, BOOLEAN)
 *   GW_FB_DB_NONE   → mesmo schema com charset NONE (textos gravados em Windows-1252)
 *   GW_FB_DB_D1     → banco dialeto 1 com PRODUTOS
 * Scripts de criação: tests/firebird/*.sql
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createContext } = require('../src/server/context');
const { createAdmin } = require('../src/server/admin');
const { GatewayServer } = require('../src/server/server');

const ENABLED = !!process.env.GW_FB_HOST;
const base = {
  tipo: 'firebird', servidor: process.env.GW_FB_HOST, porta: process.env.GW_FB_PORT || 3050,
  usuario: process.env.GW_FB_USER || 'SYSDBA', senha: process.env.GW_FB_PASSWORD || 'masterkey'
};
let PORT = 19600 + Math.floor(Math.random() * 300);

async function setup() {
  PORT++;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gw-fb-'));
  const ctx = createContext({ dataDir: dir });
  ctx.config.set('api', { port: PORT });
  const server = new GatewayServer(ctx);
  const A = createAdmin(ctx, { serverStatus: () => server.status() }).actions;
  A['auth.setup'].fn({ usuario: 'admin', senha: 'Senha123', confirmar: 'Senha123' });
  const s = A['auth.login'].fn({ usuario: 'admin', senha: 'Senha123' });
  return { ctx, server, A, s };
}

function client(token) {
  return async (m, u, body) => {
    const r = await fetch(`http://127.0.0.1:${PORT}${u}`, { method: m, headers: { Authorization: 'Bearer ' + token, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body && JSON.stringify(body) });
    return { status: r.status, json: await r.json() };
  };
}

test('Firebird (dialeto 3, WIN1252) ponta a ponta', { skip: !ENABLED && 'GW_FB_HOST não definido' }, async () => {
  const { ctx, server, A, s } = await setup();
  const form = { ...base, nome: 'ERP', banco: process.env.GW_FB_DB };
  try {
    const t = await A['bancos.test'].fn(form);
    assert.ok(t.ok, JSON.stringify(t));
    assert.match(t.version, /Firebird \d/);
    const fail = await A['bancos.test'].fn({ ...form, senha: 'errada' });
    assert.strictEqual(fail.ok, false);
    assert.match(fail.details, /usu[aá]rio ou senha/i);

    const { id: bancoId } = await A['bancos.save'].fn(form, s);
    const objs = await A['bancos.objects'].fn({ id: bancoId });
    assert.ok(objs.some((o) => o.name === 'CLIENTES' && o.type === 'TABLE'));
    assert.ok(objs.some((o) => o.name === 'VW_CLIENTES_ATIVOS' && o.type === 'VIEW'));
    assert.ok(!objs.some((o) => o.name.startsWith('RDB$')), 'sem tabelas de sistema');

    const d = await A['bancos.describe'].fn({ id: bancoId, schema: null, table: 'CLIENTES' });
    const c = Object.fromEntries(d.columns.map((x) => [x.nome, x]));
    assert.ok(c.CODIGO.pk && c.CODIGO.auto, 'generator + trigger detectado como automático');
    assert.strictEqual(c.NOME.tamanho, 100);
    assert.strictEqual(c.NOME.obrigatorio, true);
    assert.strictEqual(c.LIMITE.tipoLogico, 'DECIMAL');
    assert.strictEqual(c.LIMITE.escala, 2);
    assert.strictEqual(c.DATA_CADASTRO.tipoLogico, 'DATA');
    assert.strictEqual(c.ULTIMA_COMPRA.tipoLogico, 'DATAHORA');
    assert.strictEqual(c.OBS.tipoLogico, 'TEXTO');
    assert.strictEqual(c.ATIVO.padrao, "'S'");
    c.ATIVO.tipoLogico = 'BOOLEANO'; // CHAR(1) 'S'/'N' — ajustado pelo administrador no assistente

    const dp = await A['bancos.describe'].fn({ id: bancoId, schema: null, table: 'PEDIDOS' });
    const p = Object.fromEntries(dp.columns.map((x) => [x.nome, x]));
    assert.ok(p.ID.pk && p.ID.auto, 'IDENTITY (3.0+) ou generator + trigger (2.5)');
    // Firebird 2.5 não tem BOOLEAN: o script usa SMALLINT 0/1 e o administrador marca BOOLEANO no assistente
    if (p.ENTREGUE.tipoFisico === 'smallint') p.ENTREGUE.tipoLogico = 'BOOLEANO';
    assert.strictEqual(p.ENTREGUE.tipoLogico, 'BOOLEANO');
    assert.strictEqual(dp.foreignKeys[0].column, 'CLIENTE');
    assert.strictEqual(dp.foreignKeys[0].refTable, 'CLIENTES');
    assert.strictEqual(dp.foreignKeys[0].refColumn, 'CODIGO');
    assert.ok(dp.indexes.some((i) => i.columns.includes('DATA')));

    const ep = A['endpoints.save'].fn({
      bancoId, esquema: null, tabela: 'CLIENTES', slug: 'clientes', publicar: true,
      ops: { listar: true, buscar: true, incluir: true, alterar: true, patch: true, excluir: true },
      exclusao: { modo: 'FISICA' }, paginacao: { padrao: 2, max: 100 },
      campos: Object.values(c),
      filtros: [
        { campo: 'NOME', operador: 'contains', parametro: 'nome' },
        { campo: 'UF', operador: 'contains', parametro: 'uf' },
        { campo: 'CIDADE', operador: 'eq', parametro: 'cidade' },
        { campo: 'CODIGO', operador: 'in', parametro: 'codigos' },
        { campo: 'ATIVO', operador: 'eq', parametro: 'ativo' }
      ],
      ordens: [{ campo: 'CODIGO', padrao: true }, { campo: 'NOME' }]
    }, s);
    const epPed = A['endpoints.save'].fn({
      bancoId, esquema: null, tabela: 'PEDIDOS', slug: 'pedidos', publicar: true,
      ops: { listar: true, buscar: true, incluir: true, alterar: true, patch: true, excluir: true },
      exclusao: { modo: 'FISICA' }, paginacao: { padrao: 50, max: 100 }, campos: dp.columns, filtros: [], ordens: [{ campo: 'ID', padrao: true }]
    }, s);
    const token = A['tokens.create'].fn({ nome: 't', permissoes: [
      { endpointId: ep.endpointId, listar: true, buscar: true, incluir: true, alterar: true, excluir: true },
      { endpointId: epPed.endpointId, listar: true, buscar: true, incluir: true, alterar: true, excluir: true }
    ] }, s).token;
    await server.start();
    const call = client(token);

    // Lista paginada (ROWS) com acentos corretos
    const l = await call('GET', '/api/v1/clientes');
    assert.strictEqual(l.status, 200, JSON.stringify(l.json));
    assert.strictEqual(l.json.data.length, 2);
    assert.strictEqual(l.json.pagination.total, 4);
    assert.strictEqual(l.json.data[0].nome, 'José da Conceição');
    assert.strictEqual(l.json.data[0].data_cadastro, '2024-03-15');
    assert.strictEqual(l.json.data[0].ultima_compra, '2026-10-01T14:30:00', 'TIMESTAMP como data/hora local');
    assert.strictEqual(l.json.data[0].limite, 1500.5);
    assert.strictEqual(l.json.data[0].ativo, true);
    assert.strictEqual(l.json.data[0].uf, 'GO');
    assert.strictEqual(l.json.data[0].obs, 'Cliente antigo, paga em dia.');
    const pg2 = await call('GET', '/api/v1/clientes?page=2');
    assert.deepStrictEqual(pg2.json.data.map((x) => x.codigo), [3, 4]);

    // Filtros: contém sem diferenciar maiúsculas/acentos digitados iguais, padrão maior que a coluna (CHAR(2))
    const f1 = await call('GET', '/api/v1/clientes?nome=' + encodeURIComponent('conceição'));
    assert.deepStrictEqual(f1.json.data.map((x) => x.codigo), [1], JSON.stringify(f1.json));
    const f2 = await call('GET', '/api/v1/clientes?uf=GOX');
    assert.strictEqual(f2.status, 200, JSON.stringify(f2.json));
    assert.strictEqual(f2.json.data.length, 0);
    const f3 = await call('GET', '/api/v1/clientes?cidade=' + encodeURIComponent('Goiânia') + '&sort=nome');
    assert.deepStrictEqual(f3.json.data.map((x) => x.codigo), [3, 1]);
    const f4 = await call('GET', '/api/v1/clientes?codigos=2,4');
    assert.strictEqual(f4.json.pagination.total, 2);
    const f5 = await call('GET', '/api/v1/clientes?ativo=false');
    assert.deepStrictEqual(f5.json.data.map((x) => x.codigo), [3]);
    const f6 = await call('GET', '/api/v1/clientes?nome=' + encodeURIComponent('100%'));
    assert.deepStrictEqual(f6.json.data.map((x) => x.codigo), [4], 'LIKE escapa %');

    // Inclusão: código vem do generator via RETURNING; booleano grava 'S'/'N'
    const ins = await call('POST', '/api/v1/clientes', { nome: 'Lúcia Mendonça', cidade: 'Rio Verde', uf: 'GO', cpf: '111', ativo: false, limite: 99.9, data_cadastro: '2026-10-18', ultima_compra: '2026-10-18T08:15:00', obs: 'Observação com acentuação' });
    assert.strictEqual(ins.status, 201, JSON.stringify(ins.json));
    const novo = ins.json.data;
    assert.ok(novo.codigo >= 5, JSON.stringify(novo));
    assert.strictEqual(novo.nome, 'Lúcia Mendonça');
    assert.strictEqual(novo.ativo, false);
    assert.strictEqual(novo.ultima_compra, '2026-10-18T08:15:00');
    const drv = await ctx.connections.getDriver(bancoId);
    const raw = await drv.query('SELECT ATIVO FROM CLIENTES WHERE CODIGO = ?', [novo.codigo]);
    assert.strictEqual(raw[0].ATIVO, 'N');

    const dup = await call('POST', '/api/v1/clientes', { nome: 'Outro', cpf: '111' });
    assert.strictEqual(dup.status, 409, JSON.stringify(dup.json));
    const semNome = await call('POST', '/api/v1/clientes', { cidade: 'X' });
    assert.strictEqual(semNome.status, 400);

    const pat = await call('PATCH', `/api/v1/clientes/${novo.codigo}`, { limite: 250, ativo: true });
    assert.strictEqual(pat.status, 200, JSON.stringify(pat.json));
    assert.strictEqual(pat.json.data.limite, 250);
    assert.strictEqual(pat.json.data.ativo, true);

    // IDENTITY + BOOLEAN nativo
    const ped = await call('POST', '/api/v1/pedidos', { cliente: novo.codigo, data: '2026-10-18', total: 10.5, pago: 1, entregue: true });
    assert.strictEqual(ped.status, 201, JSON.stringify(ped.json));
    assert.ok(ped.json.data.id >= 4);
    assert.strictEqual(ped.json.data.entregue, true);

    const fk = await call('DELETE', `/api/v1/clientes/${novo.codigo}`);
    assert.strictEqual(fk.status, 409, 'violação de FK vira CONFLICT');
    assert.strictEqual((await call('DELETE', `/api/v1/pedidos/${ped.json.data.id}`)).status, 200);
    assert.strictEqual((await call('DELETE', `/api/v1/clientes/${novo.codigo}`)).status, 200);
    assert.strictEqual((await call('GET', `/api/v1/clientes/${novo.codigo}`)).status, 404);

    // Consultas SQL personalizadas
    const q = `SELECT c.CODIGO, c.NOME, COUNT(p.ID) AS PEDIDOS, SUM(p.TOTAL) AS TOTAL_COMPRADO
      FROM CLIENTES c LEFT JOIN PEDIDOS p ON p.CLIENTE = c.CODIGO
      WHERE c.UF = :uf AND (:nome IS NULL OR UPPER(c.NOME) LIKE UPPER(:nome))
      GROUP BY c.CODIGO, c.NOME ORDER BY c.CODIGO`;
    const ex = await A['consultas.executar'].fn({ bancoId, sql: q, parametros: [{ nome: 'uf', tipo: 'TEXTO' }, { nome: 'nome', tipo: 'TEXTO' }], valores: { uf: 'GO', nome: null }, limite: 2 }, s);
    assert.strictEqual(ex.data.length, 2, JSON.stringify(ex));
    assert.strictEqual(ex.pagination.total, 3);
    assert.strictEqual(Number(ex.data[0].PEDIDOS), 2);
    assert.strictEqual(Number(ex.data[0].TOTAL_COMPRADO), 470.4);
    await assert.rejects(() => Promise.resolve().then(() => A['consultas.executar'].fn({ bancoId, sql: 'SELECT GEN_ID(GEN_CLIENTES_ID, 1) FROM RDB$DATABASE', valores: {} }, s)), /GEN_ID/);
    await assert.rejects(() => Promise.resolve().then(() => A['consultas.executar'].fn({ bancoId, sql: 'SELECT FIRST 1 * FROM CLIENTES', valores: {} }, s)), /FIRST/);
    await assert.rejects(() => drv.queryReadOnly('DELETE FROM PEDIDOS', []), /read\s*-?\s*only/i, 'transação somente leitura');
    const still = await drv.query('SELECT COUNT(*) AS N FROM PEDIDOS');
    assert.strictEqual(Number(still[0].N), 3);
  } finally {
    await server.stop();
    await ctx.close();
  }
});

test('Firebird com charset NONE (sistema legado) usa WIN1252 automaticamente', { skip: !(ENABLED && process.env.GW_FB_DB_NONE) && 'GW_FB_DB_NONE não definido' }, async () => {
  const { ctx, A, s } = await setup();
  try {
    const form = { ...base, nome: 'LEGADO', banco: process.env.GW_FB_DB_NONE };
    const t = await A['bancos.test'].fn(form);
    assert.ok(t.ok);
    assert.match(t.version, /NONE → WIN1252/);
    const { id } = await A['bancos.save'].fn(form, s);
    const drv = await ctx.connections.getDriver(id);
    const r = await drv.query('SELECT NOME FROM CLIENTES WHERE CODIGO = ?', [1]);
    assert.strictEqual(r[0].NOME, 'José da Conceição');
    await drv.execute('UPDATE CLIENTES SET CIDADE = ? WHERE CODIGO = ?', ['São Simão', 2]);
    const r2 = await drv.query('SELECT CIDADE FROM CLIENTES WHERE CODIGO = ?', [2]);
    assert.strictEqual(r2[0].CIDADE, 'São Simão');
  } finally {
    await ctx.close();
  }
});

test('Firebird dialeto 1 (banco antigo)', { skip: !(ENABLED && process.env.GW_FB_DB_D1) && 'GW_FB_DB_D1 não definido' }, async () => {
  const { ctx, server, A, s } = await setup();
  try {
    const form = { ...base, nome: 'D1', banco: process.env.GW_FB_DB_D1 };
    const t = await A['bancos.test'].fn(form);
    assert.match(t.version, /dialeto 1/);
    const { id: bancoId } = await A['bancos.save'].fn(form, s);
    const d = await A['bancos.describe'].fn({ id: bancoId, schema: null, table: 'PRODUTOS' });
    const c = Object.fromEntries(d.columns.map((x) => [x.nome, x]));
    assert.ok(c.CODIGO.auto);
    assert.strictEqual(c.CADASTRO.tipoLogico, 'DATAHORA');
    const ep = A['endpoints.save'].fn({
      bancoId, esquema: null, tabela: 'PRODUTOS', slug: 'produtos', publicar: true,
      ops: { listar: true, buscar: true, incluir: true, alterar: true, patch: true, excluir: true },
      exclusao: { modo: 'FISICA' }, paginacao: { padrao: 10, max: 100 }, campos: d.columns,
      filtros: [{ campo: 'DESCRICAO', operador: 'startsWith', parametro: 'descricao' }], ordens: [{ campo: 'CODIGO', padrao: true }]
    }, s);
    const token = A['tokens.create'].fn({ nome: 't', permissoes: [{ endpointId: ep.endpointId, listar: true, buscar: true, incluir: true, alterar: true, excluir: true }] }, s).token;
    await server.start();
    const call = client(token);
    const l = await call('GET', '/api/v1/produtos?descricao=' + encodeURIComponent('açú'));
    assert.strictEqual(l.status, 200, JSON.stringify(l.json));
    assert.strictEqual(l.json.data[0].descricao, 'Açúcar Cristal 5kg');
    assert.strictEqual(l.json.data[0].cadastro, '2026-10-01T00:00:00');
    const ins = await call('POST', '/api/v1/produtos', { descricao: 'Café 500g', preco: 17.9, cadastro: '2026-10-18T09:00:00', ativo: 'S' });
    assert.strictEqual(ins.status, 201, JSON.stringify(ins.json));
    assert.ok(ins.json.data.codigo >= 3);
    assert.strictEqual((await call('DELETE', '/api/v1/produtos/' + ins.json.data.codigo)).status, 200);
    const ex = await A['consultas.executar'].fn({ bancoId, sql: 'SELECT CODIGO, DESCRICAO FROM PRODUTOS WHERE PRECO > :min ORDER BY PRECO DESC', parametros: [{ nome: 'min', tipo: 'DECIMAL' }], valores: { min: '1' }, limite: 10 }, s);
    assert.strictEqual(ex.pagination.total, 2);
  } finally {
    await server.stop();
    await ctx.close();
  }
});
