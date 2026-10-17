'use strict';

/**
 * Armazenamento seguro de segredos (senhas de banco, etc.).
 *
 * Backends:
 *  - "dpapi:"  → Electron safeStorage (no Windows usa DPAPI, vinculado ao usuário do SO). Preferencial.
 *  - "aes:"    → AES-256-GCM com chave mestra local (master.key no diretório de dados).
 *                Usado como fallback quando o safeStorage não está disponível (ex.: testes fora do Electron).
 *
 * O prefixo fica gravado junto ao valor, de forma que ambos os formatos possam ser lidos.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

let safeStorage = null;
let masterKey = null;
let keyFile = null;

function init({ dataDir, electronSafeStorage } = {}) {
  keyFile = path.join(dataDir, 'master.key');
  if (electronSafeStorage && electronSafeStorage.isEncryptionAvailable()) {
    safeStorage = electronSafeStorage;
  }
}

function getMasterKey() {
  if (masterKey) return masterKey;
  if (!keyFile) throw new Error('secrets não inicializado');
  if (fs.existsSync(keyFile)) {
    let raw = fs.readFileSync(keyFile, 'utf8').trim();
    // A própria chave mestra pode estar protegida pelo DPAPI
    if (raw.startsWith('dpapi:') && safeStorage) {
      raw = safeStorage.decryptString(Buffer.from(raw.slice(6), 'base64'));
    }
    masterKey = Buffer.from(raw, 'base64');
  } else {
    masterKey = crypto.randomBytes(32);
    const b64 = masterKey.toString('base64');
    const content = safeStorage ? 'dpapi:' + safeStorage.encryptString(b64).toString('base64') : b64;
    fs.writeFileSync(keyFile, content, { mode: 0o600 });
  }
  return masterKey;
}

function aesEncrypt(plain, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

function aesDecrypt(b64, key) {
  const buf = Buffer.from(b64, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

function encrypt(plain) {
  if (plain === null || plain === undefined || plain === '') return null;
  if (safeStorage) return 'dpapi:' + safeStorage.encryptString(String(plain)).toString('base64');
  return 'aes:' + aesEncrypt(plain, getMasterKey());
}

function decrypt(stored) {
  if (!stored) return '';
  if (stored.startsWith('dpapi:')) {
    if (!safeStorage) throw new Error('Segredo protegido pelo sistema operacional e indisponível neste contexto.');
    return safeStorage.decryptString(Buffer.from(stored.slice(6), 'base64'));
  }
  if (stored.startsWith('aes:')) return aesDecrypt(stored.slice(4), getMasterKey());
  throw new Error('Formato de segredo desconhecido.');
}

/** Criptografia com senha informada pelo usuário (usada na exportação de configuração). */
function encryptWithPassphrase(plain, passphrase) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(passphrase, salt, 32, { N: 16384, r: 8, p: 1 });
  return 'pbk:' + salt.toString('base64') + ':' + aesEncrypt(plain, key);
}

function decryptWithPassphrase(stored, passphrase) {
  const [, saltB64, data] = String(stored).split(':');
  const key = crypto.scryptSync(passphrase, Buffer.from(saltB64, 'base64'), 32, { N: 16384, r: 8, p: 1 });
  return aesDecrypt(data, key);
}

module.exports = { init, encrypt, decrypt, encryptWithPassphrase, decryptWithPassphrase };
