import { useState } from 'react';
import { Alert, Badge, Button, Card, Checkbox, CopyButton, Empty, ErrorAlert, Field, Input, Loading, Modal, PageHeader } from '../components/ui.jsx';
import { useLoad } from '../hooks/useLoad.js';
import { call } from '../services/api.js';
import { formatDateTime } from '../services/constants.js';
import { useApp } from '../stores/AppContext.jsx';

const STATUS_TONE = { ATIVO: 'success', INATIVO: '', EXPIRADO: 'warning', REVOGADO: 'danger' };

function TokenForm({ token, onClose, onSaved }) {
  const [f, setF] = useState(token ? { ...token, expiraEm: token.expiraEm ? token.expiraEm.slice(0, 10) : '' } : { nome: '', descricao: '', expiraEm: '', ativo: true });
  const [created, setCreated] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const payload = { ...f, expiraEm: f.expiraEm ? new Date(f.expiraEm + 'T23:59:59').toISOString() : null };
      if (token) {
        await call('tokens.update', payload);
        onSaved();
      } else {
        setCreated(await call('tokens.create', payload));
      }
    } catch (e) { setError(e); }
    setBusy(false);
  };

  if (created) {
    return (
      <Modal title="Token criado" onClose={onSaved} footer={<Button variant="primary" onClick={onSaved}>Já copiei o token</Button>}>
        <Alert tone="warning" title="Copie o token agora.">Por segurança, o valor completo é exibido somente uma vez — o Gateway guarda apenas um hash.</Alert>
        <div className="token-box mt-2"><span style={{ flex: 1 }}>{created.token}</span><CopyButton text={created.token} /></div>
        <p className="small text-2 mt-2">Use no cabeçalho: <code>Authorization: Bearer {created.prefixo}…</code>. Defina as permissões na lista de tokens.</p>
      </Modal>
    );
  }

  return (
    <Modal title={token ? 'Editar token' : 'Novo token'} onClose={onClose}
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={busy} onClick={save}>{token ? 'Salvar' : 'Gerar token'}</Button></>}>
      {error && <div className="mb-2"><ErrorAlert error={error} /></div>}
      <Field label="Nome"><Input value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} placeholder="Sistema ERP" autoFocus /></Field>
      <Field label="Descrição"><Input value={f.descricao || ''} onChange={(e) => setF({ ...f, descricao: e.target.value })} /></Field>
      <Field label="Expiração" hint="Vazio = não expira."><Input type="date" value={f.expiraEm} onChange={(e) => setF({ ...f, expiraEm: e.target.value })} /></Field>
      <Checkbox label="Ativo" checked={f.ativo} onChange={(v) => setF({ ...f, ativo: v })} />
    </Modal>
  );
}

const COLS = [['listar', 'Consultar', 'opListar'], ['buscar', 'Consultar por ID', 'opBuscar'], ['incluir', 'Incluir', 'opIncluir'],
  ['alterar', 'Alterar', 'opAlterar'], ['excluir', 'Excluir', 'opExcluir'], ['upload', 'Upload', 'opUpload']];

function PermissionsModal({ token, onClose }) {
  const { toast } = useApp();
  const { data, setData, error, loading } = useLoad('tokens.permissions', { tokenId: token.id });
  const [busy, setBusy] = useState(false);
  const set = (i, k, v) => setData(data.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const setRow = (i, v) => setData(data.map((r, j) => (j === i ? { ...r, ...Object.fromEntries(COLS.map(([k, , op]) => [k, v && r[op]])) } : r)));

  const save = async () => {
    setBusy(true);
    try {
      await call('tokens.savePermissions', { tokenId: token.id, permissoes: data });
      toast('Permissões salvas.');
      onClose();
    } catch (e) { toast(e.message, 'error'); }
    setBusy(false);
  };

  return (
    <Modal title={`Permissões — ${token.nome}`} size="xl" onClose={onClose}
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={busy} onClick={save}>Salvar permissões</Button></>}>
      {error && <ErrorAlert error={error} />}
      {loading ? <Loading /> : !data.length ? <Empty icon="endpoint" title="Nenhum endpoint configurado" /> : (
        <div className="table-wrap">
          <table className="table table-compact">
            <thead><tr><th>Endpoint</th>{COLS.map(([k, l]) => <th key={k} className="center">{l}</th>)}<th /></tr></thead>
            <tbody>
              {data.map((r, i) => (
                <tr key={r.endpointId}>
                  <td><span className="mono bold">{r.slug}</span> {!r.publicado && <Badge tone="warning">rascunho</Badge>}<div className="xs muted">{r.descricao}</div></td>
                  {COLS.map(([k, , op]) => (
                    <td key={k} className="center"><Checkbox checked={r[k] && r[op]} disabled={!r[op]} title={!r[op] ? 'Operação desabilitada no endpoint' : ''} onChange={(v) => set(i, k, v)} /></td>
                  ))}
                  <td className="actions">
                    <Button size="sm" variant="ghost" onClick={() => setRow(i, true)}>Todas</Button>
                    <Button size="sm" variant="ghost" onClick={() => setRow(i, false)}>Nenhuma</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}

export default function TokensPage() {
  const { data, error, loading, reload } = useLoad('tokens.list');
  const { confirm, toast } = useApp();
  const [form, setForm] = useState(null);
  const [perms, setPerms] = useState(null);

  const revoke = async (t) => {
    if (!(await confirm({ title: 'Revogar token', message: `Revogar "${t.nome}"? Sistemas que usam este token perderão o acesso imediatamente. Esta ação não pode ser desfeita.`, danger: true, confirmLabel: 'Revogar' }))) return;
    try { await call('tokens.revoke', { id: t.id }); toast('Token revogado.'); reload(); } catch (e) { toast(e.message, 'error'); }
  };
  const remove = async (t) => {
    if (!(await confirm({ title: 'Excluir token', message: `Excluir definitivamente "${t.nome}"?`, danger: true, confirmLabel: 'Excluir' }))) return;
    try { await call('tokens.delete', { id: t.id }); reload(); } catch (e) { toast(e.message, 'error'); }
  };

  return (
    <>
      <PageHeader title="Tokens de API" subtitle="Cada sistema externo recebe um token com permissões próprias. Envie sempre no cabeçalho Authorization: Bearer.">
        <Button variant="primary" icon="plus" onClick={() => setForm({})}>Novo token</Button>
      </PageHeader>
      {error && <ErrorAlert error={error} />}
      <Card noBody>
        {loading && !data ? <Loading /> : !data?.length ? <Empty icon="key" title="Nenhum token criado" /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Nome</th><th>Token</th><th>Status</th><th className="center">Endpoints</th><th>Expira</th><th>Último uso</th><th /></tr></thead>
              <tbody>
                {data.map((t) => (
                  <tr key={t.id}>
                    <td><div className="bold">{t.nome}</div><div className="xs muted">{t.descricao}</div></td>
                    <td className="mono small">{t.prefixo}••••••••••••</td>
                    <td><Badge tone={STATUS_TONE[t.status]}>{t.status}</Badge></td>
                    <td className="center">{t.endpoints}</td>
                    <td className="small">{t.expiraEm ? formatDateTime(t.expiraEm) : 'Nunca'}</td>
                    <td className="small muted">{formatDateTime(t.ultimoUso)}</td>
                    <td className="actions">
                      {t.status !== 'REVOGADO' && <>
                        <Button size="sm" icon="lock" onClick={() => setPerms(t)}>Permissões</Button>
                        <Button size="sm" variant="ghost" icon="edit" onClick={() => setForm(t)} />
                        <Button size="sm" variant="ghost" icon="ban" title="Revogar" onClick={() => revoke(t)} />
                      </>}
                      {t.status === 'REVOGADO' && <Button size="sm" variant="ghost" icon="trash" onClick={() => remove(t)} />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {form && <TokenForm token={form.id ? form : null} onClose={() => setForm(null)} onSaved={() => { setForm(null); reload(); }} />}
      {perms && <PermissionsModal token={perms} onClose={() => { setPerms(null); reload(); }} />}
    </>
  );
}
