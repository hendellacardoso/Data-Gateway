import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Alert, Button, Card, ErrorAlert, Loading, PageHeader } from '../../components/ui.jsx';
import { call } from '../../services/api.js';
import { useApp } from '../../stores/AppContext.jsx';
import {
  Routes, StepBanco, StepCampos, StepDescricao, StepEscrita, StepExclusao, StepFiltros, StepOrdenacao,
  StepPermissoes, StepRevisar, StepTabela, StepUpload
} from './steps.jsx';

const STEPS = [
  'Selecionar banco', 'Selecionar tabela', 'Definir descrição', 'Configurar campos', 'Consulta e filtros',
  'Configurar ordenação', 'Configurar inclusão', 'Configurar alteração', 'Configurar exclusão', 'Configurar upload',
  'Definir permissões', 'Revisar', 'Publicar API'
];

const NEW_CFG = {
  bancoId: null, esquema: null, tabela: '', tipoObjeto: 'TABLE', descricao: '', slug: '', ativo: true, publicar: true,
  ops: { listar: true, buscar: true, incluir: false, alterar: false, patch: false, excluir: false },
  exclusao: { modo: 'FISICA', campo: '', valorAtivo: '1', valorExcluido: '0' },
  paginacao: { padrao: 50, max: 500 },
  upload: { ativo: false, extensoes: 'pdf, jpg, png, docx, xlsx', tamanhoMaxMb: 10, qtdMax: 5, diretorio: '', armazenamento: 'FS', padraoNome: 'UUID' },
  campos: [], filtros: [], ordens: [], permissoes: []
};

function suggestSlug(name) {
  return String(name).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^[_-]+|[_-]+$/g, '').slice(0, 63);
}

export default function WizardPage() {
  const { id } = useParams();
  const isEdit = !!id;
  const { toast } = useApp();
  const [cfg, setCfg] = useState(NEW_CFG);
  const [step, setStep] = useState(0);
  const [maxStep, setMaxStep] = useState(0);
  const [bancos, setBancos] = useState(null);
  const [tokens, setTokens] = useState(null);
  const [objetos, setObjetos] = useState(null);
  const [loadingObjs, setLoadingObjs] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [loaded, setLoaded] = useState(!isEdit);
  const [savedId, setSavedId] = useState(null);

  const update = useCallback((patch) => setCfg((c) => ({ ...c, ...patch })), []);

  useEffect(() => {
    call('bancos.list').then(setBancos).catch(setError);
    call('tokens.list').then(setTokens).catch(() => setTokens([]));
  }, []);

  useEffect(() => {
    if (!isEdit) return;
    call('endpoints.get', { id: Number(id) })
      .then((full) => {
        setCfg({ ...NEW_CFG, ...full, publicar: full.publicado, exclusao: { ...NEW_CFG.exclusao, ...full.exclusao } });
        setStep(2);
        setMaxStep(STEPS.length - 2);
        setLoaded(true);
      })
      .catch(setError);
  }, [id, isEdit]);

  // Carrega tabelas/views ao escolher o banco
  useEffect(() => {
    if (isEdit || !cfg.bancoId) return;
    setLoadingObjs(true);
    setObjetos(null);
    call('bancos.objects', { id: cfg.bancoId })
      .then(setObjetos)
      .catch((e) => { setError(e); setObjetos([]); })
      .finally(() => setLoadingObjs(false));
  }, [cfg.bancoId, isEdit]);

  const selectTable = async (o) => {
    setBusy(true);
    setError(null);
    try {
      const d = await call('bancos.describe', { id: cfg.bancoId, schema: o.schema, table: o.name });
      const isView = d.type === 'VIEW';
      const campos = d.columns.map((c) => (isView ? { ...c, incluir: false, alterar: false } : c));
      const pk = campos.find((c) => c.pk);
      update({
        esquema: o.schema || null, tabela: o.name, tipoObjeto: d.type, campos,
        slug: suggestSlug(o.name), filtros: [], permissoes: [],
        ops: { ...NEW_CFG.ops, buscar: !!pk }
      });
    } catch (e) { setError(e); }
    setBusy(false);
  };

  /** Edição: mescla a estrutura atual do banco com a configuração existente. */
  const syncStructure = async () => {
    setBusy(true);
    try {
      const d = await call('bancos.describe', { id: cfg.bancoId, schema: cfg.esquema, table: cfg.tabela });
      const old = new Map(cfg.campos.map((c) => [c.nome, c]));
      const campos = d.columns.map((c) => (old.has(c.nome)
        ? { ...old.get(c.nome), tipoFisico: c.tipoFisico, nulo: c.nulo, auto: c.auto }
        : { ...c, retornar: false, incluir: false, alterar: false }));
      const removed = cfg.campos.filter((c) => !d.columns.some((x) => x.nome === c.nome)).map((c) => c.nome);
      const novos = d.columns.filter((c) => !old.has(c.nome)).map((c) => c.nome);
      update({
        campos,
        filtros: cfg.filtros.filter((f) => !removed.includes(f.campo)),
        ordens: cfg.ordens.filter((o) => !removed.includes(o.campo))
      });
      toast(`Estrutura sincronizada. Novos: ${novos.length ? novos.join(', ') + ' (ocultos)' : 'nenhum'}. Removidos: ${removed.join(', ') || 'nenhum'}.`, 'info');
    } catch (e) { setError(e); }
    setBusy(false);
  };

  const warnings = useMemo(() => {
    const w = [];
    const pks = cfg.campos.filter((c) => c.pk);
    if ((cfg.ops.buscar || cfg.ops.alterar || cfg.ops.patch || cfg.ops.excluir || cfg.upload.ativo) && pks.length !== 1) w.push('Consulta por ID, alteração, exclusão e upload exigem exatamente uma chave primária.');
    if (!cfg.campos.some((c) => c.retornar)) w.push('Nenhum campo marcado para retornar.');
    if (cfg.ops.excluir && cfg.exclusao.modo === 'LOGICA' && !cfg.exclusao.campo) w.push('Exclusão lógica sem campo de status.');
    if (!cfg.permissoes.some((p) => ['listar', 'buscar', 'incluir', 'alterar', 'excluir', 'upload'].some((k) => p[k]))) w.push('Nenhum token tem acesso a esta API (pode ser definido depois em Tokens).');
    if (!Object.values(cfg.ops).some(Boolean)) w.push('Nenhuma operação habilitada.');
    return w;
  }, [cfg]);

  const canAdvance = () => {
    if (step === 0) return !!cfg.bancoId;
    if (step === 1) return !!cfg.tabela && !busy;
    if (step === 2) return /^[a-z0-9][a-z0-9_-]{0,62}$/.test(cfg.slug);
    return true;
  };

  const go = (s) => {
    setError(null);
    setStep(s);
    setMaxStep((m) => Math.max(m, s));
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const payload = { ...cfg, endpointId: isEdit ? Number(id) : savedId || undefined };
      const r = await call('endpoints.save', payload);
      setResult(r);
      setSavedId(r.endpointId);
      go(STEPS.length - 1);
    } catch (e) { setError(e); }
    setBusy(false);
  };

  if (!loaded) return error ? <ErrorAlert error={error} /> : <Loading />;
  const last = STEPS.length - 1;

  const body = [
    <StepBanco key={0} cfg={cfg} update={update} bancos={bancos} />,
    <StepTabela key={1} cfg={cfg} objetos={objetos} loadingObjs={loadingObjs} onSelect={selectTable} onSync={syncStructure} isEdit={isEdit} busy={busy} />,
    <StepDescricao key={2} cfg={cfg} update={update} />,
    <StepCampos key={3} cfg={cfg} update={update} />,
    <StepFiltros key={4} cfg={cfg} update={update} />,
    <StepOrdenacao key={5} cfg={cfg} update={update} />,
    <StepEscrita key={6} cfg={cfg} update={update} mode="incluir" />,
    <StepEscrita key={7} cfg={cfg} update={update} mode="alterar" />,
    <StepExclusao key={8} cfg={cfg} update={update} />,
    <StepUpload key={9} cfg={cfg} update={update} pickDir={() => call('system.selectDirectory', { title: 'Diretório de upload' })} />,
    <StepPermissoes key={10} cfg={cfg} update={update} tokens={tokens} />,
    <StepRevisar key={11} cfg={cfg} update={update} bancos={bancos} warnings={warnings} />,
    <div key={12}>
      {result ? (
        <>
          <Alert tone="success" title={cfg.publicar ? 'API pronta!' : 'Configuração salva como rascunho.'}>
            {cfg.publicar ? 'Os endpoints abaixo já estão disponíveis para os tokens autorizados.' : 'Publique quando quiser na lista de endpoints.'}
          </Alert>
          <div className="mt-2"><Routes cfg={cfg} /></div>
          <div className="row mt-3">
            <Link to="/apis/testador" state={{ slug: cfg.slug }}><Button icon="send" variant="primary">Testar API</Button></Link>
            <Button icon="book" onClick={() => call('system.openDocs').catch((e) => toast(e.message, 'error'))}>Ver documentação</Button>
            <Link to="/apis/endpoints"><Button>Voltar para endpoints</Button></Link>
          </div>
        </>
      ) : <Alert tone="info">Revise a configuração e clique em “Publicar API”.</Alert>}
    </div>
  ];

  return (
    <>
      <PageHeader title={isEdit ? `Configurar API /api/v1/${cfg.slug}` : 'Nova API'} subtitle="Configuração visual primeiro — o SQL parametrizado é gerado automaticamente.">
        <Link to="/apis/endpoints"><Button>Cancelar</Button></Link>
      </PageHeader>
      <div className="wizard">
        <div className="card steps">
          {STEPS.map((s, i) => (
            <button key={s} className={'step' + (i === step ? ' active' : i < maxStep || (result && i <= last) ? ' done' : '')}
              disabled={i > maxStep || (i === last && !result) || (!cfg.tabela && i > 1)} onClick={() => go(i)}>
              <span className="n">{i + 1}</span>{s}
            </button>
          ))}
        </div>
        <Card noBody>
          <div className="card-header"><h3>{step + 1}. {STEPS[step]}</h3><span className="small muted">Passo {step + 1} de {STEPS.length}</span></div>
          <div className="card-body">
            {error && <div className="mb-2"><ErrorAlert error={error} /></div>}
            {body[step]}
          </div>
          {step < last && (
            <div className="wizard-footer">
              <Button disabled={step === 0 || (isEdit && step === 1)} onClick={() => go(step - 1)}>Voltar</Button>
              {step === last - 1
                ? <Button variant="primary" icon="check" loading={busy} onClick={save}>{cfg.publicar ? 'Publicar API' : 'Salvar rascunho'}</Button>
                : <Button variant="primary" disabled={!canAdvance()} onClick={() => go(step + 1)}>Avançar</Button>}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
