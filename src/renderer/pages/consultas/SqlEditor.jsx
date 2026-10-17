import { useRef } from 'react';

/** Editor de SQL simples: numeração de linhas, Tab com espaços e Ctrl+Enter / F5 para executar. */
export default function SqlEditor({ value, onChange, onRun, height = 300 }) {
  const ta = useRef(null);
  const gutter = useRef(null);
  const lines = Math.max(1, String(value || '').split('\n').length);

  const onKeyDown = (e) => {
    if ((e.key === 'Enter' && (e.ctrlKey || e.metaKey)) || e.key === 'F5') {
      e.preventDefault();
      onRun && onRun();
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      const el = ta.current;
      const { selectionStart: s, selectionEnd: en } = el;
      const v = value || '';
      onChange(v.slice(0, s) + '  ' + v.slice(en));
      requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = s + 2; });
    }
  };

  return (
    <div className="sql-editor" style={{ height }}>
      <div className="sql-gutter" ref={gutter} aria-hidden="true">
        {Array.from({ length: lines }, (_, i) => <div key={i}>{i + 1}</div>)}
      </div>
      <textarea
        ref={ta}
        className="sql-text"
        spellCheck={false}
        value={value || ''}
        placeholder={'SELECT c.CAD_CODIGO, c.CAD_NOME_COMPLETO\nFROM GER_CADASTRO_GERAL c\nWHERE c.CAD_CODIGO = :codigo\nORDER BY c.CAD_NOME_COMPLETO'}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onScroll={(e) => { if (gutter.current) gutter.current.scrollTop = e.target.scrollTop; }}
      />
    </div>
  );
}
