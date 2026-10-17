import { useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../../components/Icon.jsx';
import { Alert, Button, Input, Loading, Select } from '../../components/ui.jsx';
import { call } from '../../services/api.js';
import { AGGREGATES, JOIN_TYPES, generateSql, makeAlias, suggestJoins, tableKey } from './sqlGenerator.js';

const CARD_W = 250;
const HEADER_H = 30;
const EMPTY = { tables: [], joins: [], fields: [] };

function TableCard({ t, info, fields, onToggle, onRemove, onDragStart }) {
  const selected = new Set(fields.filter((f) => f.table === t.key).map((f) => f.column));
  return (
    <div className="vb-card" style={{ left: t.x, top: t.y, width: CARD_W }}>
      <div className="vb-card-h" onMouseDown={onDragStart} title="Arraste para mover">
        <span className="mono ellipsis">{t.schema ? <span className="muted">{t.schema}.</span> : null}{t.name}</span>
        {t.alias !== t.name && <span className="xs muted">({t.alias})</span>}
        <button type="button" className="vb-x" onMouseDown={(e) => e.stopPropagation()} onClick={onRemove} title="Remover tabela">×</button>
      </div>
      <div className="vb-card-b">
        {!info ? <div className="xs muted" style={{ padding: 8 }}>Carregando…</div> : info.columns.map((c) => (
          <label key={c.nome} className={'vb-col' + (selected.has(c.nome) ? ' on' : '')}>
            <input type="checkbox" checked={selected.has(c.nome)} onChange={(e) => onToggle(c.nome, e.target.checked)} />
            {c.pk ? <span title="Chave primária">🔑</span> : null}
            <span className="mono">{c.nome}</span>
            <span className="xs muted">{c.tipoFisico}{c.tamanho ? `(${c.tamanho})` : ''}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

/** Montador visual de SELECT: tabelas, ligações (JOIN), colunas, critérios, agrupamento e ordenação. */
export default function VisualBuilder({ bancoId, dbType, model: modelProp, onChange, onApply }) {
  const model = modelProp || EMPTY;
  const [objetos, setObjetos] = useState(null);
  const [busca, setBusca] = useState('');
  const [cache, setCache] = useState({});
  const [error, setError] = useState(null);
  const canvasRef = useRef(null);
  const drag = useRef(null);
  const pending = useRef(new Set());
  const modelRef = useRef(model);
  modelRef.current = model;

  useEffect(() => {
    if (!bancoId) return;
    setObjetos(null);
    call('bancos.objects', { id: bancoId }).then(setObjetos).catch((e) => { setError(e); setObjetos([]); });
  }, [bancoId]);

  // Garante a descrição (colunas/FKs) de todas as tabelas do modelo (ex.: ao reabrir uma consulta salva)
  useEffect(() => {
    for (const t of model.tables) {
      if (cache[t.key] || pending.current.has(t.key)) continue;
      pending.current.add(t.key);
      call('bancos.describe', { id: bancoId, schema: t.schema, table: t.name })
        .then((d) => setCache((c) => ({ ...c, [t.key]: d })))
        .catch(setError);
    }
  }, [model.tables, bancoId]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (patch) => onChange({ ...modelRef.current, ...patch });

  const addTable = async (o) => {
    const key = tableKey(o);
    if (model.tables.some((t) => t.key === key)) return;
    setError(null);
    try {
      const d = cache[key] || (await call('bancos.describe', { id: bancoId, schema: o.schema, table: o.name }));
      const newCache = { ...cache, [key]: d };
      setCache(newCache);
      const n = model.tables.length;
      const t = {
        key, schema: o.schema || null, name: o.name, alias: makeAlias(o.name, model.tables.map((x) => x.alias)),
        x: 20 + (n % 3) * (CARD_W + 50), y: 20 + Math.floor(n / 3) * 290
      };
      const joins = [...model.joins, ...suggestJoins(t, model.tables, newCache)];
      set({ tables: [...model.tables, t], joins });
    } catch (e) { setError(e); }
  };

  const removeTable = (key) => set({
    tables: model.tables.filter((t) => t.key !== key),
    joins: model.joins.filter((j) => j.left.table !== key && j.right.table !== key),
    fields: model.fields.filter((f) => f.table !== key)
  });

  const toggleColumn = (table, column, on) => {
    if (on) set({ fields: [...model.fields, { table, column, output: true, aggregate: '', alias: '', sort: '', sortOrder: '', group: false, criteria: '' }] });
    else set({ fields: model.fields.filter((f) => !(f.table === table && f.column === column)) });
  };

  const setField = (i, patch) => set({ fields: model.fields.map((f, j) => (j === i ? { ...f, ...patch } : f)) });
  const setJoin = (i, patch) => set({ joins: model.joins.map((j, k) => (k === i ? { ...j, ...patch } : j)) });

  // Arrastar cartões
  const startDrag = (key, e) => {
    const t = model.tables.find((x) => x.key === key);
    drag.current = { key, dx: e.clientX - t.x, dy: e.clientY - t.y };
    e.preventDefault();
  };
  useEffect(() => {
    const move = (e) => {
      if (!drag.current) return;
      const { key, dx, dy } = drag.current;
      const m = modelRef.current;
      onChange({ ...m, tables: m.tables.map((t) => (t.key === key ? { ...t, x: Math.max(0, e.clientX - dx), y: Math.max(0, e.clientY - dy) } : t)) });
    };
    const up = () => { drag.current = null; };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
  }, [onChange]);

  const { sql, warnings } = useMemo(() => generateSql(model, dbType), [model, dbType]);
  const filtered = (objetos || []).filter((o) => tableKey(o).toLowerCase().includes(busca.toLowerCase()));
  const byKey = new Map(model.tables.map((t) => [t.key, t]));
  const colOptions = model.tables.flatMap((t) => ((cache[t.key] && cache[t.key].columns) || []).map((c) => ({ value: `${t.key}|${c.nome}`, label: `${t.alias}.${c.nome}` })));
  const cardH = (t) => 40 + Math.min(12.6, ((cache[t.key] && cache[t.key].columns.length) || 3)) * 19;
  const canvasH = Math.max(240, ...model.tables.map((t) => t.y + cardH(t) + 30));
  const canvasW = Math.max(600, ...model.tables.map((t) => t.x + CARD_W + 30));

  const lines = model.joins.map((j, i) => {
    const a = byKey.get(j.left.table);
    const b = byKey.get(j.right.table);
    if (!a || !b) return null;
    const [l, r] = a.x <= b.x ? [a, b] : [b, a];
    const x1 = l.x + CARD_W;
    const y1 = l.y + HEADER_H / 2;
    const x2 = r.x;
    const y2 = r.y + HEADER_H / 2;
    const mx = (x1 + x2) / 2;
    return (
      <g key={i}>
        <path d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`} className="vb-line" />
        <text x={mx} y={(y1 + y2) / 2 - 6} className="vb-line-label">{j.type}</text>
      </g>
    );
  });

  return (
    <div className="vb">
      <div className="vb-main">
        {error && <div className="mb-1"><Alert tone="danger" title={error.message} /></div>}
        <div className="vb-canvas" ref={canvasRef} style={{ height: Math.min(560, canvasH + 2) }}>
          {!model.tables.length && <div className="vb-empty"><Icon name="table" size={28} /><div>Clique em uma tabela na lista ao lado para adicioná-la ao diagrama.</div></div>}
          <div style={{ position: 'relative', width: canvasW, height: canvasH }}>
            <svg className="vb-svg" width={canvasW} height={canvasH}>{lines}</svg>
            {model.tables.map((t) => (
              <TableCard key={t.key} t={t} info={cache[t.key]} fields={model.fields}
                onToggle={(c, on) => toggleColumn(t.key, c, on)} onRemove={() => removeTable(t.key)} onDragStart={(e) => startDrag(t.key, e)} />
            ))}
          </div>
        </div>

        {model.tables.length > 1 && (
          <div className="card mt-1">
            <div className="card-header"><h3 style={{ fontSize: 13 }}>Ligações entre tabelas (JOIN)</h3>
              <Button size="sm" icon="plus" onClick={() => {
                const [a, b] = model.tables;
                set({ joins: [...model.joins, { left: { table: a.key, column: (cache[a.key]?.primaryKeys || [])[0] || cache[a.key]?.columns[0]?.nome }, right: { table: b.key, column: cache[b.key]?.columns[0]?.nome }, type: 'INNER' }] });
              }}>Adicionar ligação</Button>
            </div>
            <table className="table table-compact">
              <tbody>
                {model.joins.map((j, i) => (
                  <tr key={i}>
                    <td style={{ width: 150 }}><Select className="input-sm" value={j.type} onChange={(e) => setJoin(i, { type: e.target.value })} options={JOIN_TYPES.map((x) => ({ value: x, label: x + ' JOIN' }))} /></td>
                    <td><Select className="input-sm" value={`${j.left.table}|${j.left.column}`} options={colOptions}
                      onChange={(e) => { const [table, column] = e.target.value.split('|'); setJoin(i, { left: { table, column } }); }} /></td>
                    <td className="center muted" style={{ width: 30 }}>=</td>
                    <td><Select className="input-sm" value={`${j.right.table}|${j.right.column}`} options={colOptions}
                      onChange={(e) => { const [table, column] = e.target.value.split('|'); setJoin(i, { right: { table, column } }); }} /></td>
                    <td className="actions"><Button size="sm" variant="ghost" icon="trash" onClick={() => set({ joins: model.joins.filter((_, k) => k !== i) })} /></td>
                  </tr>
                ))}
                {!model.joins.length && <tr><td className="muted small">Nenhuma ligação. As ligações são sugeridas automaticamente pelas chaves estrangeiras.</td></tr>}
              </tbody>
            </table>
          </div>
        )}

        <div className="card mt-1 table-wrap">
          <table className="table table-compact vb-grid">
            <thead>
              <tr><th className="center">Saída</th><th>Expressão</th><th>Agregado</th><th>Alias</th><th>Ordenação</th><th>Ordem</th><th className="center">Agrupar</th><th>Critério</th><th /></tr>
            </thead>
            <tbody>
              {model.fields.map((f, i) => {
                const t = byKey.get(f.table);
                return (
                  <tr key={f.table + f.column}>
                    <td className="center"><input type="checkbox" checked={f.output} onChange={(e) => setField(i, { output: e.target.checked })} /></td>
                    <td className="mono small">{t ? t.alias : '?'}.{f.column}</td>
                    <td style={{ width: 110 }}><Select className="input-sm" value={f.aggregate} onChange={(e) => setField(i, { aggregate: e.target.value })} options={AGGREGATES.map((a) => ({ value: a, label: a || '—' }))} /></td>
                    <td style={{ width: 140 }}><Input className="input-sm mono" value={f.alias} onChange={(e) => setField(i, { alias: e.target.value.replace(/[^A-Za-z0-9_]/g, '') })} /></td>
                    <td style={{ width: 120 }}><Select className="input-sm" value={f.sort} onChange={(e) => setField(i, { sort: e.target.value })} options={[{ value: '', label: '—' }, { value: 'ASC', label: 'Crescente' }, { value: 'DESC', label: 'Decrescente' }]} /></td>
                    <td style={{ width: 70 }}><Input className="input-sm" type="number" value={f.sortOrder} onChange={(e) => setField(i, { sortOrder: e.target.value })} /></td>
                    <td className="center"><input type="checkbox" checked={f.group} onChange={(e) => setField(i, { group: e.target.checked })} /></td>
                    <td><Input className="input-sm mono" placeholder="ex.: = :codigo   LIKE :nome   > 10" value={f.criteria} onChange={(e) => setField(i, { criteria: e.target.value })} /></td>
                    <td className="actions"><Button size="sm" variant="ghost" icon="x" onClick={() => set({ fields: model.fields.filter((_, k) => k !== i) })} /></td>
                  </tr>
                );
              })}
              {!model.fields.length && <tr><td colSpan={9} className="muted small center">Marque colunas nas tabelas do diagrama para incluí-las aqui.</td></tr>}
            </tbody>
          </table>
        </div>

        <div className="card mt-1">
          <div className="card-header">
            <h3 style={{ fontSize: 13 }}>SQL gerado</h3>
            <Button size="sm" variant="primary" icon="check" disabled={!sql} onClick={() => onApply(sql)}>Usar este SQL no editor</Button>
          </div>
          <div className="card-body">
            {warnings.map((w, i) => <div key={i} className="small" style={{ color: 'var(--warning)' }}>⚠ {w}</div>)}
            <pre className="code-block" style={{ maxHeight: 220 }}>{sql || '—'}</pre>
            <div className="xs muted mt-1">Critérios aceitam parâmetros nomeados (ex.: <code>= :codigo</code>), que viram filtros do GET publicado.</div>
          </div>
        </div>
      </div>

      <aside className="vb-side card">
        <div className="card-header"><h3 style={{ fontSize: 13 }}>Tabelas e views</h3></div>
        <div style={{ padding: 8 }}><Input className="input-sm" placeholder="Pesquisar…" value={busca} onChange={(e) => setBusca(e.target.value)} /></div>
        <div className="vb-list">
          {!objetos ? <Loading /> : filtered.map((o) => {
            const k = tableKey(o);
            const used = model.tables.some((t) => t.key === k);
            return (
              <button type="button" key={k} className={'vb-item' + (used ? ' used' : '')} onClick={() => addTable(o)} title={used ? 'Já está no diagrama' : 'Adicionar ao diagrama'}>
                <Icon name="table" size={13} />
                <span className="mono ellipsis">{o.schema ? <span className="muted">{o.schema}.</span> : null}{o.name}</span>
                {o.type === 'VIEW' && <span className="badge info">view</span>}
              </button>
            );
          })}
        </div>
      </aside>
    </div>
  );
}
