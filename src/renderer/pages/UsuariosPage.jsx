import { useState } from 'react';
import { Badge, Button, Card, Checkbox, ErrorAlert, Field, Input, Loading, Modal, PageHeader } from '../components/ui.jsx';
import { useLoad } from '../hooks/useLoad.js';
import { call } from '../services/api.js';
import { formatDateTime } from '../services/constants.js';
import { useApp } from '../stores/AppContext.jsx';

function UserForm({ user, onClose, onSaved }) {
  const [f, setF] = useState(user ? { ...user, senha: '' } : { usuario: '', nome: '', senha: '', ativo: true });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try { await call('users.save', f); onSaved(); } catch (e) { setError(e); }
    setBusy(false);
  };
  return (
    <Modal title={user ? 'Editar usuário' : 'Novo usuário'} onClose={onClose}
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={busy} onClick={save}>Salvar</Button></>}>
      {error && <div className="mb-2"><ErrorAlert error={error} /></div>}
      <Field label="Usuário"><Input value={f.usuario} disabled={!!user} onChange={(e) => setF({ ...f, usuario: e.target.value })} /></Field>
      <Field label="Nome"><Input value={f.nome || ''} onChange={(e) => setF({ ...f, nome: e.target.value })} /></Field>
      <Field label={user ? 'Nova senha (opcional)' : 'Senha'} hint="Mínimo de 8 caracteres, com letras e números.">
        <Input type="password" value={f.senha} onChange={(e) => setF({ ...f, senha: e.target.value })} autoComplete="new-password" />
      </Field>
      <Checkbox label="Ativo" checked={f.ativo} onChange={(v) => setF({ ...f, ativo: v })} />
    </Modal>
  );
}

export default function UsuariosPage() {
  const { data, error, loading, reload } = useLoad('users.list');
  const { confirm, toast, user: me } = useApp();
  const [form, setForm] = useState(null);

  const remove = async (u) => {
    if (!(await confirm({ title: 'Excluir usuário', message: `Excluir "${u.usuario}"?`, danger: true, confirmLabel: 'Excluir' }))) return;
    try { await call('users.delete', { id: u.id }); reload(); } catch (e) { toast(e.message, 'error'); }
  };

  return (
    <>
      <PageHeader title="Usuários" subtitle="Administradores com acesso ao painel. Senhas armazenadas com hash scrypt.">
        <Button variant="primary" icon="plus" onClick={() => setForm({})}>Novo usuário</Button>
      </PageHeader>
      {error && <ErrorAlert error={error} />}
      <Card noBody>
        {loading && !data ? <Loading /> : (
          <table className="table">
            <thead><tr><th>Usuário</th><th>Nome</th><th>Status</th><th>Último login</th><th>Criado em</th><th /></tr></thead>
            <tbody>
              {data.map((u) => (
                <tr key={u.id}>
                  <td className="bold">{u.usuario} {u.id === me.userId && <Badge tone="primary">você</Badge>}</td>
                  <td>{u.nome || '—'}</td>
                  <td>{u.ativo ? <Badge tone="success">Ativo</Badge> : <Badge>Inativo</Badge>}</td>
                  <td className="small">{formatDateTime(u.ultimoLogin)}</td>
                  <td className="small muted">{formatDateTime(u.criadoEm)}</td>
                  <td className="actions">
                    <Button size="sm" variant="ghost" icon="edit" onClick={() => setForm(u)} />
                    {u.id !== me.userId && <Button size="sm" variant="ghost" icon="trash" onClick={() => remove(u)} />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      {form && <UserForm user={form.id ? form : null} onClose={() => setForm(null)} onSaved={() => { setForm(null); toast('Usuário salvo.'); reload(); }} />}
    </>
  );
}
