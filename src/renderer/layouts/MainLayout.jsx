import { NavLink, Outlet } from 'react-router-dom';
import Icon from '../components/Icon.jsx';
import { Button } from '../components/ui.jsx';
import { useApp } from '../stores/AppContext.jsx';
import StatusBar from '../components/StatusBar.jsx';

const MENU = [
  { items: [{ to: '/', label: 'Dashboard', icon: 'dashboard', end: true }] },
  { title: 'Conexões', items: [
    { to: '/conexoes/bancos', label: 'Bancos', icon: 'database' },
    { to: '/conexoes/status', label: 'Status', icon: 'status' }
  ] },
  { title: 'APIs', items: [
    { to: '/apis/endpoints', label: 'Endpoints', icon: 'endpoint' },
    { to: '/apis/tokens', label: 'Tokens', icon: 'key' },
    { to: '/apis/documentacao', label: 'Documentação', icon: 'book' },
    { to: '/apis/testador', label: 'Testador de API', icon: 'send' }
  ] },
  { title: 'Configuração', items: [
    { to: '/configuracao/tabelas', label: 'Tabelas', icon: 'table' },
    { to: '/configuracao/campos', label: 'Campos', icon: 'fields' },
    { to: '/configuracao/relacionamentos', label: 'Relacionamentos', icon: 'link' },
    { to: '/configuracao/uploads', label: 'Uploads', icon: 'upload' }
  ] },
  { title: 'Monitoramento', items: [
    { to: '/monitoramento/logs', label: 'Logs', icon: 'logs' },
    { to: '/monitoramento/auditoria', label: 'Auditoria', icon: 'shield' }
  ] },
  { title: 'Sistema', items: [
    { to: '/sistema/usuarios', label: 'Usuários', icon: 'users' },
    { to: '/sistema/configuracoes', label: 'Configurações', icon: 'settings' },
    { to: '/sistema/sobre', label: 'Sobre', icon: 'info' }
  ] }
];

export function ServerPill({ server }) {
  const on = server && server.running;
  return (
    <span className={'status-pill ' + (on ? 'on' : 'off')} title={server?.error || ''}>
      <span className="dot" />
      {on ? `Gateway online · ${server.url}` : server?.error ? 'Gateway com erro' : 'Gateway parado'}
    </span>
  );
}

export default function MainLayout() {
  const { user, logout, server } = useApp();
  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-logo"><Icon name="database" size={17} /></div>
          <div>Data Gateway<small>APIs a partir do seu banco</small></div>
        </div>
        {MENU.map((g, i) => (
          <div className="nav-group" key={i}>
            {g.title && <div className="nav-title">{g.title}</div>}
            {g.items.map((it) => (
              <NavLink key={it.to} to={it.to} end={it.end} className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')}>
                <Icon name={it.icon} />
                {it.label}
              </NavLink>
            ))}
          </div>
        ))}
        <NavLink to="/sistema/sobre" className="sidebar-footer">Data Gateway 1.0.0 · API2Dev</NavLink>
      </aside>
      <div className="main">
        <header className="topbar">
          <ServerPill server={server} />
          <div className="spacer" />
          <span className="small text-2">Conectado como <b>{user?.usuario}</b></span>
          <Button size="sm" variant="ghost" icon="logout" onClick={logout}>Sair</Button>
        </header>
        <main className="content">
          <Outlet />
        </main>
        <StatusBar />
      </div>
    </div>
  );
}
