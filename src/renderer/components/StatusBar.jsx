import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from './Icon.jsx';
import { call } from '../services/api.js';
import { fmtNumber } from '../services/constants.js';
import { useApp } from '../stores/AppContext.jsx';

const REFRESH_MS = 5000;

function Item({ icon, children, title, tone, onClick, hide }) {
  return (
    <button type="button" className={'sb-item' + (tone ? ' ' + tone : '') + (onClick ? ' link' : '') + (hide ? ' sb-hide-sm' : '')} title={title} onClick={onClick} disabled={!onClick}>
      {icon && <Icon name={icon} size={13} />}
      {children}
    </button>
  );
}

/** Barra de status fixa no rodapé do painel. */
export default function StatusBar() {
  const { server } = useApp();
  const navigate = useNavigate();
  const [s, setS] = useState(null);
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    let alive = true;
    const load = () => call('statusbar.get').then((d) => alive && setS(d)).catch(() => {});
    load();
    const t = setInterval(load, REFRESH_MS);
    const c = setInterval(() => setNow(new Date()), 1000);
    return () => { alive = false; clearInterval(t); clearInterval(c); };
  }, []);

  const on = server?.running;
  const time = (iso) => (iso ? new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—');

  return (
    <footer className="statusbar">
      <Item tone={on ? 'ok' : 'bad'} title={server?.error || (on ? 'API em execução' : 'API parada')} onClick={() => navigate('/sistema/configuracoes')}>
        <span className="sb-dot" />
        {on ? <>Gateway online <span className="mono">{server.url}</span></> : server?.error ? 'Gateway com erro' : 'Gateway parado'}
      </Item>
      {s && (
        <>
          <Item icon="database" tone={s.bancosComErro ? 'bad' : undefined} onClick={() => navigate('/conexoes/status')}
            title={s.bancosComErro ? `${s.bancosComErro} conexão(ões) com falha` : 'Conexões com pool ativo / conexões ativas'}>
            Bancos {s.bancosConectados}/{s.bancos}{s.bancosComErro ? ` · ${s.bancosComErro} falha` : ''}
          </Item>
          <Item icon="endpoint" onClick={() => navigate('/apis/endpoints')} title="Endpoints publicados">Endpoints {fmtNumber(s.endpoints)}</Item>
          <Item icon="terminal" onClick={() => navigate('/apis/consultas')} title="Consultas SQL publicadas">Consultas {fmtNumber(s.consultas)}</Item>
          <Item icon="key" onClick={() => navigate('/apis/tokens')} title="Tokens ativos">Tokens {fmtNumber(s.tokens)}</Item>
          <Item icon="send" onClick={() => navigate('/monitoramento/logs')} title="Requisições recebidas hoje">Hoje {fmtNumber(s.requisicoesHoje)} req.</Item>
          <Item icon="alert" tone={s.errosHoje ? 'warn' : undefined} onClick={() => navigate('/monitoramento/logs')} title="Respostas com status ≥ 400 hoje">Erros {fmtNumber(s.errosHoje)}</Item>
          <Item hide icon="status" title="Tempo médio de resposta hoje">Média {fmtNumber(s.tempoMedioMs)} ms</Item>
          <Item hide title="Última requisição recebida">Última req. {time(s.ultimaRequisicao)}</Item>
        </>
      )}
      <div className="sb-spacer" />
      {s && <Item hide tone={s.ambiente === 'development' ? 'warn' : undefined} title="Ambiente">{s.ambiente === 'development' ? 'Desenvolvimento' : 'Produção'}</Item>}
      {s && <Item onClick={() => navigate('/sistema/sobre')} title="Sobre o Data Gateway">v{s.versao}</Item>}
      <Item title={now.toLocaleDateString('pt-BR')}>{now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</Item>
    </footer>
  );
}
