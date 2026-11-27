/**
 * admin/painel-servidor.js
 * Área administrativa oculta do BuzuRota (zero dependências).
 *
 * Segurança do login:
 * - Uma conta por pessoa, definida em BUZU_ADMIN_USUARIOS (.env / variável de ambiente do servidor).
 *   O servidor guarda só o HASH da senha (scrypt com sal aleatório) — a senha em si nunca fica salva
 *   em lugar nenhum. As contas são criadas com: node scripts/admin/criar-usuario.js
 * - Verificação em duas etapas obrigatória (TOTP: Google Authenticator, Authy, Microsoft Authenticator...).
 *   Mesmo que alguém descubra a senha, sem o celular da pessoa não entra.
 * - Sessão em cookie HttpOnly + Secure + SameSite=Strict (scripts da página não leem o cookie e outros
 *   sites não conseguem usá-lo). O servidor guarda só o hash do token da sessão.
 * - Limite de tentativas por IP e por usuário, mesma resposta genérica para qualquer erro,
 *   bloqueio de reuso do mesmo código de 6 dígitos e checagem de origem (anti-CSRF) em toda alteração.
 * - Endereço do painel definido por BUZU_PAINEL_CAMINHO (não aparece no site nem no código público).
 *
 * Dados do painel ficam em dados-admin/ (bloqueado para acesso HTTP direto e fora do Git).
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const TTL_SESSAO_MS = 8 * 60 * 60 * 1000; // duração máxima de uma sessão
const INATIVIDADE_MS = 60 * 60 * 1000; // sai sozinho após 1 h sem uso
const MAX_FALHAS_IP = 5;
const MAX_FALHAS_USUARIO = 8;
const BLOQUEIO_MS = 15 * 60 * 1000;
const PARAMS_SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

// ---------------------------------------------------------------------------
// Utilitários de criptografia
// ---------------------------------------------------------------------------
const ALFABETO_B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Decodificar(texto) {
  const limpo = String(texto || '').toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let valor = 0;
  const saida = [];
  for (const ch of limpo) {
    valor = (valor << 5) | ALFABETO_B32.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      saida.push((valor >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(saida);
}

function codigoTotp(segredo, contador) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(contador));
  const hmac = crypto.createHmac('sha1', segredo).update(buf).digest();
  const desloc = hmac[hmac.length - 1] & 0x0f;
  const num = (hmac.readUInt32BE(desloc) & 0x7fffffff) % 1000000;
  return String(num).padStart(6, '0');
}

/** Retorna o contador do código aceito (janela de ±30 s) ou -1 */
function verificarTotp(segredoBase32, codigo) {
  const c = String(codigo || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(c)) return -1;
  const segredo = base32Decodificar(segredoBase32);
  if (segredo.length < 10) return -1;
  const agora = Math.floor(Date.now() / 30000);
  for (const delta of [0, -1, 1]) {
    const esperado = codigoTotp(segredo, agora + delta);
    if (crypto.timingSafeEqual(Buffer.from(esperado), Buffer.from(c))) return agora + delta;
  }
  return -1;
}

function verificarSenha(senha, hashSalvo) {
  return new Promise(resolve => {
    const partes = String(hashSalvo || '').split('$');
    if (partes.length !== 6 || partes[0] !== 'scrypt') return resolve(false);
    const [, N, r, p, salB64, hashB64] = partes;
    const esperado = Buffer.from(hashB64, 'base64');
    crypto.scrypt(
      String(senha || ''),
      Buffer.from(salB64, 'base64'),
      esperado.length,
      { N: Number(N), r: Number(r), p: Number(p), maxmem: PARAMS_SCRYPT.maxmem },
      (err, derivado) => {
        if (err || derivado.length !== esperado.length) return resolve(false);
        resolve(crypto.timingSafeEqual(derivado, esperado));
      }
    );
  });
}

// hash "falso" usado quando o usuário não existe, para o tempo de resposta não denunciar quem existe
const HASH_FALSO = `scrypt$${PARAMS_SCRYPT.N}$${PARAMS_SCRYPT.r}$${PARAMS_SCRYPT.p}$${crypto
  .randomBytes(16)
  .toString('base64')}$${crypto.randomBytes(32).toString('base64')}`;

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

// ---------------------------------------------------------------------------
// Contas: BUZU_ADMIN_USUARIOS="usuario:Nome%20Exibido:scrypt$...:SEGREDOTOTP;outro:..."
// ---------------------------------------------------------------------------
function lerUsuarios(texto) {
  const mapa = new Map();
  for (const bloco of String(texto || '').split(';')) {
    const partes = bloco.trim().split(':');
    // 4 partes: conta com verificação em duas etapas; 3 partes: só usuário e senha (fase de testes)
    if (partes.length !== 4 && partes.length !== 3) continue;
    const [usuario, nome, hash, totp = ''] = partes.map(s => s.trim());
    if (!/^[a-z0-9._-]{3,32}$/.test(usuario) || !hash.startsWith('scrypt$')) continue;
    let nomeExibido = usuario;
    try {
      nomeExibido = decodeURIComponent(nome) || usuario;
    } catch (_e) {}
    mapa.set(usuario, { usuario, nome: nomeExibido.slice(0, 60), hash, totp });
  }
  return mapa;
}

// ---------------------------------------------------------------------------
// Persistência simples em JSON / JSONL dentro de dados-admin/
// ---------------------------------------------------------------------------
function criarArmazem(pasta) {
  if (!fs.existsSync(pasta)) fs.mkdirSync(pasta, { recursive: true });
  const arq = nome => path.join(pasta, nome);
  return {
    lerJson(nome, padrao) {
      try {
        return JSON.parse(fs.readFileSync(arq(nome), 'utf8'));
      } catch (_e) {
        return padrao;
      }
    },
    gravarJson(nome, valor) {
      const destino = arq(nome);
      const temp = `${destino}.tmp`;
      fs.writeFileSync(temp, JSON.stringify(valor, null, 1), 'utf8');
      fs.renameSync(temp, destino);
    },
    anexarLinha(nome, obj) {
      fs.appendFileSync(arq(nome), JSON.stringify(obj) + '\n', 'utf8');
    },
    lerLinhas(nome, limite) {
      try {
        const linhas = fs.readFileSync(arq(nome), 'utf8').split(/\r?\n/).filter(Boolean);
        const saida = [];
        for (const l of linhas.slice(-limite).reverse()) {
          try {
            saida.push(JSON.parse(l));
          } catch (_e) {}
        }
        return saida;
      } catch (_e) {
        return [];
      }
    }
  };
}

function resumoDispositivo(ua) {
  const u = String(ua || '');
  const so = /android/i.test(u)
    ? 'Android'
    : /iphone|ipad|ios/i.test(u)
    ? 'iOS'
    : /windows/i.test(u)
    ? 'Windows'
    : /mac os/i.test(u)
    ? 'macOS'
    : /linux/i.test(u)
    ? 'Linux'
    : 'Outro';
  const nav = /edg\//i.test(u)
    ? 'Edge'
    : /opr\//i.test(u)
    ? 'Opera'
    : /chrome\//i.test(u)
    ? 'Chrome'
    : /firefox\//i.test(u)
    ? 'Firefox'
    : /safari\//i.test(u)
    ? 'Safari'
    : 'Navegador';
  return `${nav} • ${so}`;
}

function textoLimpo(valor, max) {
  return String(valor == null ? '' : valor)
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')
    .trim()
    .slice(0, max);
}

function idAleatorio() {
  return crypto.randomBytes(8).toString('hex');
}

function diaLocal(data = new Date()) {
  // dia no fuso de Brasília (UTC-3), para as estatísticas baterem com o dia de quem usa o site
  const d = new Date(data.getTime() - 3 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Painel
// ---------------------------------------------------------------------------
function criarPainel(opcoes) {
  const { RAIZ, DADOS_DIR, BACKUPS_DIR, ARQ_AUDITORIA, somenteLeitura, registrarAuditoria, criarBackupVersao } = opcoes;
  const PASTA_ADMIN = path.join(RAIZ, 'dados-admin');
  const PASTA_FRONT = path.join(RAIZ, 'painel');
  const armazem = criarArmazem(PASTA_ADMIN);

  const usuarios = lerUsuarios(process.env.BUZU_ADMIN_USUARIOS);
  // Endereço padrão do painel: /use-admin (pode ser trocado por BUZU_PAINEL_CAMINHO no servidor)
  const CAMINHO_PADRAO = 'use-admin';
  let caminhoPainel = textoLimpo(process.env.BUZU_PAINEL_CAMINHO, 64).replace(/^\/+|\/+$/g, '');
  const caminhoFoiGerado = false;
  if (!/^[A-Za-z0-9._-]{6,64}$/.test(caminhoPainel)) {
    caminhoPainel = CAMINHO_PADRAO;
  }
  const prefixo = `/${caminhoPainel}`;

  const sessoes = new Map(); // hash do token -> { id, usuario, criadoEm, ultimoUso, expiraEm, ip, dispositivo }
  const falhasIp = new Map(); // ip -> { falhas, bloqueadoAte }
  const falhasUsuario = new Map(); // usuario -> { falhas, bloqueadoAte }
  const ultimoContadorTotp = new Map(); // usuario -> contador já usado (impede reuso do código)
  const iniciadoEm = Date.now();

  // ----- sessão -----
  function lerCookie(req, nome) {
    for (const parte of String(req.headers.cookie || '').split(';')) {
      const [k, ...v] = parte.trim().split('=');
      if (k === nome) return decodeURIComponent(v.join('='));
    }
    return '';
  }

  function ehHttps(req) {
    const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
    return proto === 'https' || /"scheme":"https"/.test(String(req.headers['cf-visitor'] || '')) || Boolean(req.socket.encrypted);
  }

  function nomeCookie(req) {
    // __Host- exige HTTPS, Path=/ e sem Domain: o cookie não pode ser plantado por subdomínios
    return ehHttps(req) ? '__Host-buzu_sessao' : 'buzu_sessao';
  }

  function obterSessao(req) {
    if (somenteLeitura) return null;
    const token = lerCookie(req, '__Host-buzu_sessao') || lerCookie(req, 'buzu_sessao');
    if (!token) return null;
    const chave = hashToken(token);
    const s = sessoes.get(chave);
    if (!s) return null;
    const agora = Date.now();
    if (agora > s.expiraEm || agora - s.ultimoUso > INATIVIDADE_MS || !usuarios.has(s.usuario)) {
      sessoes.delete(chave);
      return null;
    }
    s.ultimoUso = agora;
    return s;
  }

  function cookieSessao(req, token, maxAgeSeg) {
    const seguro = ehHttps(req) ? '; Secure' : '';
    return `${nomeCookie(req)}=${token ? encodeURIComponent(token) : ''}; HttpOnly${seguro}; SameSite=Strict; Path=/; Max-Age=${maxAgeSeg}`;
  }

  /** Anti-CSRF: alterações só aceitas vindas do próprio site */
  function origemConfiavel(req) {
    const origem = req.headers.origin || req.headers.referer;
    if (!origem) return req.headers['sec-fetch-site'] === 'same-origin';
    try {
      return new URL(origem).host === req.headers.host;
    } catch (_e) {
      return false;
    }
  }

  function bloqueio(mapa, chave) {
    const r = mapa.get(chave);
    return r && Date.now() < r.bloqueadoAte ? r.bloqueadoAte : 0;
  }

  function registrarFalha(mapa, chave, limite) {
    const r = mapa.get(chave) || { falhas: 0, bloqueadoAte: 0 };
    if (Date.now() >= r.bloqueadoAte && r.bloqueadoAte) {
      r.falhas = 0;
      r.bloqueadoAte = 0;
    }
    r.falhas += 1;
    if (r.falhas >= limite) {
      r.bloqueadoAte = Date.now() + BLOQUEIO_MS;
      r.falhas = 0;
    }
    mapa.set(chave, r);
  }

  function registrarAcesso(usuario, resultado, ip, req) {
    try {
      armazem.anexarLinha('acessos.jsonl', {
        dataHora: new Date().toISOString(),
        usuario: textoLimpo(usuario, 40) || '(vazio)',
        resultado,
        ip: String(ip || ''),
        dispositivo: resumoDispositivo(req.headers['user-agent'])
      });
    } catch (_e) {}
  }

  // ----- estatísticas anônimas de uso (sem IP, sem cookie, sem identificação) -----
  let estatisticas = armazem.lerJson('estatisticas.json', { dias: {} });
  if (!estatisticas || typeof estatisticas.dias !== 'object') estatisticas = { dias: {} };
  let estatisticasSujas = false;
  const limiteEventosIp = new Map(); // ip -> { minuto, qtd } (só em memória, para evitar abuso)

  function diaEstat(dia) {
    if (!estatisticas.dias[dia]) {
      estatisticas.dias[dia] = { visitas: 0, celular: 0, computador: 0, linhas: {}, viagens: 0, compartilhamentos: 0, abas: {}, temaEscuro: 0 };
    }
    return estatisticas.dias[dia];
  }

  function somar(obj, chave, qtd = 1) {
    obj[chave] = (obj[chave] || 0) + qtd;
  }

  function registrarEvento(evento) {
    const d = diaEstat(diaLocal());
    const tipo = String(evento.tipo || '');
    const valor = String(evento.valor || '');
    if (tipo === 'visita') {
      d.visitas += 1;
      if (evento.celular) d.celular += 1;
      else d.computador += 1;
      if (evento.escuro) d.temaEscuro += 1;
    } else if (tipo === 'linha' && /^[A-Za-z0-9-]{1,10}$/.test(valor)) {
      const lim = Object.keys(d.linhas).length;
      if (d.linhas[valor.toUpperCase()] || lim < 400) somar(d.linhas, valor.toUpperCase());
    } else if (tipo === 'viagem') {
      d.viagens += 1;
    } else if (tipo === 'compartilhar') {
      d.compartilhamentos += 1;
    } else if (tipo === 'aba' && ['itinerarios', 'como_chegar', 'sobre'].includes(valor)) {
      somar(d.abas, valor);
    } else {
      return;
    }
    estatisticasSujas = true;
  }

  function gravarEstatisticas() {
    if (!estatisticasSujas) return;
    // mantém ~400 dias
    const dias = Object.keys(estatisticas.dias).sort();
    for (const velho of dias.slice(0, Math.max(0, dias.length - 400))) delete estatisticas.dias[velho];
    try {
      armazem.gravarJson('estatisticas.json', estatisticas);
      estatisticasSujas = false;
    } catch (_e) {}
  }
  const timerEstat = setInterval(gravarEstatisticas, 30000);
  timerEstat.unref?.();
  for (const sinal of ['SIGINT', 'SIGTERM']) {
    process.once(sinal, () => {
      gravarEstatisticas();
      process.exit(0);
    });
  }

  function serieInteracoes(qtdDias) {
    const serie = [];
    const totais = { visitas: 0, celular: 0, computador: 0, viagens: 0, compartilhamentos: 0, temaEscuro: 0 };
    const linhas = {};
    const abas = {};
    for (let i = qtdDias - 1; i >= 0; i--) {
      const dia = diaLocal(new Date(Date.now() - i * 86400000));
      const d = estatisticas.dias[dia] || {};
      serie.push({ dia, visitas: d.visitas || 0, viagens: d.viagens || 0, linhas: Object.values(d.linhas || {}).reduce((s, v) => s + v, 0) });
      for (const k of Object.keys(totais)) totais[k] += d[k] || 0;
      for (const [k, v] of Object.entries(d.linhas || {})) linhas[k] = (linhas[k] || 0) + v;
      for (const [k, v] of Object.entries(d.abas || {})) abas[k] = (abas[k] || 0) + v;
    }
    const topLinhas = Object.entries(linhas)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([numero, consultas]) => ({ numero, consultas }));
    return { serie, totais, topLinhas, abas, totalConsultasLinhas: Object.values(linhas).reduce((s, v) => s + v, 0) };
  }

  // ----- resumo dos dados publicados -----
  let cacheResumoDados = { chave: '', valor: null };
  function resumoDados() {
    const arquivos = ['linhas.json', 'paradas.json', 'linha_paradas.json', 'lote-1.geojson', 'lote-2.geojson'];
    const infos = arquivos.map(nome => {
      try {
        const st = fs.statSync(path.join(DADOS_DIR, nome));
        return { nome, tamanho: st.size, modificadoEm: st.mtime.toISOString() };
      } catch (_e) {
        return { nome, tamanho: 0, modificadoEm: null };
      }
    });
    const chave = infos.map(i => `${i.tamanho}-${i.modificadoEm}`).join('|');
    if (cacheResumoDados.chave === chave) return cacheResumoDados.valor;
    const ler = nome => {
      try {
        return JSON.parse(fs.readFileSync(path.join(DADOS_DIR, nome), 'utf8'));
      } catch (_e) {
        return null;
      }
    };
    const indice = ler('linhas.json');
    const paradas = ler('paradas.json');
    const vinculos = ler('linha_paradas.json');
    const lote1 = ler('lote-1.geojson');
    const lote2 = ler('lote-2.geojson');
    const linhas = indice?.linhas || [];
    const porLote = {};
    const porCategoria = {};
    for (const l of linhas) {
      somar(porLote, `Lote ${l.lote || '?'}`);
      somar(porCategoria, l.categoria || l.tipo || 'Outras');
    }

    // Saúde da rede: linhas sem traçado, sem paradas vinculadas ou em "traçado em atualização"
    const temGeometriaValida = f => {
      const g = f?.geometry;
      if (!g || !Array.isArray(g.coordinates)) return false;
      if (g.type === 'LineString') return g.coordinates.length >= 2;
      if (g.type === 'MultiLineString') return g.coordinates.some(c => Array.isArray(c) && c.length >= 2);
      return false;
    };
    const diasPorLinha = new Map();
    const alteradaNoGeo = new Set();
    for (const geo of [lote1, lote2]) {
      for (const f of geo?.features || []) {
        const num = String(f?.properties?.numero || f?.properties?.linha_id || '').trim().toUpperCase();
        if (!num) continue;
        if (f?.properties?.situacao_rota === 'alterada') alteradaNoGeo.add(num);
        if (!temGeometriaValida(f)) continue;
        const dia = String(f?.properties?.dia_semana || 'dias_uteis_sabados');
        if (!diasPorLinha.has(num)) diasPorLinha.set(num, new Set());
        diasPorLinha.get(num).add(dia);
      }
    }
    const linhasComParada = new Set();
    if (Array.isArray(vinculos)) {
      for (const v of vinculos) {
        const num = String(v?.linha_id || '').trim().toUpperCase();
        if (num) linhasComParada.add(num);
      }
    }

    const semTracado = [];
    const semTracadoDia = [];
    const semParadas = [];
    const emAtualizacao = [];
    let completas = 0;

    for (const l of linhas) {
      const numero = String(l.numero || l.id || '').trim().toUpperCase();
      if (!numero) continue;
      const situacao = String(l.situacao_rota || '').trim().toLowerCase();
      const diasGeo = diasPorLinha.get(numero) || new Set();
      const temTracado = diasGeo.size > 0 && situacao !== 'indisponivel';
      const temParadas = linhasComParada.has(numero);
      const atualizando = situacao === 'alterada' || alteradaNoGeo.has(numero);
      const itemBase = {
        numero,
        nome: String(l.nome || ''),
        lote: String(l.lote || ''),
        situacao: situacao || 'disponivel',
        temTracado
      };

      if (!temTracado) {
        semTracado.push(itemBase);
      } else {
        const diasEsperados = Array.isArray(l.dias_disponiveis) ? l.dias_disponiveis : [];
        const faltando = diasEsperados.filter(d => (d === 'dias_uteis_sabados' || d === 'domingos_feriados') && !diasGeo.has(d));
        if (faltando.length > 0) {
          semTracadoDia.push({ ...itemBase, diasFaltando: faltando });
        }
      }
      if (!temParadas) semParadas.push(itemBase);
      if (atualizando) emAtualizacao.push(itemBase);
      if (temTracado && temParadas && !atualizando) completas += 1;
    }

    const ordenarLinhas = arr => arr.sort((a, b) => a.numero.localeCompare(b.numero, 'pt-BR', { numeric: true }));
    ordenarLinhas(semTracado);
    ordenarLinhas(semTracadoDia);
    ordenarLinhas(semParadas);
    ordenarLinhas(emAtualizacao);

    const feats = paradas?.features || [];
    const valor = {
      totalLinhas: linhas.length,
      totalParadas: feats.length,
      paradasAtivas: feats.filter(f => f.properties?.ativo !== false).length,
      totalVinculos: Array.isArray(vinculos) ? vinculos.length : 0,
      porLote,
      porCategoria,
      saudeRede: {
        completas,
        semTracado: { total: semTracado.length, linhas: semTracado },
        semTracadoDia: { total: semTracadoDia.length, linhas: semTracadoDia },
        semParadas: { total: semParadas.length, linhas: semParadas },
        emAtualizacao: { total: emAtualizacao.length, linhas: emAtualizacao }
      },
      versaoDados: indice?.versao || '',
      atualizadoEm: indice?.atualizado_em || '',
      arquivos: infos
    };
    cacheResumoDados = { chave, valor };
    return valor;
  }

  function listarVersoes() {
    const lista = [];
    if (!fs.existsSync(BACKUPS_DIR)) return lista;
    const pastas = fs
      .readdirSync(BACKUPS_DIR)
      .filter(n => /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/.test(n))
      .sort()
      .reverse();
    for (const p of pastas) {
      let meta = { versao: p, dataHora: p, motivo: 'Backup automático' };
      try {
        meta = { ...meta, ...JSON.parse(fs.readFileSync(path.join(BACKUPS_DIR, p, 'meta.json'), 'utf8')) };
      } catch (_e) {}
      lista.push(meta);
    }
    return lista;
  }

  function lerAuditoria(limite) {
    try {
      const linhas = fs.readFileSync(ARQ_AUDITORIA, 'utf8').split(/\r?\n/).filter(Boolean);
      const saida = [];
      for (const l of linhas.slice(-limite).reverse()) {
        try {
          saida.push(JSON.parse(l));
        } catch (_e) {}
      }
      return saida;
    } catch (_e) {
      return [];
    }
  }

  // ----- avisos públicos e notas internas -----
  function lerAvisos() {
    const l = armazem.lerJson('avisos.json', []);
    return Array.isArray(l) ? l : [];
  }

  function avisosAtivos() {
    const agora = Date.now();
    return lerAvisos()
      .filter(a => a.ativo && (!a.inicio || Date.parse(a.inicio) <= agora) && (!a.fim || Date.parse(a.fim) >= agora))
      .map(({ id, titulo, mensagem, tipo, link, linkTexto }) => ({ id, titulo, mensagem, tipo, link, linkTexto }));
  }

  function validarAviso(corpo) {
    const tipo = ['info', 'alerta', 'urgente', 'sucesso'].includes(corpo.tipo) ? corpo.tipo : 'info';
    let link = textoLimpo(corpo.link, 300);
    if (link && !/^https:\/\/[^\s"'<>]+$/i.test(link) && !/^\/[^\s"'<>]*$/.test(link) && !/^#\/[^\s"'<>]*$/.test(link)) {
      link = '';
    }
    const data = v => {
      const t = textoLimpo(v, 40);
      return t && !Number.isNaN(Date.parse(t)) ? new Date(t).toISOString() : '';
    };
    return {
      titulo: textoLimpo(corpo.titulo, 90),
      mensagem: textoLimpo(corpo.mensagem, 600),
      tipo,
      link,
      linkTexto: textoLimpo(corpo.linkTexto, 40),
      inicio: data(corpo.inicio),
      fim: data(corpo.fim),
      ativo: Boolean(corpo.ativo)
    };
  }

  function lerNotas() {
    const l = armazem.lerJson('notas.json', []);
    return Array.isArray(l) ? l : [];
  }

  // ----- empresas operadoras e vínculo com linhas (em dados/linhas.json) -----
  function lerIndiceLinhas() {
    const arq = path.join(DADOS_DIR, 'linhas.json');
    return JSON.parse(fs.readFileSync(arq, 'utf8'));
  }

  function gravarIndiceLinhas(indice) {
    const arq = path.join(DADOS_DIR, 'linhas.json');
    const temp = `${arq}.tmp`;
    indice.atualizado_em = new Date().toISOString();
    fs.writeFileSync(temp, JSON.stringify(indice, null, 2), 'utf8');
    fs.renameSync(temp, arq);
    cacheResumoDados = null;
  }

  function validarEmpresa(corpo) {
    const nome = textoLimpo(corpo.nome, 80);
    const sigla = textoLimpo(corpo.sigla, 16).toUpperCase();
    const lote = ['1', '2', '1e2'].includes(String(corpo.lote || '')) ? String(corpo.lote) : '';
    const corBruta = textoLimpo(corpo.cor, 12);
    const cor = /^#[0-9a-f]{6}$/i.test(corBruta) ? corBruta.toUpperCase() : '#12355B';
    const telefone = textoLimpo(corpo.telefone, 40);
    let site = textoLimpo(corpo.site, 200);
    if (site && !/^https?:\/\/[^\s"'<>]+$/i.test(site)) {
      site = '';
    }
    const observacao = textoLimpo(corpo.observacao, 300);
    const linhas = Array.isArray(corpo.linhas)
      ? [...new Set(corpo.linhas.map(x => textoLimpo(x, 20).toUpperCase()).filter(Boolean))]
      : [];
    return { nome, sigla, lote, cor, telefone, site, observacao, linhas };
  }

  function resumoEmpresasELinhas() {
    const indice = lerIndiceLinhas();
    const empresasBase = Array.isArray(indice.empresas) ? indice.empresas : [];
    const linhasRaw = Array.isArray(indice.linhas) ? indice.linhas : [];

    const porEmpresaId = new Map();
    const porEmpresaNome = new Map();
    for (const emp of empresasBase) {
      if (emp?.id) porEmpresaId.set(String(emp.id), []);
      if (emp?.nome) porEmpresaNome.set(String(emp.nome).trim().toLowerCase(), String(emp.id));
    }

    const linhas = linhasRaw
      .map(l => {
        const numero = String(l.numero || l.id || '').trim().toUpperCase();
        let empId = l.empresa_id ? String(l.empresa_id) : null;
        const empNome = l.empresa ? String(l.empresa).trim() : null;
        if (!empId && empNome) {
          empId = porEmpresaNome.get(empNome.toLowerCase()) || null;
        }
        if (empId && porEmpresaId.has(empId)) {
          porEmpresaId.get(empId).push(numero);
        }
        return {
          numero,
          nome: String(l.nome || ''),
          lote: String(l.lote || ''),
          tipo: String(l.tipo || ''),
          categoria: String(l.categoria_edital || l.tipo || ''),
          cor: String(l.cor || '#12355B'),
          empresa: empNome,
          empresa_id: empId
        };
      })
      .filter(l => l.numero)
      .sort((a, b) => a.numero.localeCompare(b.numero, 'pt-BR', { numeric: true }));

    const empresas = empresasBase
      .map(emp => {
        const nums = (porEmpresaId.get(String(emp.id)) || []).sort((a, b) =>
          a.localeCompare(b, 'pt-BR', { numeric: true })
        );
        return {
          ...emp,
          linhas: nums,
          totalLinhas: nums.length
        };
      })
      .sort((a, b) => String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR'));

    return { empresas, linhas };
  }

  // ----- respostas -----
  function json(res, status, payload, extras = {}) {
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...extras
    });
    res.end(JSON.stringify(payload));
  }

  function lerCorpo(req, limite = 32 * 1024) {
    return new Promise((resolve, reject) => {
      let tam = 0;
      const partes = [];
      req.on('data', c => {
        tam += c.length;
        if (tam > limite) {
          req.destroy();
          reject(new Error('Conteúdo grande demais.'));
          return;
        }
        partes.push(c);
      });
      req.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(partes).toString('utf8') || '{}'));
        } catch (_e) {
          reject(new Error('JSON inválido.'));
        }
      });
      req.on('error', reject);
    });
  }

  const TIPOS_FRONT = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
  const CSP_PAINEL = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' https://fonts.googleapis.com https://cdn.jsdelivr.net",
    "font-src 'self' https://fonts.gstatic.com https://cdn.jsdelivr.net",
    "img-src 'self' data:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'"
  ].join('; ');

  // Editor do mapa: precisa do Leaflet/MapLibre (unpkg), dos fundos de mapa, do roteamento pelas
  // ruas (OSRM) e da busca de endereços (Nominatim). Continua sem scripts de terceiros fora desses.
  const CSP_EDITOR = [
    "default-src 'self'",
    "script-src 'self' https://unpkg.com",
    "style-src 'self' 'unsafe-inline' https://unpkg.com https://fonts.googleapis.com https://cdn.jsdelivr.net",
    "font-src 'self' https://fonts.gstatic.com https://cdn.jsdelivr.net",
    "img-src 'self' data: blob: https://tiles.openfreemap.org https://*.tile.openstreetmap.org https://server.arcgisonline.com https://unpkg.com",
    "connect-src 'self' https://tiles.openfreemap.org https://router.project-osrm.org https://nominatim.openstreetmap.org https://unpkg.com",
    "worker-src blob:",
    "child-src blob:",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'"
  ].join('; ');

  function servirArquivoPainel(res, nome) {
    const permitido = {
      '': 'index.html',
      'index.html': 'index.html',
      'painel.js': 'painel.js',
      'painel.css': 'painel.css',
      editor: 'editor.html',
      'editor.html': 'editor.html',
      'editor.js': 'editor.js',
      'editor.css': 'editor.css'
    };
    const arquivo = permitido[nome];
    if (!arquivo) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Arquivo não encontrado');
      return;
    }
    fs.readFile(path.join(PASTA_FRONT, arquivo), (err, conteudo) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Arquivo não encontrado');
        return;
      }
      res.writeHead(200, {
        'Content-Type': TIPOS_FRONT[path.extname(arquivo)],
        'Cache-Control': 'no-store',
        'Content-Security-Policy': arquivo.startsWith('editor') ? CSP_EDITOR : CSP_PAINEL,
        'X-Robots-Tag': 'noindex, nofollow',
        'X-Frame-Options': 'DENY'
      });
      res.end(conteudo);
    });
  }

  function exigirSessao(req, res, alterar = false) {
    const s = obterSessao(req);
    if (!s) {
      json(res, 401, { ok: false, erro: 'Sessão expirada. Entre novamente.' });
      return null;
    }
    if (alterar && !origemConfiavel(req)) {
      json(res, 403, { ok: false, erro: 'Origem da requisição não permitida.' });
      return null;
    }
    return s;
  }

  /**
   * Trata as rotas do painel. Retorna true se a requisição foi respondida aqui.
   */
  async function tratar(req, res, urlObj, ip) {
    const p = urlObj.pathname;
    const metodo = req.method;

    // HSTS: depois da primeira visita por HTTPS, o navegador nunca mais usa HTTP neste site
    if (ehHttps(req)) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');

    // ---------- Páginas do painel (endereço oculto) ----------
    if (p === prefixo) {
      res.writeHead(301, { Location: `${prefixo}/`, 'Cache-Control': 'no-store' });
      res.end();
      return true;
    }
    if (p.startsWith(`${prefixo}/`)) {
      if (metodo !== 'GET' && metodo !== 'HEAD') {
        res.writeHead(405);
        res.end();
        return true;
      }
      servirArquivoPainel(res, p.slice(prefixo.length + 1));
      return true;
    }

    // ---------- Rotas públicas ----------
    if (p === '/api/avisos' && metodo === 'GET') {
      json(res, 200, { ok: true, avisos: avisosAtivos() }, { 'Cache-Control': 'no-cache' });
      return true;
    }

    if (p === '/api/evento' && metodo === 'POST') {
      // estatística anônima: nada que identifique a pessoa é guardado
      const minuto = Math.floor(Date.now() / 60000);
      const lim = limiteEventosIp.get(ip);
      if (lim && lim.minuto === minuto && lim.qtd >= 40) {
        res.writeHead(204);
        res.end();
        return true;
      }
      limiteEventosIp.set(ip, { minuto, qtd: lim && lim.minuto === minuto ? lim.qtd + 1 : 1 });
      if (limiteEventosIp.size > 5000) limiteEventosIp.clear();
      if (origemConfiavel(req)) {
        try {
          registrarEvento(await lerCorpo(req, 1024));
        } catch (_e) {}
      }
      res.writeHead(204);
      res.end();
      return true;
    }

    if (!p.startsWith('/api/painel/')) return false;

    // ---------- Login ----------
    if (p === '/api/painel/login' && metodo === 'POST') {
      if (somenteLeitura || usuarios.size === 0) {
        json(res, 403, { ok: false, erro: 'Área administrativa desativada neste servidor.' });
        return true;
      }
      if (!origemConfiavel(req)) {
        json(res, 403, { ok: false, erro: 'Origem da requisição não permitida.' });
        return true;
      }
      const ateIp = bloqueio(falhasIp, ip);
      if (ateIp) {
        registrarAcesso('', 'bloqueado_ip', ip, req);
        json(res, 429, { ok: false, erro: 'Muitas tentativas. Aguarde alguns minutos e tente de novo.' });
        return true;
      }
      let corpo;
      try {
        corpo = await lerCorpo(req, 4096);
      } catch (err) {
        json(res, 400, { ok: false, erro: err.message });
        return true;
      }
      const nomeUsuario = textoLimpo(corpo.usuario, 40).toLowerCase();
      const conta = usuarios.get(nomeUsuario);
      if (conta && bloqueio(falhasUsuario, nomeUsuario)) {
        registrarAcesso(nomeUsuario, 'bloqueado_usuario', ip, req);
        json(res, 429, { ok: false, erro: 'Muitas tentativas. Aguarde alguns minutos e tente de novo.' });
        return true;
      }
      const senhaOk = await verificarSenha(corpo.senha, conta ? conta.hash : HASH_FALSO);
      // contas sem chave do autenticador (fase de testes) entram só com a senha
      const contador = !conta || !senhaOk ? -1 : conta.totp ? verificarTotp(conta.totp, corpo.codigo) : 0;
      const codigoReusado = Boolean(conta?.totp) && contador !== -1 && ultimoContadorTotp.get(nomeUsuario) >= contador;
      if (!conta || !senhaOk || contador === -1 || codigoReusado) {
        registrarFalha(falhasIp, ip, MAX_FALHAS_IP);
        if (conta) registrarFalha(falhasUsuario, nomeUsuario, MAX_FALHAS_USUARIO);
        registrarAcesso(nomeUsuario, !conta ? 'usuario_inexistente' : !senhaOk ? 'senha_incorreta' : 'codigo_incorreto', ip, req);
        // atraso fixo: deixa tentativas em massa ainda mais lentas
        await new Promise(r => setTimeout(r, 400));
        json(res, 401, { ok: false, erro: 'Usuário, senha ou código inválidos.' });
        return true;
      }
      if (conta.totp) ultimoContadorTotp.set(nomeUsuario, contador);
      falhasIp.delete(ip);
      falhasUsuario.delete(nomeUsuario);
      const token = crypto.randomBytes(32).toString('base64url');
      const agora = Date.now();
      sessoes.set(hashToken(token), {
        id: idAleatorio(),
        usuario: nomeUsuario,
        criadoEm: agora,
        ultimoUso: agora,
        expiraEm: agora + TTL_SESSAO_MS,
        ip,
        dispositivo: resumoDispositivo(req.headers['user-agent'])
      });
      registrarAcesso(nomeUsuario, 'sucesso', ip, req);
      registrarAuditoria('LOGIN', ip, 'Entrou no painel', nomeUsuario);
      json(res, 200, { ok: true, usuario: { usuario: conta.usuario, nome: conta.nome, doisFatores: Boolean(conta.totp) } }, { 'Set-Cookie': cookieSessao(req, token, Math.floor(TTL_SESSAO_MS / 1000)) });
      return true;
    }

    if (p === '/api/painel/sessao' && metodo === 'GET') {
      const s = obterSessao(req);
      const conta = s && usuarios.get(s.usuario);
      json(res, 200, {
        autenticado: Boolean(conta),
        configurado: usuarios.size > 0 && !somenteLeitura,
        // o campo do código só aparece se alguma conta usa verificação em duas etapas
        pedeCodigo: [...usuarios.values()].some(c => c.totp),
        usuario: conta ? { usuario: conta.usuario, nome: conta.nome, doisFatores: Boolean(conta.totp) } : null
      });
      return true;
    }

    if (p === '/api/painel/logout' && metodo === 'POST') {
      const token = lerCookie(req, '__Host-buzu_sessao') || lerCookie(req, 'buzu_sessao');
      const s = token && sessoes.get(hashToken(token));
      if (s) {
        registrarAuditoria('LOGOUT', ip, 'Saiu do painel', s.usuario);
        sessoes.delete(hashToken(token));
      }
      json(res, 200, { ok: true }, { 'Set-Cookie': cookieSessao(req, '', 0) });
      return true;
    }

    // ---------- Daqui para baixo: só com sessão ----------
    const alterar = metodo !== 'GET';
    const sessao = exigirSessao(req, res, alterar);
    if (!sessao) return true;
    const quem = sessao.usuario;

    try {
      if (p === '/api/painel/resumo' && metodo === 'GET') {
        const hoje = serieInteracoes(1);
        const semana = serieInteracoes(7);
        const mes = serieInteracoes(30);
        const versoes = listarVersoes();
        const ultimaPublicacao = lerAuditoria(400).find(r => r.acao === 'PUBLICAR_ROTAS' || r.acao === 'RESTAURAR_VERSAO') || null;
        const mem = process.memoryUsage();
        json(res, 200, {
          ok: true,
          interacoes: {
            visitasHoje: hoje.totais.visitas,
            visitas7: semana.totais.visitas,
            visitas30: mes.totais.visitas,
            linhasHoje: hoje.totalConsultasLinhas,
            viagensHoje: hoje.totais.viagens,
            viagens7: semana.totais.viagens,
            serie30: mes.serie,
            topLinhas7: semana.topLinhas.slice(0, 5)
          },
          dados: resumoDados(),
          versoes: { total: versoes.length, ultima: versoes[0] || null },
          ultimaPublicacao,
          avisosAtivos: avisosAtivos().length,
          notasAbertas: lerNotas().filter(n => !n.feito).length,
          servidor: {
            iniciadoEm: new Date(iniciadoEm).toISOString(),
            node: process.version,
            memoriaMb: Math.round(mem.rss / 1048576),
            sessoesAtivas: [...sessoes.values()].filter(s => Date.now() <= s.expiraEm).length,
            contas: usuarios.size
          }
        });
        return true;
      }

      if (p === '/api/painel/interacoes' && metodo === 'GET') {
        const dias = Math.min(365, Math.max(1, Number(urlObj.searchParams.get('dias')) || 30));
        json(res, 200, { ok: true, dias, ...serieInteracoes(dias) });
        return true;
      }

      if (p === '/api/painel/auditoria' && metodo === 'GET') {
        json(res, 200, { ok: true, registros: lerAuditoria(1000) });
        return true;
      }

      if (p === '/api/painel/versoes' && metodo === 'GET') {
        json(res, 200, { ok: true, versoes: listarVersoes(), dados: resumoDados() });
        return true;
      }

      if (p === '/api/painel/acessos' && metodo === 'GET') {
        const agora = Date.now();
        const ativas = [...sessoes.values()]
          .filter(s => agora <= s.expiraEm)
          .map(s => ({
            id: s.id,
            usuario: s.usuario,
            nome: usuarios.get(s.usuario)?.nome || s.usuario,
            criadoEm: new Date(s.criadoEm).toISOString(),
            ultimoUso: new Date(s.ultimoUso).toISOString(),
            ip: s.ip,
            dispositivo: s.dispositivo,
            atual: s === sessao
          }));
        const bloqueios = [];
        for (const [k, r] of falhasIp) if (agora < r.bloqueadoAte) bloqueios.push({ tipo: 'IP', alvo: k, ate: new Date(r.bloqueadoAte).toISOString() });
        for (const [k, r] of falhasUsuario) if (agora < r.bloqueadoAte) bloqueios.push({ tipo: 'Usuário', alvo: k, ate: new Date(r.bloqueadoAte).toISOString() });
        json(res, 200, {
          ok: true,
          acessos: armazem.lerLinhas('acessos.jsonl', 500),
          sessoes: ativas,
          bloqueios,
          contas: [...usuarios.values()].map(c => ({ usuario: c.usuario, nome: c.nome }))
        });
        return true;
      }

      if (p === '/api/painel/sessoes/encerrar' && metodo === 'POST') {
        const corpo = await lerCorpo(req);
        for (const [chave, s] of sessoes) {
          if (s.id === corpo.id) {
            sessoes.delete(chave);
            registrarAuditoria('ENCERRAR_SESSAO', ip, `Encerrou uma sessão de ${s.usuario} (${s.dispositivo})`, quem);
          }
        }
        json(res, 200, { ok: true });
        return true;
      }

      if (p === '/api/painel/avisos' && metodo === 'GET') {
        json(res, 200, { ok: true, avisos: lerAvisos() });
        return true;
      }

      if (p === '/api/painel/avisos' && metodo === 'POST') {
        const corpo = await lerCorpo(req);
        const dados = validarAviso(corpo);
        if (!dados.titulo && !dados.mensagem) {
          json(res, 400, { ok: false, erro: 'Informe ao menos o título ou a mensagem.' });
          return true;
        }
        const lista = lerAvisos();
        const agora = new Date().toISOString();
        const existente = lista.find(a => a.id === corpo.id);
        if (existente) {
          Object.assign(existente, dados, { atualizadoPor: quem, atualizadoEm: agora });
          registrarAuditoria('AVISO_EDITADO', ip, `Editou o aviso "${dados.titulo || dados.mensagem.slice(0, 40)}"`, quem);
        } else {
          lista.unshift({ id: idAleatorio(), ...dados, criadoPor: quem, criadoEm: agora, atualizadoPor: quem, atualizadoEm: agora });
          registrarAuditoria('AVISO_CRIADO', ip, `Criou o aviso "${dados.titulo || dados.mensagem.slice(0, 40)}"`, quem);
        }
        armazem.gravarJson('avisos.json', lista.slice(0, 200));
        json(res, 200, { ok: true });
        return true;
      }

      if (p === '/api/painel/avisos/excluir' && metodo === 'POST') {
        const corpo = await lerCorpo(req);
        const lista = lerAvisos();
        const alvo = lista.find(a => a.id === corpo.id);
        armazem.gravarJson('avisos.json', lista.filter(a => a.id !== corpo.id));
        if (alvo) registrarAuditoria('AVISO_EXCLUIDO', ip, `Excluiu o aviso "${alvo.titulo || ''}"`, quem);
        json(res, 200, { ok: true });
        return true;
      }

      if (p === '/api/painel/notas' && metodo === 'GET') {
        json(res, 200, { ok: true, notas: lerNotas() });
        return true;
      }

      if (p === '/api/painel/notas' && metodo === 'POST') {
        const corpo = await lerCorpo(req);
        const texto = textoLimpo(corpo.texto, 500);
        if (!texto) {
          json(res, 400, { ok: false, erro: 'Escreva a nota.' });
          return true;
        }
        const prioridade = ['baixa', 'normal', 'alta'].includes(corpo.prioridade) ? corpo.prioridade : 'normal';
        const lista = lerNotas();
        lista.unshift({ id: idAleatorio(), texto, prioridade, autor: quem, criadoEm: new Date().toISOString(), feito: false });
        armazem.gravarJson('notas.json', lista.slice(0, 500));
        json(res, 200, { ok: true });
        return true;
      }

      if (p === '/api/painel/notas/alternar' && metodo === 'POST') {
        const corpo = await lerCorpo(req);
        const lista = lerNotas();
        const n = lista.find(x => x.id === corpo.id);
        if (n) {
          n.feito = !n.feito;
          n.feitoPor = n.feito ? quem : '';
          n.feitoEm = n.feito ? new Date().toISOString() : '';
          armazem.gravarJson('notas.json', lista);
        }
        json(res, 200, { ok: true });
        return true;
      }

      if (p === '/api/painel/notas/excluir' && metodo === 'POST') {
        const corpo = await lerCorpo(req);
        armazem.gravarJson('notas.json', lerNotas().filter(x => x.id !== corpo.id));
        json(res, 200, { ok: true });
        return true;
      }

      if (p === '/api/painel/empresas' && metodo === 'GET') {
        json(res, 200, { ok: true, ...resumoEmpresasELinhas() });
        return true;
      }

      if (p === '/api/painel/empresas' && metodo === 'POST') {
        const corpo = await lerCorpo(req, 128 * 1024);
        const dados = validarEmpresa(corpo);
        if (!dados.nome) {
          json(res, 400, { ok: false, erro: 'Informe o nome da empresa ou consórcio.' });
          return true;
        }

        const indice = lerIndiceLinhas();
        if (!Array.isArray(indice.empresas)) indice.empresas = [];
        const agora = new Date().toISOString();
        const idEdit = textoLimpo(corpo.id, 40);
        const existente = idEdit ? indice.empresas.find(e => e.id === idEdit) : null;

        // Evita duplicar nome de empresa
        const conflito = indice.empresas.find(
          e => e.id !== existente?.id && String(e.nome || '').trim().toLowerCase() === dados.nome.toLowerCase()
        );
        if (conflito) {
          json(res, 400, { ok: false, erro: `Já existe uma empresa cadastrada com o nome "${dados.nome}".` });
          return true;
        }

        const nomeAntigo = existente ? String(existente.nome || '').trim().toLowerCase() : '';
        const { linhas: linhasSelecionadas, ...camposEmpresa } = dados;
        const setSelecionadas = new Set(linhasSelecionadas);

        if (typeof criarBackupVersao === 'function') {
          criarBackupVersao(
            `${existente ? 'Editar' : 'Cadastrar'} empresa "${dados.nome}" (${setSelecionadas.size} linhas) — por ${quem}`
          );
        }

        let registro;
        if (existente) {
          Object.assign(existente, camposEmpresa, { atualizadoPor: quem, atualizadoEm: agora });
          registro = existente;
        } else {
          registro = {
            id: `emp-${idAleatorio().slice(0, 10)}`,
            ...camposEmpresa,
            criadoPor: quem,
            criadoEm: agora,
            atualizadoPor: quem,
            atualizadoEm: agora
          };
          indice.empresas.push(registro);
        }

        let vinculadas = 0;
        for (const linha of indice.linhas || []) {
          const num = String(linha.numero || linha.id || '').trim().toUpperCase();
          if (!num) continue;
          const pertenciaAntes =
            (linha.empresa_id && String(linha.empresa_id) === registro.id) ||
            (nomeAntigo && String(linha.empresa || '').trim().toLowerCase() === nomeAntigo);

          if (setSelecionadas.has(num)) {
            linha.empresa_id = registro.id;
            linha.empresa = registro.nome;
            vinculadas++;
          } else if (pertenciaAntes) {
            linha.empresa = null;
            delete linha.empresa_id;
          }
        }

        gravarIndiceLinhas(indice);
        registrarAuditoria(
          existente ? 'EMPRESA_EDITADA' : 'EMPRESA_CRIADA',
          ip,
          `${existente ? 'Editou' : 'Cadastrou'} a empresa "${registro.nome}" (${vinculadas} ${vinculadas === 1 ? 'linha' : 'linhas'})`,
          quem
        );
        json(res, 200, { ok: true, empresa: registro, totalLinhas: vinculadas });
        return true;
      }

      if (p === '/api/painel/empresas/excluir' && metodo === 'POST') {
        const corpo = await lerCorpo(req);
        const idAlvo = textoLimpo(corpo.id, 40);
        const indice = lerIndiceLinhas();
        if (!Array.isArray(indice.empresas)) indice.empresas = [];
        const alvo = indice.empresas.find(e => e.id === idAlvo);
        if (!alvo) {
          json(res, 404, { ok: false, erro: 'Empresa não encontrada.' });
          return true;
        }

        if (typeof criarBackupVersao === 'function') {
          criarBackupVersao(`Excluir empresa "${alvo.nome}" — por ${quem}`);
        }

        const nomeAlvo = String(alvo.nome || '').trim().toLowerCase();
        indice.empresas = indice.empresas.filter(e => e.id !== idAlvo);
        let desvinculadas = 0;
        for (const linha of indice.linhas || []) {
          const pertence =
            (linha.empresa_id && String(linha.empresa_id) === idAlvo) ||
            (nomeAlvo && String(linha.empresa || '').trim().toLowerCase() === nomeAlvo);
          if (pertence) {
            linha.empresa = null;
            delete linha.empresa_id;
            desvinculadas++;
          }
        }

        gravarIndiceLinhas(indice);
        registrarAuditoria(
          'EMPRESA_EXCLUIDA',
          ip,
          `Excluiu a empresa "${alvo.nome}" (${desvinculadas} ${desvinculadas === 1 ? 'linha desvinculada' : 'linhas desvinculadas'})`,
          quem
        );
        json(res, 200, { ok: true });
        return true;
      }
    } catch (err) {
      json(res, 400, { ok: false, erro: err.message || 'Erro ao processar.' });
      return true;
    }

    json(res, 404, { ok: false, erro: 'Rota não encontrada.' });
    return true;
  }

  return {
    tratar,
    obterSessao,
    origemConfiavel,
    nomeUsuario: s => (s && usuarios.get(s.usuario)?.nome) || '',
    info: { caminho: prefixo, caminhoFoiGerado, contas: usuarios.size }
  };
}

module.exports = { criarPainel, base32Decodificar, codigoTotp, PARAMS_SCRYPT };
