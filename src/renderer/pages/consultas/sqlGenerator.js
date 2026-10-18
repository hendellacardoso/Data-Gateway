/**
 * Gera o SELECT a partir do modelo do montador visual.
 * O resultado passa pela mesma validação do servidor antes de ser executado/publicado.
 */

const FB_RESERVED = new Set(('ADD ALL ALTER AND ANY AS AT AVG BEGIN BETWEEN BIGINT BLOB BOOLEAN BOTH BY CASE CAST CHAR CHARACTER CHECK ' +
  'CLOSE COLLATE COLUMN COMMIT CONNECT CONSTRAINT COUNT CREATE CROSS CURRENT CURRENT_DATE CURRENT_TIME CURRENT_TIMESTAMP ' +
  'CURRENT_USER CURSOR DATE DAY DEC DECIMAL DECLARE DEFAULT DELETE DISTINCT DOUBLE DROP ELSE END ESCAPE EXECUTE EXISTS ' +
  'EXTERNAL EXTRACT FALSE FETCH FILTER FLOAT FOR FOREIGN FROM FULL FUNCTION GLOBAL GRANT GROUP HAVING HOUR IN INDEX INNER ' +
  'INSERT INT INTEGER INTO IS JOIN LEADING LEFT LIKE LONG LOWER MAX MERGE MIN MINUTE MONTH NATURAL NO NOT NULL NUMERIC OF ' +
  'OFFSET ON ONLY OPEN OR ORDER OUTER OVER PARAMETER PLAN POSITION PRECISION PRIMARY PROCEDURE REAL RECREATE RECURSIVE ' +
  'REFERENCES RETURNS REVOKE RIGHT ROLLBACK ROW ROWS SECOND SELECT SET SIMILAR SMALLINT SOME START SUM TABLE THEN TIME ' +
  'TIMESTAMP TO TRAILING TRIGGER TRIM TRUE UNION UNIQUE UNKNOWN UPDATE UPPER USER USING VALUE VALUES VARCHAR VARIABLE ' +
  'VARYING VIEW WHEN WHERE WHILE WINDOW WITH YEAR').split(' '));

const QUOTES = {
  sqlserver: (id) => '[' + String(id).replace(/]/g, ']]') + ']',
  postgres: (id) => '"' + String(id).replace(/"/g, '""') + '"',
  mysql: (id) => '`' + String(id).replace(/`/g, '``') + '`',
  mariadb: (id) => '`' + String(id).replace(/`/g, '``') + '`',
  sqlite: (id) => '"' + String(id).replace(/"/g, '""') + '"',
  // Firebird: sem aspas para nomes simples em maiúsculas (compatível com o dialeto 1)
  firebird: (id) => (/^[A-Z][A-Z0-9_$]*$/.test(String(id)) && !FB_RESERVED.has(String(id)) ? String(id) : '"' + String(id).replace(/"/g, '""') + '"')
};

export const AGGREGATES = ['', 'COUNT', 'SUM', 'AVG', 'MIN', 'MAX'];
export const JOIN_TYPES = ['INNER', 'LEFT', 'RIGHT'];

export const tableKey = (t) => (t.schema ? t.schema + '.' : '') + t.name;

/** Alias curto e único para cada tabela (o próprio nome; sufixo numérico se repetido). */
export function makeAlias(name, existing) {
  const base = String(name).replace(/[^A-Za-z0-9_]/g, '_');
  let alias = base;
  let i = 2;
  while (existing.includes(alias)) alias = base + '_' + i++;
  return alias;
}

const OPERATOR_START = /^\s*(=|<>|!=|<=|>=|<|>|LIKE\b|ILIKE\b|NOT\b|IN\b|IS\b|BETWEEN\b)/i;

function criteriaExpr(expr, criteria) {
  const c = String(criteria || '').trim();
  if (!c) return null;
  return OPERATOR_START.test(c) ? `${expr} ${c}` : `${expr} = ${c}`;
}

/**
 * @param {object} model { tables:[{key, schema, name, alias}], joins:[{left:{table,column}, right:{table,column}, type}], fields:[...] }
 * @param {string} dbType
 * @returns {{ sql: string, warnings: string[] }}
 */
export function generateSql(model, dbType) {
  const q = QUOTES[dbType] || QUOTES.sqlite;
  const warnings = [];
  const tables = model.tables || [];
  if (!tables.length) return { sql: '', warnings: ['Adicione uma tabela ao diagrama.'] };
  const byKey = new Map(tables.map((t) => [t.key, t]));
  const ref = (t) => (t.schema ? `${q(t.schema)}.${q(t.name)}` : q(t.name));
  const col = (tk, c) => `${q(byKey.get(tk).alias)}.${q(c)}`;

  const fields = (model.fields || []).filter((f) => byKey.has(f.table));
  const exprOf = (f) => {
    const base = col(f.table, f.column);
    return f.aggregate ? `${f.aggregate}(${base})` : base;
  };

  // SELECT
  const out = fields.filter((f) => f.output);
  const selectList = out.length
    ? out.map((f) => exprOf(f) + (f.alias ? ` AS ${q(f.alias)}` : ''))
    : [`${q(tables[0].alias)}.*`];
  if (!out.length) warnings.push('Nenhuma coluna marcada como saída: serão retornadas todas as colunas da primeira tabela.');

  // FROM + JOINs (cada tabela nova se liga a alguma já incluída)
  // Alias só quando difere do nome (evita FROM "CLIENTES" "CLIENTES")
  const withAlias = (t) => (t.alias === t.name ? ref(t) : `${ref(t)} ${q(t.alias)}`);
  const from = [withAlias(tables[0])];
  const included = new Set([tables[0].key]);
  const pending = tables.slice(1);
  let guard = 0;
  while (pending.length && guard++ < 100) {
    let progressed = false;
    for (let i = 0; i < pending.length; i++) {
      const t = pending[i];
      const links = (model.joins || []).filter((j) =>
        (j.left.table === t.key && included.has(j.right.table)) || (j.right.table === t.key && included.has(j.left.table)));
      if (!links.length) continue;
      const type = links[0].type || 'INNER';
      const on = links.map((j) => `${col(j.left.table, j.left.column)} = ${col(j.right.table, j.right.column)}`).join(' AND ');
      from.push(`${type} JOIN ${withAlias(t)} ON ${on}`);
      included.add(t.key);
      pending.splice(i, 1);
      progressed = true;
      break;
    }
    if (!progressed) {
      const t = pending.shift();
      warnings.push(`A tabela ${t.name} não está ligada às demais (será usado CROSS JOIN).`);
      from.push(`CROSS JOIN ${withAlias(t)}`);
      included.add(t.key);
    }
  }

  // WHERE / HAVING
  const where = [];
  const having = [];
  for (const f of fields) {
    const e = criteriaExpr(exprOf(f), f.criteria);
    if (!e) continue;
    (f.aggregate ? having : where).push(`(${e})`);
  }

  // GROUP BY: colunas sem agregação quando houver agregação ou marcação "Agrupar"
  const hasAgg = out.some((f) => f.aggregate);
  const groupFields = fields.filter((f) => !f.aggregate && (f.group || (hasAgg && f.output)));
  const groupBy = [...new Set(groupFields.map((f) => col(f.table, f.column)))];

  // ORDER BY
  const orderFields = fields
    .map((f, i) => ({ f, i }))
    .filter(({ f }) => f.sort)
    .sort((a, b) => (Number(a.f.sortOrder) || 999) - (Number(b.f.sortOrder) || 999) || a.i - b.i);

  let sql = `SELECT\n  ${selectList.join(',\n  ')}\nFROM ${from.join('\n  ')}`;
  if (where.length) sql += `\nWHERE ${where.join('\n  AND ')}`;
  if (groupBy.length) sql += `\nGROUP BY ${groupBy.join(', ')}`;
  if (having.length) sql += `\nHAVING ${having.join('\n  AND ')}`;
  if (orderFields.length) sql += `\nORDER BY ${orderFields.map(({ f }) => `${exprOf(f)} ${f.sort}`).join(', ')}`;
  return { sql, warnings };
}

/** Sugere ligações entre a nova tabela e as existentes a partir das chaves estrangeiras. */
export function suggestJoins(newTable, tables, describeCache) {
  const joins = [];
  const nd = describeCache[newTable.key];
  for (const t of tables) {
    if (t.key === newTable.key) continue;
    const td = describeCache[t.key];
    // FKs da nova tabela apontando para a existente
    for (const fk of (nd && nd.foreignKeys) || []) {
      if (fk.refTable === t.name && (!fk.refSchema || !t.schema || fk.refSchema === t.schema)) {
        const refCol = fk.refColumn || ((td && td.primaryKeys) || [])[0];
        if (refCol) joins.push({ left: { table: t.key, column: refCol }, right: { table: newTable.key, column: fk.column }, type: 'INNER' });
      }
    }
    // FKs da existente apontando para a nova
    for (const fk of (td && td.foreignKeys) || []) {
      if (fk.refTable === newTable.name && (!fk.refSchema || !newTable.schema || fk.refSchema === newTable.schema)) {
        const refCol = fk.refColumn || ((nd && nd.primaryKeys) || [])[0];
        if (refCol) joins.push({ left: { table: t.key, column: fk.column }, right: { table: newTable.key, column: refCol }, type: 'INNER' });
      }
    }
  }
  return joins;
}
