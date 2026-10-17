'use strict';

const fs = require('fs');
const path = require('path');
const { app, ipcMain, dialog, shell, BrowserWindow } = require('electron');
const { toErrorResponse, GatewayError } = require('../../server/errors');
const { isTrustedUrl } = require('../window');

const SESSION_IDLE_MS = 4 * 60 * 60 * 1000; // 4h de inatividade
const MAX_TEST_FILE = 25 * 1024 * 1024;

/**
 * Canal IPC único e seguro entre o painel (renderer) e o processo principal.
 *  - O renderer só chama ações por nome (whitelist em admin.actions + ações de sistema abaixo).
 *  - A sessão de login fica no processo principal, associada ao webContents — nenhum segredo vai para o renderer.
 *  - Toda chamada verifica se veio do próprio painel (origem confiável).
 */
function registerIpc({ admin, ctx, getServerUrl }) {
  const sessions = new Map(); // webContents.id -> { userId, usuario, nome, lastSeen }

  function getSession(wc) {
    const s = sessions.get(wc.id);
    if (!s) return null;
    if (Date.now() - s.lastSeen > SESSION_IDLE_MS) {
      sessions.delete(wc.id);
      return null;
    }
    s.lastSeen = Date.now();
    return s;
  }

  function ownerWindow(event) {
    return BrowserWindow.fromWebContents(event.sender);
  }

  /** Ações que dependem do Electron (diálogos, shell, sessão). */
  const systemActions = {
    'auth.login': async (p, event) => {
      const user = admin.actions['auth.login'].fn(p);
      sessions.set(event.sender.id, { ...user, lastSeen: Date.now() });
      return user;
    },
    'auth.logout': async (p, event, s) => {
      admin.auth.logout(s);
      sessions.delete(event.sender.id);
      return { ok: true };
    },
    'auth.me': async (p, event) => {
      const s = getSession(event.sender);
      return s ? { userId: s.userId, usuario: s.usuario, nome: s.nome } : null;
    },
    'system.openDocs': async () => {
      const url = getServerUrl();
      if (!url) throw new GatewayError('CONNECTION_ERROR', 'O serviço da API não está em execução.');
      await shell.openExternal(url + '/docs');
      return { ok: true };
    },
    /** Informações da página "Sobre". */
    'system.about': async () => ({
      versao: app.getVersion(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      plataforma: `${process.platform} ${process.arch}`,
      dataDir: ctx.paths.dataDir
    }),
    /** Abre links externos — somente https e mailto. */
    'system.openExternal': async ({ url }) => {
      let u;
      try { u = new URL(String(url)); } catch { throw new GatewayError('VALIDATION_ERROR', 'Link inválido.'); }
      if (!['https:', 'mailto:'].includes(u.protocol)) throw new GatewayError('VALIDATION_ERROR', 'Link não permitido.');
      await shell.openExternal(u.href);
      return { ok: true };
    },
    'system.openDataDir': async () => {
      await shell.openPath(ctx.paths.dataDir);
      return { ok: true };
    },
    'system.selectFile': async ({ title, filters }, event) => {
      const r = await dialog.showOpenDialog(ownerWindow(event), {
        title: title || 'Selecionar arquivo',
        properties: ['openFile'],
        filters: Array.isArray(filters) ? filters : undefined
      });
      return r.canceled ? null : r.filePaths[0];
    },
    'system.selectDirectory': async ({ title }, event) => {
      const r = await dialog.showOpenDialog(ownerWindow(event), { title: title || 'Selecionar pasta', properties: ['openDirectory', 'createDirectory'] });
      return r.canceled ? null : r.filePaths[0];
    },
    /** Lê arquivos escolhidos pelo usuário para o testador de upload (somente via diálogo). */
    'system.pickFilesForUpload': async (p, event) => {
      const r = await dialog.showOpenDialog(ownerWindow(event), { title: 'Arquivos para upload', properties: ['openFile', 'multiSelections'] });
      if (r.canceled) return [];
      return r.filePaths.map((f) => {
        const st = fs.statSync(f);
        if (st.size > MAX_TEST_FILE) throw new GatewayError('VALIDATION_ERROR', `Arquivo muito grande para o testador: ${path.basename(f)}`);
        return { name: path.basename(f), size: st.size, data: fs.readFileSync(f) };
      });
    },
    /** Salva texto (CSV/JSON/SQL) em arquivo escolhido pelo usuário. */
    'system.saveTextFile': async ({ content, defaultName, filters }, event) => {
      const r = await dialog.showSaveDialog(ownerWindow(event), {
        title: 'Salvar arquivo',
        defaultPath: String(defaultName || 'arquivo.txt').replace(/[\\/:*?"<>|]/g, '_'),
        filters: Array.isArray(filters) ? filters : undefined
      });
      if (r.canceled) return { canceled: true };
      fs.writeFileSync(r.filePath, String(content ?? ''), 'utf8');
      return { ok: true, file: r.filePath };
    },
    /** Abre um arquivo de texto (.sql) escolhido pelo usuário e devolve o conteúdo. */
    'system.openTextFile': async ({ filters }, event) => {
      const r = await dialog.showOpenDialog(ownerWindow(event), { title: 'Abrir arquivo', properties: ['openFile'], filters: Array.isArray(filters) ? filters : undefined });
      if (r.canceled) return null;
      const st = fs.statSync(r.filePaths[0]);
      if (st.size > 2 * 1024 * 1024) throw new GatewayError('VALIDATION_ERROR', 'Arquivo muito grande (máximo 2 MB).');
      return { name: path.basename(r.filePaths[0]), content: fs.readFileSync(r.filePaths[0], 'utf8') };
    },
    'backup.exportToFile': async (p, event, s) => {
      const doc = admin.actions['backup.export'].fn(p, s);
      const r = await dialog.showSaveDialog(ownerWindow(event), {
        title: 'Exportar configuração',
        defaultPath: `data-gateway-${new Date().toISOString().slice(0, 10)}.datagateway`,
        filters: [{ name: 'Data Gateway', extensions: ['datagateway'] }]
      });
      if (r.canceled) return { canceled: true };
      fs.writeFileSync(r.filePath, JSON.stringify(doc, null, 2), 'utf8');
      return { ok: true, file: r.filePath };
    },
    'backup.importFromFile': async (p, event, s) => {
      const r = await dialog.showOpenDialog(ownerWindow(event), {
        title: 'Importar configuração', properties: ['openFile'], filters: [{ name: 'Data Gateway', extensions: ['datagateway', 'json'] }]
      });
      if (r.canceled) return { canceled: true };
      const conteudo = fs.readFileSync(r.filePaths[0], 'utf8');
      return admin.actions['backup.import'].fn({ conteudo, passphrase: p.passphrase }, s);
    }
  };
  const PUBLIC_SYSTEM = new Set(['auth.login', 'auth.me']);

  ipcMain.handle('gw:invoke', async (event, action, payload) => {
    try {
      // Só o frame principal de uma janela do próprio app, carregando o painel, pode chamar ações.
      const frame = event.senderFrame;
      const isMainFrame = frame && event.sender.mainFrame && frame === event.sender.mainFrame;
      if (!isMainFrame || !BrowserWindow.fromWebContents(event.sender) || !isTrustedUrl(frame.url || event.sender.getURL())) {
        console.warn('[ipc] origem recusada:', frame && frame.url);
        throw new GatewayError('AUTHORIZATION_ERROR', 'Origem não autorizada.');
      }
      if (typeof action !== 'string') throw new GatewayError('VALIDATION_ERROR', 'Ação inválida.');
      const p = payload && typeof payload === 'object' ? payload : {};

      if (systemActions[action]) {
        const s = getSession(event.sender);
        if (!PUBLIC_SYSTEM.has(action) && !s) throw new GatewayError('AUTHENTICATION_ERROR', 'Sessão expirada. Entre novamente.');
        return { ok: true, data: await systemActions[action](p, event, s) };
      }
      const def = admin.actions[action];
      if (!def) throw new GatewayError('NOT_FOUND', 'Ação desconhecida: ' + action);
      let s = null;
      if (def.auth) {
        s = getSession(event.sender);
        if (!s) throw new GatewayError('AUTHENTICATION_ERROR', 'Sessão expirada. Entre novamente.');
      }
      return { ok: true, data: await def.fn(p, s) };
    } catch (err) {
      const { body } = toErrorResponse(err);
      if (!(err instanceof GatewayError)) console.error('[ipc]', action, err);
      return { ok: false, error: body.error };
    }
  });

  return {
    clearSession: (wcId) => sessions.delete(wcId)
  };
}

module.exports = { registerIpc };
