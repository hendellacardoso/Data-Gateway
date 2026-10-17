'use strict';

const path = require('path');
const { Tray, Menu, nativeImage } = require('electron');

/**
 * Ícone e menu do System Tray.
 * @param {object} actions { openPanel(route?), openDocs(), restart(), stop(), start(), toggleAutoStart(), quit(), getState() }
 */
function createTray(actions) {
  const iconPath = path.join(__dirname, '..', '..', 'assets', 'tray.png');
  const image = nativeImage.createFromPath(iconPath);
  const tray = new Tray(image.isEmpty() ? nativeImage.createEmpty() : image.resize({ width: 16, height: 16 }));
  tray.setToolTip('Data Gateway');
  tray.on('double-click', () => actions.openPanel());
  tray.on('click', () => actions.openPanel());

  function refresh() {
    const st = actions.getState();
    const running = st.server.running;
    tray.setToolTip(`Data Gateway — ${running ? 'serviço ativo em ' + st.server.url : 'serviço parado'}`);
    const menu = Menu.buildFromTemplate([
      { label: 'Data Gateway', enabled: false },
      { type: 'separator' },
      { label: running ? '●  Serviço ativo' : '○  Serviço parado', enabled: false },
      ...(st.server.error ? [{ label: '⚠ ' + st.server.error, enabled: false }] : []),
      { type: 'separator' },
      { label: 'Abrir painel', click: () => actions.openPanel() },
      { label: 'Abrir documentação', enabled: running, click: () => actions.openDocs() },
      { label: 'Logs', click: () => actions.openPanel('/monitoramento/logs') },
      { label: 'Configurações', click: () => actions.openPanel('/sistema/configuracoes') },
      { type: 'separator' },
      running
        ? { label: 'Reiniciar serviço', click: () => actions.restart() }
        : { label: 'Iniciar serviço', click: () => actions.start() },
      { label: 'Parar serviço', enabled: running, click: () => actions.stop() },
      { type: 'separator' },
      { label: 'Sobre o Data Gateway', click: () => actions.openPanel('/sistema/sobre') },
      { type: 'separator' },
      { label: 'Iniciar com Windows', type: 'checkbox', checked: !!st.autoStart, click: (item) => actions.toggleAutoStart(item.checked) },
      { type: 'separator' },
      { label: 'Sair', click: () => actions.quit() }
    ]);
    tray.setContextMenu(menu);
  }

  refresh();
  return { tray, refresh };
}

module.exports = { createTray };
