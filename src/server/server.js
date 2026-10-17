'use strict';

const fs = require('fs');
const http = require('http');
const https = require('https');
const express = require('express');
const { createApiRouter } = require('./routes/api');
const { createDocsRouter } = require('./routes/docs');
const { securityHeaders, cors, requestLog, rateLimiter, errorHandler, sendError } = require('./middleware/common');
const { GatewayError } = require('./errors');

function buildApp(ctx) {
  const app = express();
  const apiCfg = () => ctx.config.get('api');
  app.disable('x-powered-by');
  app.set('trust proxy', false);
  app.set('query parser', 'simple');

  app.use(securityHeaders);
  app.get('/health', (req, res) => res.json({ success: true, status: 'online', version: ctx.version }));
  app.use(createDocsRouter(ctx));

  app.use('/api', requestLog(ctx.logger));
  app.use('/api', cors(apiCfg));
  app.use('/api', rateLimiter(apiCfg));
  app.use('/api', express.json({ limit: `${apiCfg().bodyLimitKb}kb`, strict: true }));
  app.use('/api/v1', createApiRouter(ctx));
  app.use('/api', (req, res) => sendError(res, new GatewayError('NOT_FOUND', 'Versão da API não encontrada. Use /api/v1.')));

  app.use((req, res) => res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Recurso não encontrado.', details: [] } }));
  app.use(errorHandler);
  return app;
}

/** Controla o ciclo de vida do servidor HTTP(S) da API. */
class GatewayServer {
  constructor(ctx) {
    this.ctx = ctx;
    this.server = null;
    this.state = { running: false, startedAt: null, error: null, url: null };
    this.listeners = new Set();
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit() {
    for (const fn of this.listeners) {
      try { fn(this.status()); } catch { /* ignore */ }
    }
  }

  status() {
    return { ...this.state };
  }

  async start() {
    if (this.server) return this.status();
    const cfg = this.ctx.config.get('api');
    const app = buildApp(this.ctx);
    let server;
    try {
      if (cfg.https) {
        if (!cfg.certPath || !cfg.keyPath) throw new Error('HTTPS habilitado, mas certificado/chave não configurados.');
        server = https.createServer({ cert: fs.readFileSync(cfg.certPath), key: fs.readFileSync(cfg.keyPath) }, app);
      } else {
        server = http.createServer(app);
      }
      server.requestTimeout = (cfg.timeoutMs || 30000) + 10000;
      server.headersTimeout = 20000;
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(cfg.port, cfg.host, () => {
          server.off('error', reject);
          resolve();
        });
      });
    } catch (err) {
      this.state = { running: false, startedAt: null, error: err.code === 'EADDRINUSE' ? `A porta ${cfg.port} já está em uso.` : err.message, url: null };
      this.emit();
      throw err;
    }
    this.server = server;
    const host = cfg.host === '0.0.0.0' ? '127.0.0.1' : cfg.host;
    this.state = { running: true, startedAt: new Date().toISOString(), error: null, url: `${cfg.https ? 'https' : 'http'}://${host}:${cfg.port}` };
    this.emit();
    return this.status();
  }

  async stop() {
    if (!this.server) return this.status();
    const s = this.server;
    this.server = null;
    await new Promise((resolve) => {
      s.close(() => resolve());
      if (s.closeAllConnections) s.closeAllConnections();
    });
    this.state = { running: false, startedAt: null, error: null, url: null };
    this.emit();
    return this.status();
  }

  async restart() {
    await this.stop();
    await this.ctx.connections.closeAll();
    this.ctx.invalidate();
    return this.start();
  }
}

module.exports = { GatewayServer, buildApp };
