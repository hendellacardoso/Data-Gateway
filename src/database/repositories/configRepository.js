'use strict';

const DEFAULTS = Object.freeze({
  api: {
    host: '127.0.0.1',
    port: 8787,
    https: false,
    certPath: '',
    keyPath: '',
    corsOrigins: [],
    timeoutMs: 30000,
    rateLimitPerMinute: 300,
    bodyLimitKb: 1024,
    docsPublicas: true
  },
  app: {
    iniciarComWindows: false,
    iniciarServicoAuto: true,
    minimizarTray: true
  },
  logs: {
    retencaoDias: 30,
    auditoriaRetencaoDias: 365
  },
  // Reservado para o futuro modo Relay (não implementado nesta versão)
  relay: {
    habilitado: false,
    url: '',
    gatewayId: ''
  }
});

function deepMerge(base, extra) {
  if (!extra || typeof extra !== 'object' || Array.isArray(extra)) return extra === undefined ? base : extra;
  const out = { ...base };
  for (const k of Object.keys(extra)) {
    const b = base ? base[k] : undefined;
    out[k] = b && typeof b === 'object' && !Array.isArray(b) ? deepMerge(b, extra[k]) : extra[k];
  }
  return out;
}

class ConfigRepository {
  constructor(db) {
    this.db = db;
  }

  getRaw(key) {
    const row = this.db.prepare('SELECT VALOR FROM GW_CONFIG WHERE CHAVE = ?').get(key);
    if (!row) return undefined;
    try { return JSON.parse(row.VALOR); } catch { return row.VALOR; }
  }

  /** Retorna uma seção de configuração já mesclada com os valores padrão. */
  get(section) {
    const stored = this.getRaw(section);
    const def = DEFAULTS[section];
    if (def === undefined) return stored;
    return deepMerge(def, stored || {});
  }

  set(section, value) {
    const merged = DEFAULTS[section] ? deepMerge(this.get(section), value) : value;
    this.db.prepare(`
      INSERT INTO GW_CONFIG (CHAVE, VALOR, ATUALIZADO_EM) VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      ON CONFLICT(CHAVE) DO UPDATE SET VALOR = excluded.VALOR, ATUALIZADO_EM = excluded.ATUALIZADO_EM
    `).run(section, JSON.stringify(merged));
    return merged;
  }

  getAll() {
    const out = {};
    for (const k of Object.keys(DEFAULTS)) out[k] = this.get(k);
    return out;
  }
}

module.exports = { ConfigRepository, CONFIG_DEFAULTS: DEFAULTS };
