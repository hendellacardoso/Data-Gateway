import { useEffect, useState } from 'react';
import logotipo from '../../../imagens/logotipo.png';
import Icon from '../components/Icon.jsx';
import { Button, Card, PageHeader } from '../components/ui.jsx';
import { call } from '../services/api.js';
import { useApp } from '../stores/AppContext.jsx';

const DEV = {
  nome: 'Hendell Alves Cardoso',
  email: 'suporte@api2dev.com.br',
  whatsapp: '(62) 9.9314-8955',
  whatsappUrl: 'https://wa.me/5562993148955',
  site: 'https://api2dev.com.br'
};

export default function SobrePage() {
  const { toast } = useApp();
  const [info, setInfo] = useState(null);
  useEffect(() => { call('system.about').then(setInfo).catch(() => {}); }, []);
  const open = (url) => call('system.openExternal', { url }).catch((e) => toast(e.message, 'error'));

  return (
    <>
      <PageHeader title="Sobre" subtitle="Informações do aplicativo e do desenvolvedor." />
      <div className="grid grid-2 about" style={{ gridTemplateColumns: 'minmax(0, 5fr) minmax(0, 4fr)' }}>
        <Card>
          <div className="about-hero">
            <img src={logotipo} alt="API2Dev" className="about-logo" />
            <div>
              <h2>Data Gateway</h2>
              <p className="text-2">Transforma bancos de dados existentes em APIs REST seguras, configuradas visualmente — sem escrever SQL e sem expor o banco.</p>
              {info && <div className="small text-2">Versão <b>{info.versao}</b></div>}
            </div>
          </div>
          <div className="divider" />
          <div className="bold mb-1">Desenvolvedor</div>
          <dl className="kv about-kv">
            <dt>Nome</dt><dd>{DEV.nome}</dd>
            <dt>E-mail</dt><dd><a href="#" onClick={(e) => { e.preventDefault(); open('mailto:' + DEV.email); }}>{DEV.email}</a></dd>
            <dt>WhatsApp</dt><dd><a href="#" onClick={(e) => { e.preventDefault(); open(DEV.whatsappUrl); }}>{DEV.whatsapp}</a></dd>
            <dt>Website</dt><dd><a href="#" onClick={(e) => { e.preventDefault(); open(DEV.site); }}>api2dev.com.br</a></dd>
          </dl>
          <div className="row wrap mt-2">
            <Button icon="external" variant="primary" onClick={() => open(DEV.site)}>Visitar website</Button>
            <Button icon="phone" onClick={() => open(DEV.whatsappUrl)}>Falar no WhatsApp</Button>
            <Button icon="mail" onClick={() => open('mailto:' + DEV.email + '?subject=' + encodeURIComponent('Suporte Data Gateway'))}>Enviar e-mail</Button>
          </div>
        </Card>
        <Card title="Informações técnicas">
          {info ? (
            <dl className="kv">
              <dt>Aplicativo</dt><dd>{info.versao}</dd>
              <dt>Electron</dt><dd>{info.electron}</dd>
              <dt>Chromium</dt><dd>{info.chrome}</dd>
              <dt>Node.js</dt><dd>{info.node}</dd>
              <dt>Plataforma</dt><dd>{info.plataforma}</dd>
              <dt>Dados</dt><dd className="mono small" style={{ wordBreak: 'break-all' }}>{info.dataDir}</dd>
            </dl>
          ) : <div className="muted small">Carregando…</div>}
          <div className="divider" />
          <div className="small text-2 row"><Icon name="shield" size={15} /> © {new Date().getFullYear()} {DEV.nome} · API2Dev. Todos os direitos reservados.</div>
        </Card>
      </div>
    </>
  );
}
