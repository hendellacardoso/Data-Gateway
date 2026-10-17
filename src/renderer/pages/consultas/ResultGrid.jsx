const fmt = (v) => {
  if (v === null || v === undefined) return <span className="muted">NULL</span>;
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'object') return JSON.stringify(v);
  const s = String(v);
  return s.length > 300 ? s.slice(0, 300) + '…' : s;
};

/** Grade de resultado da consulta. */
export default function ResultGrid({ columns, rows, startIndex = 0 }) {
  if (!columns || !columns.length) return <div className="empty small">&lt;Não há registros&gt;</div>;
  return (
    <div className="result-grid">
      <table>
        <thead>
          <tr>
            <th className="rn">#</th>
            {columns.map((c) => <th key={c}>{c}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td className="rn">{startIndex + i + 1}</td>
              {columns.map((c) => (
                <td key={c} className={typeof r[c] === 'number' ? 'num' : ''} title={r[c] === null || r[c] === undefined ? '' : String(typeof r[c] === 'object' ? JSON.stringify(r[c]) : r[c])}>{fmt(r[c])}</td>
              ))}
            </tr>
          ))}
          {!rows.length && <tr><td className="muted" colSpan={columns.length + 1} style={{ textAlign: 'center', padding: 24 }}>&lt;Não há registros&gt;</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

/** Converte o resultado em CSV (separador ";" — abre direto no Excel em português). */
export function toCsv(columns, rows) {
  const esc = (v) => {
    if (v === null || v === undefined) return '';
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return '﻿' + [columns.map(esc).join(';'), ...rows.map((r) => columns.map((c) => esc(r[c])).join(';'))].join('\r\n');
}
