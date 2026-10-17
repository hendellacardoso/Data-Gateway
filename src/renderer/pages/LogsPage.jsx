import { Fragment, useEffect, useState } from 'react';
import { Badge, Button, Card, Empty, ErrorAlert, Input, Loading, Method, PageHeader, Pagination, Select } from '../components/ui.jsx';
import { useLoad } from '../hooks/useLoad.js';
import { call } from '../services/api.js';
import { formatDateTime } from '../services/constants.js';
import { useApp } from '../stores/AppContext.jsx';

const statusTone = (s) => (s >= 500 ? 'danger' : s >= 400 ? 'warning' : 'success');

export default function LogsPage() {
  const { confirm, toast } = useApp();
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({ status: '', metodo: '', texto: '' });
  const [applied, setApplied] = useState(filters);
  const [auto, setAuto] = useState(true);
  const { data, error, loading, reload } = useLoad('logs.list', { page, pageSize: 50, ...applied }, [page, applied]);
  const [open, setOpen] = useState(null);

  useEffect(() => {
    if (!auto) return undefined;
    const t = setInterval(reload, 5000);
    return () => clearInterval(t);
  }, [auto, reload]);

  const clear = async () => {
    if (!(await confirm({ title: 'Limpar logs', message: 'Apagar todos os logs de requisições? A auditoria não é afetada.', danger: true, confirmLabel: 'Limpar' }))) return;
    await call('logs.clear');
    toast('Logs apagados.');
    reload();
  };

  return (
    <>
      <PageHeader title="Logs" subtitle="Requisições recebidas pela API (valores de filtros e corpos não são gravados).">
        <label className="check small"><input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />Atualizar automaticamente</label>
        <Button icon="refresh" onClick={reload}>Atualizar</Button>
        <Button icon="trash" onClick={clear}>Limpar</Button>
      </PageHeader>
      <div className="card card-body mb-2">
        <form className="row wrap" onSubmit={(e) => { e.preventDefault(); setPage(1); setApplied(filters); }}>
          <Input style={{ maxWidth: 320 }} placeholder="Pesquisar endpoint, token, tabela, IP, erro…" value={filters.texto} onChange={(e) => setFilters({ ...filters, texto: e.target.value })} />
          <Select style={{ width: 160 }} value={filters.status} placeholder="Todos os status" onChange={(e) => setFilters({ ...filters, status: e.target.value })} options={[{ value: 'ok', label: 'Sucesso (< 400)' }, { value: 'erro', label: 'Erros (≥ 400)' }]} />
          <Select style={{ width: 140 }} value={filters.metodo} placeholder="Todos os métodos" onChange={(e) => setFilters({ ...filters, metodo: e.target.value })} options={['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => ({ value: m, label: m }))} />
          <Button type="submit" variant="primary">Filtrar</Button>
        </form>
      </div>
      {error && <ErrorAlert error={error} />}
      <Card noBody>
        {loading && !data ? <Loading /> : !data?.rows.length ? <Empty icon="logs" title="Nenhum log encontrado" /> : (
          <>
            <div className="table-wrap">
              <table className="table table-compact">
                <thead><tr><th>Data/hora</th><th>Método</th><th>Endpoint</th><th>Status</th><th className="right">Tempo</th><th>Token</th><th>Operação</th><th>IP</th></tr></thead>
                <tbody>
                  {data.rows.map((l) => (
                    <Fragment key={l.id}>
                      <tr onClick={() => setOpen(open === l.id ? null : l.id)} style={{ cursor: l.erro ? 'pointer' : undefined }}>
                        <td className="small nowrap">{formatDateTime(l.dataHora)}</td>
                        <td><Method m={l.metodo} /></td>
                        <td className="mono small ellipsis">{l.endpoint}</td>
                        <td><Badge tone={statusTone(l.status)}>{l.status}</Badge></td>
                        <td className="right small nowrap">{l.tempoMs} ms</td>
                        <td className="small">{l.token || <span className="muted">—</span>}</td>
                        <td className="small">{l.operacao || '—'}</td>
                        <td className="small mono">{l.ip}</td>
                      </tr>
                      {open === l.id && l.erro && (
                        <tr><td colSpan={8}><pre className="code-block" style={{ whiteSpace: 'pre-wrap' }}>{l.erro}</pre></td></tr>
                      )}
                    </Fragment>
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
