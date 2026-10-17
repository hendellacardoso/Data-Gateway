import { useEffect, useState } from 'react';
import { Alert, Button, Card, ErrorAlert, Field, Input, Loading, PageHeader, ToggleRow } from '../components/ui.jsx';
import { call } from '../services/api.js';
import { useApp } from '../stores/AppContext.jsx';
import { ServerPill } from '../layouts/MainLayout.jsx';

function ApiSettings({ cfg, onSaved }) {
  const { toast, confirm } = useApp();
  const [f, setF] = useState({ ...cfg, corsOrigins: (cfg.corsOrigins || []).join(', ') });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const exposed = !['127.0.0.1', 'localhost', '::1'].includes(f.host);

  const pick = async (k) => {
    const file = await call('system.selectFile', { title: k === 'certPath' ? 'Certificado (PEM)' : 'Chave privada (PEM)', filters: [{ name: 'PEM', extensions: ['pem', 'crt', 'cer', 'key'] }, { name: 'Todos', extensions: ['*'] }] });
    if (file) set(k, file);
  };

  const save = async () => {
    if (exposed && !f.https && !(await confirm({ title: 'Acesso pela rede sem HTTPS', message: `O host ${f.host} permite acesso por outros computadores.\nSem HTTPS, os tokens trafegam sem criptografia. Recomenda-se habilitar HTTPS para acesso remoto.\n\nSalvar mesmo assim?`, confirmLabel: 'Salvar' }))) return;
    setBusy(true);
    setError(null);
    try {
      await call('config.save', { section: 'api', value: { ...f, port: Number(f.port) } });
      toast('Configurações da API salvas. O serviço foi reiniciado.');
      onSaved();
    } catch (e) { setError(e); }
    setBusy(false);
  };

  return (
    <Card title="API" actions={<Button variant="primary" loading={busy} onClick={save}>Salvar</Button>}>
      {error && <div className="mb-2"><ErrorAlert error={error} /></div>}
      <div className="form-row three">
        <Field label="Host" hint="127.0.0.1 = somente este computador. 0.0.0.0 = toda a rede local."><Input className="mono" value={f.host} onChange={(e) => set('host', e.target.value)} /></Field>
        <Field label="Porta"><Input type="number" value={f.port} onChange={(e) => set('port', e.target.value)} /></Field>
        <Field label="Timeout das consultas (ms)"><Input type="number" value={f.timeoutMs} onChange={(e) => set('timeoutMs', e.target.value)} /></Field>
      </div>
      <div className="form-row three">
        <Field label="Limite de requisições (por minuto, por token)"><Input type="number" value={f.rateLimitPerMinute} onChange={(e) => set('rateLimitPerMinute', e.target.value)} /></Field>
        <Field label="Tamanho máximo do JSON (KB)"><Input type="number" value={f.bodyLimitKb} onChange={(e) => set('bodyLimitKb', e.target.value)} /></Field>
        <Field label="CORS — origens permitidas" hint="Separadas por vírgula. Vazio = nenhuma."><Input className="mono" value={f.corsOrigins} onChange={(e) => set('corsOrigins', e.target.value)} placeholder="https://app.empresa.com" /></Field>
      </div>
      <ToggleRow title="HTTPS" description="Recomendado quando houver acesso remoto." checked={f.https} onChange={(v) => set('https', v)} />
      {f.https && (
        <div className="form-row mt-1">
          <Field label="Certificado (PEM)"><div className="input-group"><Input className="mono" value={f.certPath} onChange={(e) => set('certPath', e.target.value)} /><Button icon="folder" onClick={() => pick('certPath')} /></div></Field>
          <Field label="Chave privada (PEM)"><div className="input-group"><Input className="mono" value={f.keyPath} onChange={(e) => set('keyPath', e.target.value)} /><Button icon="folder" onClick={() => pick('keyPath')} /></div></Field>
        </div>
      )}
      <ToggleRow title="Documentação pública" description="Desligado = Swagger e openapi.json acessíveis somente neste computador." checked={f.docsPublicas} onChange={(v) => set('docsPublicas', v)} />
      {exposed && !f.https && <Alert tone="warning">Acesso pela rede sem HTTPS: use apenas em redes confiáveis.</Alert>}
    </Card>
  );
}

function AppSettings({ cfg, onSaved }) {
  const { toast } = useApp();
  const save = async (patch) => {
    try { await call('config.save', { section: 'app', value: patch }); toast('Preferência salva.'); onSaved(); } catch (e) { toast(e.message, 'error'); }
  };
  return (
    <Card title="Aplicativo">
      <ToggleRow title="Iniciar automaticamente com o Windows" description="Abre minimizado no Tray ao entrar no Windows." checked={cfg.iniciarComWindows} onChange={(v) => save({ iniciarComWindows: v })} />
      <ToggleRow title="Iniciar serviço automaticamente" description="Sobe a API assim que o aplicativo abrir." checked={cfg.iniciarServicoAuto} onChange={(v) => save({ iniciarServicoAuto: v })} />
      <ToggleRow title="Minimizar para o Tray ao fechar" description="Fechar a janela mantém o Gateway em execução." checked={cfg.minimizarTray} onChange={(v) => save({ minimizarTray: v })} />
    </Card>
  );
}

function LogSettings({ cfg, onSaved }) {
  const { toast } = useApp();
  const [f, setF] = useState(cfg);
  const save = async () => {
    try { await call('config.save', { section: 'logs', value: { retencaoDias: Number(f.retencaoDias), auditoriaRetencaoDias: Number(f.auditoriaRetencaoDias) } }); toast('Retenção salva.'); onSaved(); } catch (e) { toast(e.message, 'error'); }
  };
  return (
    <Card title="Retenção de logs" actions={<Button onClick={save}>Salvar</Button>}>
      <div className="form-row">
        <Field label="Logs de requisição (dias)"><Input type="number" value={f.retencaoDias} onChange={(e) => setF({ ...f, retencaoDias: e.target.value })} /></Field>
        <Field label="Auditoria (dias)"><Input type="number" value={f.auditoriaRetencaoDias} onChange={(e) => setF({ ...f, auditoriaRetencaoDias: e.target.value })} /></Field>
      </div>
      <div className="small text-2">A limpeza ocorre ao iniciar o aplicativo.</div>
    </Card>
  );
}

function ServiceCard({ cfg }) {
  const { server, toast } = useApp();
  const [busy, setBusy] = useState('');
  const ctl = async (action) => {
    setBusy(action);
    try { await call('server.control', { action }); } catch (e) { toast(e.message, 'error'); }
    setBusy('');
  };
  return (
    <Card title="Serviço" actions={<ServerPill server={server} />}>
      <div className="row wrap">
        <Button icon="play" loading={busy === 'start'} disabled={server?.running} onClick={() => ctl('start')}>Iniciar</Button>
        <Button icon="refresh" loading={busy === 'restart'} onClick={() => ctl('restart')}>Reiniciar</Button>
        <Button icon="stop" loading={busy === 'stop'} disabled={!server?.running} onClick={() => ctl('stop')}>Parar</Button>
        <div style={{ flex: 1 }} />
        <Button icon="folder" onClick={() => call('system.openDataDir')}>Abrir pasta de dados</Button>
      </div>
      {server?.error && <div className="mt-2"><ErrorAlert error={{ message: server.error }} /></div>}
      <div className="small text-2 mt-2">Ambiente: <b>{cfg.ambiente}</b> · Dados: <code>{cfg.paths.dataDir}</code></div>
    </Card>
  );
}

function SecurityCard() {
  const { toast } = useApp();
  const [f, setF] = useState({ senhaAtual: '', novaSenha: '', confirmar: '' });
  const [error, setError] = useState(null);
  const save = async () => {
    setError(null);
    try { await call('auth.changePassword', f); toast('Senha alterada.'); setF({ senhaAtual: '', novaSenha: '', confirmar: '' }); } catch (e) { setError(e); }
  };
  return (
    <Card title="Alterar minha senha" actions={<Button onClick={save} disabled={!f.senhaAtual || !f.novaSenha}>Alterar</Button>}>
      {error && <div className="mb-2"><ErrorAlert error={error} /></div>}
      <div className="form-row three">
        <Field label="Senha atual"><Input type="password" value={f.senhaAtual} onChange={(e) => setF({ ...f, senhaAtual: e.target.value })} /></Field>
        <Field label="Nova senha"><Input type="password" value={f.novaSenha} onChange={(e) => setF({ ...f, novaSenha: e.target.value })} /></Field>
        <Field label="Confirmar"><Input type="password" value={f.confirmar} onChange={(e) => setF({ ...f, confirmar: e.target.value })} /></Field>
      </div>
    </Card>
  );
}

function BackupCard() {
  const { toast, confirm } = useApp();
  const [passphrase, setPassphrase] = useState('');
  const exp = async () => {
    try {
      const r = await call('backup.exportToFile', { passphrase: passphrase || undefined });
      if (!r.canceled) toast('Configuração exportada.');
    } catch (e) { toast(e.message, 'error'); }
  };
  const imp = async () => {
    if (!(await confirm({ title: 'Importar configuração', message: 'A importação SUBSTITUI todas as conexões, tabelas, endpoints, tokens e configurações atuais.\nUsuários, logs e auditoria são mantidos. Continuar?', danger: true, confirmLabel: 'Escolher arquivo' }))) return;
    try {
      const r = await call('backup.importFromFile', { passphrase: passphrase || undefined });
      if (!r.canceled) toast(r.bancosSemSenha ? `Importado. ${r.bancosSemSenha} conexão(ões) sem senha: edite-as para informar.` : 'Configuração importada.', r.bancosSemSenha ? 'info' : 'success');
    } catch (e) { toast(e.message, 'error'); }
  };
  return (
    <Card title="Backup da configuração (.datagateway)">
      <Field label="Frase-senha (opcional)" hint="Se informada, as senhas dos bancos são exportadas criptografadas com ela. Sem frase-senha, as senhas NÃO são exportadas. Tokens são exportados apenas como hash.">
        <Input type="password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} autoComplete="new-password" />
      </Field>
      <div className="row">
        <Button icon="download" onClick={exp}>Exportar configuração</Button>
        <Button icon="upload" onClick={imp}>Importar configuração</Button>
      </div>
    </Card>
  );
}

export default function ConfiguracoesPage() {
  const [cfg, setCfg] = useState(null);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState('api');
  const load = () => call('config.get').then(setCfg).catch(setError);
  useEffect(() => { load(); }, []);
  if (error) return <ErrorAlert error={error} />;
  if (!cfg) return <Loading />;
  return (
    <>
      <PageHeader title="Configurações" subtitle="Servidor da API, inicialização, segurança e backup." />
      <div className="tabs">
        {[['api', 'API'], ['app', 'Aplicativo'], ['seg', 'Segurança'], ['backup', 'Backup']].map(([k, l]) => (
          <button key={k} className={'tab' + (tab === k ? ' active' : '')} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      {tab === 'api' && <><ServiceCard cfg={cfg} /><ApiSettings key={JSON.stringify(cfg.api)} cfg={cfg.api} onSaved={load} /></>}
      {tab === 'app' && <><AppSettings cfg={cfg.app} onSaved={load} /><LogSettings cfg={cfg.logs} onSaved={load} /></>}
      {tab === 'seg' && <SecurityCard />}
      {tab === 'backup' && <BackupCard />}
    </>
  );
}
