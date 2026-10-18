'use strict';

/**
 * Consultas SQL personalizadas (somente leitura).
 *
 * O SQL é escrito SOMENTE pelo administrador no painel. Quem chama a API envia apenas valores
 * de parâmetros nomeados (:nome), que viram placeholders do driver — nunca texto SQL.
 *
 * Camadas de proteção:
 *  1. Análise léxica: um único comando, iniciando com SELECT/WITH, sem palavras-chave de escrita
 *     ou administração e sem funções perigosas (fora de strings/comentários/identificadores).
 *  2. Execução dentro de transação somente leitura (PostgreSQL/MySQL/Firebird), conexão read-only (SQLite)
 *     ou transação sempre desfeita com ROLLBACK (SQL Server).
 *  3. Paginação e limite de linhas aplicados pelo Gateway; timeout do driver.
 */
const { getDialect } = require('../query-builder/dialects');
const { GatewayError } = require('../errors');

const PARAM_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const RESERVED_PARAMS = new Set(['page', 'pageSize']);

// Palavras de escrita/administração. Como só é aceito um comando iniciando com SELECT/WITH, a lista
// cobre principalmente CTEs que modificam dados, SELECT ... INTO e chamadas de procedimentos.
const FORBIDDEN_WORDS = [
  'INSERT', 'UPDATE', 'DELETE', 'MERGE', 'UPSERT', 'DROP', 'ALTER', 'CREATE', 'TRUNCATE', 'EXEC', 'EXECUTE',
  'GRANT', 'REVOKE', 'DENY', 'BACKUP', 'RESTORE', 'SHUTDOWN', 'DBCC', 'BULK', 'OPENROWSET', 'OPENQUERY',
  'OPENDATASOURCE', 'OPENXML', 'INTO', 'DECLARE', 'SET', 'ATTACH', 'DETACH', 'PRAGMA', 'VACUUM', 'REINDEX',
  'COPY', 'WAITFOR', 'COMMIT', 'ROLLBACK', 'BEGIN', 'SAVEPOINT', 'RECONFIGURE', 'PREPARE', 'DEALLOCATE',
  'IMPERSONATE', 'OUTFILE', 'DUMPFILE'
];
const FORBIDDEN_WORD_RE = new RegExp('\\b(' + FORBIDDEN_WORDS.join('|') + ')\\b', 'i');
const FORBIDDEN_FN_RE = /\b(PG_SLEEP\w*|PG_READ_FILE|PG_READ_BINARY_FILE|PG_LS_DIR|PG_STAT_FILE|PG_TERMINATE_BACKEND|PG_CANCEL_BACKEND|PG_RELOAD_CONF|LO_IMPORT|LO_EXPORT|DBLINK\w*|SLEEP|BENCHMARK|LOAD_FILE|SYS_EXEC|SYS_EVAL|XP_\w+|SP_\w+|SET_CONFIG|NEXTVAL|SETVAL|GET_LOCK|RELEASE_LOCK|READFILE|WRITEFILE|LOAD_EXTENSION|GEN_ID|RDB\$SET_CONTEXT)\s*\(/i;
const NEXT_VALUE_RE = /\bNEXT\s+VALUE\s+FOR\b/i;
const REPLACE_STMT_RE = /\bREPLACE\b(?!\s*\()/i;

/**
 * Gera uma cópia do SQL com strings, identificadores entre aspas e comentários neutralizados,
 * preservando o tamanho (as posições continuam valendo para o texto original).
 */
function mask(sql, dbType) {
  const out = sql.split('');
  const n = sql.length;
  let i = 0;
  const fill = (from, to, ch) => { for (let k = from; k < to; k++) if (out[k] !== '\n') out[k] = ch; };
  while (i < n) {
    const c = sql[i];
    const next = sql[i + 1];
    if (c === '-' && next === '-') {
      let j = sql.indexOf('\n', i);
      if (j < 0) j = n;
      fill(i, j, ' ');
      i = j;
    } else if (c === '#' && (dbType === 'mysql' || dbType === 'mariadb')) {
      let j = sql.indexOf('\n', i);
      if (j < 0) j = n;
      fill(i, j, ' ');
      i = j;
    } else if (c === '/' && next === '*') {
      let j = sql.indexOf('*/', i + 2);
      j = j < 0 ? n : j + 2;
      fill(i, j, ' ');
      i = j;
    } else if (c === "'" || c === '"' || c === '`' || c === '[') {
      const close = c === '[' ? ']' : c;
      const isString = c === "'";
      const backslash = isString && (dbType === 'mysql' || dbType === 'mariadb' ||
        (dbType === 'postgres' && i > 0 && /[eE]/.test(sql[i - 1])));
      let j = i + 1;
      while (j < n) {
        if (backslash && sql[j] === '\\') { j += 2; continue; }
        if (sql[j] === close) {
          if (sql[j + 1] === close && c !== '[') { j += 2; continue; }
          break;
        }
        j++;
      }
      if (j >= n) throw new GatewayError('VALIDATION_ERROR', `Texto ou identificador não fechado (${c}).`);
      fill(i, j + 1, isString ? '0' : 'x');
      i = j + 1;
    } else {
      i++;
    }
  }
  return out.join('');
}

function depthArray(masked) {
  const d = new Array(masked.length);
  let depth = 0;
  for (let i = 0; i < masked.length; i++) {
    if (masked[i] === '(') depth++;
    d[i] = depth;
    if (masked[i] === ')') depth = Math.max(0, depth - 1);
  }
  return d;
}

/**
 * Analisa o SQL. Retorna { errors, params: [nomes], occurrences: [{name, start, end}], orderByAt, body }
 * `body` é o SQL original sem o ";" final.
 */
function analyze(sqlText, dbType) {
  const errors = [];
  const sql = String(sqlText || '');
  if (!sql.trim()) return { errors: ['Informe o comando SELECT.'], params: [], occurrences: [] };
  if (sql.length > 100000) return { errors: ['SQL muito grande (máximo 100.000 caracteres).'], params: [], occurrences: [] };

  let masked;
  try {
    masked = mask(sql, dbType);
  } catch (e) {
    return { errors: [e.message], params: [], occurrences: [] };
  }

  // Remove ";" final (um único comando é permitido)
  let body = sql;
  let bodyMasked = masked;
  const trail = /;\s*$/.exec(masked);
  if (trail) {
    body = sql.slice(0, trail.index);
    bodyMasked = masked.slice(0, trail.index);
  }
  if (bodyMasked.includes(';')) errors.push('Somente um comando é permitido (remova o ";" do meio do texto).');

  const head = bodyMasked.replace(/^[\s(]+/, '');
  if (!/^(SELECT|WITH)\b/i.test(head)) errors.push('A consulta deve começar com SELECT ou WITH (somente leitura).');

  const fw = FORBIDDEN_WORD_RE.exec(bodyMasked);
  if (fw) errors.push(`Comando não permitido em consultas: ${fw[1].toUpperCase()}.`);
  if (REPLACE_STMT_RE.test(bodyMasked)) errors.push('Comando não permitido em consultas: REPLACE.');
  const ff = FORBIDDEN_FN_RE.exec(bodyMasked);
  if (ff) errors.push(`Função não permitida em consultas: ${ff[1].toUpperCase()}.`);

  if (NEXT_VALUE_RE.test(bodyMasked)) errors.push('Função não permitida em consultas: NEXT VALUE FOR.');

  if ((dbType === 'mysql' || dbType === 'mariadb' || dbType === 'sqlite' || dbType === 'firebird') && bodyMasked.includes('?')) {
    errors.push('Use parâmetros nomeados (ex.: :codigo) em vez de "?".');
  }
  if (dbType === 'postgres' && /\$\d/.test(bodyMasked)) errors.push('Use parâmetros nomeados (ex.: :codigo) em vez de $1.');
  if (dbType === 'sqlserver' && /(^|[^@])@(?!@)\w/.test(bodyMasked)) errors.push('Use parâmetros nomeados (ex.: :codigo) em vez de @variável.');

  const depth = depthArray(bodyMasked);
  const topLevel = (re) => {
    const found = [];
    const g = new RegExp(re.source, 'gi');
    let m;
    while ((m = g.exec(bodyMasked))) if (depth[m.index] === 0) found.push(m.index);
    return found;
  };
  if (topLevel(/\b(LIMIT|OFFSET|FETCH)\b/).length) errors.push('Remova LIMIT/OFFSET/FETCH: a paginação é aplicada automaticamente pelo Gateway.');
  if (topLevel(/\bSELECT\s+(DISTINCT\s+)?TOP\b/).length) errors.push('Remova TOP: a paginação é aplicada automaticamente pelo Gateway.');
  if (dbType === 'firebird' && (topLevel(/\bSELECT\s+(DISTINCT\s+)?(FIRST|SKIP)\b/).length || topLevel(/\bROWS\b/).length)) {
    errors.push('Remova FIRST/SKIP/ROWS: a paginação é aplicada automaticamente pelo Gateway.');
  }
  if (topLevel(/\bFOR\s+(XML|JSON|BROWSE)\b/).length) errors.push('FOR XML/JSON não é suportado em consultas publicadas.');
  const orders = topLevel(/\bORDER\s+BY\b/);
  const orderByAt = orders.length ? orders[orders.length - 1] : -1;

  // Parâmetros nomeados :nome (ignora "::tipo" do PostgreSQL)
  const occurrences = [];
  const pr = /(^|[^:\w]):([A-Za-z_][A-Za-z0-9_]*)/g;
  let m;
  while ((m = pr.exec(bodyMasked))) {
    const start = m.index + m[1].length;
    occurrences.push({ name: m[2], start, end: start + 1 + m[2].length });
  }
  const params = [...new Set(occurrences.map((o) => o.name))];
  for (const p of params) {
    if (RESERVED_PARAMS.has(p)) errors.push(`"${p}" é um parâmetro reservado (paginação).`);
    if (!PARAM_RE.test(p)) errors.push(`Nome de parâmetro inválido: ${p}.`);
  }
  return { errors, params, occurrences, orderByAt, body };
}

/**
 * Monta o SQL executável: troca :nome por placeholders do driver e aplica paginação.
 * @param {object} a resultado de analyze()
 * @param {string} dbType
 * @param {object} values mapa nome → valor já convertido
 * @param {{offset:number, limit:number}} page
 * @param {object} [types] mapa nome → tipo lógico (usado para tipar parâmetros no PostgreSQL)
 */
const PG_CASTS = { TEXTO: 'text', INTEIRO: 'bigint', NUMERO: 'numeric', DECIMAL: 'numeric', BOOLEANO: 'boolean', DATA: 'date', DATAHORA: 'timestamptz' };

function build(a, dbType, values, page, types = {}) {
  const d = getDialect(dbType);
  const numbered = d.placeholder(1) !== d.placeholder(2); // $1/@p1 podem ser reutilizados; "?" não
  const params = [];
  let named = new Map();
  const ph = (v) => { params.push(v); return d.placeholder(params.length); };
  const phNamed = (name) => {
    const v = values[name] === undefined ? null : values[name];
    if (!numbered) return ph(v);
    if (!named.has(name)) {
      // PostgreSQL não deduz o tipo de "$1 IS NULL": informa o tipo do parâmetro explicitamente
      const cast = dbType === 'postgres' && PG_CASTS[types[name]] ? '::' + PG_CASTS[types[name]] : '';
      named.set(name, ph(v) + cast);
    }
    return named.get(name);
  };

  const replaceParams = (text, offsetBase, upto) => {
    let out = '';
    let last = 0;
    for (const o of a.occurrences) {
      if (o.start < offsetBase || o.start >= upto) continue;
      out += text.slice(last, o.start - offsetBase) + phNamed(o.name);
      last = o.end - offsetBase;
    }
    return out + text.slice(last);
  };

  const fullLen = a.body.length;
  const sql = replaceParams(a.body, 0, fullLen);
  let paged;
  const limitPh = ph(page.limit);
  const offsetPh = ph(page.offset);
  if (dbType === 'sqlserver') {
    paged = `${sql}${a.orderByAt >= 0 ? '' : '\nORDER BY (SELECT NULL)'}\nOFFSET ${offsetPh} ROWS FETCH NEXT ${limitPh} ROWS ONLY`;
  } else if (dbType === 'firebird') {
    // ROWS inicio TO fim (1-based) — troca os valores já empilhados (limit, offset) por (inicio, fim)
    params[params.length - 2] = page.offset + 1;
    params[params.length - 1] = page.offset + page.limit;
    paged = `${sql}\nROWS ${limitPh} TO ${offsetPh}`;
  } else {
    paged = `${sql}\nLIMIT ${limitPh} OFFSET ${offsetPh}`;
  }
  const dataParams = params.slice();

  // COUNT: sem ORDER BY de nível superior; CTE no SQL Server não pode ficar em tabela derivada
  let countSql = null;
  let countParams = null;
  const isCte = /^[\s(]*WITH\b/i.test(a.body);
  if (!(dbType === 'sqlserver' && isCte)) {
    params.length = 0;
    named = new Map();
    const upto = a.orderByAt >= 0 ? a.orderByAt : fullLen;
    const inner = replaceParams(a.body.slice(0, upto), 0, upto);
    countSql = dbType === 'firebird'
      ? `SELECT COUNT(*) AS TOTAL FROM (\n${inner}\n) GW_Q`
      : `SELECT COUNT(*) AS ${d.quote('total')} FROM (\n${inner}\n) ${d.quote('gw_q')}`;
    countParams = params.slice();
  }
  return { sql: paged, params: dataParams, countSql, countParams };
}

/** Normaliza valores do resultado para JSON. */
function normalizeValue(v) {
  if (v === null || v === undefined) return null;
  if (Buffer.isBuffer(v)) return v.toString('base64');
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString();
  if (typeof v === 'bigint') return Number.isSafeInteger(Number(v)) ? Number(v) : v.toString();
  return v;
}

function normalizeRows(rows) {
  return rows.map((r) => {
    const o = {};
    for (const k of Object.keys(r)) o[k] = Array.isArray(r[k]) ? r[k].map(normalizeValue) : normalizeValue(r[k]);
    return o;
  });
}

module.exports = { analyze, build, mask, normalizeRows, RESERVED_PARAMS, PARAM_RE };
