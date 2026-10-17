import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Badge, Button, Card, ErrorAlert, Field, Input, PageHeader, Select } from '../components/ui.jsx';
import { call } from '../services/api.js';
import { formatBytes } from '../services/constants.js';
import { useApp } from '../stores/AppContext.jsx';

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => ({ value: m, label: m }));

/** Testador de API (Postman simplificado). A requisição é feita pelo processo principal. */
export default function TesterPage() {
  const { server } = useApp();
  const location = useLocation();
  const base = server?.url || 'http://127.0.0.1:8787';
  const [method, setMethod] = useState('GET');
  const [url, setUrl] = useState(`${base}/api/v1/${location.state?.slug || ''}`);
  const [token, setToken] = useState('');
  const [body, setBody] = useState('{\n  \n}');
  const [mode, setMode] = useState('json'); // json | upload
  const [files, setFiles] = useState([]);
  const [res, setRes] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [endpoints, setEndpoints] = useState([]);

  useEffect(() => { call('endpoints.list').then(setEndpoints).catch(() => {}); }, []);

  const send = async () => {
    setBusy(true);
    setError(null);
    setRes(null);
    try {
      const payload = { method: mode === 'upload' ? 'POST' : method, url, token };
      if (mode === 'upload') payload.files = files;
      else if (!['GET', 'DELETE'].includes(method)) payload.body = body;
      setRes(await call('tester.send', payload));
    } catch (e) { setError(e); }
    setBusy(false);
  };

  const pick = async () => {
    try { setFiles(await call('system.pickFilesForUpload')); } catch (e) { setError(e); }
  };

  const tone = !res ? '' : res.status < 300 ? 'success' : res.status < 500 ? 'warning' : 'danger';

  return (
    <>
      <PageHeader title="Testador de API" subtitle="Envie requisições para os endpoints publicados e veja a resposta." />
      <div className="tester-grid">
        <Card title="Requisição" actions={
          <div className="tabs" style={{ margin: 0, border: 0 }}>
            <button className={'tab' + (mode === 'json' ? ' active' : '')} onClick={() => setMode('json')}>JSON</button>
            <button className={'tab' + (mode === 'upload' ? ' active' : '')} onClick={() => setMode('upload')}>Upload</button>
          </div>}>
          <Field label="Endpoint publicado (atalho)">
            <Select value="" placeholder="Escolha para preencher a URL…" options={endpoints.filter((e) => e.publicado).map((e) => ({ value: e.slug, label: `/api/v1/${e.slug}` }))}
              onChange={(e) => e.target.value && setUrl(`${base}/api/v1/${e.target.value}${mode === 'upload' ? '/1/arquivos' : ''}`)} />
          </Field>
          <div className="form-row" style={{ gridTemplateColumns: mode === 'json' ? '120px 1fr' : '1fr' }}>
            {mode === 'json' && <Field label="Método"><Select value={method} onChange={(e) => setMethod(e.target.value)} options={METHODS} /></Field>}
            <Field label="URL"><Input className="mono" value={url} onChange={(e) => setUrl(e.target.value)} /></Field>
          </div>
          <Field label="Authorization: Bearer" hint="O token não é salvo.">
            <Input type="password" className="mono" value={token} onChange={(e) => setToken(e.target.value)} placeholder="gw_…" />
          </Field>
          {mode === 'json' ? (
            !['GET', 'DELETE'].includes(method) && (
              <Field label="Corpo (JSON)"><textarea className="textarea mono" rows={10} value={body} onChange={(e) => setBody(e.target.value)} /></Field>
            )
          ) : (
            <Field label="Arquivos (multipart/form-data)" hint="URL no formato /api/v1/endpoint/:id/arquivos">
              <div className="row">
                <Button icon="folder" onClick={pick}>Selecionar arquivos</Button>
                <span className="small text-2">{files.length ? files.map((f) => `${f.name} (${formatBytes(f.size)})`).join(', ') : 'Nenhum arquivo'}</span>
              </div>
            </Field>
          )}
          <Button variant="primary" icon="send" loading={busy} onClick={send} disabled={!url}>Enviar</Button>
        </Card>
        <Card title="Resposta" actions={res && <><Badge tone={tone}>Status: {res.status} {res.statusText}</Badge><Badge>{res.timeMs} ms</Badge></>}>
          {error && <ErrorAlert error={error} />}
          {!res && !error && <div className="muted small">Envie uma requisição para ver a resposta.</div>}
          {res && <pre className="code-block">{res.body}</pre>}
          {res && (
            <details className="mt-1">
              <summary className="small text-2">Cabeçalhos da resposta</summary>
              <pre className="code-block mt-1">{Object.entries(res.headers).map(([k, v]) => `${k}: ${v}`).join('\n')}</pre>
            </details>
          )}
        </Card>
      </div>
    </>
  );
}
