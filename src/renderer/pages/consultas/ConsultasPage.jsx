import { Link, useNavigate } from 'react-router-dom';
import { Badge, Button, Card, Empty, ErrorAlert, Loading, Method, PageHeader, Switch } from '../../components/ui.jsx';
import { useLoad } from '../../hooks/useLoad.js';
import { call } from '../../services/api.js';
import { dbLabel, formatDateTime } from '../../services/constants.js';
import { useApp } from '../../stores/AppContext.jsx';

export default function ConsultasPage() {
  const { data, error, loading, reload } = useLoad('consultas.list');
  const { confirm, toast } = useApp();
  const navigate = useNavigate();

  const togglePublish = async (c) => {
    try {
      await call('consultas.publish', { id: c.id, publicado: !c.publicado });
      toast(!c.publicado ? 'Consulta publicada.' : 'Consulta despublicada.');
      reload();
    } catch (e) { toast(e.message, 'error'); }
  };

  const remove = async (c) => {
    if (!(await confirm({ title: 'Excluir consulta', message: `Excluir a consulta "${c.nome}"? O GET /api/v1/consultas/${c.slug} deixará de existir.`, danger: true, confirmLabel: 'Excluir' }))) return;
    try { await call('consultas.delete', { id: c.id }); toast('Consulta excluída.'); reload(); } catch (e) { toast(e.message, 'error'); }
  };

  return (
    <>
      <PageHeader title="Consultas SQL" subtitle="SELECTs personalizados (somente leitura) testados no painel e publicados como GET.">
        <Link to="/apis/consultas/nova"><Button variant="primary" icon="plus">Nova consulta</Button></Link>
      </PageHeader>
      {error && <ErrorAlert error={error} />}
      <Card noBody>
        {loading && !data ? <Loading /> : !data?.length ? (
          <Empty icon="terminal" title="Nenhuma consulta criada">
            Monte um SELECT com várias tabelas, teste o resultado e publique como <code>GET /api/v1/consultas/…</code>.
            <div className="mt-2"><Link to="/apis/consultas/nova"><Button variant="primary" icon="plus">Criar primeira consulta</Button></Link></div>
          </Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Consulta</th><th>Endereço</th><th>Banco</th><th>Parâmetros</th><th className="center">Tokens</th><th>Publicada</th><th>Atualizada</th><th /></tr></thead>
              <tbody>
                {data.map((c) => (
                  <tr key={c.id}>
                    <td><div className="bold">{c.nome}</div><div className="xs muted">{c.descricao}</div></td>
                    <td><div className="route" style={{ padding: 0 }}><Method m="GET" /><span className="small">/api/v1/consultas/{c.slug}</span></div></td>
                    <td className="small">{c.banco} <span className="muted">({dbLabel(c.bancoTipo)})</span></td>
                    <td className="mono small">{c.parametros || <span className="muted">—</span>}</td>
                    <td className="center">{c.totalTokens}</td>
                    <td><div className="row"><Switch checked={c.publicado} onChange={() => togglePublish(c)} />{!c.ativo && <Badge>Inativa</Badge>}</div></td>
                    <td className="small muted">{formatDateTime(c.atualizadoEm)}</td>
                    <td className="actions">
                      <Button size="sm" icon="edit" onClick={() => navigate(`/apis/consultas/${c.id}`)}>Abrir</Button>
                      <Button size="sm" variant="ghost" icon="trash" onClick={() => remove(c)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
