import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Alert, Badge, Button, Card, Checkbox, CopyButton, ErrorAlert, Field, Input, Loading, PageHeader, Select, ToggleRow } from '../../components/ui.jsx';
import { call } from '../../services/api.js';
import { dbLabel } from '../../services/constants.js';
import { useApp } from '../../stores/AppContext.jsx';
import ResultGrid, { toCsv } from './ResultGrid.jsx';
import SqlEditor from './SqlEditor.jsx';
import VisualBuilder from './VisualBuilder.jsx';

const PARAM_TYPES = [
  { value: 'TEXTO', label: 'Texto' }, { value: 'INTEIRO', label: 'Inteiro' }, { value: 'DECIMAL', label: 'Decimal' },
  { value: 'NUMERO', label: 'Número' }, { value: 'BOOLEANO', label: 'Boolean' }, { value: 'DATA', label: 'Data' }, { value: 'DATAHORA', label: 'Data/Hora' }
];

const NEW = {
  nome: '', slug: '', descricao: '', bancoId: '', sql: '', modeloVisual: null, ativo: true, publicar: false,
  paginacao: { padrao: 50, max: 500 }, calcularTotal: true, parametros: [], permissoes: []
};

const slugify = (s) => String(s).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 63);

export default function ConsultaEditorPage() {
  const { id: routeId } = useParams();
  const { toast, server } = useApp();
  const [id, setId] = useState(routeId ? Number(routeId) : null);
  const [c, setC] = useState(NEW);
  const [loaded, setLoaded] = useState(!routeId);
  const [bancos, setBancos] = useState([]);
  const [tokens, setTokens] = useState([]);
  const [tab, setTab] = useState('sql');
  const [resTab, setResTab] = useState('dados');
  const [analysis, setAnalysis] = useState({ errors: [], params: [] });
  const [testValues, setTestValues] = useState({});
  const [limite, setLimite] = useState(100);
  const [result, setResult] = useState(null);
  const [running, setRunning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [log, setLog] = useState([]);
  const [history, setHistory] = useState([]);
  const [dirty, setDirty] = useState(false);
  const slugTouched = useRef(!!routeId);

  const update = useCallback((patch) => { setC((x) => ({ ...x, ...patch })); setDirty(true); }, []);
  const banco = bancos.find((b) => b.id === Number(c.bancoId));
  const dbType = banco ? banco.tipo : 'sqlite';

  useEffect(() => {
    call('bancos.list').then((l) => {
      setBancos(l);
      if (!routeId && l.length) setC((x) => (x.bancoId ? x : { ...x, bancoId: l.find((b) => b.ativo)?.id || l[0].id }));
    }).catch(setError);
    call('tokens.list').then((t) => setTokens(t.filter((x) => x.status === 'ATIVO'))).catch(() => {});
  }, [routeId]);

  useEffect(() => {
    if (!routeId) return;
    call('consultas.get', { id: Number(routeId) })
      .then((d) => { setC({ ...NEW, ...d, publicar: d.publicado }); setLoaded(true); if (d.modeloVisual && !d.sql) setTab('diagrama'); })
      .catch(setError);
  }, [routeId]);

  // Análise do SQL em tempo real (validação + parâmetros encontrados)
  useEffect(() => {
    if (!c.bancoId) return undefined;
    const t = setTimeout(() => {
      call('consultas.analisar', { bancoId: Number(c.bancoId), sql: c.sql })
        .then((a) => {
          setAnalysis(a);
          setC((x) => {
            const defs = new Map(x.parametros.map((p) => [p.nome, p]));
            const next = a.params.map((n) => defs.get(n) || { nome: n, tipo: 'TEXTO', obrigatorio: false, padrao: '', descricao: '' });
            const same = next.length === x.parametros.length && next.every((p, i) => p === x.parametros[i]);
            return same ? x : { ...x, parametros: next };
          });
        })
        .catch(() => {});
    }, 350);
    return () => clearTimeout(t);
  }, [c.sql, c.bancoId]);

  const setParam = (nome, patch) => update({ parametros: c.parametros.map((p) => (p.nome === nome ? { ...p, ...patch } : p)) });

  const run = async (page = 1) => {
    if (!c.sql.trim()) return;
    setRunning(true);
    setError(null);
    const t0 = new Date();
    try {
      const r = await call('consultas.executar', {
        bancoId: Number(c.bancoId), sql: c.sql, parametros: c.parametros, valores: testValues, limite: Number(limite) || 100, page
      });
      setResult(r);
      setResTab('dados');
      setLog((l) => [{ at: t0, ok: true, msg: `${r.data.length} registro(s)${r.pagination.total !== null ? ` de ${r.pagination.total}` : ''} em ${r.elapsedMs} ms` }, ...l].slice(0, 100));
    } catch (e) {
      setResult(null);
      setResTab('log');
      setLog((l) => [{ at: t0, ok: false, msg: e.message, details: e.details }, ...l].slice(0, 100));
    } finally {
      setRunning(false);
      setHistory((h) => [{ at: t0, sql: c.sql }, ...h.filter((x) => x.sql !== c.sql)].slice(0, 30));
    }
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const r = await call('consultas.save', { ...c, id: id || undefined, bancoId: Number(c.bancoId) });
      setId(r.id);
      setDirty(false);
      toast(c.publicar ? 'Consulta salva e publicada.' : 'Consulta salva.');
    } catch (e) { setError(e); }
    setSaving(false);
  };

  const openSql = async () => {
    const f = await call('system.openTextFile', { filters: [{ name: 'SQL', extensions: ['sql', 'txt'] }] }).catch((e) => { toast(e.message, 'error'); return null; });
    if (f) { update({ sql: f.content }); setTab('sql'); }
  };
  const saveSql = () => call('system.saveTextFile', { content: c.sql, defaultName: (c.slug || 'consulta') + '.sql', filters: [{ name: 'SQL', extensions: ['sql'] }] }).catch((e) => toast(e.message, 'error'));
  const exportCsv = () => result && call('system.saveTextFile', { content: toCsv(result.columns, result.data), defaultName: (c.slug || 'consulta') + '.csv', filters: [{ name: 'CSV', extensions: ['csv'] }] });
  const exportJson = () => result && call('system.saveTextFile', { content: JSON.stringify(result.data, null, 2), defaultName: (c.slug || 'consulta') + '.json', filters: [{ name: 'JSON', extensions: ['json'] }] });

  if (!loaded) return error ? <ErrorAlert error={error} /> : <Loading />;
  const base = server?.url || 'http://127.0.0.1:8787';
  const url = `${base}/api/v1/consultas/${c.slug || '…'}`;
  const exampleQs = c.parametros.map((p) => `${p.nome}=${encodeURIComponent(testValues[p.nome] || p.padrao || '…')}`).join('&');

  return (
    <>
      <PageHeader title={id ? `Consulta: ${c.nome || c.slug}` : 'Nova consulta SQL'} subtitle="Monte e teste um SELECT e publique-o como um GET somente leitura.">
        <Button icon="folder" onClick={openSql}>Abrir .sql</Button>
        <Button icon="download" onClick={saveSql} disabled={!c.sql}>Salvar .sql</Button>
        <Button icon="play" onClick={() => run(1)} loading={running} disabled={!c.sql.trim() || analysis.errors.length > 0}>Executar</Button>
        <Button variant="primary" icon="check" onClick={save} loading={saving}>{dirty ? 'Salvar •' : 'Salvar'}</Button>
        <Link to="/apis/consultas"><Button>Voltar</Button></Link>
      </PageHeader>
      {error && <div className="mb-2"><ErrorAlert error={error} /></div>}

      <div className="card card-body mb-2">
        <div className="form-row" style={{ gridTemplateColumns: '1.3fr 1.3fr 1fr 2fr' }}>
          <Field label="Nome" className="mb-0">
            <Input value={c.nome} onChange={(e) => update({ nome: e.target.value, ...(slugTouched.current ? {} : { slug: slugify(e.target.value) }) })} placeholder="Clientes com foto" />
          </Field>
          <Field label="Endereço (GET)" className="mb-0">
            <div className="input-group">
              <span className="input mono small" style={{ width: 'auto', display: 'flex', alignItems: 'center', background: 'var(--surface-2)', whiteSpace: 'nowrap' }}>/consultas/</span>
              <Input className="mono" value={c.slug} onChange={(e) => { slugTouched.current = true; update({ slug: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '') }); }} />
            </div>
          </Field>
          <Field label="Banco de dados" className="mb-0">
            <Select value={c.bancoId} onChange={(e) => update({ bancoId: Number(e.target.value), modeloVisual: null })}
              options={bancos.map((b) => ({ value: b.id, label: `${b.nome} (${dbLabel(b.tipo)})`, disabled: !b.ativo }))} />
          </Field>
          <Field label="Descrição" className="mb-0"><Input value={c.descricao} onChange={(e) => update({ descricao: e.target.value })} placeholder="Exibida na documentação" /></Field>
        </div>
      </div>

      <div className="tabs">
        {[['diagrama', 'Diagrama'], ['sql', 'SQL'], ['publicacao', 'Publicação']].map(([k, l]) => (
          <button key={k} className={'tab' + (tab === k ? ' active' : '')} onClick={() => setTab(k)}>{l}</button>
        ))}
        <div style={{ flex: 1 }} />
        {c.publicar ? <Badge tone="success">Publicada</Badge> : <Badge tone="warning">Rascunho</Badge>}
      </div>

      {tab === 'diagrama' && c.bancoId && (
        <VisualBuilder bancoId={Number(c.bancoId)} dbType={dbType} model={c.modeloVisual}
          onChange={(m) => update({ modeloVisual: m })}
          onApply={(sql) => { update({ sql }); setTab('sql'); toast('SQL aplicado no editor. Clique em Executar para testar.', 'info'); }} />
      )}

      {tab === 'sql' && (
        <>
          <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 3fr) minmax(300px, 1.3fr)', alignItems: 'start' }}>
            <div>
              <SqlEditor value={c.sql} onChange={(v) => update({ sql: v })} onRun={() => run(1)} height={300} />
              <div className="small mt-1">
                {!c.sql.trim() ? <span className="muted">Digite o SELECT ou monte-o na aba Diagrama. Ctrl+Enter ou F5 executa.</span>
                  : analysis.errors.length
                    ? analysis.errors.map((e, i) => <div key={i} style={{ color: 'var(--danger)' }}>✕ {e}</div>)
                    : <span style={{ color: 'var(--success)' }}>✓ Consulta somente leitura válida{c.parametros.length ? ` · ${c.parametros.length} parâmetro(s)` : ''}</span>}
              </div>
            </div>
            <Card title="Parâmetros" noBody>
              {!c.parametros.length ? (
                <div className="card-body small text-2">Use <code>:nome</code> no SQL para criar parâmetros. Eles viram filtros do GET, ex.: <code>WHERE c.CAD_CODIGO = :codigo</code>.</div>
              ) : (
                <table className="table table-compact">
                  <thead><tr><th>Nome</th><th>Tipo</th><th className="center" title="Obrigatório">Obr.</th><th>Valor de teste</th></tr></thead>
                  <tbody>
                    {c.parametros.map((p) => (
                      <tr key={p.nome}>
                        <td className="mono small">:{p.nome}</td>
                        <td style={{ width: 110 }}><Select className="input-sm" value={p.tipo} onChange={(e) => setParam(p.nome, { tipo: e.target.value })} options={PARAM_TYPES} /></td>
                        <td className="center"><Checkbox checked={p.obrigatorio} onChange={(v) => setParam(p.nome, { obrigatorio: v })} /></td>
                        <td><Input className="input-sm" value={testValues[p.nome] ?? ''} placeholder={p.padrao ? `padrão: ${p.padrao}` : 'vazio = NULL'}
                          onChange={(e) => setTestValues({ ...testValues, [p.nome]: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && run(1)} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          </div>

          <div className="card mt-2 result-panel">
            <div className="result-toolbar">
              <div className="tabs" style={{ margin: 0, border: 0 }}>
                {[['dados', 'Dados'], ['log', `Log${log.length ? ` (${log.length})` : ''}`], ['historico', 'Histórico']].map(([k, l]) => (
                  <button key={k} className={'tab' + (resTab === k ? ' active' : '')} onClick={() => setResTab(k)}>{l}</button>
                ))}
              </div>
              <div className="row" style={{ marginLeft: 'auto' }}>
                <span className="small text-2">Exibir os primeiros</span>
                <Input className="input-sm" type="number" style={{ width: 80 }} value={limite} min={1} max={1000} onChange={(e) => setLimite(e.target.value)} />
                <span className="small text-2">registros</span>
                <Button size="sm" icon="refresh" onClick={() => run(1)} disabled={!c.sql.trim() || running}>Atualizar</Button>
                <Button size="sm" icon="download" onClick={exportCsv} disabled={!result}>CSV</Button>
                <Button size="sm" icon="download" onClick={exportJson} disabled={!result}>JSON</Button>
              </div>
            </div>
            {resTab === 'dados' && (
              <>
                {running ? <Loading text="Executando…" /> : <ResultGrid columns={result?.columns} rows={result?.data || []} startIndex={result ? (result.pagination.page - 1) * result.pagination.pageSize : 0} />}
                {result && (
                  <div className="pagination">
                    <span>
                      {result.data.length} registro(s){result.pagination.total !== null ? ` de ${result.pagination.total.toLocaleString('pt-BR')}` : ''} · {result.elapsedMs} ms
                      {result.pagination.hasMore && ' · há mais registros'}
                    </span>
                    <div className="row">
                      <Button size="sm" disabled={result.pagination.page <= 1} onClick={() => run(result.pagination.page - 1)}>Anterior</Button>
                      <span>Página {result.pagination.page}{result.pagination.totalPages ? ` de ${result.pagination.totalPages}` : ''}</span>
                      <Button size="sm" disabled={!result.pagination.hasMore} onClick={() => run(result.pagination.page + 1)}>Próxima</Button>
                    </div>
                  </div>
                )}
              </>
            )}
            {resTab === 'log' && (
              <div className="card-body" style={{ maxHeight: 320, overflow: 'auto' }}>
                {!log.length ? <div className="muted small">Nenhuma execução ainda.</div> : log.map((l, i) => (
                  <div key={i} className="small" style={{ padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                    <span className="muted mono">{l.at.toLocaleTimeString('pt-BR')}</span>{' '}
                    <span style={{ color: l.ok ? 'var(--success)' : 'var(--danger)' }}>{l.ok ? '✓' : '✕'} {l.msg}</span>
                    {l.details && l.details.length > 1 && <pre className="mono xs" style={{ whiteSpace: 'pre-wrap', margin: '4px 0 0' }}>{l.details.join('\n')}</pre>}
                  </div>
                ))}
              </div>
            )}
            {resTab === 'historico' && (
              <div className="card-body" style={{ maxHeight: 320, overflow: 'auto' }}>
                {!history.length ? <div className="muted small">Os comandos executados nesta sessão aparecem aqui. Clique para reutilizar.</div> : history.map((h, i) => (
                  <button key={i} type="button" className="hist-item" onClick={() => { update({ sql: h.sql }); }}>
                    <span className="muted xs">{h.at.toLocaleTimeString('pt-BR')}</span>
                    <code className="ellipsis" style={{ maxWidth: '100%' }}>{h.sql.replace(/\s+/g, ' ')}</code>
                  </button>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {tab === 'publicacao' && (
        <div className="grid grid-2">
          <Card title="Publicação">
            <ToggleRow title="Publicar como GET" description={`GET /api/v1/consultas/${c.slug || '…'}`} checked={c.publicar} onChange={(v) => update({ publicar: v })} />
            <ToggleRow title="Ativa" description="Consultas inativas respondem 404." checked={c.ativo} onChange={(v) => update({ ativo: v })} />
            <ToggleRow title="Calcular total de registros" description="Executa um COUNT adicional para informar total e totalPages." checked={c.calcularTotal} onChange={(v) => update({ calcularTotal: v })} />
            <div className="form-row mt-2">
              <Field label="Itens por página (padrão)"><Input type="number" value={c.paginacao.padrao} onChange={(e) => update({ paginacao: { ...c.paginacao, padrao: Number(e.target.value) } })} /></Field>
              <Field label="Máximo por página"><Input type="number" value={c.paginacao.max} onChange={(e) => update({ paginacao: { ...c.paginacao, max: Number(e.target.value) } })} /></Field>
            </div>
            <div className="bold small mb-1">Exemplo de chamada</div>
            <div className="token-box" style={{ color: '#e2e8f0' }}>
              <span style={{ flex: 1 }}>GET {url}{exampleQs ? '?' + exampleQs : ''}</span>
              <CopyButton text={`${url}${exampleQs ? '?' + exampleQs : ''}`} />
            </div>
            <div className="xs muted mt-1">Cabeçalho: Authorization: Bearer &lt;token&gt;. Paginação: page e pageSize.</div>
          </Card>
          <div>
            <Card title="Tokens com acesso">
              {!tokens.length ? <div className="muted small">Nenhum token ativo. Crie em APIs → Tokens.</div> : tokens.map((t) => (
                <div key={t.id} className="toggle-row">
                  <div><div className="t">{t.nome}</div><div className="d mono">{t.prefixo}…</div></div>
                  <Checkbox checked={c.permissoes.includes(t.id)} onChange={(v) => update({ permissoes: v ? [...c.permissoes, t.id] : c.permissoes.filter((x) => x !== t.id) })} />
                </div>
              ))}
            </Card>
            <Card title="Parâmetros na documentação">
              {!c.parametros.length ? <div className="muted small">Sem parâmetros.</div> : c.parametros.map((p) => (
                <div key={p.nome} className="form-row" style={{ gridTemplateColumns: '120px 1fr 140px', alignItems: 'end' }}>
                  <Field label="Parâmetro"><Input className="mono" value={p.nome} disabled /></Field>
                  <Field label="Descrição"><Input value={p.descricao} onChange={(e) => setParam(p.nome, { descricao: e.target.value })} /></Field>
                  <Field label="Valor padrão"><Input value={p.padrao} onChange={(e) => setParam(p.nome, { padrao: e.target.value })} /></Field>
                </div>
              ))}
            </Card>
          </div>
          {analysis.errors.length > 0 && <div style={{ gridColumn: '1 / -1' }}><Alert tone="danger" title="Corrija o SQL antes de salvar">{analysis.errors[0]}</Alert></div>}
        </div>
      )}
    </>
  );
}
