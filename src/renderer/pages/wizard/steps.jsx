import { useMemo, useState } from 'react';
import { Alert, Badge, Button, Checkbox, Empty, Field, Input, Loading, Method, Select, ToggleRow } from '../../components/ui.jsx';
import { LOGICAL_TYPES, OPERATORS_BY_TYPE, OPERATOR_LABELS, dbLabel, typeLabel } from '../../services/constants.js';
import FieldModal from './FieldModal.jsx';

export function routesOf(cfg) {
  const base = `/api/v1/${cfg.slug || '…'}`;
  const r = [];
  if (cfg.ops.listar) r.push(['GET', base]);
  if (cfg.ops.buscar) r.push(['GET', `${base}/:id`]);
  if (cfg.ops.incluir) r.push(['POST', base]);
  if (cfg.ops.alterar) r.push(['PUT', `${base}/:id`]);
  if (cfg.ops.patch) r.push(['PATCH', `${base}/:id`]);
  if (cfg.ops.excluir) r.push(['DELETE', `${base}/:id`]);
  if (cfg.upload.ativo) r.push(['POST', `${base}/:id/arquivos`]);
  return r;
}

export function Routes({ cfg }) {
  const r = routesOf(cfg);
  if (!r.length) return <div className="muted small">Nenhuma operação habilitada.</div>;
  return r.map(([m, p], i) => <div className="route" key={i}><Method m={m} />{p}</div>);
}

// ---------------- 1. Banco ----------------
export function StepBanco({ cfg, update, bancos }) {
  if (!bancos) return <Loading />;
  const ativos = bancos.filter((b) => b.ativo);
  if (!ativos.length) return <Empty title="Nenhuma conexão ativa">Cadastre uma conexão em Conexões → Bancos.</Empty>;
  return (
    <div className="grid grid-2">
      {ativos.map((b) => (
        <label key={b.id} className="card" style={{ padding: 14, cursor: 'pointer', borderColor: cfg.bancoId === b.id ? 'var(--primary)' : undefined, boxShadow: cfg.bancoId === b.id ? '0 0 0 3px rgba(79,70,229,.15)' : undefined }}>
          <div className="row">
            <input type="radio" checked={cfg.bancoId === b.id} onChange={() => update({ bancoId: b.id, tabela: '', esquema: null, campos: [] })} />
            <div>
              <div className="bold">{b.nome}</div>
              <div className="small text-2">{dbLabel(b.tipo)} · {b.tipo === 'sqlite' ? b.arquivo : `${b.servidor}/${b.banco}`}</div>
            </div>
          </div>
        </label>
      ))}
    </div>
  );
}

// ---------------- 2. Tabela ----------------
export function StepTabela({ cfg, objetos, loadingObjs, onSelect, onSync, isEdit, busy }) {
  const [q, setQ] = useState('');
  const [tipo, setTipo] = useState('');
  const list = useMemo(() => (objetos || []).filter((o) =>
    (!tipo || o.type === tipo) && `${o.schema || ''}.${o.name}`.toLowerCase().includes(q.toLowerCase())), [objetos, q, tipo]);

  if (isEdit) {
    return (
      <>
        <Alert tone="info" title={`Tabela: ${cfg.esquema ? cfg.esquema + '.' : ''}${cfg.tabela}`}>
          Para trocar a tabela, crie uma nova API. Você pode sincronizar a estrutura caso colunas tenham sido criadas ou removidas no banco.
        </Alert>
        <Button className="mt-2" icon="refresh" loading={busy} onClick={onSync}>Sincronizar estrutura com o banco</Button>
      </>
    );
  }
  if (loadingObjs) return <Loading text="Lendo tabelas e views do banco…" />;
  return (
    <>
      <div className="row mb-2">
        <Input placeholder="Pesquisar tabela ou view…" value={q} onChange={(e) => setQ(e.target.value)} />
        <Select style={{ width: 160 }} value={tipo} onChange={(e) => setTipo(e.target.value)} placeholder="Tabelas e views" options={[{ value: 'TABLE', label: 'Tabelas' }, { value: 'VIEW', label: 'Views' }]} />
      </div>
      <div className="card" style={{ maxHeight: 440, overflowY: 'auto' }}>
        <table className="table table-compact">
          <tbody>
            {list.map((o) => {
              const sel = cfg.tabela === o.name && (cfg.esquema || null) === (o.schema || null);
              return (
                <tr key={`${o.schema}.${o.name}`} onClick={() => onSelect(o)} style={{ cursor: 'pointer', background: sel ? 'var(--primary-soft)' : undefined }}>
                  <td style={{ width: 30 }}><input type="radio" readOnly checked={sel} /></td>
                  <td className="mono">{o.schema ? <span className="muted">{o.schema}.</span> : null}{o.name}</td>
                  <td>{o.type === 'VIEW' ? <Badge tone="info">View</Badge> : <Badge>Tabela</Badge>}</td>
                  <td className="right">{o.configurado && <Badge tone="success">já possui API</Badge>}</td>
                </tr>
              );
            })}
            {!list.length && <tr><td className="muted center">Nenhum objeto encontrado.</td></tr>}
          </tbody>
        </table>
      </div>
      {busy && <Loading text="Lendo estrutura da tabela…" />}
      {cfg.tabela && !busy && <div className="mt-2"><Alert tone="success">Selecionada: <b className="mono">{cfg.tabela}</b> — {cfg.campos.length} campo(s) encontrados.</Alert></div>}
    </>
  );
}

// ---------------- 3. Descrição ----------------
export function StepDescricao({ cfg, update }) {
  return (
    <>
      <Field label="Tabela"><Input value={(cfg.esquema ? cfg.esquema + '.' : '') + cfg.tabela} disabled className="mono" /></Field>
      <Field label="Descrição" hint="Exibida na documentação automática da API.">
        <Input value={cfg.descricao} onChange={(e) => update({ descricao: e.target.value })} placeholder="Cadastro de clientes" />
      </Field>
      <Field label="Endpoint" hint="Letras minúsculas, números, “-” e “_”.">
        <div className="input-group">
          <span className="input mono" style={{ width: 'auto', display: 'flex', alignItems: 'center', background: 'var(--surface-2)' }}>/api/v1/</span>
          <Input className="mono" value={cfg.slug} onChange={(e) => update({ slug: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '') })} />
        </div>
      </Field>
      <ToggleRow title="Status: ativo" description="Endpoints inativos respondem 404 mesmo se publicados." checked={cfg.ativo} onChange={(v) => update({ ativo: v })} />
    </>
  );
}

// ---------------- 4. Campos ----------------
export function StepCampos({ cfg, update }) {
  const [editing, setEditing] = useState(null);
  const setCampo = (i, patch) => update({ campos: cfg.campos.map((c, j) => (j === i ? { ...c, ...patch } : c)) });
  const all = (k, v) => update({ campos: cfg.campos.map((c) => ({ ...c, [k]: v })) });
  return (
    <>
      <div className="row between mb-1">
        <span className="small text-2">{cfg.campos.length} campos · clique em “Detalhes” para a configuração completa do campo.</span>
        <div className="row">
          <Button size="sm" onClick={() => all('retornar', true)}>Exibir todos</Button>
          <Button size="sm" onClick={() => all('retornar', false)}>Ocultar todos</Button>
        </div>
      </div>
      <div className="card table-wrap">
        <table className="table table-compact">
          <thead><tr><th>Campo</th><th>Tipo físico</th><th>Tipo lógico</th><th>Nome na API</th><th className="center">Exibir</th><th className="center">PK</th><th className="center">Obrig.</th><th /></tr></thead>
          <tbody>
            {cfg.campos.map((c, i) => (
              <tr key={c.nome}>
                <td className="mono bold">{c.nome}{c.auto && <Badge tone="info">auto</Badge>}</td>
                <td className="mono small muted">{c.tipoFisico}{c.tamanho ? `(${c.tamanho})` : ''}</td>
                <td><Select className="input-sm" value={c.tipoLogico} onChange={(e) => setCampo(i, { tipoLogico: e.target.value })} options={LOGICAL_TYPES} /></td>
                <td><Input className="input-sm mono" value={c.nomeApi} onChange={(e) => setCampo(i, { nomeApi: e.target.value })} /></td>
                <td className="center"><Checkbox checked={c.retornar} onChange={(v) => setCampo(i, { retornar: v })} /></td>
                <td className="center"><Checkbox checked={c.pk} onChange={(v) => setCampo(i, { pk: v })} /></td>
                <td className="center"><Checkbox checked={c.obrigatorio} onChange={(v) => setCampo(i, { obrigatorio: v })} /></td>
                <td className="actions"><Button size="sm" variant="ghost" icon="edit" onClick={() => setEditing(i)}>Detalhes</Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {cfg.campos.filter((c) => c.pk).length === 0 && (
        <div className="mt-2"><Alert tone="warning">Nenhuma chave primária marcada. Sem ela, apenas a consulta em lista fica disponível. Para views, marque a coluna que identifica cada registro.</Alert></div>
      )}
      {editing !== null && (
        <FieldModal campo={cfg.campos[editing]} onClose={() => setEditing(null)} onSave={(c) => { setCampo(editing, c); setEditing(null); }} />
      )}
    </>
  );
}

// ---------------- 5. Consulta e filtros ----------------
export function StepFiltros({ cfg, update }) {
  const [novo, setNovo] = useState({ campo: '', operador: '', parametro: '' });
  const campo = cfg.campos.find((c) => c.nome === novo.campo);
  const ops = campo ? OPERATORS_BY_TYPE[campo.tipoLogico] || ['eq'] : [];
  const add = () => {
    if (!campo || !novo.operador || !novo.parametro) return;
    update({ filtros: [...cfg.filtros, { ...novo }] });
    setNovo({ campo: '', operador: '', parametro: '' });
  };
  const exemplo = cfg.filtros.slice(0, 2).map((f) => `${f.parametro}=…`).join('&');
  return (
    <>
      <div className="grid grid-2">
        <div>
          <ToggleRow title="Consulta em lista (GET /api/v1/…)" checked={cfg.ops.listar} onChange={(v) => update({ ops: { ...cfg.ops, listar: v } })} />
          <ToggleRow title="Consulta por ID (GET /api/v1/…/:id)" checked={cfg.ops.buscar} onChange={(v) => update({ ops: { ...cfg.ops, buscar: v } })} />
        </div>
        <div className="form-row">
          <Field label="Itens por página (padrão)"><Input type="number" value={cfg.paginacao.padrao} onChange={(e) => update({ paginacao: { ...cfg.paginacao, padrao: Number(e.target.value) } })} /></Field>
          <Field label="Máximo por página" hint="Nunca há consultas ilimitadas."><Input type="number" value={cfg.paginacao.max} onChange={(e) => update({ paginacao: { ...cfg.paginacao, max: Number(e.target.value) } })} /></Field>
        </div>
      </div>
      <div className="divider" />
      <div className="bold mb-1">Filtros permitidos</div>
      <p className="small text-2 mt-0">Somente os filtros definidos aqui são aceitos. Qualquer outro parâmetro é rejeitado — o cliente nunca envia SQL.</p>
      <div className="card table-wrap">
        <table className="table table-compact">
          <thead><tr><th>Campo</th><th>Operador</th><th>Parâmetro na URL</th><th /></tr></thead>
          <tbody>
            {cfg.filtros.map((f, i) => (
              <tr key={f.parametro}>
                <td className="mono">{f.campo}</td>
                <td>{OPERATOR_LABELS[f.operador]}</td>
                <td className="mono">?{f.parametro}=</td>
                <td className="actions"><Button size="sm" variant="ghost" icon="trash" onClick={() => update({ filtros: cfg.filtros.filter((_, j) => j !== i) })} /></td>
              </tr>
            ))}
            <tr>
              <td><Select className="input-sm" value={novo.campo} placeholder="Campo…" options={cfg.campos.map((c) => ({ value: c.nome, label: `${c.nome} (${typeLabel(c.tipoLogico)})` }))}
                onChange={(e) => {
                  const c = cfg.campos.find((x) => x.nome === e.target.value);
                  const taken = new Set(cfg.filtros.map((f) => f.parametro));
                  let p = c ? c.nomeApi : '';
                  let n = 2;
                  while (taken.has(p)) p = `${c.nomeApi}${n++}`;
                  setNovo({ campo: e.target.value, operador: c ? (c.tipoLogico === 'TEXTO' ? 'contains' : 'eq') : '', parametro: p });
                }} /></td>
              <td><Select className="input-sm" value={novo.operador} placeholder="Operador…" options={ops.map((o) => ({ value: o, label: OPERATOR_LABELS[o] }))} onChange={(e) => setNovo({ ...novo, operador: e.target.value })} /></td>
              <td><Input className="input-sm mono" value={novo.parametro} onChange={(e) => setNovo({ ...novo, parametro: e.target.value.replace(/[^A-Za-z0-9_]/g, '') })} placeholder="nome" /></td>
              <td className="actions"><Button size="sm" variant="primary" icon="plus" disabled={!novo.campo || !novo.operador || !novo.parametro} onClick={add}>Adicionar</Button></td>
            </tr>
          </tbody>
        </table>
      </div>
      {exemplo && <div className="mt-1 small text-2">Exemplo: <code>GET /api/v1/{cfg.slug}?{exemplo}&page=1&pageSize={cfg.paginacao.padrao}</code></div>}
    </>
  );
}

// ---------------- 6. Ordenação ----------------
export function StepOrdenacao({ cfg, update }) {
  const byCampo = new Map(cfg.ordens.map((o) => [o.campo, o]));
  const toggle = (nome, on) => update({ ordens: on ? [...cfg.ordens, { campo: nome, padrao: cfg.ordens.length === 0, direcao: 'ASC' }] : cfg.ordens.filter((o) => o.campo !== nome) });
  const setDefault = (nome) => update({ ordens: cfg.ordens.map((o) => ({ ...o, padrao: o.campo === nome })) });
  const setDir = (nome, direcao) => update({ ordens: cfg.ordens.map((o) => (o.campo === nome ? { ...o, direcao } : o)) });
  return (
    <>
      <p className="small text-2 mt-0">Somente os campos autorizados podem ser usados em <code>?sort=campo&direction=asc|desc</code>. Sem ordenação padrão, a lista é ordenada pela chave primária.</p>
      <div className="card table-wrap">
        <table className="table table-compact">
          <thead><tr><th className="center">Permitir</th><th>Campo</th><th>Parâmetro</th><th className="center">Padrão</th><th>Direção padrão</th></tr></thead>
          <tbody>
            {cfg.campos.filter((c) => !['JSON', 'ARQUIVO'].includes(c.tipoLogico)).map((c) => {
              const o = byCampo.get(c.nome);
              return (
                <tr key={c.nome}>
                  <td className="center"><Checkbox checked={!!o} onChange={(v) => toggle(c.nome, v)} /></td>
                  <td className="mono">{c.nome}</td>
                  <td className="mono small">sort={c.nomeApi}</td>
                  <td className="center"><input type="radio" disabled={!o} checked={!!o?.padrao} onChange={() => setDefault(c.nome)} /></td>
                  <td>{o && <Select className="input-sm" style={{ width: 140 }} value={o.direcao} onChange={(e) => setDir(c.nome, e.target.value)} options={[{ value: 'ASC', label: 'Crescente' }, { value: 'DESC', label: 'Decrescente' }]} />}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ---------------- 7/8. Inclusão e alteração ----------------
export function StepEscrita({ cfg, update, mode }) {
  const isView = cfg.tipoObjeto === 'VIEW';
  const flag = mode === 'incluir' ? 'incluir' : 'alterar';
  const setCampo = (nome, patch) => update({ campos: cfg.campos.map((c) => (c.nome === nome ? { ...c, ...patch } : c)) });
  const exemplo = Object.fromEntries(cfg.campos.filter((c) => c[flag]).slice(0, 4).map((c) => [c.nomeApi, c.tipoLogico === 'BOOLEANO' ? true : ['INTEIRO', 'NUMERO', 'DECIMAL'].includes(c.tipoLogico) ? 0 : '…']));
  return (
    <>
      {isView && <div className="mb-2"><Alert tone="warning">Esta é uma view. Gravação em views depende do banco e geralmente não é suportada.</Alert></div>}
      {mode === 'incluir' ? (
        <ToggleRow title="Permitir inclusão (POST)" description="Recebe JSON, valida campos, tipos e obrigatórios e executa INSERT parametrizado." checked={cfg.ops.incluir} onChange={(v) => update({ ops: { ...cfg.ops, incluir: v } })} />
      ) : (
        <>
          <ToggleRow title="Permitir alteração completa (PUT)" description="Campos obrigatórios alteráveis devem ser enviados." checked={cfg.ops.alterar} onChange={(v) => update({ ops: { ...cfg.ops, alterar: v } })} />
          <ToggleRow title="Permitir alteração parcial (PATCH)" description="Envia somente os campos que mudaram." checked={cfg.ops.patch} onChange={(v) => update({ ops: { ...cfg.ops, patch: v } })} />
        </>
      )}
      {(mode === 'incluir' ? cfg.ops.incluir : cfg.ops.alterar || cfg.ops.patch) && (
        <div className="grid grid-2 mt-2" style={{ gridTemplateColumns: '3fr 2fr' }}>
          <div className="card table-wrap">
            <table className="table table-compact">
              <thead><tr><th>Campo</th><th>Tipo</th><th className="center">{mode === 'incluir' ? 'Incluir' : 'Alterar'}</th><th className="center">Obrigatório</th></tr></thead>
              <tbody>
                {cfg.campos.map((c) => {
                  const locked = c.pk && c.auto;
                  return (
                    <tr key={c.nome}>
                      <td className="mono">{c.nomeApi}{c.pk && <Badge tone="primary">PK</Badge>}</td>
                      <td className="small">{typeLabel(c.tipoLogico)}</td>
                      <td className="center"><Checkbox checked={c[flag]} disabled={locked || c.tipoLogico === 'ARQUIVO'} title={locked ? 'Chave gerada automaticamente' : ''} onChange={(v) => setCampo(c.nome, { [flag]: v })} /></td>
                      <td className="center"><Checkbox checked={c.obrigatorio} disabled={!c[flag]} onChange={(v) => setCampo(c.nome, { obrigatorio: v })} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div>
            <div className="small bold mb-1">Exemplo de JSON</div>
            <pre className="code-block">{JSON.stringify(exemplo, null, 2)}</pre>
            {mode === 'alterar' && cfg.campos.some((c) => c.pk && !c.auto && c.alterar) && (
              <div className="mt-1"><Alert tone="warning">A chave primária está marcada como alterável.</Alert></div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

// ---------------- 9. Exclusão ----------------
export function StepExclusao({ cfg, update }) {
  const ex = cfg.exclusao;
  const set = (patch) => update({ exclusao: { ...ex, ...patch } });
  return (
    <>
      <ToggleRow title="Permitir exclusão (DELETE)" checked={cfg.ops.excluir} onChange={(v) => update({ ops: { ...cfg.ops, excluir: v } })} />
      {cfg.ops.excluir && (
        <div className="mt-2">
          <div className="row" style={{ gap: 24 }}>
            <label className="check"><input type="radio" checked={ex.modo === 'FISICA'} onChange={() => set({ modo: 'FISICA' })} />Exclusão física (DELETE no banco)</label>
            <label className="check"><input type="radio" checked={ex.modo === 'LOGICA'} onChange={() => set({ modo: 'LOGICA' })} />Exclusão lógica (marca o registro como excluído)</label>
          </div>
          {ex.modo === 'LOGICA' && (
            <div className="form-row three mt-2">
              <Field label="Campo de status"><Select value={ex.campo} placeholder="Selecione…" onChange={(e) => set({ campo: e.target.value })} options={cfg.campos.filter((c) => !c.pk).map((c) => ({ value: c.nome, label: c.nome }))} /></Field>
              <Field label="Valor ativo" hint="Registros listados somente com este valor."><Input value={ex.valorAtivo} onChange={(e) => set({ valorAtivo: e.target.value })} /></Field>
              <Field label="Valor excluído"><Input value={ex.valorExcluido} onChange={(e) => set({ valorExcluido: e.target.value })} /></Field>
            </div>
          )}
          {ex.modo === 'FISICA' && <div className="mt-2"><Alert tone="warning">A exclusão física remove definitivamente o registro do banco de dados.</Alert></div>}
        </div>
      )}
    </>
  );
}

// ---------------- 10. Upload ----------------
export function StepUpload({ cfg, update, pickDir }) {
  const up = cfg.upload;
  const set = (patch) => update({ upload: { ...up, ...patch } });
  const hasPk = cfg.campos.filter((c) => c.pk).length === 1;
  return (
    <>
      <ToggleRow title="Permitir upload de arquivos" description={`POST /api/v1/${cfg.slug}/:id/arquivos (multipart/form-data)`} checked={up.ativo} disabled={!hasPk} onChange={(v) => set({ ativo: v })} />
      {!hasPk && <Alert tone="info">Upload requer uma chave primária.</Alert>}
      {up.ativo && (
        <div className="mt-2">
          <Field label="Extensões permitidas" hint="Separadas por vírgula. Executáveis e scripts são sempre bloqueados.">
            <Input value={up.extensoes} onChange={(e) => set({ extensoes: e.target.value })} placeholder="pdf, jpg, png, docx, xlsx" />
          </Field>
          <div className="form-row three">
            <Field label="Tamanho máximo (MB)"><Input type="number" value={up.tamanhoMaxMb} onChange={(e) => set({ tamanhoMaxMb: Number(e.target.value) })} /></Field>
            <Field label="Quantidade máxima por envio"><Input type="number" value={up.qtdMax} onChange={(e) => set({ qtdMax: Number(e.target.value) })} /></Field>
            <Field label="Nome do arquivo">
              <Select value={up.padraoNome} onChange={(e) => set({ padraoNome: e.target.value })} options={[
                { value: 'UUID', label: 'Identificador único (UUID)' }, { value: 'ORIGINAL', label: 'Nome original' }, { value: 'TIMESTAMP', label: 'Data/hora + nome original' }]} />
            </Field>
          </div>
          <div className="row" style={{ gap: 24 }}>
            <label className="check"><input type="radio" checked={up.armazenamento === 'FS'} onChange={() => set({ armazenamento: 'FS' })} />Armazenar arquivo no filesystem</label>
            <label className="check"><input type="radio" checked={up.armazenamento === 'DB'} onChange={() => set({ armazenamento: 'DB' })} />Armazenar arquivo no banco (interno do Gateway)</label>
          </div>
          {up.armazenamento === 'FS' && (
            <Field label="Diretório" className="mt-2" hint="Vazio = pasta de dados do Gateway (uploads/endpoint/id). Os metadados ficam sempre no banco.">
              <div className="input-group">
                <Input value={up.diretorio} onChange={(e) => set({ diretorio: e.target.value })} placeholder="(padrão)" />
                <Button icon="folder" onClick={async () => { const d = await pickDir(); if (d) set({ diretorio: d }); }}>Selecionar</Button>
              </div>
            </Field>
          )}
        </div>
      )}
    </>
  );
}

// ---------------- 11. Permissões ----------------
export function StepPermissoes({ cfg, update, tokens }) {
  if (!tokens) return <Loading />;
  const ativos = tokens.filter((t) => t.status === 'ATIVO');
  const ops = [
    ['listar', 'Consultar', cfg.ops.listar], ['buscar', 'Consultar por ID', cfg.ops.buscar], ['incluir', 'Incluir', cfg.ops.incluir],
    ['alterar', 'Alterar', cfg.ops.alterar || cfg.ops.patch], ['excluir', 'Excluir', cfg.ops.excluir], ['upload', 'Upload', cfg.upload.ativo]
  ];
  const perm = (tokenId) => cfg.permissoes.find((p) => p.tokenId === tokenId) || { tokenId };
  const set = (tokenId, k, v) => {
    const cur = perm(tokenId);
    update({ permissoes: [...cfg.permissoes.filter((p) => p.tokenId !== tokenId), { ...cur, [k]: v }] });
  };
  if (!ativos.length) return <Empty icon="key" title="Nenhum token ativo">Crie tokens em APIs → Tokens. As permissões também podem ser definidas depois.</Empty>;
  return (
    <div className="card table-wrap">
      <table className="table table-compact">
        <thead><tr><th>Token</th>{ops.map(([k, l, on]) => <th key={k} className="center" style={{ opacity: on ? 1 : 0.4 }}>{l}</th>)}</tr></thead>
        <tbody>
          {ativos.map((t) => {
            const p = perm(t.id);
            return (
              <tr key={t.id}>
                <td><div className="bold">{t.nome}</div><div className="xs muted mono">{t.prefixo}…</div></td>
                {ops.map(([k, , on]) => <td key={k} className="center"><Checkbox checked={on && p[k]} disabled={!on} onChange={(v) => set(t.id, k, v)} /></td>)}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------------- 12. Revisar ----------------
export function StepRevisar({ cfg, update, bancos, warnings }) {
  const banco = bancos?.find((b) => b.id === cfg.bancoId);
  return (
    <>
      {warnings.length > 0 && <div className="mb-2"><Alert tone="warning" title="Verifique antes de publicar"><ul>{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></Alert></div>}
      <div className="grid grid-2">
        <div>
          <div className="bold mb-1">Resumo da API</div>
          <dl className="kv">
            <dt>Banco</dt><dd>{banco?.nome}</dd>
            <dt>Tabela</dt><dd className="mono">{cfg.esquema ? cfg.esquema + '.' : ''}{cfg.tabela}</dd>
            <dt>Descrição</dt><dd>{cfg.descricao || '—'}</dd>
            <dt>Paginação</dt><dd>{cfg.paginacao.padrao} por página (máx. {cfg.paginacao.max})</dd>
            <dt>Filtros</dt><dd>{cfg.filtros.map((f) => f.parametro).join(', ') || '—'}</dd>
            <dt>Ordenação</dt><dd>{cfg.ordens.map((o) => o.campo + (o.padrao ? ' (padrão)' : '')).join(', ') || 'chave primária'}</dd>
            <dt>Exclusão</dt><dd>{cfg.ops.excluir ? (cfg.exclusao.modo === 'LOGICA' ? `lógica (${cfg.exclusao.campo} = ${cfg.exclusao.valorExcluido})` : 'física') : '—'}</dd>
            <dt>Upload</dt><dd>{cfg.upload.ativo ? `${cfg.upload.extensoes} · ${cfg.upload.tamanhoMaxMb} MB` : '—'}</dd>
            <dt>Tokens com acesso</dt><dd>{cfg.permissoes.filter((p) => ['listar', 'buscar', 'incluir', 'alterar', 'excluir', 'upload'].some((k) => p[k])).length}</dd>
          </dl>
          <div className="bold mb-1 mt-2">Endpoints</div>
          <Routes cfg={cfg} />
        </div>
        <div>
          <div className="bold mb-1">Campos retornados</div>
          <div className="card table-wrap" style={{ maxHeight: 380, overflowY: 'auto' }}>
            <table className="table table-compact">
              <tbody>
                {cfg.campos.filter((c) => c.retornar).map((c) => (
                  <tr key={c.nome}><td className="mono">{c.nomeApi}</td><td className="small">{typeLabel(c.tipoLogico)}</td>
                    <td className="right">{c.pk && <Badge tone="primary">PK</Badge>} {c.obrigatorio && <Badge>obrig.</Badge>}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      <div className="divider" />
      <ToggleRow title="Publicar API ao salvar" description="Desmarcado = salva como rascunho (não acessível pela API)." checked={cfg.publicar} onChange={(v) => update({ publicar: v })} />
    </>
  );
}
