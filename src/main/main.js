'use strict';

const path = require('path');
const { app, safeStorage, shell, dialog } = require('electron');

// Desenvolvimento usa uma pasta de dados separada da versão instalada/portátil,
// para que testes não criem usuários, conexões e tokens no ambiente real.
//   Produção:        %APPDATA%\Data Gateway
//   Desenvolvimento: %APPDATA%\Data Gateway (Dev)
if (!app.isPackaged) {
  app.setPath('userData', path.join(app.getPath('appData'), 'Data Gateway (Dev)'));
}

if (!process.env.NODE_ENV) process.env.NODE_ENV = app.isPackaged ? 'production' : 'development';

const { createContext } = require('../server/context');
const { GatewayServer } = require('../server/server');
const { createAdmin } = require('../server/admin');
const { createMainWindow, applyCsp } = require('./window');
const { createTray } = require('./tray');
const { registerIpc } = require('./ipc/handlers');
const { applyLoginItem, getLoginItem } = require('./services/startup');

const START_HIDDEN = process.argv.includes('--hidden');

let ctx;
let server;
let win = null;
let trayCtl = null;
let quitting = false;

// Uma única instância: abrir de novo apenas traz a janela existente.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => openPanel());
  app.whenReady().then(bootstrap).catch((err) => {
    dialog.showErrorBox('Data Gateway', 'Falha ao iniciar: ' + err.message);
    app.exit(1);
  });
}

app.setAppUserModelId('com.datagateway.desktop');

function openPanel(route) {
  if (!win || win.isDestroyed()) {
    win = createMainWindow({ show: true });
    wireWindow(win);
  } else {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }
  if (route) {
    const send = () => win.webContents.send('gw:navigate', route);
    if (win.webContents.isLoading()) win.webContents.once('did-finish-load', send);
    else send();
  }
}

function wireWindow(w) {
  w.on('close', (e) => {
    if (!quitting && ctx.config.get('app').minimizarTray) {
      e.preventDefault();
      w.hide();
    }
  });
  w.on('closed', () => {
    if (w === win) win = null;
  });
}

function broadcastStatus() {
  if (win && !win.isDestroyed()) win.webContents.send('gw:server-status', server.status());
  if (trayCtl) trayCtl.refresh();
}

async function serverControl(action) {
  try {
    if (action === 'start') await server.start();
    else if (action === 'stop') await server.stop();
    else if (action === 'restart') await server.restart();
  } catch (err) {
    // estado de erro já registrado em server.status()
  }
  return server.status();
}

async function bootstrap() {
  applyCsp();
  const dataDir = app.getPath('userData');
  ctx = createContext({ dataDir, electronSafeStorage: safeStorage, version: app.getVersion() });
  server = new GatewayServer(ctx);
  server.onChange(broadcastStatus);

  const admin = createAdmin(ctx, {
    serverStatus: () => server.status(),
    serverControl,
    onConfigSaved: async (section, value) => {
      if (section === 'app') applyLoginItem(value.iniciarComWindows);
      if (section === 'api' && server.status().running) await serverControl('restart');
      if (trayCtl) trayCtl.refresh();
    }
  });

  registerIpc({ admin, ctx, getServerUrl: () => server.status().url });

  const appCfg = ctx.config.get('app');
  applyLoginItem(appCfg.iniciarComWindows);

  trayCtl = createTray({
    getState: () => ({ server: server.status(), autoStart: getLoginItem() }),
    openPanel,
    openDocs: () => server.status().url && shell.openExternal(server.status().url + '/docs'),
    start: () => serverControl('start'),
    stop: () => serverControl('stop'),
    restart: () => serverControl('restart'),
    toggleAutoStart: (checked) => {
      ctx.config.set('app', { iniciarComWindows: checked });
      applyLoginItem(checked);
      ctx.logger.audit({ acao: 'CONFIG_ALTERADA', entidade: 'CONFIG', entidadeId: 'app', detalhes: { iniciarComWindows: checked }, origem: 'TRAY' });
      trayCtl.refresh();
    },
    quit: () => {
      quitting = true;
      app.quit();
    }
  });

  if (appCfg.iniciarServicoAuto) await serverControl('start');

  if (!START_HIDDEN) openPanel();
}

// Com o Tray ativo, fechar todas as janelas não encerra o aplicativo.
app.on('window-all-closed', () => {
  if (!ctx || !ctx.config.get('app').minimizarTray) {
    quitting = true;
    app.quit();
  }
});

app.on('before-quit', () => {
  quitting = true;
});

let shuttingDown = false;
app.on('will-quit', (e) => {
  if (shuttingDown || !ctx) return;
  e.preventDefault();
  shuttingDown = true;
  Promise.resolve()
    .then(() => server && server.stop())
    .then(() => ctx.close())
    .catch(() => {})
    .finally(() => app.exit(0));
});
