import { Link, useNavigate } from 'react-router-dom';
import { Badge, Button, Card, Empty, ErrorAlert, Loading, Method, PageHeader, Switch } from '../components/ui.jsx';
import { useLoad } from '../hooks/useLoad.js';
import { call } from '../services/api.js';
import { dbLabel, formatDateTime } from '../services/constants.js';
import { useApp } from '../stores/AppContext.jsx';

export default function EndpointsPage() {
  const { data, error, loading, reload } = useLoad('endpoints.list');
  const { confirm, toast } = useApp();
  const navigate = useNavigate();

  const togglePublish = async (e) => {
    const publicado = !e.publicado;
    if (!publicado && !(await confirm({ title: 'Despublicar API', message: `Os clientes deixarão de acessar /api/v1/${e.slug}. Continuar?`, confirmLabel: 'Despublicar' }))) return;
    try {
      await call('endpoints.publish', { id: e.id, publicado });
      toast(publicado ? 'API publicada.' : 'API despublicada.');
      reload();
    } catch (err) { toast(err.message, 'error'); }
  };

  const remove = async (e) => {
    if (!(await confirm({ title: 'Excluir endpoint', message: `Excluir a API "${e.slug}" e toda a sua configuração (campos, filtros, permissões)?\nOs dados do banco NÃO são afetados.`, danger: true, confirmLabel: 'Excluir' }))) return;
    try { await call('endpoints.delete', { id: e.id }); toast('Endpoint excluído.'); reload(); } catch (err) { toast(err.message, 'error'); }
  };

  return (
    <>
      <PageHeader title="Endpoints" subtitle="APIs REST geradas a partir das tabelas configuradas.">
        <Link to="/apis/endpoints/novo"><Button variant="primary" icon="plus">Nova API</Button></Link>
      </PageHeader>
      {error && <ErrorAlert error={error} />}
      {loading && !data ? <Loading /> : !data?.length ? (
        <Card><Empty icon="endpoint" title="Nenhuma API criada">Use o assistente para transformar uma tabela em API REST sem escrever SQL.<div className="mt-2"><Link to="/apis/endpoints/novo"><Button variant="primary" icon="plus">Criar primeira API</Button></Link></div></Empty></Card>
      ) : data.map((e) => (
        <Card key={e.id}
          title={<div className="row"><h3 className="mono">/api/v1/{e.slug}</h3>{e.publicado ? <Badge tone="success">Publicada</Badge> : <Badge tone="warning">Rascunho</Badge>}{!e.ativo && <Badge>Inativa</Badge>}</div>}
          actions={<>
            <span className="small text-2">Publicada</span>
            <Switch checked={e.publicado} onChange={() => togglePublish(e)} />
            <Button size="sm" icon="edit" onClick={() => navigate(`/apis/endpoints/${e.id}`)}>Configurar</Button>
            <Button size="sm" variant="ghost" icon="trash" onClick={() => remove(e)} />
          </>}>
          <div className="grid grid-2">
            <div>
              {e.routes.map((r, i) => <div className="route" key={i}><Method m={r.method} />{r.path}</div>)}
            </div>
            <dl className="kv">
              <dt>Descrição</dt><dd>{e.descricao || <span className="muted">—</span>}</dd>
              <dt>Banco</dt><dd>{e.banco} <span className="muted">({dbLabel(e.bancoTipo)})</span></dd>
              <dt>Tabela</dt><dd className="mono">{e.esquema ? e.esquema + '.' : ''}{e.tabela}</dd>
              <dt>Campos</dt><dd>{e.totalCampos}</dd>
              <dt>Atualizado</dt><dd>{formatDateTime(e.atualizadoEm)}</dd>
            </dl>
          </div>
        </Card>
      ))}
    </>
  );
}
