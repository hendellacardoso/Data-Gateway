'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { QueryBuilder } = require('../src/server/query-builder/builder');

const spec = {
  table: { schema: 'dbo', name: 'CLIENTES' },
  fields: ['ID', 'NOME'],
  filters: [{ column: 'NOME', operator: 'contains', value: "50%_x'" }, { column: 'ID', operator: 'in', value: [1, 2] }],
  orderBy: [{ column: 'NOME', direction: 'DESC' }],
  pagination: { page: 3, pageSize: 10 }
};

test('SQL Server', () => {
  const q = new QueryBuilder('sqlserver').select(spec);
  assert.strictEqual(q.sql, "SELECT [ID], [NOME] FROM [dbo].[CLIENTES] WHERE [NOME] LIKE @p1 ESCAPE '!' AND [ID] IN (@p2, @p3) ORDER BY [NOME] DESC OFFSET @p5 ROWS FETCH NEXT @p4 ROWS ONLY");
  assert.deepStrictEqual(q.params, ["%50!%!_x'%", 1, 2, 10, 20]);
  assert.strictEqual(q.countSql, "SELECT COUNT(*) AS total FROM [dbo].[CLIENTES] WHERE [NOME] LIKE @p1 ESCAPE '!' AND [ID] IN (@p2, @p3)");
  const ins = new QueryBuilder('sqlserver').insert({ table: { name: 'T' }, values: { A: 1 }, returning: 'ID', autoKey: true });
  assert.strictEqual(ins.sql, 'INSERT INTO [T] ([A]) VALUES (@p1); SELECT CAST(SCOPE_IDENTITY() AS BIGINT) AS [__gw_id]');
});

test('PostgreSQL', () => {
  const q = new QueryBuilder('postgres').select(spec);
  assert.strictEqual(q.sql, 'SELECT "ID", "NOME" FROM "dbo"."CLIENTES" WHERE "NOME"::text ILIKE $1 ESCAPE \'!\' AND "ID" IN ($2, $3) ORDER BY "NOME" DESC LIMIT $4 OFFSET $5');
  const ins = new QueryBuilder('postgres').insert({ table: { name: 't' }, values: { a: 1 }, returning: 'id', autoKey: true });
  assert.strictEqual(ins.sql, 'INSERT INTO "t" ("a") VALUES ($1) RETURNING "id" AS "__gw_id"');
});

test('MySQL', () => {
  const q = new QueryBuilder('mysql').select(spec);
  assert.strictEqual(q.sql, "SELECT `ID`, `NOME` FROM `dbo`.`CLIENTES` WHERE `NOME` LIKE ? ESCAPE '!' AND `ID` IN (?, ?) ORDER BY `NOME` DESC LIMIT ? OFFSET ?");
  assert.deepStrictEqual(q.params.slice(-2), [10, 20]);
  const up = new QueryBuilder('mysql').update({ table: { name: 't' }, values: { a: 1, b: 'x' }, key: { column: 'id', value: 5 } });
  assert.strictEqual(up.sql, 'UPDATE `t` SET `a` = ?, `b` = ? WHERE `id` = ?');
});

test('identificadores maliciosos são escapados e operadores fora da whitelist rejeitados', () => {
  const qb = new QueryBuilder('sqlserver');
  assert.strictEqual(qb.col('X]; DROP TABLE Y;--'), '[X]]; DROP TABLE Y;--]');
  assert.throws(() => qb.select({ ...spec, filters: [{ column: 'A', operator: 'OR 1=1', value: 1 }] }));
});
