export const LOGICAL_TYPES = [
  { value: 'TEXTO', label: 'Texto' },
  { value: 'NUMERO', label: 'Número' },
  { value: 'INTEIRO', label: 'Inteiro' },
  { value: 'DECIMAL', label: 'Decimal' },
  { value: 'BOOLEANO', label: 'Boolean' },
  { value: 'DATA', label: 'Data' },
  { value: 'DATAHORA', label: 'Data/Hora' },
  { value: 'JSON', label: 'JSON' },
  { value: 'ARQUIVO', label: 'Arquivo' }
];

export const typeLabel = (v) => LOGICAL_TYPES.find((t) => t.value === v)?.label || v;

export const OPERATORS_BY_TYPE = {
  TEXTO: ['eq', 'neq', 'contains', 'startsWith', 'endsWith', 'in', 'isNull'],
  NUMERO: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'isNull'],
  INTEIRO: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'isNull'],
  DECIMAL: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'isNull'],
  BOOLEANO: ['eq', 'isNull'],
  DATA: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'isNull'],
  DATAHORA: ['eq', 'gt', 'gte', 'lt', 'lte', 'isNull'],
  JSON: ['isNull'],
  ARQUIVO: ['isNull']
};

export const OPERATOR_LABELS = {
  eq: 'igual', neq: 'diferente', gt: 'maior que', gte: 'maior ou igual', lt: 'menor que', lte: 'menor ou igual',
  contains: 'contém', startsWith: 'começa com', endsWith: 'termina com', in: 'em lista', isNull: 'é nulo'
};

export const DB_TYPES = [
  { value: 'sqlserver', label: 'SQL Server', port: 1433 },
  { value: 'postgres', label: 'PostgreSQL', port: 5432 },
  { value: 'mysql', label: 'MySQL', port: 3306 },
  { value: 'mariadb', label: 'MariaDB', port: 3306 },
  { value: 'firebird', label: 'Firebird', port: 3050 },
  { value: 'sqlite', label: 'SQLite', port: null }
];

export const dbLabel = (v) => DB_TYPES.find((t) => t.value === v)?.label || v;

export function formatDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('pt-BR');
}

export function formatBytes(n) {
  if (n == null) return '—';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1024 / 1024).toFixed(1) + ' MB';
}

export const fmtNumber = (n) => (n ?? 0).toLocaleString('pt-BR');
