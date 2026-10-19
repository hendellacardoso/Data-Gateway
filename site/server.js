'use strict';
/**
 * Site de download do Data Gateway (api2dev.com.br)
 * Servidor HTTP sem dependências externas. Escuta em 127.0.0.1:5010 e fica atrás do Caddy (HTTPS).
 *
 *   /                      página (public/)
 *   /api/versao            versão e arquivos disponíveis (nome, tamanho, SHA-256)
 *   /download/instalador   baixa DataGateway-Setup-<versão>.exe   (conta o download)
 *   /download/portatil     baixa DataGateway-Portable-<versão>.exe (conta o download)
 *   /saude                 teste de funcionamento (usado pelo publicar.bat)
 *
 *   /backup                       página do API2Dev Backup (public/backup/)
 *   /api/backup/versao            versão e arquivos do API2Dev Backup
 *   /download/backup/instalador   baixa API2Dev-Backup-Setup-<versão>.exe    (conta o download)
 *   /download/backup/portatil     baixa API2Dev-Backup-Portatil-<versão>.exe (conta o download)
 *
 * Variáveis opcionais: PORT (padrão 5010), HOST (padrão 127.0.0.1)
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 5010;
const HOST = process.env.HOST || '127.0.0.1';
const RAIZ = __dirname;
const PUBLIC = path.join(RAIZ, 'public');
const DOWNLOADS = path.join(RAIZ, 'downloads');
const DADOS = path.join(RAIZ, 'dados');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.woff2': 'font/woff2'
};

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'"
].join('; ');

function cabecalhosSeguranca(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  res.setHeader('Content-Security-Policy', CSP);
}

function log(...a) {
  console.log(new Date().toISOString(), ...a);
}

// ------------------------------------------------------------------ arquivos para download
// Cada produto tem os seus executáveis (em downloads/) e o seu próprio contador (em dados/).
const PRODUTOS = {
  gateway: {
    nome: 'Data Gateway',
    contador: path.join(DADOS, 'downloads.json'),
    inicial: Number(process.env.DOWNLOADS_INICIAL || 97),
    tipos: {
      instalador: { padrao: /^DataGateway-Setup-(\d+\.\d+\.\d+)\.exe$/i, titulo: 'Instalador' },
      portatil: { padrao: /^DataGateway-Portable-(\d+\.\d+\.\d+)\.exe$/i, titulo: 'Portátil' }
    },
    prefixoUrl: '/download/'
  },
  backup: {
    nome: 'API2Dev Backup',
    contador: path.join(DADOS, 'downloads-backup.json'),
    inicial: Number(process.env.DOWNLOADS_INICIAL_BACKUP || 32),
    tipos: {
      instalador: { padrao: /^API2Dev-Backup-Setup-(\d+\.\d+\.\d+)\.exe$/i, titulo: 'Instalador' },
      portatil: { padrao: /^API2Dev-Backup-Portatil-(\d+\.\d+\.\d+)\.exe$/i, titulo: 'Portátil' }
    },
    prefixoUrl: '/download/backup/'
  }
};

const cacheHash = new Map(); // caminho -> { mtimeMs, size, sha256 }

function compararVersao(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
}

function sha256Arquivo(caminho, st) {
  const c = cacheHash.get(caminho);
  if (c && c.mtimeMs === st.mtimeMs && c.size === st.size) return Promise.resolve(c.sha256);
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(caminho)
      .on('data', (d) => h.update(d))
      .on('error', reject)
      .on('end', () => {
        const sha256 = h.digest('hex');
        cacheHash.set(caminho, { mtimeMs: st.mtimeMs, size: st.size, sha256 });
        resolve(sha256);
      });
  });
}

/** Retorna o arquivo mais novo de cada tipo (do produto) encontrado em downloads/. */
function listarArquivos(produto) {
  const TIPOS = PRODUTOS[produto].tipos;
  let nomes = [];
  try {
    nomes = fs.readdirSync(DOWNLOADS);
  } catch {
    return {};
  }
  const achados = {};
  for (const nome of nomes) {
    for (const [tipo, def] of Object.entries(TIPOS)) {
      const m = def.padrao.exec(nome);
      if (!m) continue;
      const caminho = path.join(DOWNLOADS, nome);
      let st;
      try {
        st = fs.statSync(caminho);
      } catch {
        continue;
      }
      if (!st.isFile()) continue;
      if (!achados[tipo] || compararVersao(m[1], achados[tipo].versao) > 0) {
        achados[tipo] = { tipo, nome, versao: m[1], caminho, st };
      }
    }
  }
  return achados;
}

// ------------------------------------------------------------------ contador de downloads
// Um arquivo por produto:
//   dados/downloads.json         Data Gateway   { "inicial": 97, "instalador": N, "portatil": N }
//   dados/downloads-backup.json  API2Dev Backup { "inicial": 32, "instalador": N, "portatil": N }
//   inicial    → valor de partida exibido no site (ajuste à vontade no arquivo)
//   instalador/portatil → downloads reais contados pelo servidor
// Total exibido = inicial + instalador + portatil. Cada IP conta no máximo 1 vez por arquivo a cada 24 h.
const contagens = {};
const gravacoesPendentes = {};

function gravarContador(produto) {
  const arq = PRODUTOS[produto].contador;
  try {
    fs.mkdirSync(DADOS, { recursive: true });
    fs.writeFileSync(arq + '.tmp', JSON.stringify(contagens[produto], null, 2));
    fs.renameSync(arq + '.tmp', arq);
  } catch (e) {
    log('Falha ao gravar contador:', produto, e.message);
  }
}

for (const [produto, def] of Object.entries(PRODUTOS)) {
  contagens[produto] = { inicial: def.inicial, instalador: 0, portatil: 0 };
  let lido = null;
  try {
    lido = JSON.parse(fs.readFileSync(def.contador, 'utf8'));
    Object.assign(contagens[produto], lido);
  } catch {
    /* primeiro uso */
  }
  // grava já na primeira execução, para o arquivo mostrar o campo "inicial"
  if (!lido || !('inicial' in lido)) gravarContador(produto);
}

const totalDownloads = (produto) => {
  const c = contagens[produto];
  return (Number(c.inicial) || 0) + (Number(c.instalador) || 0) + (Number(c.portatil) || 0);
};

const vistos = new Map(); // hash(ip|produto|tipo) -> momento do último download contado
const DIA = 24 * 60 * 60 * 1000;
function ipDoVisitante(req) {
  // Caddy repassa o IP real (Cloudflare → X-Cliente-IP; sem Cloudflare → X-Forwarded-For)
  const h = req.headers['x-cliente-ip'] || String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return h || req.socket.remoteAddress || '';
}
function contar(req, produto, tipo) {
  const chave = crypto.createHash('sha256').update(ipDoVisitante(req) + '|' + produto + '|' + tipo).digest('hex').slice(0, 24);
  const agora = Date.now();
  if (vistos.has(chave) && agora - vistos.get(chave) < DIA) return;
  vistos.set(chave, agora);
  if (vistos.size > 50000) for (const [k, t] of vistos) if (agora - t >= DIA) vistos.delete(k);
  const c = contagens[produto];
  c[tipo] = (Number(c[tipo]) || 0) + 1;
  if (gravacoesPendentes[produto]) return;
  gravacoesPendentes[produto] = setTimeout(() => { gravacoesPendentes[produto] = null; gravarContador(produto); }, 2000);
}

// ------------------------------------------------------------------ respostas
function json(res, status, obj) {
  const corpo = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(corpo) });
  res.end(corpo);
}

function texto(res, status, msg) {
  res.writeHead(status, { 'Content-Type': MIME['.txt'], 'Cache-Control': 'no-store' });
  res.end(msg);
}

async function apiVersao(res, produto) {
  const def = PRODUTOS[produto];
  const TIPOS = def.tipos;
  const achados = listarArquivos(produto);
  const arquivos = [];
  for (const tipo of Object.keys(TIPOS)) {
    const a = achados[tipo];
    if (!a) continue;
    let sha256 = null;
    try {
      sha256 = await sha256Arquivo(a.caminho, a.st);
    } catch {
      /* ignora */
    }
    arquivos.push({
      tipo,
      titulo: TIPOS[tipo].titulo,
      nome: a.nome,
      versao: a.versao,
      tamanho: a.st.size,
      atualizadoEm: a.st.mtime.toISOString(),
      sha256,
      url: def.prefixoUrl + tipo
    });
  }
  const versao = arquivos.map((a) => a.versao).sort(compararVersao).pop() || null;
  json(res, 200, { produto: def.nome, versao, arquivos, downloads: totalDownloads(produto) });
}

function enviarDownload(req, res, produto, tipo) {
  const a = listarArquivos(produto)[tipo];
  if (!a) return texto(res, 404, 'Arquivo ainda não publicado. Tente novamente mais tarde.');
  const tamanho = a.st.size;
  const cab = {
    'Content-Type': 'application/vnd.microsoft.portable-executable',
    'Content-Disposition': `attachment; filename="${a.nome}"`,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store', // sempre passa pelo servidor (Cloudflare não guarda) → contagem correta
    'Last-Modified': a.st.mtime.toUTCString(),
    ETag: `"${a.st.size.toString(16)}-${Math.floor(a.st.mtimeMs).toString(16)}"`
  };

  // Retomada de download (Range: bytes=inicio-fim)
  const range = req.headers.range;
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    let ini = m && m[1] !== '' ? Number(m[1]) : NaN;
    let fim = m && m[2] !== '' ? Number(m[2]) : NaN;
    if (m && m[1] === '' && m[2] !== '') {
      ini = Math.max(0, tamanho - Number(m[2]));
      fim = tamanho - 1;
    }
    if (Number.isNaN(fim) || fim >= tamanho) fim = tamanho - 1;
    if (!m || Number.isNaN(ini) || ini > fim) {
      res.writeHead(416, { 'Content-Range': `bytes */${tamanho}` });
      return res.end();
    }
    res.writeHead(206, { ...cab, 'Content-Range': `bytes ${ini}-${fim}/${tamanho}`, 'Content-Length': fim - ini + 1 });
    if (req.method === 'HEAD') return res.end();
    if (ini === 0) contar(req, produto, tipo); // gerenciadores de download começam com Range: bytes=0-
    return fs.createReadStream(a.caminho, { start: ini, end: fim }).on('error', () => res.destroy()).pipe(res);
  }

  res.writeHead(200, { ...cab, 'Content-Length': tamanho });
  if (req.method === 'HEAD') return res.end();
  contar(req, produto, tipo);
  log('download', produto, tipo, a.nome);
  fs.createReadStream(a.caminho).on('error', () => res.destroy()).pipe(res);
}

function enviarEstatico(req, res, urlPath, versionado) {
  let rel;
  try {
    rel = decodeURIComponent(urlPath);
  } catch {
    return texto(res, 400, 'Endereço inválido.');
  }
  if (rel.includes('\0')) return texto(res, 400, 'Endereço inválido.');
  if (rel.endsWith('/')) rel += 'index.html';
  const caminho = path.normalize(path.join(PUBLIC, rel));
  if (!caminho.startsWith(PUBLIC + path.sep)) return texto(res, 403, 'Acesso negado.');

  fs.stat(caminho, (err, st) => {
    if (err || !st.isFile()) {
      // página 404 amigável
      const p404 = path.join(PUBLIC, '404.html');
      res.writeHead(404, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-cache' });
      return fs.createReadStream(p404).on('error', () => res.end('Página não encontrada.')).pipe(res);
    }
    const ext = path.extname(caminho).toLowerCase();
    const etag = `"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
    // Cache longo só para arquivos com ?v=... no endereço (CSS/JS versionados).
    // Os demais (inclusive imagens que podem ser substituídas com o mesmo nome) são revalidados
    // a cada acesso pelo ETag — resposta 304 rápida, e a troca do arquivo aparece na hora.
    const imutavel = versionado && /^\/(img|css|js)\//.test(rel) && ext !== '.html';
    const cab = {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': imutavel ? 'public, max-age=604800' : 'no-cache',
      ETag: etag,
      'Last-Modified': st.mtime.toUTCString()
    };
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, cab);
      return res.end();
    }
    res.writeHead(200, { ...cab, 'Content-Length': st.size });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(caminho).on('error', () => res.destroy()).pipe(res);
  });
}

// ------------------------------------------------------------------ servidor
const servidor = http.createServer((req, res) => {
  cabecalhosSeguranca(res);
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return texto(res, 405, 'Método não permitido.');
  }
  let url;
  try {
    url = new URL(req.url, 'http://localhost');
  } catch {
    return texto(res, 400, 'Endereço inválido.');
  }
  const p = url.pathname;

  if (p === '/saude') return json(res, 200, { ok: true, servico: 'site-datagateway', hora: new Date().toISOString() });
  if (p === '/api/versao') return apiVersao(res, 'gateway').catch(() => json(res, 500, { erro: 'Falha ao ler os arquivos.' }));
  if (p === '/download/instalador' || p === '/download/portatil') return enviarDownload(req, res, 'gateway', p.split('/')[2]);

  // ---- API2Dev Backup
  if (p === '/api/backup/versao') return apiVersao(res, 'backup').catch(() => json(res, 500, { erro: 'Falha ao ler os arquivos.' }));
  if (p === '/download/backup/instalador' || p === '/download/backup/portatil') return enviarDownload(req, res, 'backup', p.split('/')[3]);
  if (p === '/download/backup' || p === '/download/backup/') {
    res.writeHead(302, { Location: '/backup#download' });
    return res.end();
  }
  if (p === '/backup' || p === '/backup/index.html') return enviarEstatico(req, res, '/backup/', false);
  if (p === '/download' || p === '/download/') {
    res.writeHead(302, { Location: '/#download' });
    return res.end();
  }
  return enviarEstatico(req, res, p, url.searchParams.has('v'));
});

servidor.on('clientError', (err, socket) => socket.destroy());
servidor.listen(PORT, HOST, () => log(`Site Data Gateway em http://${HOST}:${PORT}  (downloads: ${DOWNLOADS})`));

function encerrar() {
  log('Encerrando...');
  for (const produto of Object.keys(PRODUTOS)) {
    if (!gravacoesPendentes[produto]) continue;
    clearTimeout(gravacoesPendentes[produto]);
    gravacoesPendentes[produto] = null;
    gravarContador(produto);
  }
  servidor.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', encerrar);
process.on('SIGTERM', encerrar);
