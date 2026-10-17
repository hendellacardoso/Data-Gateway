import { useState } from 'react';
import { Alert, Button, Checkbox, Field, Input, Modal, Select } from '../../components/ui.jsx';
import { LOGICAL_TYPES } from '../../services/constants.js';

/** Wizard de configuração detalhada de um campo. */
export default function FieldModal({ campo, onClose, onSave }) {
  const [c, setC] = useState({ ...campo });
  const set = (k, v) => setC((x) => ({ ...x, [k]: v }));
  const autoPk = c.pk && c.auto;

  return (
    <Modal title="Configuração do campo" size="lg" onClose={onClose}
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" onClick={() => onSave(c)}>Aplicar</Button></>}>
      <div className="form-row">
        <Field label="Nome (coluna no banco)"><Input value={c.nome} disabled className="mono" /></Field>
        <Field label="Nome na API" hint="Como o campo aparece no JSON."><Input value={c.nomeApi} onChange={(e) => set('nomeApi', e.target.value)} className="mono" /></Field>
      </div>
      <Field label="Descrição" hint="Usada na documentação automática da API.">
        <Input value={c.descricao} onChange={(e) => set('descricao', e.target.value)} placeholder="Ex.: Nome completo do cliente" />
      </Field>
      <div className="form-row three">
        <Field label="Tipo físico (banco)"><Input value={c.tipoFisico || ''} disabled className="mono" /></Field>
        <Field label="Tipo lógico (API)"><Select value={c.tipoLogico} onChange={(e) => set('tipoLogico', e.target.value)} options={LOGICAL_TYPES} /></Field>
        <Field label="Tamanho máximo" hint="Validado na inclusão/alteração (texto).">
          <Input type="number" value={c.tamanho ?? ''} onChange={(e) => set('tamanho', e.target.value === '' ? null : Number(e.target.value))} />
        </Field>
      </div>
      <div className="grid grid-2 mt-1">
        <div>
          <div className="bold small mb-1">Chave</div>
          <div className="row wrap" style={{ gap: 18 }}>
            <Checkbox label="Chave primária" checked={c.pk} onChange={(v) => set('pk', v)} />
            <Checkbox label="Gerado automaticamente" checked={c.auto} onChange={(v) => setC((x) => ({ ...x, auto: v, ...(v && x.pk ? { incluir: false, alterar: false } : {}) }))} />
          </div>
        </div>
        <div>
          <div className="bold small mb-1">Comportamento na API</div>
          <div className="row wrap" style={{ gap: 18 }}>
            <Checkbox label="Retornar na API" checked={c.retornar} onChange={(v) => set('retornar', v)} />
            <Checkbox label="Permitir inclusão" checked={c.incluir} disabled={autoPk} onChange={(v) => set('incluir', v)} />
            <Checkbox label="Permitir alteração" checked={c.alterar} disabled={autoPk} onChange={(v) => set('alterar', v)} />
            <Checkbox label="Obrigatório" checked={c.obrigatorio} onChange={(v) => set('obrigatorio', v)} />
            <Checkbox label="Aceita nulo" checked={c.nulo} onChange={(v) => set('nulo', v)} />
          </div>
        </div>
      </div>
      {autoPk && <div className="mt-2"><Alert tone="info">Chaves geradas automaticamente nunca podem ser incluídas ou alteradas pela API.</Alert></div>}
      {c.pk && !c.auto && c.alterar && <div className="mt-2"><Alert tone="warning">Atenção: permitir alterar a chave primária pode quebrar referências em outros sistemas.</Alert></div>}
    </Modal>
  );
}
