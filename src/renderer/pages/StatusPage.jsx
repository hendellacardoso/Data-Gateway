import { Badge, Button, Card, Empty, ErrorAlert, Loading, PageHeader } from '../components/ui.jsx';
import { useLoad } from '../hooks/useLoad.js';
import { call } from '../services/api.js';
import { dbLabel, formatDateTime } from '../services/constants.js';
import { useApp } from '../stores/AppContext.jsx';
import { useState } from 'react';

export default function StatusPage() {
  const { data, error, loading, reload } = useLoad('bancos.status');
  const { toast } = useApp();
  const [busy, setBusy] = useState(null);

  const reconnect = async (id) => {
    setBusy(id);
    const r = await call('bancos.reconnect', { id }).catch((e) => ({ ok: false, details: e.message }));
    setBusy(null);
    toast(r.ok ? 'Conectado com sucesso.' : 'Falha: ' + r.details, r.ok ? 'success' : 'error');
    reload();
  };

  return (
    <>
      <PageHeader title="Status das conexões" subtitle="Situação dos pools de conexão mantidos pelo Gateway.">
        <Button icon="refresh" onClick={reload}>Atualizar</Button>
      </PageHeader>
      {error && <ErrorAlert error={error} />}
      <Card noBody>
        {loading && !data ? <Loading /> : !data?.length ? <Empty title="Nenhuma conexão cadastrada" /> : (
          <table className="table">
            <thead><tr><th>Conexão</th><th>Tipo</th><th>Situação</th><th>Último erro</th><th /></tr></thead>
            <tbody>
              {data.map((s) => (
                <tr key={s.id}>
                  <td className="bold">{s.nome}</td>
                  <td>{dbLabel(s.tipo)}</td>
                  <td>
                    {!s.ativo ? <Badge>Inativa</Badge>
                      : s.conectado ? <Badge tone="success">● Conectada (pool ativo)</Badge>
                        : s.ultimoErro ? <Badge tone="danger">Falha</Badge>
                          : <Badge tone="info">Aguardando primeira requisição</Badge>}
                  </td>
                  <td className="small">{s.ultimoErro ? <><span className="muted">{formatDateTime(s.ultimoErro.at)}</span><br />{s.ultimoErro.message}</> : '—'}</td>
                  <td className="actions"><Button size="sm" icon="refresh" loading={busy === s.id} onClick={() => reconnect(s.id)}>Reconectar</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
