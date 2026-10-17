import { useState } from 'react';
import { Badge, Button, Card, Empty, ErrorAlert, Input, Loading, PageHeader, Pagination, Select } from '../components/ui.jsx';
import { useLoad } from '../hooks/useLoad.js';
import { formatDateTime } from '../services/constants.js';

const TONE = { LOGIN_FALHA: 'danger', EXCLUSAO: 'danger', TOKEN_REVOGADO: 'danger', ENDPOINT_EXCLUIDO: 'danger', BANCO_EXCLUIDO: 'danger', LOGIN: 'info', LOGOUT: 'info', INCLUSAO: 'success', UPLOAD: 'success' };

export default function AuditoriaPage() {
  const [page, setPage] = useState(1);
  const [texto, setTexto] = useState('');
  const [origem, setOrigem] = useState('');
  const [applied, setApplied] = useState({ texto: '', origem: '' });
  const { data, error, loading, reload } = useLoad('audit.list', { page, pageSize: 50, ...applied }, [page, applied]);

  return (
    <>
      <PageHeader title="Auditoria" subtitle="Operações importantes do painel e da API (login, configurações, tokens, inclusões, alterações, exclusões e uploads).">
        <Button icon="refresh" onClick={reload}>Atualizar</Button>
      </PageHeader>
      <div className="card card-body mb-2">
        <form className="row wrap" onSubmit={(e) => { e.preventDefault(); setPage(1); setApplied({ texto, origem }); }}>
          <Input style={{ maxWidth: 320 }} placeholder="Pesquisar ação, usuário, entidade…" value={texto} onChange={(e) => setTexto(e.target.value)} />
          <Select style={{ width: 180 }} value={origem} placeholder="Todas as origens" onChange={(e) => setOrigem(e.target.value)} options={[{ value: 'PAINEL', label: 'Painel' }, { value: 'API', label: 'API' }, { value: 'TRAY', label: 'Tray' }]} />
          <Button type="submit" variant="primary">Filtrar</Button>
        </form>
      </div>
      {error && <ErrorAlert error={error} />}
      <Card noBody>
        {loading && !data ? <Loading /> : !data?.rows.length ? <Empty icon="shield" title="Nenhum registro" /> : (
          <>
            <div className="table-wrap">
              <table className="table table-compact">
                <thead><tr><th>Data/hora</th><th>Origem</th><th>Usuário / Token</th><th>Ação</th><th>Entidade</th><th>Detalhes</th></tr></thead>
                <tbody>
                  {data.rows.map((a) => (
                    <tr key={a.id}>
                      <td className="small nowrap">{formatDateTime(a.dataHora)}</td>
                      <td><Badge>{a.origem}</Badge></td>
                      <td className="small">{a.usuario || '—'}</td>
                      <td><Badge tone={TONE[a.acao] || 'primary'}>{a.acao}</Badge></td>
                      <td className="small mono">{a.entidade ? `${a.entidade}${a.entidadeId ? ' #' + a.entidadeId : ''}` : '—'}</td>
                      <td className="small mono ellipsis" title={a.detalhes || ''}>{a.detalhes || ''}</td>
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
