'use strict';

const path = require('path');
const { openInternalDatabase } = require('../database/connection');
const { ConfigRepository } = require('../database/repositories/configRepository');
const { EndpointRepository } = require('../database/repositories/endpointRepository');
const { ConnectionManager } = require('./services/connectionManager');
const { MetadataService } = require('./services/metadataService');
const { CrudService } = require('./services/crudService');
const { TokenAuth } = require('./authentication/tokenAuth');
const { UploadService } = require('./uploads/uploadService');
const { GatewayLogger } = require('./logging/logger');
const { makeSpecBuilder } = require('./routes/docs');
const secrets = require('./security/secrets');

/**
 * Cria o contexto compartilhado entre o servidor REST e o painel (IPC).
 * @param {{dataDir: string, electronSafeStorage?: object, version?: string}} opts
 */
function createContext({ dataDir, electronSafeStorage, version = '1.0.0' }) {
  secrets.init({ dataDir, electronSafeStorage });
  const db = openInternalDatabase(dataDir);
  const ctx = { dataDir, version, db };
  ctx.config = new ConfigRepository(db);
  ctx.endpoints = new EndpointRepository(db);
  ctx.logger = new GatewayLogger(db);
  ctx.connections = new ConnectionManager(db, ctx.config);
  ctx.metadata = new MetadataService(ctx.endpoints);
  ctx.tokenAuth = new TokenAuth(db);
  ctx.crud = new CrudService({ connections: ctx.connections, metadata: ctx.metadata, permissions: ctx.tokenAuth });
  ctx.uploads = new UploadService({ db, dataDir });
  ctx.buildSpec = makeSpecBuilder(ctx);
  ctx.paths = { dataDir, db: path.join(dataDir, 'data-gateway.db'), uploads: path.join(dataDir, 'uploads') };

  /** Chamado pelo painel sempre que a configuração muda. */
  ctx.invalidate = () => ctx.metadata.invalidate();

  ctx.close = async () => {
    await ctx.connections.closeAll();
    db.close();
  };

  ctx.logger.purge(ctx.config.get('logs'));
  return ctx;
}

module.exports = { createContext };
