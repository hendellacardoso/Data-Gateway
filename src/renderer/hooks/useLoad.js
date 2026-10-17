import { useCallback, useEffect, useRef, useState } from 'react';
import { call } from '../services/api.js';

/** Carrega dados de uma ação do painel, com recarga manual. */
export function useLoad(action, payload, deps = []) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const payloadRef = useRef(payload);
  payloadRef.current = payload;

  const reload = useCallback(async () => {
    if (!action) return;
    setLoading(true);
    try {
      setData(await call(action, payloadRef.current));
      setError(null);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action, ...deps]);

  useEffect(() => { reload(); }, [reload]);
  return { data, setData, error, loading, reload };
}

/** Executa uma ação com estado de carregamento e erro. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const run = useCallback(async (fn) => {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError(e);
      throw e;
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, error, setError, run };
}
