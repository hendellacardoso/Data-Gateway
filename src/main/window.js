'use strict';

const path = require('path');
const { BrowserWindow, shell, session, screen } = require('electron');

/** Tamanho mínimo da janela principal. */
const MIN_WIDTH = 1800;
const MIN_HEIGHT = 1020;

const isDev = process.env.NODE_ENV === 'development' && !!process.env.VITE_DEV_SERVER_URL;

function rendererUrl() {
  return isDev ? process.env.VITE_DEV_SERVER_URL : null;
}

function rendererFile() {
  return path.join(__dirname, '..', '..', 'dist', 'renderer', 'index.html');
}

/** Política de segurança de conteúdo do painel (somente produção; o Vite injeta scripts inline no dev). */
function applyCsp() {
  if (isDev) return;
  session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
    if (!details.url.startsWith('file://')) return cb({ responseHeaders: details.responseHeaders });
    cb({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'none'; object-src 'none'; base-uri 'none'; frame-src 'none'"
        ]
      }
    });
  });
}

/**
 * URL pertence ao próprio painel? (usado para bloquear navegação e validar a origem das chamadas IPC)
 *
 * Em produção a comparação é feita pelo caminho decodificado e sem diferenciar maiúsculas/minúsculas:
 * no Windows o mesmo arquivo pode aparecer com letra de unidade em outra caixa, com nome curto 8.3
 * (ex.: C:\Users\HENDEL~1\...) ou com codificação de URL diferente — especialmente na versão
 * portátil, que é extraída para a pasta temporária. Por isso aceitamos qualquer file:// que aponte
 * para ".../dist/renderer/index.html" dentro do pacote do aplicativo.
 */
function isTrustedUrl(url) {
  if (!url) return false;
  if (isDev) return url.startsWith(rendererUrl());
  let u;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol !== 'file:') return false;
  let pathname;
  try { pathname = decodeURIComponent(u.pathname); } catch { return false; }
  return pathname.replace(/\\/g, '/').toLowerCase().endsWith('/dist/renderer/index.html');
}

function createMainWindow({ show = true } = {}) {
  // Em monitores menores que o mínimo, limita à área útil da tela para a janela não ficar fora do monitor.
  const area = screen.getPrimaryDisplay().workArea;
  const minWidth = Math.min(MIN_WIDTH, area.width);
  const minHeight = Math.min(MIN_HEIGHT, area.height);
  // Já nasce com o tamanho da área útil do monitor, evitando "piscar" pequena antes de maximizar.
  const win = new BrowserWindow({
    x: area.x,
    y: area.y,
    width: area.width,
    height: area.height,
    minWidth,
    minHeight,
    show: false,
    title: 'Data Gateway',
    backgroundColor: '#0f172a',
    autoHideMenuBar: true,
    icon: path.join(__dirname, '..', '..', 'assets', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false,
      devTools: isDev
    }
  });

  // Nunca navegar para fora do painel; links externos vão para o navegador padrão.
  win.webContents.on('will-navigate', (e, url) => {
    if (!isTrustedUrl(url)) e.preventDefault();
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-attach-webview', (e) => e.preventDefault());

  if (isDev) win.loadURL(rendererUrl());
  else win.loadFile(rendererFile());

  // Abre ocupando toda a área útil do monitor (maximizada).
  win.once('ready-to-show', () => {
    if (show) {
      win.maximize();
      win.show();
    }
  });
  return win;
}

module.exports = { createMainWindow, applyCsp, isTrustedUrl, isDev };
