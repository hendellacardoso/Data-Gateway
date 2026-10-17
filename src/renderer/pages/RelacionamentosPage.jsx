import { useState } from 'react';
import { Alert, Badge, Button, Card, Empty, ErrorAlert, Field, Input, Loading, Modal, PageHeader, Select } from '../components/ui.jsx';
import { useLoad } from '../hooks/useLoad.js';
import { call } from '../services/api.js';
import { useApp } from '../stores/AppContext.jsx';

function RelForm({ rel, tables, onClose, onSaved }) {
  const [f, setF] = useState(rel || { nome: '', tabelaOrigemId: '', campoOrigemId: '', tabelaDestinoId: '', campoDestinoId: '', cardinalidade: 'MUITOS', ativo: true });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const origem = tables.find((t) => t.id === Number(f.tabelaOrigemId));
  const destino = tables.find((t) => t.id === Number(f.tabelaDestinoId));
  const set = (patch) => setF((x) => ({ ...x, ...patch }));
  const opts = (t) => (t ? t.campos.map((c) => ({ value: c.id, label: c.nome })) : []);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await call('relationships.save', { ...f, tabelaOrigemId: Number(f.tabelaOrigemId), tabelaDestinoId: Number(f.tabelaDestinoId), campoOrigemId: Number(f.campoOrigemId), campoDestinoId: Number(f.campoDestinoId) });
      onSaved();
    } catch (e) { setError(e); }
    setBusy(false);
  };

  return (
    <Modal title={rel ? 'Editar relacionamento' : 'Novo relacionamento'} size="lg" onClose={onClose}
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={busy} onClick={save}>Salvar</Button></>}>
      {error && <div className="mb-2"><ErrorAlert error={error} /></div>}
      <div className="form-row">
        <Field label="Tabela origem"><Select value={f.tabelaOrigemId} placeholder="Selecione…" options={tables.map((t) => ({ value: t.id, label: `${t.banco} · ${t.nome}` }))} onChange={(e) => set({ tabelaOrigemId: e.target.value, campoOrigemId: '' })} /></Field>
        <Field label="Campo"><Select value={f.campoOrigemId} placeholder="Selecione…" options={opts(origem)} onChange={(e) => set({ campoOrigemId: e.target.value })} /></Field>
      </div>
      <div className="form-row">
        <Field label="Tabela relacionada"><Select value={f.tabelaDestinoId} placeholder="Selecione…" options={tables.filter((t) => !origem || t.bancoId === origem.bancoId).map((t) => ({ value: t.id, label: `${t.banco} · ${t.nome}` }))} onChange={(e) => set({ tabelaDestinoId: e.target.value, campoDestinoId: '' })} /></Field>
        <Field label="Campo"><Select value={f.campoDestinoId} placeholder="Selecione…" options={opts(destino)} onChange={(e) => set({ campoDestinoId: e.target.value })} /></Field>
      </div>
      <div className="form-row">
        <Field label="Nome no JSON" hint="Propriedade adicionada ao registro (ex.: enderecos)."><Input className="mono" value={f.nome} onChange={(e) => set({ nome: e.target.value.replace(/[^A-Za-z0-9_]/g, '') })} /></Field>
        <Field label="Retorno"><Select value={f.cardinalidade} onChange={(e) => set({ cardinalidade: e.target.value })} options={[{ value: 'MUITOS', label: 'Lista (1:N) → [ … ]' }, { value: 'UM', label: 'Objeto (1:1 / N:1) → { … }' }]} /></Field>
      </div>
      {origem && f.nome && (
        <Alert tone="info">
          Uso: <code>GET /api/v1/{origem.slug || '…'}?expand={f.nome}</code>. A tabela relacionada precisa ter API publicada e o token precisa de permissão de consulta nela.
        </Alert>
      )}
    </Modal>
  );
}

export default function RelacionamentosPage() {
  const { data, error, loading, reload } = useLoad('relationships.list');
  const { data: tables } = useLoad('relationships.tables');
  const { confirm, toast } = useApp();
  const [form, setForm] = useState(null);

  const remove = async (r) => {
    if (!(await confirm({ title: 'Excluir relacionamento', message: `Excluir "${r.nome}"?`, danger: true, confirmLabel: 'Excluir' }))) return;
    await call('relationships.delete', { id: r.id }).catch((e) => toast(e.message, 'error'));
    reload();
  };

  return (
    <>
      <PageHeader title="Relacionamentos" subtitle="Inclua registros relacionados na resposta com ?expand=nome.">
        <Button variant="primary" icon="plus" disabled={!tables || tables.length < 1} onClick={() => setForm({})}>Novo relacionamento</Button>
      </PageHeader>
      {error && <ErrorAlert error={error} />}
      <Card noBody>
        {loading && !data ? <Loading /> : !data?.length ? <Empty icon="link" title="Nenhum relacionamento">Exemplo: CLIENTES.ID → CLIENTE_ENDERECO.CLIENTE_ID</Empty> : (
          <table className="table">
            <thead><tr><th>Nome</th><th>Origem</th><th /><th>Relacionada</th><th>Retorno</th><th>Uso</th><th /></tr></thead>
            <tbody>
              {data.map((r) => (
                <tr key={r.id}>
                  <td className="mono bold">{r.nome}</td>
                  <td className="mono">{r.tabelaOrigem}.{r.campoOrigem}</td>
                  <td className="muted">→</td>
                  <td className="mono">{r.tabelaDestino}.{r.campoDestino} {!r.slugDestino && <Badge tone="warning">sem API</Badge>}</td>
                  <td>{r.cardinalidade === 'UM' ? 'Objeto' : 'Lista'}</td>
                  <td className="mono small">?expand={r.nome}</td>
                  <td className="actions">
                    <Button size="sm" variant="ghost" icon="edit" onClick={() => setForm(r)} />
                    <Button size="sm" variant="ghost" icon="trash" onClick={() => remove(r)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      {form && tables && <RelForm rel={form.id ? form : null} tables={tables} onClose={() => setForm(null)} onSaved={() => { setForm(null); toast('Relacionamento salvo.'); reload(); }} />}
    </>
  );
}
