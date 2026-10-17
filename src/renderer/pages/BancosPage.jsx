import { useState } from 'react';
import { Alert, Badge, Button, Card, Checkbox, Empty, ErrorAlert, Field, Input, Loading, Modal, PageHeader, Select } from '../components/ui.jsx';
import { useLoad } from '../hooks/useLoad.js';
import { call } from '../services/api.js';
import { DB_TYPES, dbLabel, formatDateTime } from '../services/constants.js';
import { useApp } from '../stores/AppContext.jsx';

const EMPTY = { nome: '', tipo: 'sqlserver', servidor: '', porta: 1433, banco: '', usuario: '', senha: '', ssl: false, timeout: 15000, arquivo: '', ativo: true, parametros: {} };

function BancoForm({ initial, onClose, onSaved }) {
  const { toast } = useApp();
  const [f, setF] = useState(initial ? { ...EMPTY, ...initial, senha: '' } : EMPTY);
  const [test, setTest] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState(null);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const setParam = (k, v) => setF((x) => ({ ...x, parametros: { ...x.parametros, [k]: v } }));
  const isSqlite = f.tipo === 'sqlite';

  const changeType = (tipo) => {
    const t = DB_TYPES.find((d) => d.value === tipo);
    setF((x) => ({ ...x, tipo, porta: t.port || '' }));
    setTest(null);
  };

  const doTest = async () => {
    setBusy('test');
    setTest(null);
    try { setTest(await call('bancos.test', f)); } catch (e) { setTest({ ok: false, message: 'Falha na conexão.', details: e.message }); }
    setBusy('');
  };

  const save = async () => {
    setBusy('save');
    setError(null);
    try {
      await call('bancos.save', f);
      toast('Conexão salva.');
      onSaved();
    } catch (e) { setError(e); }
    setBusy('');
  };

  const pickFile = async () => {
    const file = await call('system.selectFile', { title: 'Arquivo SQLite', filters: [{ name: 'SQLite', extensions: ['db', 'sqlite', 'sqlite3', 'db3'] }, { name: 'Todos', extensions: ['*'] }] });
    if (file) set('arquivo', file);
  };

  return (
    <Modal title={initial ? 'Editar conexão' : 'Nova conexão'} size="lg" onClose={onClose}
      footer={<>
        <Button icon="bolt" onClick={doTest} loading={busy === 'test'}>Testar conexão</Button>
        <div style={{ flex: 1 }} />
        <Button onClick={onClose}>Cancelar</Button>
        <Button variant="primary" onClick={save} loading={busy === 'save'}>Salvar</Button>
      </>}>
      {error && <div className="mb-2"><ErrorAlert error={error} /></div>}
      <div className="form-row">
        <Field label="Nome da conexão"><Input value={f.nome} onChange={(e) => set('nome', e.target.value)} placeholder="ERP" autoFocus /></Field>
        <Field label="Tipo de banco"><Select value={f.tipo} onChange={(e) => changeType(e.target.value)} options={DB_TYPES} /></Field>
      </div>
      {isSqlite ? (
        <Field label="Arquivo do banco SQLite">
          <div className="input-group">
            <Input value={f.arquivo} onChange={(e) => set('arquivo', e.target.value)} placeholder="C:\dados\banco.db" />
            <Button icon="folder" onClick={pickFile}>Selecionar</Button>
          </div>
        </Field>
      ) : (
        <>
          <div className="form-row" style={{ gridTemplateColumns: '3fr 1fr' }}>
            <Field label="Servidor" hint={f.tipo === 'sqlserver' ? 'Ex.: 192.168.0.10 ou SERVIDOR' : undefined}>
              <Input value={f.servidor} onChange={(e) => set('servidor', e.target.value)} placeholder="localhost" />
            </Field>
            <Field label="Porta"><Input type="number" value={f.porta} onChange={(e) => set('porta', e.target.value)} /></Field>
          </div>
          <div className="form-row three">
            <Field label="Banco de dados"><Input value={f.banco} onChange={(e) => set('banco', e.target.value)} /></Field>
            <Field label="Usuário"><Input value={f.usuario} onChange={(e) => set('usuario', e.target.value)} autoComplete="off" /></Field>
            <Field label="Senha" hint={initial?.temSenha ? 'Deixe em branco para manter a senha atual.' : 'Armazenada criptografada (DPAPI do Windows).'}>
              <Input type="password" value={f.senha} onChange={(e) => set('senha', e.target.value)} autoComplete="new-password" placeholder={initial?.temSenha ? '••••••••' : ''} />
            </Field>
          </div>
          <div className="form-row">
            <Field label="Timeout de conexão (ms)"><Input type="number" value={f.timeout} onChange={(e) => set('timeout', e.target.value)} /></Field>
            <Field label="Conexões simultâneas (pool)"><Input type="number" value={f.parametros.poolMax || ''} placeholder="10" onChange={(e) => setParam('poolMax', e.target.value)} /></Field>
          </div>
          <div className="row wrap" style={{ gap: 20 }}>
            <Checkbox label="SSL / criptografia" checked={f.ssl} onChange={(v) => set('ssl', v)} />
            {f.tipo === 'sqlserver' && (
              <Checkbox label="Confiar no certificado do servidor" checked={f.parametros.trustServerCertificate !== 'false'} onChange={(v) => setParam('trustServerCertificate', v ? 'true' : 'false')} />
            )}
            {f.tipo !== 'sqlserver' && f.ssl && (
              <Checkbox label="Validar certificado SSL" checked={f.parametros.rejectUnauthorized === 'true'} onChange={(v) => setParam('rejectUnauthorized', v ? 'true' : 'false')} />
            )}
            <Checkbox label="Conexão ativa" checked={f.ativo} onChange={(v) => set('ativo', v)} />
          </div>
          {f.tipo === 'sqlserver' && (
            <Field label="Instância nomeada (opcional)" className="mt-2" hint="Ex.: SQLEXPRESS. Quando informada, a porta é ignorada.">
              <Input value={f.parametros.instanceName || ''} onChange={(e) => setParam('instanceName', e.target.value)} />
            </Field>
          )}
        </>
      )}
      {test && (
        <div className="mt-2">
          {test.ok
            ? <Alert tone="success" title="✓ Conexão realizada com sucesso.">{test.version} · {test.elapsedMs} ms</Alert>
            : <Alert tone="danger" title="✕ Falha na conexão."><pre>Detalhes:{'\n'}{test.details}</pre></Alert>}
        </div>
      )}
    </Modal>
  );
}

export default function BancosPage() {
  const { data, error, loading, reload } = useLoad('bancos.list');
  const { confirm, toast } = useApp();
  const [editing, setEditing] = useState(null); // null | {} (novo) | dto

  const remove = async (b) => {
    if (!(await confirm({ title: 'Excluir conexão', message: `Excluir a conexão "${b.nome}"?`, danger: true, confirmLabel: 'Excluir' }))) return;
    try { await call('bancos.delete', { id: b.id }); toast('Conexão excluída.'); reload(); } catch (e) { toast(e.message, 'error'); }
  };

  return (
    <>
      <PageHeader title="Bancos de Dados" subtitle="Conexões com os bancos existentes. O banco nunca é exposto diretamente — somente as APIs configuradas.">
        <Button variant="primary" icon="plus" onClick={() => setEditing({})}>Nova conexão</Button>
      </PageHeader>
      {error && <ErrorAlert error={error} />}
      <Card noBody>
        {loading && !data ? <Loading /> : !data?.length ? (
          <Empty title="Nenhuma conexão cadastrada">Clique em “Nova conexão” para cadastrar o primeiro banco.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Nome</th><th>Tipo</th><th>Servidor / Arquivo</th><th>Banco</th><th className="center">Endpoints</th><th>Status</th><th>Atualizado</th><th /></tr></thead>
              <tbody>
                {data.map((b) => (
                  <tr key={b.id}>
                    <td className="bold">{b.nome}</td>
                    <td>{dbLabel(b.tipo)}</td>
                    <td className="mono ellipsis">{b.tipo === 'sqlite' ? b.arquivo : `${b.servidor}${b.porta ? ':' + b.porta : ''}`}</td>
                    <td>{b.banco || '—'}</td>
                    <td className="center">{b.endpoints}</td>
                    <td>{b.ativo ? <Badge tone="success">Ativa</Badge> : <Badge>Inativa</Badge>}</td>
                    <td className="muted small">{formatDateTime(b.atualizadoEm)}</td>
                    <td className="actions">
                      <Button size="sm" variant="ghost" icon="edit" onClick={() => setEditing(b)}>Editar</Button>
                      <Button size="sm" variant="ghost" icon="trash" onClick={() => remove(b)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {editing && (
        <BancoForm initial={editing.id ? editing : null} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />
      )}
    </>
  );
}
