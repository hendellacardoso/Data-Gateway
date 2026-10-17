import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { call, onGatewayEvent, onSessionExpired } from '../services/api.js';
import { Button, Modal } from '../components/ui.jsx';

const AppCtx = createContext(null);
export const useApp = () => useContext(AppCtx);

export function AppProvider({ children }) {
  const [user, setUser] = useState(undefined); // undefined = verificando
  const [needsSetup, setNeedsSetup] = useState(false);
  const [server, setServer] = useState(null);
  const [toasts, setToasts] = useState([]);
  const [confirmState, setConfirmState] = useState(null);
  const idRef = useRef(0);

  const toast = useCallback((message, tone = 'success') => {
    const id = ++idRef.current;
    setToasts((t) => [...t, { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'error' ? 6000 : 3500);
  }, []);

  /** Confirmação antes de operações destrutivas. Retorna Promise<boolean>. */
  const confirm = useCallback((opts) => new Promise((resolve) => setConfirmState({ ...opts, resolve })), []);

  const refreshAuth = useCallback(async () => {
    try {
      const st = await call('auth.status');
      setNeedsSetup(st.needsSetup);
      setUser(st.needsSetup ? null : await call('auth.me'));
    } catch {
      setUser(null);
    }
  }, []);

  const refreshServer = useCallback(async () => {
    try { setServer(await call('server.status')); } catch { /* sem sessão */ }
  }, []);

  useEffect(() => { refreshAuth(); }, [refreshAuth]);
  useEffect(() => onSessionExpired(() => setUser(null)), []);
  useEffect(() => onGatewayEvent('server-status', setServer), []);
  useEffect(() => { if (user) refreshServer(); }, [user, refreshServer]);

  const login = async (usuario, senha) => {
    const u = await call('auth.login', { usuario, senha });
    setUser(u);
  };
  const logout = async () => {
    await call('auth.logout').catch(() => {});
    setUser(null);
  };

  const value = { user, needsSetup, setNeedsSetup, login, logout, refreshAuth, server, refreshServer, toast, confirm };

  return (
    <AppCtx.Provider value={value}>
      {children}
      <div className="toasts">
        {toasts.map((t) => <div key={t.id} className={'toast ' + t.tone}>{t.message}</div>)}
      </div>
      {confirmState && (
        <Modal
          title={confirmState.title || 'Confirmar'}
          onClose={() => { confirmState.resolve(false); setConfirmState(null); }}
          footer={
            <>
              <Button onClick={() => { confirmState.resolve(false); setConfirmState(null); }}>Cancelar</Button>
              <Button variant={confirmState.danger ? 'danger' : 'primary'} onClick={() => { confirmState.resolve(true); setConfirmState(null); }}>
                {confirmState.confirmLabel || 'Confirmar'}
              </Button>
            </>
          }
        >
          <div style={{ whiteSpace: 'pre-wrap' }}>{confirmState.message}</div>
        </Modal>
      )}
    </AppCtx.Provider>
  );
}
