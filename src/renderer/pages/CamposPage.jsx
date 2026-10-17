import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Button, Card, Empty, ErrorAlert, Field, Loading, PageHeader, Select } from '../components/ui.jsx';
import { useLoad } from '../hooks/useLoad.js';
import { call } from '../services/api.js';
import { typeLabel } from '../services/constants.js';

const yes = (v) => (v ? <span style={{ color: 'var(--success)' }}>✓</span> : <span className="muted">—</span>);

export default function CamposPage() {
  const { data: eps, error } = useLoad('endpoints.list');
  const [sel, setSel] = useState('');
  const [full, setFull] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!sel && eps?.length) setSel(String(eps[0].id));
  }, [eps, sel]);

  useEffect(() => {
    if (!sel) return;
    setLoading(true);
    call('endpoints.get', { id: Number(sel) }).then(setFull).finally(() => setLoading(false));
  }, [sel]);

  return (
    <>
      <PageHeader title="Campos" subtitle="Tipo físico do banco × tipo lógico da API e o comportamento de cada campo.">
        {sel && <Link to={`/apis/endpoints/${sel}`}><Button variant="primary" icon="edit">Editar no assistente</Button></Link>}
      </PageHeader>
      {error && <ErrorAlert error={error} />}
      {!eps ? <Loading /> : !eps.length ? <Card><Empty icon="fields" title="Nenhuma tabela configurada" /></Card> : (
        <>
          <Field label="Tabela / endpoint" className="mb-2">
            <Select style={{ maxWidth: 420 }} value={sel} onChange={(e) => setSel(e.target.value)} options={eps.map((e) => ({ value: String(e.id), label: `${e.tabela} → /api/v1/${e.slug}` }))} />
          </Field>
          <Card noBody>
            {loading || !full ? <Loading /> : (
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Campo</th><th>Nome na API</th><th>Tipo físico</th><th>Tipo lógico</th><th className="center">Exibir</th><th className="center">Incluir</th><th className="center">Alterar</th><th className="center">Obrigatório</th><th>Descrição</th></tr></thead>
                  <tbody>
                    {full.campos.map((c) => (
                      <tr key={c.nome}>
                        <td className="mono bold">{c.nome} {c.pk && <Badge tone="primary">PK</Badge>} {c.auto && <Badge tone="info">auto</Badge>}</td>
                        <td className="mono">{c.nomeApi}</td>
                        <td className="mono small muted">{c.tipoFisico}{c.tamanho ? `(${c.tamanho})` : ''}</td>
                        <td>{typeLabel(c.tipoLogico)}</td>
                        <td className="center">{yes(c.retornar)}</td>
                        <td className="center">{yes(c.incluir)}</td>
                        <td className="center">{yes(c.alterar)}</td>
                        <td className="center">{yes(c.obrigatorio)}</td>
                        <td className="small">{c.descricao || <span className="muted">—</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </>
  );
}
