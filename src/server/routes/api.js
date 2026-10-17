'use strict';

const express = require('express');
const { GatewayError } = require('../errors');
const { sendError } = require('../middleware/common');

/**
 * Rotas dinâmicas /api/v1/:endpoint.
 * As rotas não são registradas por tabela: cada requisição é resolvida contra a configuração
 * publicada (whitelist). Endpoints/operações não configurados retornam 404/405.
 */
function createApiRouter(ctx) {
  const { metadata, tokenAuth, crud, uploads, logger, consultas, consultaService } = ctx;
  const router = express.Router();

  const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((err) => sendError(res, err));

  function authenticate(req, res) {
    if (req.query.token !== undefined || req.query.access_token !== undefined || req.query.api_key !== undefined) {
      throw new GatewayError('AUTHENTICATION_ERROR', 'Nunca envie o token pela URL. Use o cabeçalho Authorization: Bearer <token>.', { status: 400 });
    }
    const token = tokenAuth.authenticate(req.headers.authorization);
    res.locals.gw.token = token;
    return token;
  }

  function resolve(req, res) {
    const ep = metadata.get(req.params.slug);
    if (!ep || !ep.publicado || !ep.ativo) throw new GatewayError('NOT_FOUND', 'Endpoint não encontrado.');
    res.locals.gw.banco = ep.banco.nome;
    res.locals.gw.tabela = ep.tabela.name;
    return ep;
  }

  function guard(ep, token, res, { op, enabled, perm, allow }) {
    res.locals.gw.operacao = op;
    if (!enabled) {
      const err = new GatewayError('METHOD_NOT_ALLOWED', 'Operação não disponível neste endpoint.');
      err.allow = allow;
      throw err;
    }
    tokenAuth.require(token, ep.id, perm);
  }

  function requireJson(req) {
    if (!req.is('application/json')) {
      throw new GatewayError('VALIDATION_ERROR', 'Content-Type deve ser application/json.', { status: 415 });
    }
  }

  const allowCollection = (ep) => [ep.ops.listar && 'GET', ep.ops.incluir && 'POST'].filter(Boolean).join(', ');
  const allowItem = (ep) => [ep.ops.buscar && 'GET', ep.ops.alterar && 'PUT', ep.ops.patch && 'PATCH', ep.ops.excluir && 'DELETE'].filter(Boolean).join(', ');

  function audit(req, token, acao, ep, id, detalhes) {
    logger.audit({ origem: 'API', usuario: token.nome, acao, entidade: ep.slug, entidadeId: id, detalhes, ip: req.ip });
  }

  // ---------- Consultas SQL personalizadas (somente leitura) ----------
  router.all('/consultas/:cslug', wrap(async (req, res) => {
    const token = authenticate(req, res);
    const c = consultas.loadRuntime(String(req.params.cslug).toLowerCase());
    if (!c || !c.publicado || !c.ativo) throw new GatewayError('NOT_FOUND', 'Consulta não encontrada.');
    res.locals.gw.banco = c.banco.nome;
    res.locals.gw.tabela = 'consulta:' + c.slug;
    res.locals.gw.operacao = 'CONSULTA_SQL';
    if (req.method !== 'GET') {
      const err = new GatewayError('METHOD_NOT_ALLOWED', 'Consultas aceitam somente GET.');
      err.allow = 'GET';
      throw err;
    }
    tokenAuth.requireConsulta(token, c.id);
    const values = consultaService.resolveValues(c, req.query, true);
    const pg = consultaService.parsePage(c, req.query);
    const r = await consultaService.execute(c, values, pg);
    return res.json({ success: true, data: r.data, pagination: r.pagination });
  }));

  // ---------- Coleção ----------
  router.all('/:slug', wrap(async (req, res) => {
    const token = authenticate(req, res);
    const ep = resolve(req, res);
    if (req.method === 'GET') {
      guard(ep, token, res, { op: 'CONSULTA', enabled: ep.ops.listar, perm: 'listar', allow: allowCollection(ep) });
      const result = await crud.list(ep, req.query, token);
      return res.json({ success: true, ...result });
    }
    if (req.method === 'POST') {
      guard(ep, token, res, { op: 'INCLUSAO', enabled: ep.ops.incluir, perm: 'incluir', allow: allowCollection(ep) });
      requireJson(req);
      const result = await crud.create(ep, req.body);
      audit(req, token, 'INCLUSAO', ep, result.id, { campos: Object.keys(req.body || {}) });
      return res.status(201).json({ success: true, data: result.data });
    }
    guard(ep, token, res, { op: req.method, enabled: false, allow: allowCollection(ep) });
  }));

  // ---------- Registro ----------
  router.all('/:slug/:id', wrap(async (req, res) => {
    const token = authenticate(req, res);
    const ep = resolve(req, res);
    const id = req.params.id;
    switch (req.method) {
      case 'GET': {
        guard(ep, token, res, { op: 'CONSULTA_ID', enabled: ep.ops.buscar, perm: 'buscar', allow: allowItem(ep) });
        return res.json({ success: true, data: await crud.get(ep, id, req.query, token) });
      }
      case 'PUT':
      case 'PATCH': {
        const partial = req.method === 'PATCH';
        guard(ep, token, res, { op: 'ALTERACAO', enabled: partial ? ep.ops.patch : ep.ops.alterar, perm: 'alterar', allow: allowItem(ep) });
        requireJson(req);
        const result = await crud.update(ep, id, req.body, partial);
        audit(req, token, 'ALTERACAO', ep, result.id, { campos: Object.keys(req.body || {}), metodo: req.method });
        return res.json({ success: true, data: result.data });
      }
      case 'DELETE': {
        guard(ep, token, res, { op: 'EXCLUSAO', enabled: ep.ops.excluir, perm: 'excluir', allow: allowItem(ep) });
        const result = await crud.remove(ep, id);
        audit(req, token, 'EXCLUSAO', ep, result.id, { modo: result.modo });
        return res.json({ success: true, data: { id: result.id, deleted: true, mode: result.modo === 'LOGICA' ? 'logical' : 'physical' } });
      }
      default:
        guard(ep, token, res, { op: req.method, enabled: false, allow: allowItem(ep) });
    }
  }));

  // ---------- Arquivos ----------
  router.all('/:slug/:id/arquivos', wrap(async (req, res) => {
    const token = authenticate(req, res);
    const ep = resolve(req, res);
    if (req.method === 'POST') {
      guard(ep, token, res, { op: 'UPLOAD', enabled: ep.upload.ativo, perm: 'upload', allow: 'GET, POST' });
      if (!req.is('multipart/form-data')) throw new GatewayError('UPLOAD_ERROR', 'Envie os arquivos como multipart/form-data.', { status: 415 });
      const recordId = await crud.ensureExists(ep, req.params.id);
      await uploads.middleware(ep)(req, res);
      const saved = await uploads.store(ep, recordId, req.files, token);
      audit(req, token, 'UPLOAD', ep, recordId, { arquivos: saved.map((s) => ({ id: s.id, nome: s.nome, tamanho: s.tamanho })) });
      return res.status(201).json({ success: true, data: saved });
    }
    if (req.method === 'GET') {
      guard(ep, token, res, { op: 'LISTA_ARQUIVOS', enabled: ep.upload.ativo, perm: 'buscar', allow: 'GET, POST' });
      const recordId = await crud.ensureExists(ep, req.params.id);
      return res.json({ success: true, data: uploads.list(ep, recordId) });
    }
    guard(ep, token, res, { op: req.method, enabled: false, allow: 'GET, POST' });
  }));

  router.get('/:slug/:id/arquivos/:arquivoId', wrap(async (req, res) => {
    const token = authenticate(req, res);
    const ep = resolve(req, res);
    guard(ep, token, res, { op: 'DOWNLOAD', enabled: ep.upload.ativo, perm: 'buscar', allow: 'GET' });
    const recordId = await crud.ensureExists(ep, req.params.id);
    const file = uploads.get(ep, recordId, req.params.arquivoId);
    res.set('Content-Type', file.MIME || 'application/octet-stream');
    res.set('Content-Disposition', `attachment; filename="${file.NOME_ORIGINAL.replace(/"/g, '')}"`);
    if (file.CONTEUDO) return res.send(file.CONTEUDO);
    return res.sendFile(file.CAMINHO, (err) => {
      if (err && !res.headersSent) sendError(res, new GatewayError('NOT_FOUND', 'Arquivo não encontrado no disco.'));
    });
  }));

  router.all('*', (req, res) => sendError(res, new GatewayError('NOT_FOUND', 'Endpoint não encontrado.')));

  return router;
}

module.exports = { createApiRouter };
