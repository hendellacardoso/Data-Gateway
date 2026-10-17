'use strict';

const { app } = require('electron');

/** Inicialização automática com o Windows (inicia minimizado no Tray). */
function applyLoginItem(enabled) {
  if (!app.isPackaged) return; // em desenvolvimento não registra o electron.exe na inicialização
  app.setLoginItemSettings({
    openAtLogin: !!enabled,
    path: process.execPath,
    args: ['--hidden']
  });
}

function getLoginItem() {
  if (!app.isPackaged) return false;
  return app.getLoginItemSettings({ path: process.execPath, args: ['--hidden'] }).openAtLogin;
}

module.exports = { applyLoginItem, getLoginItem };
