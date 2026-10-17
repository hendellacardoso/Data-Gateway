'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { GatewayError } = require('../errors');

// Extensões nunca aceitas, mesmo que configuradas por engano
const BLOCKED_EXT = new Set(['exe', 'dll', 'bat', 'cmd', 'com', 'msi', 'ps1', 'vbs', 'js', 'jse', 'scr', 'hta', 'jar', 'sh', 'lnk', 'reg', 'cpl', 'pif']);

function sanitizeName(name) {
  const base = path.basename(String(name || 'arquivo')).normalize('NFKD').replace(/[̀-ͯ]/g, '');
  return base.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '').slice(0, 150) || 'arquivo';
}

function extOf(name) {
  const e = path.extname(String(name || '')).replace('.', '').toLowerCase();
  return e;
}

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(file).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
  });
}

class UploadService {
  constructor({ db, dataDir }) {
    this.db = db;
    this.baseDir = path.join(dataDir, 'uploads');
    this.tmpDir = path.join(os.tmpdir(), 'data-gateway-upload');
    fs.mkdirSync(this.tmpDir, { recursive: true });
  }

  /** Middleware multer configurado com os limites do endpoint. */
  middleware(ep) {
    const upload = multer({
      dest: this.tmpDir,
      limits: {
        fileSize: ep.upload.tamanhoMaxMb * 1024 * 1024,
        files: ep.upload.qtdMax,
        fields: 20,
        parts: ep.upload.qtdMax + 20
      }
    }).any();
    return (req, res) => new Promise((resolve, reject) => {
      upload(req, res, (err) => {
        if (!err) return resolve();
        const map = {
          LIMIT_FILE_SIZE: `Arquivo excede o tamanho máximo de ${ep.upload.tamanhoMaxMb} MB.`,
          LIMIT_FILE_COUNT: `Quantidade máxima de arquivos por envio: ${ep.upload.qtdMax}.`,
          LIMIT_UNEXPECTED_FILE: 'Campo de arquivo inesperado.'
        };
        reject(new GatewayError('UPLOAD_ERROR', map[err.code] || 'Falha ao receber o arquivo.', {
          status: err.code === 'LIMIT_FILE_SIZE' ? 413 : 400, cause: err
        }));
      });
    });
  }

  cleanup(files) {
    for (const f of files || []) fs.promises.unlink(f.path).catch(() => {});
  }

  targetDir(ep, recordId) {
    const safeRecord = String(recordId).replace(/[^A-Za-z0-9._-]/g, '_');
    const root = ep.upload.diretorio ? path.resolve(ep.upload.diretorio) : path.join(this.baseDir, ep.slug);
    const dir = path.resolve(root, safeRecord);
    if (!dir.startsWith(root)) throw new GatewayError('UPLOAD_ERROR', 'Diretório de upload inválido.');
    return dir;
  }

  buildStoredName(ep, original, ext, dir) {
    let name;
    if (ep.upload.padraoNome === 'ORIGINAL') name = sanitizeName(original);
    else if (ep.upload.padraoNome === 'TIMESTAMP') name = `${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}_${sanitizeName(original)}`;
    else name = `${crypto.randomUUID()}.${ext}`;
    if (dir) {
      // Nunca sobrescreve um arquivo existente
      let candidate = name;
      let i = 1;
      while (fs.existsSync(path.join(dir, candidate))) {
        const p = path.parse(name);
        candidate = `${p.name}(${i++})${p.ext}`;
      }
      name = candidate;
    }
    return name;
  }

  /** Valida e persiste arquivos recebidos. Retorna os metadados salvos. */
  async store(ep, recordId, files, token) {
    try {
      if (!files || !files.length) throw new GatewayError('UPLOAD_ERROR', 'Nenhum arquivo enviado (use multipart/form-data).');
      for (const f of files) {
        const ext = extOf(f.originalname);
        if (!ext || BLOCKED_EXT.has(ext) || !ep.upload.extensoes.includes(ext)) {
          throw new GatewayError('UPLOAD_ERROR', `Extensão não permitida: ${ext || '(sem extensão)'}. Permitidas: ${ep.upload.extensoes.join(', ')}.`);
        }
      }
      const saved = [];
      const ins = this.db.prepare(`INSERT INTO GW_ARQUIVO (ENDPOINT_ID, REGISTRO_ID, NOME_ORIGINAL, NOME_ARMAZENADO, CAMINHO, MIME, TAMANHO, HASH_SHA256, CONTEUDO, TOKEN_ID)
        VALUES (?,?,?,?,?,?,?,?,?,?)`);
      for (const f of files) {
        const ext = extOf(f.originalname);
        const hash = await sha256File(f.path);
        let caminho = null;
        let conteudo = null;
        let stored;
        if (ep.upload.armazenamento === 'DB') {
          stored = this.buildStoredName(ep, f.originalname, ext, null);
          conteudo = await fs.promises.readFile(f.path);
        } else {
          const dir = this.targetDir(ep, recordId);
          await fs.promises.mkdir(dir, { recursive: true });
          stored = this.buildStoredName(ep, f.originalname, ext, dir);
          caminho = path.join(dir, stored);
          await fs.promises.copyFile(f.path, caminho, fs.constants.COPYFILE_EXCL);
        }
        const id = ins.run(ep.id, String(recordId), sanitizeName(f.originalname), stored, caminho, f.mimetype || null, f.size, hash, conteudo, token ? token.id : null).lastInsertRowid;
        saved.push({ id: Number(id), nome: sanitizeName(f.originalname), armazenadoComo: stored, tamanho: f.size, mime: f.mimetype, sha256: hash });
      }
      return saved;
    } finally {
      this.cleanup(files);
    }
  }

  list(ep, recordId) {
    return this.db.prepare(`SELECT ID AS id, NOME_ORIGINAL AS nome, MIME AS mime, TAMANHO AS tamanho, HASH_SHA256 AS sha256, CRIADO_EM AS criadoEm
      FROM GW_ARQUIVO WHERE ENDPOINT_ID = ? AND REGISTRO_ID = ? ORDER BY ID`).all(ep.id, String(recordId));
  }

  get(ep, recordId, fileId) {
    const row = this.db.prepare('SELECT * FROM GW_ARQUIVO WHERE ID = ? AND ENDPOINT_ID = ? AND REGISTRO_ID = ?').get(Number(fileId), ep.id, String(recordId));
    if (!row) throw new GatewayError('NOT_FOUND', 'Arquivo não encontrado.');
    return row;
  }
}

module.exports = { UploadService, sanitizeName, BLOCKED_EXT };
