'use strict';

/**
 * Conversão e validação de valores entre JSON (tipo lógico da API) e o banco (tipo físico).
 * Cada função lança Error com mensagem amigável quando o valor é inválido.
 */

const TRUE_SET = new Set(['true', '1', 'sim', 's', 'yes', 'y']);
const FALSE_SET = new Set(['false', '0', 'nao', 'não', 'n', 'no']);

function isBoolPhysical(tipoFisico) {
  return /^(bit|bool|boolean)$/i.test(String(tipoFisico || ''));
}

/**
 * Converte valor recebido para o formato aceito pelo driver.
 * @param {object} campo  campo de runtime ({ api, tipo, tamanho, tipoFisico })
 * @param {*} v valor recebido
 * @param {string} dbType tipo do banco
 */
function parseInput(campo, v, dbType) {
  if (v === null) return null;
  const name = campo.api;
  switch (campo.tipo) {
    case 'TEXTO': {
      if (typeof v === 'object') throw new Error(`O campo ${name} deve ser texto.`);
      const s = String(v);
      if (campo.tamanho && s.length > campo.tamanho) throw new Error(`O campo ${name} excede o tamanho máximo de ${campo.tamanho} caracteres.`);
      return s;
    }
    case 'INTEIRO': {
      if (typeof v === 'boolean' || typeof v === 'object') throw new Error(`O campo ${name} deve ser um número inteiro.`);
      const s = String(v).trim();
      if (!/^-?\d+$/.test(s)) throw new Error(`O campo ${name} deve ser um número inteiro.`);
      const n = Number(s);
      return Number.isSafeInteger(n) ? n : s;
    }
    case 'NUMERO':
    case 'DECIMAL': {
      if (typeof v === 'boolean' || typeof v === 'object' || String(v).trim() === '') throw new Error(`O campo ${name} deve ser numérico.`);
      const n = Number(String(v).trim());
      if (!Number.isFinite(n)) throw new Error(`O campo ${name} deve ser numérico.`);
      return n;
    }
    case 'BOOLEANO': {
      let bool;
      if (typeof v === 'boolean') bool = v;
      else if (TRUE_SET.has(String(v).toLowerCase())) bool = true;
      else if (FALSE_SET.has(String(v).toLowerCase())) bool = false;
      else throw new Error(`O campo ${name} deve ser booleano (true/false).`);
      if ((dbType === 'postgres' || dbType === 'sqlserver') && isBoolPhysical(campo.tipoFisico)) return bool;
      return bool ? 1 : 0;
    }
    case 'DATA': {
      const s = String(v);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s + 'T00:00:00Z'))) {
        throw new Error(`O campo ${name} deve ser uma data no formato AAAA-MM-DD.`);
      }
      return s;
    }
    case 'DATAHORA': {
      const s = String(v);
      const t = Date.parse(s);
      if (!/^\d{4}-\d{2}-\d{2}/.test(s) || Number.isNaN(t)) throw new Error(`O campo ${name} deve ser data/hora ISO 8601 (ex.: 2026-10-17T15:30:00).`);
      const d = new Date(t);
      return dbType === 'sqlite' ? d.toISOString() : d;
    }
    case 'JSON': {
      if (typeof v === 'string') {
        try { JSON.parse(v); } catch { throw new Error(`O campo ${name} deve conter JSON válido.`); }
        return v;
      }
      return JSON.stringify(v);
    }
    case 'ARQUIVO':
      throw new Error(`O campo ${name} é do tipo arquivo e deve ser enviado pelo endpoint de upload.`);
    default:
      return v;
  }
}

/** Formata valor lido do banco para o JSON de resposta. */
function formatOutput(campo, v) {
  if (v === null || v === undefined) return null;
  switch (campo.tipo) {
    case 'INTEIRO':
      if (typeof v === 'bigint') return Number.isSafeInteger(Number(v)) ? Number(v) : v.toString();
      if (typeof v === 'string' && /^-?\d+$/.test(v) && Number.isSafeInteger(Number(v))) return Number(v);
      return v;
    case 'NUMERO':
    case 'DECIMAL':
      return typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : v;
    case 'BOOLEANO':
      if (typeof v === 'boolean') return v;
      if (Buffer.isBuffer(v)) return v[0] === 1;
      return TRUE_SET.has(String(v).toLowerCase());
    case 'DATA':
      if (v instanceof Date) return v.toISOString().slice(0, 10);
      return String(v).slice(0, 10);
    case 'DATAHORA':
      if (v instanceof Date) return v.toISOString();
      return String(v);
    case 'JSON':
      if (typeof v === 'string') { try { return JSON.parse(v); } catch { return v; } }
      return v;
    case 'ARQUIVO':
      return Buffer.isBuffer(v) ? v.toString('base64') : v;
    default:
      if (Buffer.isBuffer(v)) return v.toString('base64');
      if (v instanceof Date) return v.toISOString();
      if (typeof v === 'bigint') return v.toString();
      return v;
  }
}

/** Converte valor de filtro (sempre string vindo da query string) para o tipo do campo. */
function parseFilterValue(campo, raw, operador, dbType) {
  if (operador === 'isNull') return raw;
  if (operador === 'in') {
    return String(raw).split(',').map((x) => x.trim()).filter(Boolean).map((x) => parseInput(campo, x, dbType));
  }
  if (['contains', 'startsWith', 'endsWith'].includes(operador)) return String(raw);
  return parseInput(campo, raw, dbType);
}

module.exports = { parseInput, formatOutput, parseFilterValue };
