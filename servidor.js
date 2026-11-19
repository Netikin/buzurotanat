/**
 * servidor.js
 * Servidor HTTP em Node.js puro (Zero Dependências / Sem npm install)
 *
 * Segurança para produção pública:
 * - Autenticação administrativa exclusivamente no backend (POST /api/admin/login)
 * - Chave lida de process.env.BUZU_ADMIN_KEY ou arquivo .env (nunca hardcoded no código)
 * - Sessões com token aleatório (crypto.randomBytes), cookie HttpOnly + SameSite=Strict e expiração
 * - Rate limit contra força bruta no login + comparação timingSafeEqual
 * - POST /api/salvar-rotas exige sessão autenticada (401 sem token válido)
 * - Bloqueio de acesso HTTP a arquivos sensíveis (.env, servidor.js, scripts/, rotas/, .git)
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execFile } = require('child_process');

const PORTA_INICIAL = Number(process.env.PORT) || 8080;
const RAIZ = path.resolve(__dirname);
const DADOS_DIR = path.join(RAIZ, 'dados');
const BACKUPS_DIR = path.join(DADOS_DIR, 'backups');
const ARQ_AUDITORIA = path.join(DADOS_DIR, 'auditoria-admin.jsonl');
const ROTAS_DIR = path.join(RAIZ, 'rotas');
const ARQUIVOS_VERSIONADOS = [
  'linhas.json',
  'paradas.json',
  'linha_paradas.json',
  'lote-1.geojson',
  'lote-2.geojson'
];

function registrarAuditoria(acao, ip, detalhes = '') {
  try {
    if (!fs.existsSync(DADOS_DIR)) fs.mkdirSync(DADOS_DIR, { recursive: true });
    const linha = JSON.stringify({
      dataHora: new Date().toISOString(),
      ip: String(ip || ''),
      acao: String(acao || 'ACAO'),
      detalhes: String(detalhes || '').slice(0, 400)
    });
    fs.appendFileSync(ARQ_AUDITORIA, linha + '\n', 'utf8');
  } catch (_e) {
    // Não interrompe o fluxo caso o log falhe
  }
}

function criarBackupVersao(motivo = 'Publicação Admin') {
  if (!fs.existsSync(DADOS_DIR)) return null;
  if (!fs.existsSync(BACKUPS_DIR)) fs.mkdirSync(BACKUPS_DIR, { recursive: true });

  const agora = new Date();
  const pad = n => String(n).padStart(2, '0');
  const idVersao =
    `${agora.getFullYear()}-${pad(agora.getMonth() + 1)}-${pad(agora.getDate())}_` +
    `${pad(agora.getHours())}-${pad(agora.getMinutes())}-${pad(agora.getSeconds())}`;
  const pastaDestino = path.join(BACKUPS_DIR, idVersao);
  if (!fs.existsSync(pastaDestino)) fs.mkdirSync(pastaDestino, { recursive: true });

  let copiados = 0;
  for (const nomeArq of ARQUIVOS_VERSIONADOS) {
    const origem = path.join(DADOS_DIR, nomeArq);
    if (fs.existsSync(origem)) {
      fs.copyFileSync(origem, path.join(pastaDestino, nomeArq));
      copiados++;
    }
  }
  if (copiados === 0) return null;

  fs.writeFileSync(
    path.join(pastaDestino, 'meta.json'),
    JSON.stringify({ versao: idVersao, dataHora: agora.toISOString(), motivo, arquivos: copiados }, null, 2),
    'utf8'
  );

  // Mantém no máximo os 20 backups mais recentes
  const todas = fs
    .readdirSync(BACKUPS_DIR)
    .filter(n => /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/.test(n))
    .sort()
    .reverse();
  for (const antiga of todas.slice(20)) {
    fs.rmSync(path.join(BACKUPS_DIR, antiga), { recursive: true, force: true });
  }
  return idVersao;
}

// Carrega variáveis de .env local (se existir) sem depender de pacotes externos
function carregarEnvLocal() {
  const arqEnv = path.join(RAIZ, '.env');
  if (!fs.existsSync(arqEnv)) return;
  const linhas = fs.readFileSync(arqEnv, 'utf8').split(/\r?\n/);
  for (const linha of linhas) {
    const limpa = linha.trim();
    if (!limpa || limpa.startsWith('#')) continue;
    const idxIgual = limpa.indexOf('=');
    if (idxIgual <= 0) continue;
    const chave = limpa.slice(0, idxIgual).trim();
    let valor = limpa.slice(idxIgual + 1).trim();
    if ((valor.startsWith('"') && valor.endsWith('"')) || (valor.startsWith("'") && valor.endsWith("'"))) {
      valor = valor.slice(1, -1);
    }
    if (!process.env[chave]) {
      process.env[chave] = valor;
    }
  }
}
carregarEnvLocal();

// Chave administrativa: vem de BUZU_ADMIN_KEY (.env ou variável de ambiente).
// Se não definida e não estiver em modo somente leitura, gera uma chave temporária aleatória apenas no terminal do servidor.
const MODO_SOMENTE_LEITURA = process.env.BUZU_PUBLIC_READONLY === '1';
let ADMIN_KEY_ATIVA = (process.env.BUZU_ADMIN_KEY || '').trim();
let CHAVE_FOI_GERADA_NO_TERMINAL = false;

if (!MODO_SOMENTE_LEITURA && !ADMIN_KEY_ATIVA) {
  ADMIN_KEY_ATIVA = crypto.randomBytes(18).toString('base64url');
  CHAVE_FOI_GERADA_NO_TERMINAL = true;
}

const sessoesAdmin = new Map(); // token -> { expiraEm }
const tentativasLogin = new Map(); // ip -> { falhas, bloqueadoAte }
const TTL_SESSAO_MS = 4 * 60 * 60 * 1000; // 4 horas
const MAX_TENTATIVAS_LOGIN = 5;
const BLOQUEIO_LOGIN_MS = 15 * 60 * 1000; // 15 minutos

function compararChavesSeguro(a, b) {
  if (!a || !b) return false;
  const hashA = crypto.createHash('sha256').update(String(a)).digest();
  const hashB = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

function extrairTokenSessao(req) {
  const authHeader = req.headers.authorization || '';
  if (authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  const cookieHeader = req.headers.cookie || '';
  for (const parte of cookieHeader.split(';')) {
    const [k, ...v] = parte.trim().split('=');
    if (k === 'buzu_admin_sess') {
      return decodeURIComponent(v.join('='));
    }
  }
  return '';
}

function sessaoEstaValida(req) {
  if (MODO_SOMENTE_LEITURA) return false;
  const token = extrairTokenSessao(req);
  if (!token) return false;
  const reg = sessoesAdmin.get(token);
  if (!reg) return false;
  if (Date.now() > reg.expiraEm) {
    sessoesAdmin.delete(token);
    return false;
  }
  return true;
}

// Monitora automaticamente a pasta ./rotas/ para converter novos arquivos .kmz/.kml assim que forem colados!
if (fs.existsSync(ROTAS_DIR)) {
  let timerConversao = null;
  fs.watch(ROTAS_DIR, (_evento, nomeArquivo) => {
    if (nomeArquivo && /\.(kmz|kml)$/i.test(nomeArquivo)) {
      clearTimeout(timerConversao);
      timerConversao = setTimeout(() => {
        console.log(`[Auto-Conversor] Detectada alteração em ./rotas/${nomeArquivo}. Convertendo...`);
        execFile(process.execPath, [path.join(RAIZ, 'scripts', 'converter-kmz.js')], (err, stdout) => {
          if (!err) console.log(stdout.trim());
        });
      }, 600);
    }
  });
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.geojson': 'application/geo+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function obterIpsDaRede() {
  const interfaces = os.networkInterfaces();
  const ips = [];
  for (const nome of Object.keys(interfaces)) {
    for (const iface of interfaces[nome] || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        ips.push(iface.address);
      }
    }
  }
  return ips;
}

function lerCorpoJson(req, limiteBytes = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let tamanho = 0;
    const chunks = [];
    req.on('data', chunk => {
      tamanho += chunk.length;
      if (tamanho > limiteBytes) {
        req.destroy();
        reject(new Error('Payload excede o limite permitido.'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch (_e) {
        reject(new Error('JSON inválido.'));
      }
    });
    req.on('error', reject);
  });
}

function responderJson(res, status, payload, headersExtras = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headersExtras
  });
  res.end(JSON.stringify(payload));
}

const servidor = http.createServer(async (req, res) => {
  // Cabeçalhos de proteção (sem wildcard CORS)
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const xff = req.headers['x-forwarded-for'];
  const ipCliente =
    (typeof xff === 'string' && xff.split(',')[0].trim()) ||
    req.socket.remoteAddress ||
    'desconhecido';

  // 1. Login administrativo (exclusivo no servidor, com rate limit)
  if (req.method === 'POST' && urlObj.pathname === '/api/admin/login') {
    if (MODO_SOMENTE_LEITURA || !ADMIN_KEY_ATIVA) {
      responderJson(res, 403, { ok: false, erro: 'Painel administrativo desabilitado neste servidor.' });
      return;
    }

    const regTent = tentativasLogin.get(ipCliente) || { falhas: 0, bloqueadoAte: 0 };
    if (Date.now() < regTent.bloqueadoAte) {
      responderJson(res, 429, {
        ok: false,
        erro: 'Muitas tentativas inválidas. Aguarde 15 minutos e tente novamente.'
      });
      return;
    }

    try {
      const body = await lerCorpoJson(req, 16 * 1024);
      if (compararChavesSeguro(body.chave, ADMIN_KEY_ATIVA)) {
        tentativasLogin.delete(ipCliente);
        const token = crypto.randomBytes(32).toString('base64url');
        sessoesAdmin.set(token, { expiraEm: Date.now() + TTL_SESSAO_MS });
        registrarAuditoria('LOGIN_ADMIN', ipCliente, 'Autenticação bem-sucedida');

        responderJson(
          res,
          200,
          { ok: true, token },
          {
            'Set-Cookie': `buzu_admin_sess=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(TTL_SESSAO_MS / 1000)}`
          }
        );
      } else {
        regTent.falhas += 1;
        if (regTent.falhas >= MAX_TENTATIVAS_LOGIN) {
          regTent.bloqueadoAte = Date.now() + BLOQUEIO_LOGIN_MS;
          regTent.falhas = 0;
        }
        tentativasLogin.set(ipCliente, regTent);
        responderJson(res, 401, { ok: false, erro: 'Chave técnica inválida.' });
      }
    } catch (err) {
      responderJson(res, 400, { ok: false, erro: err.message });
    }
    return;
  }

  // 2. Verificar sessão / Logout
  if (req.method === 'GET' && urlObj.pathname === '/api/admin/sessao') {
    responderJson(res, 200, { autenticado: sessaoEstaValida(req), somenteLeitura: MODO_SOMENTE_LEITURA });
    return;
  }

  if (req.method === 'POST' && urlObj.pathname === '/api/admin/logout') {
    const token = extrairTokenSessao(req);
    if (token) sessoesAdmin.delete(token);
    responderJson(
      res,
      200,
      { ok: true },
      { 'Set-Cookie': 'buzu_admin_sess=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' }
    );
    return;
  }

  // 3. Listar versões de backup e log de auditoria (PROTEGIDO)
  if (req.method === 'GET' && urlObj.pathname === '/api/admin/versoes') {
    if (!sessaoEstaValida(req)) {
      responderJson(res, 401, { ok: false, erro: 'Não autorizado.' });
      return;
    }
    const lista = [];
    if (fs.existsSync(BACKUPS_DIR)) {
      const pastas = fs
        .readdirSync(BACKUPS_DIR)
        .filter(n => /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/.test(n))
        .sort()
        .reverse();
      for (const p of pastas) {
        let meta = { versao: p, dataHora: p, motivo: 'Backup automático' };
        const arqMeta = path.join(BACKUPS_DIR, p, 'meta.json');
        if (fs.existsSync(arqMeta)) {
          try {
            meta = JSON.parse(fs.readFileSync(arqMeta, 'utf8'));
          } catch (_e) {}
        }
        lista.push(meta);
      }
    }
    responderJson(res, 200, { ok: true, versoes: lista });
    return;
  }

  if (req.method === 'POST' && urlObj.pathname === '/api/admin/restaurar-versao') {
    if (!sessaoEstaValida(req)) {
      responderJson(res, 401, { ok: false, erro: 'Não autorizado.' });
      return;
    }
    try {
      const body = await lerCorpoJson(req, 16 * 1024);
      const versao = String(body.versao || '').trim();
      if (!/^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/.test(versao)) {
        responderJson(res, 400, { ok: false, erro: 'Identificador de versão inválido.' });
        return;
      }
      const pastaOrigem = path.join(BACKUPS_DIR, versao);
      if (!fs.existsSync(pastaOrigem)) {
        responderJson(res, 404, { ok: false, erro: 'Versão de backup não encontrada.' });
        return;
      }
      criarBackupVersao(`Antes de restaurar ${versao}`);
      for (const nomeArq of ARQUIVOS_VERSIONADOS) {
        const src = path.join(pastaOrigem, nomeArq);
        if (fs.existsSync(src)) {
          fs.copyFileSync(src, path.join(DADOS_DIR, nomeArq));
        }
      }
      registrarAuditoria('RESTAURAR_VERSAO', ipCliente, `Restaurado backup ${versao}`);
      responderJson(res, 200, { ok: true, mensagem: `Versão ${versao} restaurada com sucesso!` });
    } catch (err) {
      responderJson(res, 500, { ok: false, erro: err.message });
    }
    return;
  }

  if (req.method === 'GET' && urlObj.pathname === '/api/admin/auditoria') {
    if (!sessaoEstaValida(req)) {
      responderJson(res, 401, { ok: false, erro: 'Não autorizado.' });
      return;
    }
    const registros = [];
    if (fs.existsSync(ARQ_AUDITORIA)) {
      const linhas = fs.readFileSync(ARQ_AUDITORIA, 'utf8').split(/\r?\n/).filter(Boolean);
      for (const l of linhas.slice(-40).reverse()) {
        try {
          registros.push(JSON.parse(l));
        } catch (_e) {}
      }
    }
    responderJson(res, 200, { ok: true, registros });
    return;
  }

  // 4. Salvar rotas/paradas (PROTEGIDO: exige sessão autenticada + cria backup automático!)
  if (req.method === 'POST' && urlObj.pathname === '/api/salvar-rotas') {
    if (!sessaoEstaValida(req)) {
      responderJson(res, 401, { ok: false, erro: 'Não autorizado. Autentique-se como administrador.' });
      return;
    }

    try {
      const pacote = await lerCorpoJson(req, 50 * 1024 * 1024);
      if (!pacote.indice || !pacote.paradas) {
        responderJson(res, 400, { ok: false, erro: 'Formato de pacote inválido.' });
        return;
      }

      if (!fs.existsSync(DADOS_DIR)) {
        fs.mkdirSync(DADOS_DIR, { recursive: true });
      }

      const versaoBackup = criarBackupVersao(pacote.resumoAuditoria || 'Publicação Admin');

      fs.writeFileSync(path.join(DADOS_DIR, 'linhas.json'), JSON.stringify(pacote.indice, null, 2), 'utf8');
      fs.writeFileSync(path.join(DADOS_DIR, 'paradas.json'), JSON.stringify(pacote.paradas, null, 2), 'utf8');

      if (Array.isArray(pacote.linhaParadas)) {
        fs.writeFileSync(
          path.join(DADOS_DIR, 'linha_paradas.json'),
          JSON.stringify(pacote.linhaParadas, null, 2),
          'utf8'
        );
      }

      if (pacote.lotesGeoJson) {
        if (pacote.lotesGeoJson['1']) {
          fs.writeFileSync(
            path.join(DADOS_DIR, 'lote-1.geojson'),
            JSON.stringify(pacote.lotesGeoJson['1'], null, 2),
            'utf8'
          );
        }
        if (pacote.lotesGeoJson['2']) {
          fs.writeFileSync(
            path.join(DADOS_DIR, 'lote-2.geojson'),
            JSON.stringify(pacote.lotesGeoJson['2'], null, 2),
            'utf8'
          );
        }
      }

      const totalLinhas = (pacote.indice.linhas || []).length;
      const totalParadas = (pacote.paradas.features || []).length;
      registrarAuditoria(
        'PUBLICAR_ROTAS',
        ipCliente,
        pacote.resumoAuditoria || `Publicado: ${totalLinhas} linhas, ${totalParadas} paradas (backup: ${versaoBackup || 'n/a'})`
      );

      responderJson(res, 200, {
        ok: true,
        versaoBackup,
        mensagem: 'Publicado no servidor com backup automático!'
      });
    } catch (err) {
      responderJson(res, 500, { ok: false, erro: err.message });
    }
    return;
  }

  // 4. Bloqueio de acesso direto a arquivos/pastas sensíveis do servidor
  let caminhoRelativo = decodeURIComponent(urlObj.pathname);
  if (caminhoRelativo === '/') caminhoRelativo = '/index.html';

  const segmentos = caminhoRelativo.split('/').filter(Boolean);
  const primeiroSeg = (segmentos[0] || '').toLowerCase();
  const bloqueados = new Set(['.env', '.env.example', '.git', 'servidor.js', 'scripts', 'rotas', 'node_modules']);
  const caminhoLower = caminhoRelativo.toLowerCase();
  if (
    bloqueados.has(primeiroSeg) ||
    segmentos.some(s => s.startsWith('.')) ||
    caminhoLower.startsWith('/dados/backups') ||
    caminhoLower === '/dados/auditoria-admin.jsonl'
  ) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Acesso negado');
    return;
  }

  const caminhoSeguro = path.resolve(RAIZ, '.' + caminhoRelativo);
  if (caminhoSeguro !== RAIZ && !caminhoSeguro.startsWith(RAIZ + path.sep)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Acesso negado');
    return;
  }

  fs.stat(caminhoSeguro, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Arquivo não encontrado');
      return;
    }

    const ext = path.extname(caminhoSeguro).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    const cacheControl =
      ext === '.json' || ext === '.geojson' ? 'no-cache, no-store, must-revalidate' : 'public, max-age=60';

    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': cacheControl
    });

    fs.createReadStream(caminhoSeguro).pipe(res);
  });
});

function iniciarServidor(porta) {
  servidor.once('error', err => {
    if (err.code === 'EADDRINUSE') {
      iniciarServidor(porta + 1);
    } else {
      console.error(err);
    }
  });

  servidor.listen(porta, '0.0.0.0', () => {
    const ips = obterIpsDaRede();
    console.log('===================================================================');
    console.log(' 🚌 Servidor BuzuRota Natal ativo (Modo Protegido)!');
    console.log('===================================================================');
    console.log(` -> Local:  http://localhost:${porta}`);
    if (ips.length > 0) {
      ips.forEach(ip => {
        console.log(` -> Rede:   http://${ip}:${porta}`);
      });
    }
    if (MODO_SOMENTE_LEITURA) {
      console.log(' -> Admin:  DESABILITADO (BUZU_PUBLIC_READONLY=1)');
    } else if (CHAVE_FOI_GERADA_NO_TERMINAL) {
      console.log(` -> Chave Admin gerada nesta sessão: ${ADMIN_KEY_ATIVA}`);
      console.log('    (Dica: crie um arquivo .env com BUZU_ADMIN_KEY=sua-chave-forte)');
    } else {
      console.log(' -> Admin:  Protegido por BUZU_ADMIN_KEY configurada no ambiente/.env');
    }
    console.log('===================================================================');
  });
}

iniciarServidor(PORTA_INICIAL);
