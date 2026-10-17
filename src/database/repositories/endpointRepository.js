'use strict';

const { GatewayError } = require('../../server/errors');
const { OPERATORS } = require('../../server/query-builder/builder');
const { LOGICAL_TYPES } = require('../../server/drivers');

const SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,62}$/;
const API_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const RESERVED_PARAMS = new Set(['page', 'pageSize', 'sort', 'direction', 'expand', 'fields']);
const b = (v) => (v ? 1 : 0);

function vErr(message, details) {
  return new GatewayError('VALIDATION_ERROR', message, { details });
}

class EndpointRepository {
  constructor(db) {
    this.db = db;
  }

  listSummary() {
    return this.db.prepare(`
      SELECT e.ID AS id, e.SLUG AS slug, e.DESCRICAO AS descricao, e.ATIVO AS ativo, e.PUBLICADO AS publicado,
             e.PERMITE_LISTAR AS listar, e.PERMITE_BUSCAR AS buscar, e.PERMITE_INCLUIR AS incluir,
             e.PERMITE_ALTERAR AS alterar, e.PERMITE_PATCH AS patch, e.PERMITE_EXCLUIR AS excluir,
             e.UPLOAD_ATIVO AS upload, e.ATUALIZADO_EM AS atualizadoEm,
             t.ID AS tabelaId, t.NOME AS tabela, t.ESQUEMA AS esquema, b.ID AS bancoId, b.NOME AS banco, b.TIPO AS bancoTipo,
             (SELECT COUNT(*) FROM GW_CAMPO c WHERE c.TABELA_ID = t.ID) AS totalCampos
      FROM GW_ENDPOINT e
      JOIN GW_TABELA t ON t.ID = e.TABELA_ID
      JOIN GW_BANCO b ON b.ID = t.BANCO_ID
      ORDER BY e.SLUG`).all();
  }

  /** Configuração completa no formato do wizard. */
  getFull(endpointId) {
    const e = this.db.prepare('SELECT * FROM GW_ENDPOINT WHERE ID = ?').get(endpointId);
    if (!e) throw new GatewayError('NOT_FOUND', 'Endpoint não encontrado.');
    const t = this.db.prepare('SELECT * FROM GW_TABELA WHERE ID = ?').get(e.TABELA_ID);
    const campos = this.db.prepare(`
      SELECT c.*, ec.RETORNAR, ec.INCLUIR, ec.ALTERAR, ec.OBRIGATORIO
      FROM GW_CAMPO c LEFT JOIN GW_ENDPOINT_CAMPO ec ON ec.CAMPO_ID = c.ID AND ec.ENDPOINT_ID = ?
      WHERE c.TABELA_ID = ? ORDER BY c.ORDEM, c.ID`).all(e.ID, t.ID);
    const byId = new Map(campos.map((c) => [c.ID, c]));
    const filtros = this.db.prepare('SELECT * FROM GW_ENDPOINT_FILTRO WHERE ENDPOINT_ID = ? ORDER BY ID').all(e.ID);
    const ordens = this.db.prepare('SELECT * FROM GW_ENDPOINT_ORDEM WHERE ENDPOINT_ID = ? ORDER BY ID').all(e.ID);
    const perms = this.db.prepare('SELECT * FROM GW_TOKEN_PERMISSAO WHERE ENDPOINT_ID = ?').all(e.ID);
    return {
      endpointId: e.ID,
      tabelaId: t.ID,
      bancoId: t.BANCO_ID,
      esquema: t.ESQUEMA,
      tabela: t.NOME,
      tipoObjeto: t.TIPO_OBJETO,
      descricao: t.DESCRICAO,
      slug: e.SLUG,
      ativo: !!e.ATIVO,
      publicado: !!e.PUBLICADO,
      ops: {
        listar: !!e.PERMITE_LISTAR, buscar: !!e.PERMITE_BUSCAR, incluir: !!e.PERMITE_INCLUIR,
        alterar: !!e.PERMITE_ALTERAR, patch: !!e.PERMITE_PATCH, excluir: !!e.PERMITE_EXCLUIR
      },
      exclusao: {
        modo: e.MODO_EXCLUSAO,
        campo: e.CAMPO_EXCLUSAO_ID && byId.get(e.CAMPO_EXCLUSAO_ID) ? byId.get(e.CAMPO_EXCLUSAO_ID).NOME : '',
        valorAtivo: e.VALOR_ATIVO ?? '',
        valorExcluido: e.VALOR_EXCLUIDO ?? ''
      },
      paginacao: { padrao: e.PAGE_SIZE_PADRAO, max: e.PAGE_SIZE_MAX },
      upload: {
        ativo: !!e.UPLOAD_ATIVO,
        extensoes: e.UPLOAD_EXTENSOES || '',
        tamanhoMaxMb: e.UPLOAD_TAMANHO_MAX_MB,
        qtdMax: e.UPLOAD_QTD_MAX,
        diretorio: e.UPLOAD_DIRETORIO || '',
        armazenamento: e.UPLOAD_ARMAZENAMENTO,
        padraoNome: e.UPLOAD_PADRAO_NOME
      },
      campos: campos.map((c) => ({
        id: c.ID, nome: c.NOME, nomeApi: c.NOME_API, descricao: c.DESCRICAO || '',
        tipoFisico: c.TIPO_FISICO, tipoLogico: c.TIPO_LOGICO, tamanho: c.TAMANHO, precisao: c.PRECISAO, escala: c.ESCALA,
        nulo: !!c.NULO, pk: !!c.PK, auto: !!c.AUTO, padrao: c.VALOR_PADRAO, ordem: c.ORDEM,
        retornar: !!c.RETORNAR, incluir: !!c.INCLUIR, alterar: !!c.ALTERAR, obrigatorio: !!c.OBRIGATORIO
      })),
      filtros: filtros.map((f) => ({ campo: byId.get(f.CAMPO_ID)?.NOME, operador: f.OPERADOR, parametro: f.PARAMETRO })),
      ordens: ordens.map((o) => ({ campo: byId.get(o.CAMPO_ID)?.NOME, padrao: !!o.PADRAO, direcao: o.DIRECAO_PADRAO })),
      permissoes: perms.map((p) => ({
        tokenId: p.TOKEN_ID, listar: !!p.LISTAR, buscar: !!p.BUSCAR, incluir: !!p.INCLUIR,
        alterar: !!p.ALTERAR, excluir: !!p.EXCLUIR, upload: !!p.UPLOAD
      }))
    };
  }

  validate(p) {
    const errors = [];
    if (!p.bancoId) errors.push('Selecione o banco de dados.');
    if (!p.tabela) errors.push('Selecione a tabela.');
    if (!SLUG_RE.test(p.slug || '')) errors.push('Endpoint inválido: use letras minúsculas, números, "-" ou "_" (ex.: clientes).');
    const campos = p.campos || [];
    if (!campos.length) errors.push('Nenhum campo configurado.');
    const apiNames = new Set();
    for (const c of campos) {
      if (!API_NAME_RE.test(c.nomeApi || '')) errors.push(`Nome na API inválido para o campo ${c.nome}.`);
      if (apiNames.has(String(c.nomeApi).toLowerCase())) errors.push(`Nome na API duplicado: ${c.nomeApi}.`);
      apiNames.add(String(c.nomeApi).toLowerCase());
      if (!LOGICAL_TYPES.includes(c.tipoLogico)) errors.push(`Tipo lógico inválido no campo ${c.nome}.`);
      if (c.pk && c.auto && (c.incluir || c.alterar)) errors.push(`O campo ${c.nome} é chave gerada automaticamente e não pode ser incluído/alterado.`);
    }
    if (!campos.some((c) => c.retornar)) errors.push('Marque ao menos um campo para retornar na API.');
    const pks = campos.filter((c) => c.pk);
    const ops = p.ops || {};
    const needsPk = ops.buscar || ops.alterar || ops.patch || ops.excluir || (p.upload && p.upload.ativo);
    if (needsPk && pks.length !== 1) {
      errors.push('Consulta por ID, alteração, exclusão e upload exigem exatamente uma chave primária marcada.');
    }
    if ((ops.alterar || ops.patch) && !campos.some((c) => c.alterar)) errors.push('Nenhum campo permitido para alteração.');
    if (ops.incluir && !campos.some((c) => c.incluir) && !pks.some((c) => c.auto)) errors.push('Nenhum campo permitido para inclusão.');
    const names = new Set(campos.map((c) => c.nome));
    const params = new Set();
    for (const f of p.filtros || []) {
      if (!names.has(f.campo)) errors.push(`Filtro com campo inexistente: ${f.campo}.`);
      if (!OPERATORS[f.operador]) errors.push(`Operador inválido no filtro ${f.parametro}.`);
      if (!API_NAME_RE.test(f.parametro || '')) errors.push(`Nome de parâmetro inválido: ${f.parametro}.`);
      if (RESERVED_PARAMS.has(f.parametro)) errors.push(`"${f.parametro}" é um parâmetro reservado.`);
      if (params.has(f.parametro)) errors.push(`Parâmetro de filtro duplicado: ${f.parametro}.`);
      params.add(f.parametro);
    }
    for (const o of p.ordens || []) if (!names.has(o.campo)) errors.push(`Ordenação com campo inexistente: ${o.campo}.`);
    if (ops.excluir && p.exclusao && p.exclusao.modo === 'LOGICA') {
      if (!names.has(p.exclusao.campo)) errors.push('Exclusão lógica: selecione o campo de status.');
      if (p.exclusao.valorExcluido === '' || p.exclusao.valorExcluido === undefined) errors.push('Exclusão lógica: informe o valor de excluído.');
    }
    const pg = p.paginacao || {};
    if (!(pg.padrao >= 1 && pg.max >= pg.padrao && pg.max <= 10000)) errors.push('Paginação inválida (padrão ≥ 1, máximo entre padrão e 10000).');
    if (p.upload && p.upload.ativo) {
      if (!(p.upload.tamanhoMaxMb >= 1 && p.upload.tamanhoMaxMb <= 1024)) errors.push('Upload: tamanho máximo deve estar entre 1 e 1024 MB.');
      if (!(p.upload.qtdMax >= 1 && p.upload.qtdMax <= 50)) errors.push('Upload: quantidade máxima entre 1 e 50.');
      if (!String(p.upload.extensoes || '').trim()) errors.push('Upload: informe as extensões permitidas.');
    }
    const dup = this.db.prepare('SELECT ID FROM GW_ENDPOINT WHERE SLUG = ? AND ID <> ?').get(p.slug, p.endpointId || 0);
    if (dup) errors.push(`Já existe um endpoint "${p.slug}".`);
    if (errors.length) throw vErr(errors[0], errors);
  }

  /** Grava a configuração completa (tabela, campos, endpoint, filtros, ordenação, permissões) em transação. */
  saveFull(p) {
    this.validate(p);
    const db = this.db;
    const tx = db.transaction(() => {
      let tabelaId = p.tabelaId;
      let endpointId = p.endpointId;
      if (endpointId) {
        const e = db.prepare('SELECT TABELA_ID FROM GW_ENDPOINT WHERE ID = ?').get(endpointId);
        if (!e) throw new GatewayError('NOT_FOUND', 'Endpoint não encontrado.');
        tabelaId = e.TABELA_ID;
        db.prepare(`UPDATE GW_TABELA SET BANCO_ID=?, ESQUEMA=?, NOME=?, TIPO_OBJETO=?, DESCRICAO=?, ATIVO=?,
          ATUALIZADO_EM=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE ID=?`)
          .run(p.bancoId, p.esquema || null, p.tabela, p.tipoObjeto || 'TABLE', p.descricao || null, b(p.ativo !== false), tabelaId);
      } else {
        tabelaId = db.prepare('INSERT INTO GW_TABELA (BANCO_ID, ESQUEMA, NOME, TIPO_OBJETO, DESCRICAO, ATIVO) VALUES (?,?,?,?,?,?)')
          .run(p.bancoId, p.esquema || null, p.tabela, p.tipoObjeto || 'TABLE', p.descricao || null, b(p.ativo !== false)).lastInsertRowid;
      }

      // Campos (upsert por nome físico; remove os que não vieram)
      const existing = new Map(db.prepare('SELECT ID, NOME FROM GW_CAMPO WHERE TABELA_ID = ?').all(tabelaId).map((r) => [r.NOME, r.ID]));
      // Evita conflito de UNIQUE(NOME_API) durante renomeações
      db.prepare("UPDATE GW_CAMPO SET NOME_API = '__tmp_' || ID WHERE TABELA_ID = ?").run(tabelaId);
      const campoIds = new Map();
      (p.campos || []).forEach((c, i) => {
        const vals = [c.nomeApi, c.descricao || null, c.tipoFisico || null, c.tipoLogico, c.tamanho ?? null, c.precisao ?? null,
          c.escala ?? null, b(c.nulo), b(c.pk), b(c.auto), c.padrao ?? null, c.ordem ?? i];
        if (existing.has(c.nome)) {
          const id = existing.get(c.nome);
          db.prepare(`UPDATE GW_CAMPO SET NOME_API=?, DESCRICAO=?, TIPO_FISICO=?, TIPO_LOGICO=?, TAMANHO=?, PRECISAO=?, ESCALA=?,
            NULO=?, PK=?, AUTO=?, VALOR_PADRAO=?, ORDEM=? WHERE ID=?`).run(...vals, id);
          campoIds.set(c.nome, id);
          existing.delete(c.nome);
        } else {
          const id = db.prepare(`INSERT INTO GW_CAMPO (NOME_API, DESCRICAO, TIPO_FISICO, TIPO_LOGICO, TAMANHO, PRECISAO, ESCALA,
            NULO, PK, AUTO, VALOR_PADRAO, ORDEM, TABELA_ID, NOME) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(...vals, tabelaId, c.nome).lastInsertRowid;
          campoIds.set(c.nome, Number(id));
        }
      });
      for (const id of existing.values()) db.prepare('DELETE FROM GW_CAMPO WHERE ID = ?').run(id);

      const ops = p.ops || {};
      const ex = p.exclusao || {};
      const up = p.upload || {};
      const pg = p.paginacao || {};
      const epVals = [
        p.slug, p.descricao || null, b(p.ativo !== false), b(p.publicar ?? p.publicado),
        b(ops.listar), b(ops.buscar), b(ops.incluir), b(ops.alterar), b(ops.patch), b(ops.excluir),
        ex.modo === 'LOGICA' ? 'LOGICA' : 'FISICA', ex.modo === 'LOGICA' ? campoIds.get(ex.campo) || null : null,
        ex.valorAtivo === '' ? null : ex.valorAtivo ?? null, ex.valorExcluido === '' ? null : ex.valorExcluido ?? null,
        pg.padrao || 50, pg.max || 500,
        b(up.ativo), up.extensoes || null, up.tamanhoMaxMb || 10, up.qtdMax || 5, up.diretorio || null,
        up.armazenamento === 'DB' ? 'DB' : 'FS', ['ORIGINAL', 'TIMESTAMP'].includes(up.padraoNome) ? up.padraoNome : 'UUID'
      ];
      if (endpointId) {
        db.prepare(`UPDATE GW_ENDPOINT SET SLUG=?, DESCRICAO=?, ATIVO=?, PUBLICADO=?, PERMITE_LISTAR=?, PERMITE_BUSCAR=?,
          PERMITE_INCLUIR=?, PERMITE_ALTERAR=?, PERMITE_PATCH=?, PERMITE_EXCLUIR=?, MODO_EXCLUSAO=?, CAMPO_EXCLUSAO_ID=?,
          VALOR_ATIVO=?, VALOR_EXCLUIDO=?, PAGE_SIZE_PADRAO=?, PAGE_SIZE_MAX=?, UPLOAD_ATIVO=?, UPLOAD_EXTENSOES=?,
          UPLOAD_TAMANHO_MAX_MB=?, UPLOAD_QTD_MAX=?, UPLOAD_DIRETORIO=?, UPLOAD_ARMAZENAMENTO=?, UPLOAD_PADRAO_NOME=?,
          ATUALIZADO_EM=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE ID=?`).run(...epVals, endpointId);
      } else {
        endpointId = Number(db.prepare(`INSERT INTO GW_ENDPOINT (SLUG, DESCRICAO, ATIVO, PUBLICADO, PERMITE_LISTAR, PERMITE_BUSCAR,
          PERMITE_INCLUIR, PERMITE_ALTERAR, PERMITE_PATCH, PERMITE_EXCLUIR, MODO_EXCLUSAO, CAMPO_EXCLUSAO_ID, VALOR_ATIVO,
          VALOR_EXCLUIDO, PAGE_SIZE_PADRAO, PAGE_SIZE_MAX, UPLOAD_ATIVO, UPLOAD_EXTENSOES, UPLOAD_TAMANHO_MAX_MB, UPLOAD_QTD_MAX,
          UPLOAD_DIRETORIO, UPLOAD_ARMAZENAMENTO, UPLOAD_PADRAO_NOME, TABELA_ID)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(...epVals, tabelaId).lastInsertRowid);
      }

      db.prepare('DELETE FROM GW_ENDPOINT_CAMPO WHERE ENDPOINT_ID = ?').run(endpointId);
      const insEc = db.prepare('INSERT INTO GW_ENDPOINT_CAMPO (ENDPOINT_ID, CAMPO_ID, RETORNAR, INCLUIR, ALTERAR, OBRIGATORIO) VALUES (?,?,?,?,?,?)');
      for (const c of p.campos || []) {
        insEc.run(endpointId, campoIds.get(c.nome), b(c.retornar), b(c.incluir && !(c.pk && c.auto)), b(c.alterar && !(c.pk && c.auto)), b(c.obrigatorio));
      }

      db.prepare('DELETE FROM GW_ENDPOINT_FILTRO WHERE ENDPOINT_ID = ?').run(endpointId);
      const insF = db.prepare('INSERT INTO GW_ENDPOINT_FILTRO (ENDPOINT_ID, CAMPO_ID, OPERADOR, PARAMETRO) VALUES (?,?,?,?)');
      for (const f of p.filtros || []) insF.run(endpointId, campoIds.get(f.campo), f.operador, f.parametro);

      db.prepare('DELETE FROM GW_ENDPOINT_ORDEM WHERE ENDPOINT_ID = ?').run(endpointId);
      const insO = db.prepare('INSERT INTO GW_ENDPOINT_ORDEM (ENDPOINT_ID, CAMPO_ID, PADRAO, DIRECAO_PADRAO) VALUES (?,?,?,?)');
      let hasDefault = false;
      for (const o of p.ordens || []) {
        const isDefault = !!o.padrao && !hasDefault;
        hasDefault = hasDefault || isDefault;
        insO.run(endpointId, campoIds.get(o.campo), b(isDefault), o.direcao === 'DESC' ? 'DESC' : 'ASC');
      }

      if (Array.isArray(p.permissoes)) {
        db.prepare('DELETE FROM GW_TOKEN_PERMISSAO WHERE ENDPOINT_ID = ?').run(endpointId);
        const insP = db.prepare(`INSERT INTO GW_TOKEN_PERMISSAO (TOKEN_ID, ENDPOINT_ID, LISTAR, BUSCAR, INCLUIR, ALTERAR, EXCLUIR, UPLOAD)
          VALUES (?,?,?,?,?,?,?,?)`);
        for (const x of p.permissoes) {
          if (!x.tokenId) continue;
          if (![x.listar, x.buscar, x.incluir, x.alterar, x.excluir, x.upload].some(Boolean)) continue;
          insP.run(x.tokenId, endpointId, b(x.listar), b(x.buscar), b(x.incluir), b(x.alterar), b(x.excluir), b(x.upload));
        }
      }
      return { endpointId, tabelaId: Number(tabelaId) };
    });
    return tx();
  }

  setPublished(id, published) {
    const r = this.db.prepare(`UPDATE GW_ENDPOINT SET PUBLICADO=?, ATUALIZADO_EM=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE ID=?`).run(b(published), id);
    if (!r.changes) throw new GatewayError('NOT_FOUND', 'Endpoint não encontrado.');
  }

  delete(id) {
    const e = this.db.prepare('SELECT TABELA_ID FROM GW_ENDPOINT WHERE ID = ?').get(id);
    if (!e) throw new GatewayError('NOT_FOUND', 'Endpoint não encontrado.');
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM GW_ENDPOINT WHERE ID = ?').run(id);
      const other = this.db.prepare('SELECT 1 FROM GW_ENDPOINT WHERE TABELA_ID = ?').get(e.TABELA_ID);
      if (!other) this.db.prepare('DELETE FROM GW_TABELA WHERE ID = ?').run(e.TABELA_ID);
    })();
  }

  /** Carrega a configuração de execução (usada pela API REST). */
  loadRuntime(slug) {
    const e = this.db.prepare(`
      SELECT e.*, t.ESQUEMA, t.NOME AS TABELA_NOME, t.DESCRICAO AS TABELA_DESCRICAO, t.ID AS TID, t.ATIVO AS TABELA_ATIVA,
             b.ID AS BID, b.NOME AS BANCO_NOME, b.TIPO AS BANCO_TIPO, b.ATIVO AS BANCO_ATIVO
      FROM GW_ENDPOINT e JOIN GW_TABELA t ON t.ID = e.TABELA_ID JOIN GW_BANCO b ON b.ID = t.BANCO_ID
      WHERE e.SLUG = ?`).get(slug);
    if (!e) return null;
    const campos = this.db.prepare(`
      SELECT c.*, ec.RETORNAR, ec.INCLUIR, ec.ALTERAR, ec.OBRIGATORIO
      FROM GW_CAMPO c JOIN GW_ENDPOINT_CAMPO ec ON ec.CAMPO_ID = c.ID AND ec.ENDPOINT_ID = ?
      ORDER BY c.ORDEM, c.ID`).all(e.ID).map((c) => ({
      id: c.ID, column: c.NOME, api: c.NOME_API, descricao: c.DESCRICAO, tipoFisico: c.TIPO_FISICO, tipo: c.TIPO_LOGICO,
      tamanho: c.TAMANHO, nulo: !!c.NULO, pk: !!c.PK, auto: !!c.AUTO, retornar: !!c.RETORNAR, incluir: !!c.INCLUIR,
      alterar: !!c.ALTERAR, obrigatorio: !!c.OBRIGATORIO
    }));
    const byId = new Map(campos.map((c) => [c.id, c]));
    const filtros = this.db.prepare('SELECT * FROM GW_ENDPOINT_FILTRO WHERE ENDPOINT_ID = ?').all(e.ID)
      .map((f) => ({ param: f.PARAMETRO, operador: f.OPERADOR, campo: byId.get(f.CAMPO_ID) })).filter((f) => f.campo);
    const ordens = this.db.prepare('SELECT * FROM GW_ENDPOINT_ORDEM WHERE ENDPOINT_ID = ? ORDER BY ID').all(e.ID)
      .map((o) => ({ campo: byId.get(o.CAMPO_ID), padrao: !!o.PADRAO, direcao: o.DIRECAO_PADRAO })).filter((o) => o.campo);
    const relacionamentos = this.db.prepare(`
      SELECT r.NOME, r.CARDINALIDADE, co.NOME_API AS ORIGEM_API, co.NOME AS ORIGEM_COL, cd.NOME AS DESTINO_COL,
             (SELECT SLUG FROM GW_ENDPOINT WHERE TABELA_ID = r.TABELA_DESTINO_ID ORDER BY ID LIMIT 1) AS DESTINO_SLUG
      FROM GW_RELACIONAMENTO r
      JOIN GW_CAMPO co ON co.ID = r.CAMPO_ORIGEM_ID
      JOIN GW_CAMPO cd ON cd.ID = r.CAMPO_DESTINO_ID
      WHERE r.TABELA_ORIGEM_ID = ? AND r.ATIVO = 1`).all(e.TID).map((r) => ({
      nome: r.NOME, cardinalidade: r.CARDINALIDADE, origemColumn: r.ORIGEM_COL, destinoColumn: r.DESTINO_COL, destinoSlug: r.DESTINO_SLUG
    }));
    const campoExclusao = e.CAMPO_EXCLUSAO_ID ? campos.find((c) => c.id === e.CAMPO_EXCLUSAO_ID) || null : null;
    return {
      id: e.ID,
      slug: e.SLUG,
      descricao: e.DESCRICAO || e.TABELA_DESCRICAO,
      ativo: !!e.ATIVO && !!e.TABELA_ATIVA && !!e.BANCO_ATIVO,
      publicado: !!e.PUBLICADO,
      ops: {
        listar: !!e.PERMITE_LISTAR, buscar: !!e.PERMITE_BUSCAR, incluir: !!e.PERMITE_INCLUIR,
        alterar: !!e.PERMITE_ALTERAR, patch: !!e.PERMITE_PATCH, excluir: !!e.PERMITE_EXCLUIR
      },
      exclusao: { modo: e.MODO_EXCLUSAO, campo: campoExclusao, valorAtivo: e.VALOR_ATIVO, valorExcluido: e.VALOR_EXCLUIDO },
      paginacao: { padrao: e.PAGE_SIZE_PADRAO, max: e.PAGE_SIZE_MAX },
      upload: {
        ativo: !!e.UPLOAD_ATIVO,
        extensoes: String(e.UPLOAD_EXTENSOES || '').split(/[,;\s]+/).map((x) => x.replace(/^\./, '').toLowerCase()).filter(Boolean),
        tamanhoMaxMb: e.UPLOAD_TAMANHO_MAX_MB, qtdMax: e.UPLOAD_QTD_MAX, diretorio: e.UPLOAD_DIRETORIO,
        armazenamento: e.UPLOAD_ARMAZENAMENTO, padraoNome: e.UPLOAD_PADRAO_NOME
      },
      tabela: { id: e.TID, schema: e.ESQUEMA, name: e.TABELA_NOME },
      banco: { id: e.BID, nome: e.BANCO_NOME, tipo: e.BANCO_TIPO },
      campos,
      pk: campos.find((c) => c.pk) || null,
      filtros,
      ordens,
      relacionamentos
    };
  }

  listPublishedSlugs() {
    return this.db.prepare('SELECT SLUG FROM GW_ENDPOINT WHERE PUBLICADO = 1 AND ATIVO = 1 ORDER BY SLUG').all().map((r) => r.SLUG);
  }
}

module.exports = { EndpointRepository, RESERVED_PARAMS };
