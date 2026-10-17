import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import Icon from '../components/Icon.jsx';
import { Button, Card, ErrorAlert, Loading, PageHeader } from '../components/ui.jsx';
import { useLoad } from '../hooks/useLoad.js';
import { fmtNumber } from '../services/constants.js';
import { useApp } from '../stores/AppContext.jsx';
import { call } from '../services/api.js';

function Stat({ label, value, sub, icon, tone }) {
  return (
    <div className="card stat">
      <div className="stat-label"><Icon name={icon} size={15} />{label}</div>
      <div className="stat-value" style={tone ? { color: `var(--${tone})` } : undefined}>{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

export default function DashboardPage() {
  const { data, error, loading, reload } = useLoad('dashboard.get');
  const { server, toast } = useApp();

  useEffect(() => {
    const t = setInterval(reload, 15000);
    return () => clearInterval(t);
  }, [reload]);

  if (loading && !data) return <Loading />;
  if (error) return <ErrorAlert error={error} />;
  const d = data;
  const max = Math.max(1, ...d.serie24h.map((s) => s.requisicoes));
  const on = server?.running;

  const control = async (action) => {
    try {
      await call('server.control', { action });
      toast(action === 'stop' ? 'Serviço parado.' : 'Serviço iniciado.');
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  return (
    <>
      <PageHeader title="Dashboard" subtitle="Visão geral do Gateway e das requisições de hoje.">
        <Button icon="refresh" onClick={reload}>Atualizar</Button>
        {on
          ? <Button icon="stop" onClick={() => control('stop')}>Parar serviço</Button>
          : <Button icon="play" variant="primary" onClick={() => control('start')}>Iniciar serviço</Button>}
      </PageHeader>

      {server?.error && <div className="mb-2"><ErrorAlert error={{ message: 'O serviço não pôde ser iniciado: ' + server.error }} /></div>}

      <div className="grid grid-4">
        <Stat icon="bolt" label="Status do Gateway" value={on ? '🟢 Online' : '🔴 Parado'} sub={on ? server.url : 'API indisponível'} />
        <Stat icon="database" label="Conexões ativas" value={fmtNumber(d.bancos)} sub={`${d.bancosConectados} conectada(s) agora${d.bancosComErro ? ` · ${d.bancosComErro} com erro` : ''}`} />
        <Stat icon="endpoint" label="Endpoints publicados" value={fmtNumber(d.endpoints)} sub={d.endpointsRascunho ? `${d.endpointsRascunho} em rascunho` : 'nenhum rascunho'} />
        <Stat icon="key" label="Tokens ativos" value={fmtNumber(d.tokens)} />
        <Stat icon="send" label="Requisições hoje" value={fmtNumber(d.requisicoesHoje)} />
        <Stat icon="alert" label="Erros hoje" value={fmtNumber(d.errosHoje)} tone={d.errosHoje ? 'danger' : undefined}
          sub={d.requisicoesHoje ? `${((d.errosHoje / d.requisicoesHoje) * 100).toFixed(1)}% das requisições` : '—'} />
        <Stat icon="status" label="Tempo médio de resposta" value={`${fmtNumber(d.tempoMedioMs)} ms`} />
        <div className="card stat">
          <div className="stat-label"><Icon name="plus" size={15} />Ações rápidas</div>
          <div className="row wrap mt-1">
            <Link to="/apis/endpoints/novo"><Button size="sm" variant="primary" icon="plus">Nova API</Button></Link>
            <Link to="/apis/testador"><Button size="sm" icon="send">Testar</Button></Link>
          </div>
        </div>
      </div>

      <div className="grid grid-2 mt-2" style={{ gridTemplateColumns: '2fr 1fr' }}>
        <Card title="Requisições nas últimas 24 horas" actions={<span className="xs muted">■ erros em vermelho</span>}>
          <div className="chart-bars">
            {d.serie24h.map((s) => (
              <div key={s.hora} className="bar" style={{ height: `${(s.requisicoes / max) * 100}%` }}
                title={`${new Date(s.hora).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} — ${s.requisicoes} req. / ${s.erros} erro(s)`}>
                {s.erros > 0 && <div className="err" style={{ height: `${(s.erros / Math.max(1, s.requisicoes)) * 100}%` }} />}
              </div>
            ))}
          </div>
          <div className="chart-axis">
            <span>{new Date(d.serie24h[0].hora).toLocaleTimeString('pt-BR', { hour: '2-digit' })}h</span>
            <span>agora</span>
          </div>
        </Card>
        <Card title="Tabelas mais acessadas hoje">
          {d.topTabelas.length === 0 ? <div className="muted small">Nenhuma requisição hoje.</div> : (
            <table className="table table-compact">
              <tbody>
                {d.topTabelas.map((t) => <tr key={t.tabela}><td>{t.tabela}</td><td className="right bold">{fmtNumber(t.n)}</td></tr>)}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </>
  );
}
