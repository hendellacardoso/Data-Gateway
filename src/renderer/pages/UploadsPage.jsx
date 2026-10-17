import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Button, Card, Empty, ErrorAlert, Loading, PageHeader, Pagination } from '../components/ui.jsx';
import { useLoad } from '../hooks/useLoad.js';
import { formatBytes, formatDateTime } from '../services/constants.js';

export default function UploadsPage() {
  const { data: eps } = useLoad('endpoints.list');
  const [page, setPage] = useState(1);
  const { data, error, loading } = useLoad('files.list', { page, pageSize: 50 }, [page]);
  const withUpload = (eps || []).filter((e) => e.upload);

  return (
    <>
      <PageHeader title="Uploads" subtitle="Endpoints com upload habilitado e arquivos recebidos." />
      <Card title="Endpoints de upload" noBody>
        {!eps ? <Loading /> : !withUpload.length ? <Empty icon="upload" title="Nenhum endpoint com upload">Habilite no passo “Configurar upload” do assistente.</Empty> : (
          <table className="table">
            <tbody>
              {withUpload.map((e) => (
                <tr key={e.id}>
                  <td className="mono">POST /api/v1/{e.slug}/:id/arquivos</td>
                  <td>{e.publicado ? <Badge tone="success">Publicada</Badge> : <Badge tone="warning">Rascunho</Badge>}</td>
                  <td className="actions"><Link to={`/apis/endpoints/${e.id}`}><Button size="sm" icon="edit">Configurar</Button></Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <Card title="Arquivos recebidos" noBody>
        {error && <ErrorAlert error={error} />}
        {loading && !data ? <Loading /> : !data?.rows.length ? <Empty icon="folder" title="Nenhum arquivo recebido" /> : (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Data</th><th>Endpoint</th><th>Registro</th><th>Arquivo</th><th>Tamanho</th><th>Armazenamento</th></tr></thead>
                <tbody>
                  {data.rows.map((f) => (
                    <tr key={f.id}>
                      <td className="small nowrap">{formatDateTime(f.criadoEm)}</td>
                      <td className="mono">{f.endpoint}</td>
                      <td className="mono">{f.registroId}</td>
                      <td><div>{f.nome}</div><div className="xs muted mono ellipsis" title={f.caminho || ''}>{f.caminho || f.armazenadoComo}</div></td>
                      <td className="nowrap">{formatBytes(f.tamanho)}</td>
                      <td>{f.armazenamento === 'FS' ? 'Filesystem' : 'Banco interno'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={page} pageSize={50} total={data.total} onChange={setPage} />
          </>
        )}
      </Card>
    </>
  );
}
