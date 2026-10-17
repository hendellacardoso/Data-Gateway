import { useState } from 'react';
import { Button, Card, CopyButton, Empty, ErrorAlert, Loading, Method, PageHeader } from '../components/ui.jsx';
import { useLoad } from '../hooks/useLoad.js';
import { call } from '../services/api.js';
import { useApp } from '../stores/AppContext.jsx';

export default function DocsPage() {
  const { data: spec, error, loading, reload } = useLoad('docs.spec');
  const { server, toast } = useApp();
  const [showJson, setShowJson] = useState(false);

  const open = () => call('system.openDocs').catch((e) => toast(e.message, 'error'));

  return (
    <>
      <PageHeader title="Documentação da API" subtitle="Gerada automaticamente (OpenAPI 3) a partir dos endpoints publicados.">
        <Button icon="refresh" onClick={reload}>Atualizar</Button>
        <Button icon="eye" onClick={() => setShowJson(!showJson)}>{showJson ? 'Ocultar' : 'Ver'} OpenAPI JSON</Button>
        <Button variant="primary" icon="external" disabled={!server?.running} onClick={open}>Abrir Swagger UI</Button>
      </PageHeader>
      {server?.running && (
        <div className="card card-body mb-2 row between">
          <div className="small">Swagger UI: <code>{server.url}/docs</code> · Especificação: <code>{server.url}/openapi.json</code></div>
          <CopyButton text={`${server.url}/openapi.json`} label="Copiar URL da especificação" />
        </div>
      )}
      {error && <ErrorAlert error={error} />}
      {loading && !spec ? <Loading /> : !spec || !Object.keys(spec.paths).length ? (
        <Card><Empty icon="book" title="Nenhum endpoint publicado">Publique uma API para gerar a documentação.</Empty></Card>
      ) : showJson ? (
        <Card title="openapi.json"><pre className="code-block">{JSON.stringify(spec, null, 2)}</pre></Card>
      ) : (
        spec.tags.map((tag) => (
          <Card key={tag.name} title={<div><h3 className="mono">{tag.name}</h3><div className="small text-2">{tag.description}</div></div>}>
            {Object.entries(spec.paths).filter(([p]) => p.startsWith(`/api/v1/${tag.name}`) && (p === `/api/v1/${tag.name}` || p.startsWith(`/api/v1/${tag.name}/`))).map(([p, ops]) => (
              Object.entries(ops).map(([m, op]) => (
                <div key={p + m} style={{ padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
                  <div className="route"><Method m={m.toUpperCase()} />{p}<span className="small text-2" style={{ fontFamily: 'inherit' }}>— {op.summary}</span></div>
                  {op.parameters?.filter((x) => x.in === 'query').length > 0 && (
                    <div className="small text-2" style={{ marginLeft: 66 }}>
                      Parâmetros: {op.parameters.filter((x) => x.in === 'query').map((x) => <code key={x.name} style={{ marginRight: 8 }} title={x.description}>{x.name}</code>)}
                    </div>
                  )}
                  <div className="xs muted" style={{ marginLeft: 66 }}>Respostas: {Object.keys(op.responses).join(' · ')}</div>
                </div>
              ))
            ))}
          </Card>
        ))
      )}
    </>
  );
}
