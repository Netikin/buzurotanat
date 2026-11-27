/**
 * servidor.js
 * Servidor HTTP em Node.js puro (Zero Dependências / Sem npm install)
 *
 * Segurança para produção pública:
 * - Área administrativa em endereço oculto, com uma conta por pessoa: senha guardada só como hash
 *   (scrypt) + verificação em duas etapas (TOTP). Ver admin/painel-servidor.js.
 * - Sessões com token aleatório, cookie HttpOnly + Secure + SameSite=Strict, expiração e inatividade
 * - Limite de tentativas no login (por IP e por usuário) e checagem de origem (anti-CSRF)
 * - POST /api/salvar-rotas exige sessão autenticada (401 sem sessão válida)
 * - Bloqueio de acesso HTTP a arquivos sensíveis (.env, servidor.js, scripts/, rotas/, admin/, dados-admin/, .git)
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const zlib = require('zlib');
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

function registrarAuditoria(acao, ip, detalhes = '', usuario = '') {
  try {
    if (!fs.existsSync(DADOS_DIR)) fs.mkdirSync(DADOS_DIR, { recursive: true });
    const linha = JSON.stringify({
      dataHora: new Date().toISOString(),
      usuario: String(usuario || ''),
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

// Área administrativa: contas por pessoa (senha com hash + verificação em duas etapas),
// endereço oculto e dados do painel. Detalhes em admin/painel-servidor.js.
const MODO_SOMENTE_LEITURA = process.env.BUZU_PUBLIC_READONLY === '1';
const { criarPainel } = require('./admin/painel-servidor.js');
const painel = criarPainel({
  RAIZ,
  DADOS_DIR,
  BACKUPS_DIR,
  ARQ_AUDITORIA,
  somenteLeitura: MODO_SOMENTE_LEITURA,
  registrarAuditoria,
  criarBackupVersao
});

function sessaoEstaValida(req) {
  return Boolean(painel.obterSessao(req));
}

function usuarioDaSessao(req) {
  return painel.obterSessao(req)?.usuario || '';
}

// Conversão automática de ./rotas/*.kmz → dados/ — DESLIGADA por padrão.
// No Windows o fs.watch dispara até quando um arquivo é só lido (antivírus, git), e a conversão
// sobrescrevia os dados reais (paradas.json chegou a ficar com 18 paradas). Para usar de propósito,
// inicie o servidor com BUZU_AUTO_KMZ=1 (ou rode node scripts/converter-kmz.js manualmente).
if (process.env.BUZU_AUTO_KMZ === '1' && fs.existsSync(ROTAS_DIR)) {
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
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8'
};

// Endereço oficial do site. Visitas pelos endereços antigos são levadas para cá (301), para os links
// antigos continuarem funcionando e o Google não ver dois sites iguais.
const DOMINIO_PRINCIPAL = (process.env.BUZU_DOMINIO_PRINCIPAL || 'rotasnatal.com.br').trim().toLowerCase();
const DOMINIOS_ANTIGOS = new Set(
  (process.env.BUZU_DOMINIOS_ANTIGOS || 'rotasnatal.vertraweb.app,buzurotanat.vertraweb.app,www.rotasnatal.com.br')
    .split(',')
    .map(d => d.trim().toLowerCase())
    .filter(Boolean)
);

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

// ---------- Proteção anti-abuso: IP real via proxy + Rate Limit global ----------
const RATE_JANELA_MS = 60 * 1000;
const RATE_PENALIDADE_MS = 2 * 60 * 1000;
const RATE_LIMITE_GERAL = Math.max(30, Number(process.env.BUZU_RATE_LIMIT_GERAL) || 180);
const RATE_LIMITE_API = Math.max(20, Number(process.env.BUZU_RATE_LIMIT_API) || 90);
const RATE_MAX_ENTRADAS = 10000;
const baldesRateLimit = new Map(); // ip -> { inicio, geral, api, bloqueadoAte }

function normalizarIp(valor) {
  const limpo = String(valor || '')
    .trim()
    .replace(/^::ffff:/i, '')
    .slice(0, 64);
  return limpo || 'desconhecido';
}

function obterIpCliente(req) {
  const cfIp = req.headers['cf-connecting-ip'];
  if (typeof cfIp === 'string' && cfIp.trim()) return normalizarIp(cfIp.split(',')[0]);
  const realIp = req.headers['x-real-ip'];
  if (typeof realIp === 'string' && realIp.trim()) return normalizarIp(realIp.split(',')[0]);
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.trim()) return normalizarIp(xff.split(',')[0]);
  return normalizarIp(req.socket?.remoteAddress);
}

function verificarRateLimit(ip, pathname) {
  const agora = Date.now();
  let b = baldesRateLimit.get(ip);
  if (!b) {
    if (baldesRateLimit.size >= RATE_MAX_ENTRADAS) {
      // Remove entradas expiradas primeiro; se ainda lotado, limpa para impedir exaustão de memória
      for (const [k, v] of baldesRateLimit) {
        if (agora - v.inicio >= RATE_JANELA_MS && agora >= v.bloqueadoAte) baldesRateLimit.delete(k);
      }
      if (baldesRateLimit.size >= RATE_MAX_ENTRADAS) baldesRateLimit.clear();
    }
    b = { inicio: agora, geral: 0, api: 0, bloqueadoAte: 0 };
    baldesRateLimit.set(ip, b);
  }

  if (b.bloqueadoAte > agora) {
    return { permitido: false, limite: RATE_LIMITE_GERAL, restante: 0, retryAfter: Math.max(1, Math.ceil((b.bloqueadoAte - agora) / 1000)) };
  }

  if (agora - b.inicio >= RATE_JANELA_MS) {
    b.inicio = agora;
    b.geral = 0;
    b.api = 0;
    b.bloqueadoAte = 0;
  }

  const ehRotaPesada = pathname.startsWith('/api/') || pathname.startsWith('/dados/');
  b.geral += 1;
  if (ehRotaPesada) b.api += 1;

  const limiteAtivo = ehRotaPesada ? RATE_LIMITE_API : RATE_LIMITE_GERAL;
  const contagemAtiva = ehRotaPesada ? b.api : b.geral;
  const estourouGeral = b.geral > RATE_LIMITE_GERAL;
  const estourouApi = ehRotaPesada && b.api > RATE_LIMITE_API;

  if (estourouGeral || estourouApi) {
    // Se insistir em floodar além de 2x o limite, aplica bloqueio temporário de 2 minutos
    if (b.geral > RATE_LIMITE_GERAL * 2 || (ehRotaPesada && b.api > RATE_LIMITE_API * 2)) {
      b.bloqueadoAte = agora + RATE_PENALIDADE_MS;
    }
    const ate = Math.max(b.inicio + RATE_JANELA_MS, b.bloqueadoAte);
    return {
      permitido: false,
      limite: limiteAtivo,
      restante: 0,
      retryAfter: Math.max(1, Math.ceil((ate - agora) / 1000))
    };
  }

  return {
    permitido: true,
    limite: limiteAtivo,
    restante: Math.max(0, limiteAtivo - contagemAtiva),
    retryAfter: 0
  };
}

const timerLimpezaRate = setInterval(() => {
  const agora = Date.now();
  for (const [k, v] of baldesRateLimit) {
    if (agora - v.inicio >= RATE_JANELA_MS && agora >= v.bloqueadoAte) {
      baldesRateLimit.delete(k);
    }
  }
}, RATE_JANELA_MS);
timerLimpezaRate.unref();

const servidor = http.createServer(async (req, res) => {
  // Cabeçalhos de proteção (sem wildcard CORS)
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  let urlObj;
  try {
    urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  } catch (_e) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Requisição inválida');
    return;
  }
  const ipCliente = obterIpCliente(req);

  // 0a. Endereço antigo -> endereço oficial (só leitura de páginas; nunca redireciona APIs)
  const hostPedido = String(req.headers.host || '').split(':')[0].toLowerCase();
  if (
    DOMINIOS_ANTIGOS.has(hostPedido) &&
    (req.method === 'GET' || req.method === 'HEAD') &&
    !urlObj.pathname.startsWith('/api/')
  ) {
    res.writeHead(301, {
      Location: `https://${DOMINIO_PRINCIPAL}${urlObj.pathname}${urlObj.search}`,
      'Cache-Control': 'public, max-age=3600'
    });
    res.end();
    return;
  }

  // 0. Rate limit global por IP (administrador autenticado fica isento para trabalhar no editor)
  if (!sessaoEstaValida(req)) {
    const rl = verificarRateLimit(ipCliente, urlObj.pathname);
    res.setHeader('X-RateLimit-Limit', String(rl.limite));
    res.setHeader('X-RateLimit-Remaining', String(rl.restante));
    if (!rl.permitido) {
      const headers429 = { 'Retry-After': String(rl.retryAfter), 'Cache-Control': 'no-store' };
      if (urlObj.pathname.startsWith('/api/')) {
        responderJson(res, 429, { ok: false, erro: 'Muitas requisições deste endereço. Tente novamente em instantes.' }, headers429);
      } else {
        res.writeHead(429, { 'Content-Type': 'text/plain; charset=utf-8', ...headers429 });
        res.end('429 Too Many Requests — Muitas requisições em pouco tempo. Aguarde alguns segundos.');
      }
      return;
    }
  }

  // 1. Painel administrativo (login, endereço oculto, avisos, estatísticas anônimas)
  if (await painel.tratar(req, res, urlObj, ipCliente)) return;

  // 2. Alterações nas rotas antigas de admin só valem vindas do próprio site (anti-CSRF)
  if (req.method === 'POST' && urlObj.pathname.startsWith('/api/') && !painel.origemConfiavel(req)) {
    responderJson(res, 403, { ok: false, erro: 'Origem da requisição não permitida.' });
    return;
  }

  // Verificar sessão / Logout (usados pelo editor do mapa no site)
  if (req.method === 'GET' && urlObj.pathname === '/api/admin/sessao') {
    const sessao = painel.obterSessao(req);
    responderJson(res, 200, {
      autenticado: Boolean(sessao),
      usuario: sessao ? { usuario: sessao.usuario, nome: painel.nomeUsuario(sessao) } : null,
      painel: sessao ? `${painel.info.caminho}/` : null,
      somenteLeitura: MODO_SOMENTE_LEITURA
    });
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
      criarBackupVersao(`Antes de restaurar ${versao} (${usuarioDaSessao(req)})`);
      for (const nomeArq of ARQUIVOS_VERSIONADOS) {
        const src = path.join(pastaOrigem, nomeArq);
        if (fs.existsSync(src)) {
          fs.copyFileSync(src, path.join(DADOS_DIR, nomeArq));
        }
      }
      registrarAuditoria('RESTAURAR_VERSAO', ipCliente, `Restaurado backup ${versao}`, usuarioDaSessao(req));
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
    // Permite mais tempo apenas para upload autenticado de publicação grande
    req.setTimeout(120 * 1000);

    try {
      const pacote = await lerCorpoJson(req, 50 * 1024 * 1024);
      if (!pacote.indice || !pacote.paradas) {
        responderJson(res, 400, { ok: false, erro: 'Formato de pacote inválido.' });
        return;
      }

      if (!fs.existsSync(DADOS_DIR)) {
        fs.mkdirSync(DADOS_DIR, { recursive: true });
      }

      const versaoBackup = criarBackupVersao(
        `${pacote.resumoAuditoria || 'Publicação Admin'} — por ${usuarioDaSessao(req) || 'admin'}`
      );

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
        pacote.resumoAuditoria || `Publicado: ${totalLinhas} linhas, ${totalParadas} paradas (backup: ${versaoBackup || 'n/a'})`,
        usuarioDaSessao(req)
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
  let caminhoRelativo;
  try {
    caminhoRelativo = decodeURIComponent(urlObj.pathname);
  } catch (_e) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Caminho inválido');
    return;
  }
  if (caminhoRelativo === '/') caminhoRelativo = '/index.html';

  const segmentos = caminhoRelativo.split('/').filter(Boolean);
  const primeiroSeg = (segmentos[0] || '').toLowerCase();
  const bloqueados = new Set([
    '.env',
    '.env.example',
    '.git',
    'servidor.js',
    'scripts',
    'rotas',
    'node_modules',
    'admin',
    'painel',
    'dados-admin'
  ]);
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

    // Páginas: os endereços de css/js/dados ganham ?v=<versão do arquivo> (ver servirHtmlVersionado)
    if (ext === '.html') {
      servirHtmlVersionado(req, res, caminhoSeguro, stats, contentType);
      return;
    }

    // Com ?v= (endereço com a versão do arquivo): pode ficar em cache "para sempre" — quando o
    // arquivo muda, a página passa a pedir outro endereço. Sem ?v=, os dados são conferidos a cada
    // visita (ETag → 304 sem corpo), para uma publicação do admin aparecer na hora.
    const ehDados = ext === '.json' || ext === '.geojson';
    const cacheControl = urlObj.searchParams.has('v')
      ? 'public, max-age=31536000, immutable'
      : ehDados
      ? 'no-cache'
      : 'public, max-age=60';
    const etag = `W/"${stats.size.toString(16)}-${Math.floor(stats.mtimeMs).toString(16)}"`;
    const cabecalhos = {
      'Content-Type': contentType,
      'Cache-Control': cacheControl,
      ETag: etag,
      'Last-Modified': stats.mtime.toUTCString(),
      Vary: 'Accept-Encoding'
    };

    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, cabecalhos);
      res.end();
      return;
    }

    const codificacao = escolherCodificacao(req.headers['accept-encoding'], ext, stats.size);
    if (!codificacao) {
      res.writeHead(200, { ...cabecalhos, 'Content-Length': stats.size });
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(caminhoSeguro).pipe(res);
      return;
    }

    obterComprimido(caminhoSeguro, stats, codificacao, (errZip, corpo) => {
      if (errZip) {
        res.writeHead(200, cabecalhos);
        fs.createReadStream(caminhoSeguro).pipe(res);
        return;
      }
      res.writeHead(200, { ...cabecalhos, 'Content-Encoding': codificacao, 'Content-Length': corpo.length });
      res.end(req.method === 'HEAD' ? undefined : corpo);
    });
  });
});

// ---------- Páginas com endereços versionados ----------
// Cada <script src="js/..."> e <link href="css/..."> ganha ?v=<versão do arquivo> e a página recebe
// <meta name="buzu-versoes"> com as versões dos dados (usado por js/precarga.js). Assim:
// - depois de um deploy, o navegador/Cloudflare nunca mistura arquivos novos com antigos em cache;
// - no F5 o navegador só busca a página: css, js e dados já guardados são usados sem consultar o servidor.
const DADOS_VERSIONADOS = [
  'dados/linhas.json',
  'dados/paradas.json',
  'dados/linha_paradas.json',
  'dados/lote-1.geojson',
  'dados/lote-2.geojson',
  'dados/locais-natal.json',
  'dados/rede-atual.geojson' // camada opcional: fora da lista quando o arquivo não existe
];
const cacheHtml = new Map(); // caminho -> { chave, html }

function versaoDoArquivo(relativo) {
  try {
    const st = fs.statSync(path.join(RAIZ, relativo));
    return `${st.size.toString(36)}${Math.floor(st.mtimeMs).toString(36)}`;
  } catch (_e) {
    return null;
  }
}

function servirHtmlVersionado(req, res, caminho, stats, contentType) {
  fs.readFile(caminho, 'utf8', (err, bruto) => {
    if (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Erro ao ler a página');
      return;
    }
    const versoesDados = {};
    for (const rel of DADOS_VERSIONADOS) {
      const v = versaoDoArquivo(rel);
      if (v) versoesDados[rel] = v;
    }
    const html = bruto
      .replace(/(<script\b[^>]*\ssrc=")(js\/[^"?#]+\.js)(")/g, (m, a, rel, b) => {
        const v = versaoDoArquivo(rel);
        return v ? `${a}${rel}?v=${v}${b}` : m;
      })
      .replace(/(<link\b[^>]*\shref=")(css\/[^"?#]+\.css)(")/g, (m, a, rel, b) => {
        const v = versaoDoArquivo(rel);
        return v ? `${a}${rel}?v=${v}${b}` : m;
      })
      .replace(
        /<head>/i,
        `<head>\n  <meta name="buzu-versoes" content='${JSON.stringify(versoesDados)}'>`
      );

    const etag = `W/"h-${crypto.createHash('sha1').update(html).digest('hex').slice(0, 16)}"`;
    const cabecalhos = {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache',
      ETag: etag,
      Vary: 'Accept-Encoding'
    };
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, cabecalhos);
      res.end();
      return;
    }
    const corpo = Buffer.from(html, 'utf8');
    const codificacao = escolherCodificacao(req.headers['accept-encoding'], '.html', corpo.length);
    const enviar = (buf, cod) => {
      res.writeHead(200, { ...cabecalhos, ...(cod ? { 'Content-Encoding': cod } : {}), 'Content-Length': buf.length });
      res.end(req.method === 'HEAD' ? undefined : buf);
    };
    if (!codificacao) return enviar(corpo, null);
    const chave = `${etag}|${codificacao}`;
    const salvo = cacheHtml.get(caminho);
    if (salvo && salvo.chave === chave) return enviar(salvo.corpo, codificacao);
    const pronto = (errZip, comprimido) => {
      if (errZip) return enviar(corpo, null);
      cacheHtml.set(caminho, { chave, corpo: comprimido });
      enviar(comprimido, codificacao);
    };
    if (codificacao === 'br') zlib.brotliCompress(corpo, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 6 } }, pronto);
    else zlib.gzip(corpo, { level: 6 }, pronto);
  });
}

// ---------- Compressão (brotli/gzip) com cache em memória ----------
// Os arquivos de dados somam ~10 MB; comprimidos ficam ~10x menores. A versão comprimida é guardada
// em memória e refeita só quando o arquivo muda (tamanho ou data de modificação).
const EXT_COMPRIMIVEIS = new Set(['.json', '.geojson', '.js', '.css', '.html', '.svg', '.txt', '.md', '.xml']);
const cacheComprimidos = new Map(); // caminho|codificação -> { chave, corpo }

function escolherCodificacao(aceita, ext, tamanho) {
  if (!EXT_COMPRIMIVEIS.has(ext) || tamanho < 1024) return null;
  const a = String(aceita || '');
  if (/\bbr\b/.test(a)) return 'br';
  if (/\bgzip\b/.test(a)) return 'gzip';
  return null;
}

function obterComprimido(caminho, stats, codificacao, cb) {
  const chaveCache = `${caminho}|${codificacao}`;
  const versao = `${stats.size}-${stats.mtimeMs}`;
  const salvo = cacheComprimidos.get(chaveCache);
  if (salvo && salvo.versao === versao) return cb(null, salvo.corpo);
  fs.readFile(caminho, (err, bruto) => {
    if (err) return cb(err);
    const pronto = (errZip, corpo) => {
      if (errZip) return cb(errZip);
      cacheComprimidos.set(chaveCache, { versao, corpo });
      cb(null, corpo);
    };
    if (codificacao === 'br') {
      zlib.brotliCompress(
        bruto,
        {
          params: {
            [zlib.constants.BROTLI_PARAM_QUALITY]: 6,
            [zlib.constants.BROTLI_PARAM_SIZE_HINT]: bruto.length
          }
        },
        pronto
      );
    } else {
      zlib.gzip(bruto, { level: 6 }, pronto);
    }
  });
}

// Timeouts rígidos contra ataques de conexões lentas (Slowloris)
servidor.headersTimeout = 15 * 1000;
servidor.requestTimeout = 30 * 1000;
servidor.keepAliveTimeout = 5 * 1000;
servidor.maxHeadersCount = 60;
servidor.maxRequestsPerSocket = 100;

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
    } else {
      const { caminho, contas } = painel.info;
      console.log(` -> Painel: http://localhost:${porta}${caminho}/  (editor do mapa: ${caminho}/editor)`);
      if (contas === 0) {
        console.log(' -> Admin:  nenhuma conta configurada. Crie com: node scripts/admin/criar-usuario.js');
      } else {
        console.log(` -> Admin:  ${contas} conta(s) com senha + verificação em duas etapas`);
      }
    }
    console.log('===================================================================');
  });
}

iniciarServidor(PORTA_INICIAL);
