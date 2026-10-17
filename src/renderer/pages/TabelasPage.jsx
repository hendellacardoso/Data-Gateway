import { Link } from 'react-router-dom';
import { Badge, Button, Card, Empty, ErrorAlert, Loading, PageHeader } from '../components/ui.jsx';
import { useLoad } from '../hooks/useLoad.js';
import { dbLabel } from '../services/constants.js';

export default function TabelasPage() {
  const { data, error, loading } = useLoad('endpoints.list');
  const groups = {};
  for (const e of data || []) (groups[e.banco] ||= []).push(e);

  return (
    <>
      <PageHeader title="Tabelas" subtitle="Tabelas e views disponibilizadas pelo Gateway, agrupadas por conexão.">
        <Link to="/apis/endpoints/novo"><Button variant="primary" icon="plus">Selecionar nova tabela</Button></Link>
      </PageHeader>
      {error && <ErrorAlert error={error} />}
      {loading && !data ? <Loading /> : !data?.length ? (
        <Card><Empty icon="table" title="Nenhuma tabela configurada">Use “Selecionar nova tabela” para escolher as tabelas que deseja disponibilizar.</Empty></Card>
      ) : Object.entries(groups).map(([banco, list]) => (
        <Card key={banco} title={`${banco} · ${dbLabel(list[0].bancoTipo)}`} noBody>
          <table className="table">
            <thead><tr><th>Tabela</th><th>Descrição</th><th>Endpoint</th><th className="center">Campos</th><th>Status</th><th /></tr></thead>
            <tbody>
              {list.map((e) => (
                <tr key={e.id}>
                  <td className="mono bold">{e.esquema ? <span className="muted">{e.esquema}.</span> : null}{e.tabela}</td>
                  <td>{e.descricao || <span className="muted">—</span>}</td>
                  <td className="mono">/api/v1/{e.slug}</td>
                  <td className="center">{e.totalCampos}</td>
                  <td>{e.publicado ? <Badge tone="success">Publicada</Badge> : <Badge tone="warning">Rascunho</Badge>}</td>
                  <td className="actions"><Link to={`/apis/endpoints/${e.id}`}><Button size="sm" icon="edit">Configurar</Button></Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ))}
    </>
  );
}
