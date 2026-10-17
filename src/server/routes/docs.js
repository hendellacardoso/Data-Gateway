'use strict';

const express = require('express');
const { buildOpenApi } = require('../openapi/generator');

function swaggerDir() {
  try {
    return require('swagger-ui-dist').getAbsoluteFSPath().replace(/app\.asar(?!\.unpacked)/, 'app.asar.unpacked');
  } catch {
    return null;
  }
}

const DOCS_HTML = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><title>Data Gateway — Documentação da API</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="/docs/assets/swagger-ui.css">
<style>body{margin:0;background:#fafafa}.topbar{display:none}</style></head>
<body><div id="swagger-ui"></div>
<script src="/docs/assets/swagger-ui-bundle.js"></script>
<script src="/docs/init.js"></script>
</body></html>`;

const INIT_JS = `window.ui = SwaggerUIBundle({ url: '/openapi.json', dom_id: '#swagger-ui', deepLinking: true, persistAuthorization: false });`;

function isLocal(req) {
  const ip = String(req.socket.remoteAddress || '');
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

function createDocsRouter(ctx) {
  const router = express.Router();

  router.use(['/docs', '/openapi.json'], (req, res, next) => {
    if (ctx.config.get('api').docsPublicas || isLocal(req)) return next();
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Documentação disponível somente localmente.', details: [] } });
  });

  router.get('/openapi.json', (req, res) => {
    res.json(ctx.buildSpec(`${req.protocol}://${req.get('host')}`));
  });

  const dir = swaggerDir();
  if (dir) router.use('/docs/assets', express.static(dir, { index: false }));
  router.get('/docs/init.js', (req, res) => res.type('application/javascript').send(INIT_JS));
  router.get(['/docs', '/docs/'], (req, res) => {
    res.removeHeader('X-Frame-Options');
    res.type('html').send(DOCS_HTML);
  });
  return router;
}

/** Monta a especificação OpenAPI a partir dos endpoints publicados. */
function makeSpecBuilder(ctx) {
  return (serverUrl) => {
    const eps = ctx.endpoints.listPublishedSlugs().map((s) => ctx.metadata.get(s)).filter(Boolean);
    const consultas = ctx.consultas ? ctx.consultas.listPublishedSlugs().map((s) => ctx.consultas.loadRuntime(s)).filter(Boolean) : [];
    return buildOpenApi(eps, { serverUrl, version: ctx.version, consultas });
  };
}

module.exports = { createDocsRouter, makeSpecBuilder };
