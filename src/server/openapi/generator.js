'use strict';

const { OPERATORS } = require('../query-builder/builder');

const TYPE_SCHEMA = {
  TEXTO: { type: 'string' },
  NUMERO: { type: 'number' },
  INTEIRO: { type: 'integer' },
  DECIMAL: { type: 'number' },
  BOOLEANO: { type: 'boolean' },
  DATA: { type: 'string', format: 'date' },
  DATAHORA: { type: 'string', format: 'date-time' },
  JSON: { type: 'object', additionalProperties: true },
  ARQUIVO: { type: 'string', format: 'byte' }
};

function fieldSchema(c) {
  const s = { ...TYPE_SCHEMA[c.tipo] };
  if (c.descricao) s.description = c.descricao;
  if (c.tipo === 'TEXTO' && c.tamanho) s.maxLength = c.tamanho;
  if (c.nulo) s.nullable = true;
  return s;
}

function schemaName(slug) {
  return slug.replace(/(^|[-_])(\w)/g, (_, __, ch) => ch.toUpperCase());
}

const errorRef = (desc) => ({ description: desc, content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } });

function buildOpenApi(endpoints, { serverUrl, version = '1.0.0', consultas = [] }) {
  const paths = {};
  const schemas = {
    Error: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: false },
        error: {
          type: 'object',
          properties: {
            code: { type: 'string', enum: ['AUTHENTICATION_ERROR', 'AUTHORIZATION_ERROR', 'VALIDATION_ERROR', 'NOT_FOUND', 'CONFLICT', 'DATABASE_ERROR', 'CONNECTION_ERROR', 'UPLOAD_ERROR', 'RATE_LIMIT', 'INTERNAL_ERROR'] },
            message: { type: 'string' },
            details: { type: 'array', items: { type: 'string' } }
          }
        }
      }
    },
    Pagination: {
      type: 'object',
      properties: { page: { type: 'integer' }, pageSize: { type: 'integer' }, total: { type: 'integer' }, totalPages: { type: 'integer' } }
    }
  };
  const tags = [];

  for (const ep of endpoints) {
    const name = schemaName(ep.slug);
    const tag = ep.slug;
    tags.push({ name: tag, description: ep.descricao || '' });
    const props = {};
    for (const c of ep.campos.filter((x) => x.retornar)) props[c.api] = fieldSchema(c);
    for (const r of ep.relacionamentos) {
      props[r.nome] = r.cardinalidade === 'UM'
        ? { type: 'object', nullable: true, description: `Relacionamento (use ?expand=${r.nome})` }
        : { type: 'array', items: { type: 'object' }, description: `Relacionamento (use ?expand=${r.nome})` };
    }
    schemas[name] = { type: 'object', properties: props };

    const inProps = {};
    const required = [];
    for (const c of ep.campos.filter((x) => x.incluir)) {
      inProps[c.api] = fieldSchema(c);
      if (c.obrigatorio) required.push(c.api);
    }
    schemas[name + 'Input'] = { type: 'object', properties: inProps, required: required.length ? required : undefined, additionalProperties: false };
    const upProps = {};
    const upRequired = [];
    for (const c of ep.campos.filter((x) => x.alterar)) {
      upProps[c.api] = fieldSchema(c);
      if (c.obrigatorio) upRequired.push(c.api);
    }
    schemas[name + 'Update'] = { type: 'object', properties: upProps, required: upRequired.length ? upRequired : undefined, additionalProperties: false };
    schemas[name + 'Patch'] = { type: 'object', properties: upProps, additionalProperties: false };

    const single = { description: 'OK', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, data: { $ref: `#/components/schemas/${name}` } } } } } };
    const base = `/api/v1/${ep.slug}`;
    const pkName = ep.pk ? ep.pk.api : 'id';
    const idParam = { name: 'id', in: 'path', required: true, description: `Chave primária (${pkName})`, schema: ep.pk ? TYPE_SCHEMA[ep.pk.tipo] : { type: 'string' } };
    const expandParam = ep.relacionamentos.length
      ? [{ name: 'expand', in: 'query', description: 'Relacionamentos a incluir, separados por vírgula: ' + ep.relacionamentos.map((r) => r.nome).join(', '), schema: { type: 'string' } }]
      : [];
    const commonErr = { 401: errorRef('Não autenticado'), 403: errorRef('Sem permissão'), 429: errorRef('Limite de requisições'), 500: errorRef('Erro interno') };

    paths[base] = {};
    if (ep.ops.listar) {
      const params = [
        { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } },
        { name: 'pageSize', in: 'query', schema: { type: 'integer', minimum: 1, maximum: ep.paginacao.max, default: ep.paginacao.padrao } }
      ];
      if (ep.ordens.length) {
        params.push({ name: 'sort', in: 'query', schema: { type: 'string', enum: ep.ordens.map((o) => o.campo.api) } });
        params.push({ name: 'direction', in: 'query', schema: { type: 'string', enum: ['asc', 'desc'] } });
      }
      for (const f of ep.filtros) {
        params.push({
          name: f.param, in: 'query',
          description: `Filtro em ${f.campo.api} — operador: ${OPERATORS[f.operador].label}${f.operador === 'in' ? ' (valores separados por vírgula)' : ''}`,
          schema: f.operador === 'isNull' ? { type: 'boolean' } : (f.operador === 'in' ? { type: 'string' } : TYPE_SCHEMA[f.campo.tipo])
        });
      }
      params.push(...expandParam);
      paths[base].get = {
        tags: [tag], summary: `Consulta ${ep.descricao || ep.slug}`, operationId: `list_${ep.slug}`, parameters: params,
        responses: {
          200: { description: 'OK', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, data: { type: 'array', items: { $ref: `#/components/schemas/${name}` } }, pagination: { $ref: '#/components/schemas/Pagination' } } } } } },
          400: errorRef('Parâmetros inválidos'), ...commonErr
        }
      };
    }
    if (ep.ops.incluir) {
      paths[base].post = {
        tags: [tag], summary: `Inclui registro em ${ep.slug}`, operationId: `create_${ep.slug}`,
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: `#/components/schemas/${name}Input` } } } },
        responses: { 201: { ...single, description: 'Criado' }, 400: errorRef('Validação'), 409: errorRef('Conflito'), ...commonErr }
      };
    }
    if (!Object.keys(paths[base]).length) delete paths[base];

    const item = {};
    if (ep.ops.buscar) {
      item.get = { tags: [tag], summary: `Consulta ${ep.slug} por ID`, operationId: `get_${ep.slug}`, parameters: [idParam, ...expandParam], responses: { 200: single, 404: errorRef('Não encontrado'), ...commonErr } };
    }
    if (ep.ops.alterar) {
      item.put = { tags: [tag], summary: `Altera registro de ${ep.slug}`, operationId: `update_${ep.slug}`, parameters: [idParam],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: `#/components/schemas/${name}Update` } } } },
        responses: { 200: single, 400: errorRef('Validação'), 404: errorRef('Não encontrado'), 409: errorRef('Conflito'), ...commonErr } };
    }
    if (ep.ops.patch) {
      item.patch = { tags: [tag], summary: `Altera parcialmente registro de ${ep.slug}`, operationId: `patch_${ep.slug}`, parameters: [idParam],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: `#/components/schemas/${name}Patch` } } } },
        responses: { 200: single, 400: errorRef('Validação'), 404: errorRef('Não encontrado'), ...commonErr } };
    }
    if (ep.ops.excluir) {
      item.delete = { tags: [tag], summary: `Exclui registro de ${ep.slug}${ep.exclusao.modo === 'LOGICA' ? ' (exclusão lógica)' : ''}`, operationId: `delete_${ep.slug}`, parameters: [idParam],
        responses: { 200: { description: 'Excluído' }, 404: errorRef('Não encontrado'), 409: errorRef('Conflito'), ...commonErr } };
    }
    if (Object.keys(item).length) paths[`${base}/{id}`] = item;

    if (ep.upload.ativo) {
      paths[`${base}/{id}/arquivos`] = {
        post: {
          tags: [tag], summary: `Upload de arquivos (${ep.upload.extensoes.join(', ')}; máx. ${ep.upload.tamanhoMaxMb} MB; até ${ep.upload.qtdMax} por envio)`,
          operationId: `upload_${ep.slug}`, parameters: [idParam],
          requestBody: { required: true, content: { 'multipart/form-data': { schema: { type: 'object', properties: { arquivos: { type: 'array', items: { type: 'string', format: 'binary' } } } } } } },
          responses: { 201: { description: 'Arquivos recebidos' }, 400: errorRef('Arquivo inválido'), 404: errorRef('Registro não encontrado'), 413: errorRef('Arquivo muito grande'), ...commonErr }
        },
        get: { tags: [tag], summary: 'Lista arquivos do registro', operationId: `listfiles_${ep.slug}`, parameters: [idParam], responses: { 200: { description: 'OK' }, ...commonErr } }
      };
      paths[`${base}/{id}/arquivos/{arquivoId}`] = {
        get: { tags: [tag], summary: 'Download de arquivo', operationId: `download_${ep.slug}`,
          parameters: [idParam, { name: 'arquivoId', in: 'path', required: true, schema: { type: 'integer' } }],
          responses: { 200: { description: 'Conteúdo do arquivo' }, 404: errorRef('Não encontrado'), ...commonErr } }
      };
    }
  }

  if (consultas.length) {
    tags.push({ name: 'consultas', description: 'Consultas SQL personalizadas (somente leitura)' });
    const PARAM_SCHEMA = { ...TYPE_SCHEMA };
    for (const c of consultas) {
      const params = [
        ...c.parametros.map((p) => ({
          name: p.nome, in: 'query', required: !!p.obrigatorio && (p.padrao === null || p.padrao === undefined || p.padrao === ''),
          description: [p.descricao, p.padrao ? `Padrão: ${p.padrao}` : ''].filter(Boolean).join(' — ') || undefined,
          schema: PARAM_SCHEMA[p.tipo] || { type: 'string' }
        })),
        { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } },
        { name: 'pageSize', in: 'query', schema: { type: 'integer', minimum: 1, maximum: c.paginacao.max, default: c.paginacao.padrao } }
      ];
      paths[`/api/v1/consultas/${c.slug}`] = {
        get: {
          tags: ['consultas'],
          summary: c.nome + (c.descricao ? ' — ' + c.descricao : ''),
          operationId: `consulta_${c.slug.replace(/-/g, '_')}`,
          parameters: params,
          responses: {
            200: {
              description: 'OK',
              content: { 'application/json': { schema: { type: 'object', properties: {
                success: { type: 'boolean' },
                data: { type: 'array', items: { type: 'object', additionalProperties: true } },
                pagination: { type: 'object', properties: {
                  page: { type: 'integer' }, pageSize: { type: 'integer' }, total: { type: 'integer', nullable: true },
                  totalPages: { type: 'integer', nullable: true }, hasMore: { type: 'boolean' }
                } }
              } } } }
            },
            400: errorRef('Parâmetros inválidos'), 401: errorRef('Não autenticado'), 403: errorRef('Sem permissão'),
            404: errorRef('Não encontrada'), 429: errorRef('Limite de requisições'), 500: errorRef('Erro interno')
          }
        }
      };
    }
  }

  return {
    openapi: '3.0.3',
    info: {
      title: 'Data Gateway API',
      version,
      description: 'APIs REST geradas automaticamente pelo Data Gateway. Autentique com o cabeçalho `Authorization: Bearer <token>`.'
    },
    servers: [{ url: serverUrl }],
    tags,
    security: [{ bearerAuth: [] }],
    components: {
      securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } },
      schemas
    },
    paths
  };
}

module.exports = { buildOpenApi };
