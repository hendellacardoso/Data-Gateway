/**
 * Cliente do painel: todas as chamadas passam pelo preload seguro (window.gateway.invoke),
 * que encaminha ao processo principal por um único canal IPC.
 */
export class ApiError extends Error {
  constructor(error) {
    super(error?.message || 'Erro desconhecido.');
    this.code = error?.code || 'INTERNAL_ERROR';
    this.details = error?.details || [];
  }
}

const listeners = new Set();
export function onSessionExpired(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export async function call(action, payload) {
  if (!window.gateway) throw new ApiError({ message: 'Execute o painel dentro do aplicativo Data Gateway.' });
  const res = await window.gateway.invoke(action, payload);
  if (!res || !res.ok) {
    const err = new ApiError(res && res.error);
    if (err.code === 'AUTHENTICATION_ERROR' && action !== 'auth.login') listeners.forEach((fn) => fn());
    throw err;
  }
  return res.data;
}

export function onGatewayEvent(event, cb) {
  return window.gateway ? window.gateway.on(event, cb) : () => {};
}
