/**
 * painel/painel.js — área administrativa do BuzuRota.
 * Todo dado vindo do servidor é escapado antes de ir para a tela (esc()).
 */
(function () {
  'use strict';

  // ---------------------------------------------------------------- utilitários
  const $ = sel => document.querySelector(sel);
  const telaLogin = $('#tela-login');
  const app = $('#app');
  const alvo = $('#aba-conteudo');
  const carregando = $('#carregando');
  let usuarioAtual = null;
  let pedeCodigo = true; // false enquanto nenhuma conta usa verificação em duas etapas

  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  const fmtNum = n => Number(n || 0).toLocaleString('pt-BR');
  function fmtData(iso, comHora = true) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return esc(iso);
    return d.toLocaleString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      ...(comHora ? { hour: '2-digit', minute: '2-digit' } : {})
    });
  }
  function relativo(iso) {
    if (!iso) return '';
    const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return 'agora';
    if (s < 3600) return `há ${Math.floor(s / 60)} min`;
    if (s < 86400) return `há ${Math.floor(s / 3600)} h`;
    return `há ${Math.floor(s / 86400)} d`;
  }
  const fmtBytes = b => (b >= 1048576 ? `${(b / 1048576).toFixed(1).replace('.', ',')} MB` : `${Math.round(b / 1024)} KB`);

  function toast(msg, erro = false) {
    const t = $('#toast');
    t.textContent = msg;
    t.className = `toast${erro ? ' toast--erro' : ''}`;
    t.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => (t.hidden = true), 3500);
  }

  async function api(caminho, opcoes = {}) {
    const res = await fetch(caminho, {
      method: opcoes.metodo || 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: opcoes.corpo ? { 'Content-Type': 'application/json' } : {},
      body: opcoes.corpo ? JSON.stringify(opcoes.corpo) : undefined
    });
    const dados = await res.json().catch(() => ({}));
    if (res.status === 401 && !opcoes.login) {
      mostrarLogin('Sua sessão terminou. Entre novamente.');
      throw new Error('Sessão expirada');
    }
    if (!res.ok || dados.ok === false) throw new Error(dados.erro || `Erro ${res.status}`);
    return dados;
  }

  // ---------------------------------------------------------------- tema
  function aplicarTema(tema) {
    document.documentElement.setAttribute('data-tema', tema);
    const i = $('#btn-tema i');
    if (i) i.className = tema === 'escuro' ? 'bi bi-sun' : 'bi bi-moon-stars';
  }
  let tema = 'claro';
  try {
    tema = localStorage.getItem('buzu_tema') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'escuro' : 'claro');
  } catch (_e) {}
  aplicarTema(tema);
  $('#btn-tema').addEventListener('click', () => {
    tema = tema === 'escuro' ? 'claro' : 'escuro';
    aplicarTema(tema);
    try {
      localStorage.setItem('buzu_tema', tema);
    } catch (_e) {}
  });

  // ---------------------------------------------------------------- login
  function mostrarLogin(mensagem) {
    usuarioAtual = null;
    app.hidden = true;
    telaLogin.hidden = false;
    const erro = $('#erro-login');
    erro.hidden = !mensagem;
    erro.textContent = mensagem || '';
    document.title = 'Entrar — Painel BuzuRota';
    $('#campo-usuario').focus();
  }

  function mostrarApp(usuario) {
    usuarioAtual = usuario;
    telaLogin.hidden = true;
    app.hidden = false;
    $('#nome-usuario').textContent = usuario.nome;
    $('#avatar').textContent = (usuario.nome || usuario.usuario).trim().slice(0, 1).toUpperCase();
    abrirAba(location.hash.slice(1) || 'visao');
  }

  $('#btn-ver-senha').addEventListener('click', e => {
    const campo = $('#campo-senha');
    const ver = campo.type === 'password';
    campo.type = ver ? 'text' : 'password';
    e.currentTarget.setAttribute('aria-pressed', String(ver));
    e.currentTarget.setAttribute('aria-label', ver ? 'Esconder senha' : 'Mostrar senha');
    e.currentTarget.querySelector('i').className = ver ? 'bi bi-eye-slash' : 'bi bi-eye';
  });

  $('#campo-codigo').addEventListener('input', e => {
    e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6);
  });

  $('#form-login').addEventListener('submit', async e => {
    e.preventDefault();
    const usuario = $('#campo-usuario').value.trim();
    const senha = $('#campo-senha').value;
    const codigo = $('#campo-codigo').value.trim();
    const erro = $('#erro-login');
    if (!usuario || !senha || (pedeCodigo && codigo.length !== 6)) {
      erro.hidden = false;
      erro.textContent = pedeCodigo ? 'Preencha usuário, senha e o código de 6 dígitos.' : 'Preencha usuário e senha.';
      return;
    }
    const btn = $('#btn-entrar');
    btn.disabled = true;
    erro.hidden = true;
    try {
      const r = await api('/api/painel/login', { metodo: 'POST', corpo: { usuario, senha, codigo }, login: true });
      $('#campo-senha').value = '';
      $('#campo-codigo').value = '';
      mostrarApp(r.usuario);
    } catch (err) {
      erro.hidden = false;
      erro.textContent = err.message;
      $('#campo-codigo').value = '';
      if (pedeCodigo) $('#campo-codigo').focus();
      else $('#campo-senha').select();
    } finally {
      btn.disabled = false;
    }
  });

  $('#btn-sair').addEventListener('click', async () => {
    try {
      await api('/api/painel/logout', { metodo: 'POST', login: true });
    } catch (_e) {}
    mostrarLogin('Você saiu do painel.');
  });

  // ---------------------------------------------------------------- navegação
  const menu = $('#menu-lateral');
  $('#btn-menu').addEventListener('click', () => {
    const aberto = menu.classList.toggle('aberto');
    $('#btn-menu').setAttribute('aria-expanded', String(aberto));
  });

  const ABAS = { visao: abaVisao, interacoes: abaInteracoes, empresas: abaEmpresas, mudancas: abaMudancas, avisos: abaAvisos, log: abaLog, acessos: abaAcessos, notas: abaNotas, perfil: abaPerfil };
  const TITULOS = { visao: 'Visão geral', interacoes: 'Interações', empresas: 'Empresas operadoras', mudancas: 'Mudanças nos dados', avisos: 'Avisos do site', log: 'Log de alterações', acessos: 'Acessos e segurança', notas: 'Notas da equipe', perfil: 'Meu perfil' };

  window.addEventListener('hashchange', () => {
    if (usuarioAtual) abrirAba(location.hash.slice(1));
  });

  async function abrirAba(nome) {
    if (!ABAS[nome]) nome = 'visao';
    menu.classList.remove('aberto');
    $('#btn-menu').setAttribute('aria-expanded', 'false');
    menu.querySelectorAll('a[data-aba]').forEach(a => {
      if (a.dataset.aba === nome) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    document.title = `${TITULOS[nome]} — Painel BuzuRota`;
    carregando.hidden = false;
    alvo.innerHTML = '';
    try {
      await ABAS[nome]();
    } catch (err) {
      if (err.message !== 'Sessão expirada') alvo.innerHTML = `<div class="msg-erro">Não foi possível carregar: ${esc(err.message)}</div>`;
    } finally {
      carregando.hidden = true;
    }
  }

  function cabecalho(titulo, sub, acoes = '') {
    return `<div class="cabecalho-aba"><div><h1>${esc(titulo)}</h1>${sub ? `<p>${esc(sub)}</p>` : ''}</div>${acoes}</div>`;
  }

  /** Larguras e cores dinâmicas: CSP não permite style="" no HTML, então aplicamos via JS */
  function aplicarLarguras(raiz = alvo) {
    raiz.querySelectorAll('[data-largura]').forEach(el => {
      el.style.width = `${Math.max(0, Math.min(100, Number(el.dataset.largura)))}%`;
    });
    raiz.querySelectorAll('[data-cor]').forEach(el => {
      const c = String(el.dataset.cor || '');
      if (/^#[0-9a-f]{6}$/i.test(c)) el.style.backgroundColor = c;
    });
  }

  function graficoBarras(serie, campo = 'visitas') {
    const L = 760;
    const A = 220;
    const m = { e: 34, d: 8, t: 10, b: 28 };
    const max = Math.max(1, ...serie.map(p => p[campo] || 0));
    const passo = Math.pow(10, Math.floor(Math.log10(max)));
    const topo = Math.ceil(max / passo) * passo;
    const largura = (L - m.e - m.d) / serie.length;
    const y = v => m.t + (A - m.t - m.b) * (1 - v / topo);
    let svg = `<svg class="grafico" viewBox="0 0 ${L} ${A}" role="img" aria-label="Gráfico de ${esc(campo)} por dia">`;
    for (const v of [0, topo / 2, topo]) {
      svg += `<line class="grade-linha" x1="${m.e}" x2="${L - m.d}" y1="${y(v)}" y2="${y(v)}"/><text class="eixo" x="${m.e - 6}" y="${y(v) + 4}" text-anchor="end">${fmtNum(Math.round(v))}</text>`;
    }
    serie.forEach((p, i) => {
      const v = p[campo] || 0;
      const x = m.e + i * largura + largura * 0.15;
      const h = Math.max(v ? 2 : 0, A - m.b - y(v));
      const [ano, mes, dia] = p.dia.split('-');
      svg += `<rect class="barra" x="${x.toFixed(1)}" y="${(A - m.b - h).toFixed(1)}" width="${(largura * 0.7).toFixed(1)}" height="${h.toFixed(1)}" rx="2"><title>${dia}/${mes}/${ano}: ${fmtNum(v)}</title></rect>`;
      const cada = serie.length > 45 ? 14 : serie.length > 14 ? 5 : 1;
      if (i % cada === 0 || i === serie.length - 1) {
        svg += `<text class="eixo" x="${(x + largura * 0.35).toFixed(1)}" y="${A - 8}" text-anchor="middle">${dia}/${mes}</text>`;
      }
    });
    return `${svg}</svg>`;
  }

  function ranking(itens) {
    if (!itens.length) return '<p class="vazio">Ainda não há consultas registradas.</p>';
    const max = Math.max(...itens.map(i => i.consultas));
    return `<ol class="ranking">${itens
      .map(
        i => `<li><span class="num-linha">${esc(i.numero)}</span><span class="trilho"><span class="preenchido" data-largura="${(i.consultas / max) * 100}"></span></span><span class="qtd">${fmtNum(i.consultas)}</span></li>`
      )
      .join('')}</ol>`;
  }

  function indicador(icone, rotulo, valor, sub = '') {
    return `<div class="cartao"><div class="indicador__rotulo"><i class="bi ${icone}" aria-hidden="true"></i>${esc(rotulo)}</div><div class="indicador__valor">${valor}</div>${sub ? `<div class="indicador__sub">${sub}</div>` : ''}</div>`;
  }

  const NOMES_ACOES = {
    LOGIN: 'Entrou no painel',
    LOGOUT: 'Saiu do painel',
    PUBLICAR_ROTAS: 'Publicou dados',
    RESTAURAR_VERSAO: 'Restaurou versão',
    AVISO_CRIADO: 'Criou aviso',
    AVISO_EDITADO: 'Editou aviso',
    AVISO_EXCLUIDO: 'Excluiu aviso',
    EMPRESA_CRIADA: 'Cadastrou empresa',
    EMPRESA_EDITADA: 'Editou empresa',
    EMPRESA_EXCLUIDA: 'Excluiu empresa',
    ENCERRAR_SESSAO: 'Encerrou sessão',
    LOGIN_ADMIN: 'Entrou (chave antiga)'
  };
  const nomeAcao = a => NOMES_ACOES[a] || a;

  function cartaoSaude(icone, titulo, total, linhas, opcoes = {}) {
    const { nivel = 'alerta', vazioTexto = 'Nenhuma pendência encontrada.', subtexto = '', mostrarNotaSemTracado = false } = opcoes;
    const classeEtiqueta = total === 0 ? 'etiqueta--ok' : nivel === 'perigo' ? 'etiqueta--perigo' : 'etiqueta--alerta';
    const rotuloEtiqueta = total === 0 ? 'Tudo certo' : `${fmtNum(total)} ${total === 1 ? 'linha' : 'linhas'}`;
    const lista = linhas.length
      ? `<div class="saude-chips">${linhas
          .map(l => {
            const extra = mostrarNotaSemTracado && !l.temTracado ? ' (também sem traçado)' : '';
            const tituloLink = `${l.numero}${l.nome ? ` — ${l.nome}` : ''}${extra} • Abrir no editor`;
            const classeChip = mostrarNotaSemTracado && !l.temTracado ? 'saude-chip saude-chip--secundario' : 'saude-chip';
            return `<a class="${classeChip}" href="editor?linha=${encodeURIComponent(l.numero)}" title="${esc(tituloLink)}">${esc(l.numero)}</a>`;
          })
          .join('')}</div>`
      : `<p class="saude-vazio"><i class="bi bi-check-circle-fill" aria-hidden="true"></i> ${esc(vazioTexto)}</p>`;
    return `
      <div class="saude-bloco">
        <div class="saude-bloco__topo">
          <span class="saude-bloco__rotulo"><i class="bi ${icone}" aria-hidden="true"></i>${esc(titulo)}</span>
          <span class="etiqueta ${classeEtiqueta}">${rotuloEtiqueta}</span>
        </div>
        <div class="saude-bloco__numero">${fmtNum(total)}</div>
        ${subtexto ? `<p class="saude-bloco__sub">${esc(subtexto)}</p>` : ''}
        ${lista}
      </div>`;
  }

  // ---------------------------------------------------------------- abas
  async function abaVisao() {
    const r = await api('/api/painel/resumo');
    const i = r.interacoes;
    const d = r.dados;
    const s = d.saudeRede || {
      completas: 0,
      semTracado: { total: 0, linhas: [] },
      semTracadoDia: { total: 0, linhas: [] },
      semParadas: { total: 0, linhas: [] },
      emAtualizacao: { total: 0, linhas: [] }
    };
    const pctCompletas = d.totalLinhas ? Math.round((s.completas / d.totalLinhas) * 100) : 0;
    const subSemTracado = s.semTracadoDia?.total
      ? `Mais ${fmtNum(s.semTracadoDia.total)} ${s.semTracadoDia.total === 1 ? 'linha com traçado faltando' : 'linhas com traçado faltando'} em um dos dias.`
      : 'Sem geometria publicada nos mapas.';
    const semParadasComTracado = s.semParadas.linhas.filter(l => l.temTracado).length;
    const subSemParadas =
      s.semParadas.total > 0 && semParadasComTracado > 0
        ? `${fmtNum(semParadasComTracado)} ${semParadasComTracado === 1 ? 'já tem traçado, mas está sem paradas ligadas.' : 'já têm traçado, mas estão sem paradas ligadas.'}`
        : 'Linhas sem nenhum vínculo em linha_paradas.json.';
    alvo.innerHTML = `
      ${cabecalho(`Olá, ${usuarioAtual.nome}!`, 'Resumo do site, dos dados publicados e do servidor.')}
      <div class="grade grade--4">
        ${indicador('bi-people', 'Visitas hoje', fmtNum(i.visitasHoje), `${fmtNum(i.visitas7)} nos últimos 7 dias`)}
        ${indicador('bi-calendar3', 'Visitas em 30 dias', fmtNum(i.visitas30))}
        ${indicador('bi-bus-front', 'Linhas consultadas hoje', fmtNum(i.linhasHoje))}
        ${indicador('bi-signpost-split', 'Buscas "Como chegar" hoje', fmtNum(i.viagensHoje), `${fmtNum(i.viagens7)} em 7 dias`)}
      </div>
      <section class="cartao mt" aria-labelledby="t-saude">
        <div class="saude-cabecalho">
          <div>
            <h2 id="t-saude"><i class="bi bi-heart-pulse" aria-hidden="true"></i>Saúde da rede publicada</h2>
            <p class="saude-sub">${fmtNum(s.completas)} de ${fmtNum(d.totalLinhas)} linhas (${pctCompletas}%) com traçado, paradas vinculadas e situação regular. Clique em uma linha para abrir direto no editor.</p>
          </div>
          <a href="editor" class="btn btn--peq"><i class="bi bi-map" aria-hidden="true"></i> Abrir editor</a>
        </div>
        <div class="grade grade--3 saude-grade">
          ${cartaoSaude('bi-slash-circle', 'Sem traçado', s.semTracado.total, s.semTracado.linhas, {
            nivel: 'perigo',
            subtexto: subSemTracado,
            vazioTexto: 'Todas as linhas possuem traçado.'
          })}
          ${cartaoSaude('bi-geo-alt', 'Sem paradas vinculadas', s.semParadas.total, s.semParadas.linhas, {
            nivel: 'alerta',
            subtexto: subSemParadas,
            vazioTexto: 'Todas as linhas possuem paradas vinculadas.',
            mostrarNotaSemTracado: true
          })}
          ${cartaoSaude('bi-arrow-repeat', 'Traçado em atualização', s.emAtualizacao.total, s.emAtualizacao.linhas, {
            nivel: 'alerta',
            subtexto: 'Exibidas tracejadas no mapa público.',
            vazioTexto: 'Nenhuma linha marcada como em atualização.'
          })}
        </div>
      </section>
      <div class="grade grade--3 mt">
        <section class="cartao" aria-labelledby="t-visitas30">
          <h2 id="t-visitas30"><i class="bi bi-bar-chart" aria-hidden="true"></i>Visitas por dia (30 dias)</h2>
          ${graficoBarras(i.serie30)}
        </section>
        <section class="cartao" aria-labelledby="t-top">
          <h2 id="t-top"><i class="bi bi-trophy" aria-hidden="true"></i>Linhas mais vistas (7 dias)</h2>
          ${ranking(i.topLinhas7)}
        </section>
        <section class="cartao" aria-labelledby="t-dados">
          <h2 id="t-dados"><i class="bi bi-database" aria-hidden="true"></i>Dados publicados</h2>
          <dl class="lista-chave-valor">
            <dt>Linhas</dt><dd>${fmtNum(d.totalLinhas)}</dd>
            <dt>Paradas (ativas)</dt><dd>${fmtNum(d.totalParadas)} (${fmtNum(d.paradasAtivas)})</dd>
            <dt>Vínculos linha × parada</dt><dd>${fmtNum(d.totalVinculos)}</dd>
            <dt>Última publicação</dt><dd>${r.ultimaPublicacao ? `${fmtData(r.ultimaPublicacao.dataHora)}${r.ultimaPublicacao.usuario ? ` • ${esc(r.ultimaPublicacao.usuario)}` : ''}` : '—'}</dd>
            <dt>Versões guardadas</dt><dd>${fmtNum(r.versoes.total)}</dd>
          </dl>
        </section>
      </div>
      <div class="grade grade--3 mt">
        <section class="cartao">
          <h2><i class="bi bi-megaphone" aria-hidden="true"></i>Avisos no ar</h2>
          <div class="indicador__valor">${fmtNum(r.avisosAtivos)}</div>
          <p><a href="#avisos">Gerenciar avisos</a></p>
        </section>
        <section class="cartao">
          <h2><i class="bi bi-check2-square" aria-hidden="true"></i>Notas em aberto</h2>
          <div class="indicador__valor">${fmtNum(r.notasAbertas)}</div>
          <p><a href="#notas">Ver notas da equipe</a></p>
        </section>
        <section class="cartao">
          <h2><i class="bi bi-hdd-network" aria-hidden="true"></i>Servidor</h2>
          <dl class="lista-chave-valor">
            <dt>No ar desde</dt><dd>${fmtData(r.servidor.iniciadoEm)}</dd>
            <dt>Memória</dt><dd>${fmtNum(r.servidor.memoriaMb)} MB</dd>
            <dt>Sessões abertas</dt><dd>${fmtNum(r.servidor.sessoesAtivas)}</dd>
            <dt>Contas de admin</dt><dd>${fmtNum(r.servidor.contas)}</dd>
            <dt>Banco de dados</dt><dd>${
              r.servidor.banco?.ativo
                ? '<span class="etiqueta etiqueta--ok">PostgreSQL ativo</span>'
                : r.servidor.banco?.configurado
                ? '<span class="etiqueta etiqueta--perigo">Erro na conexão</span>'
                : '<span class="etiqueta">Arquivos locais</span>'
            }</dd>
            <dt>Node.js</dt><dd>${esc(r.servidor.node)}</dd>
          </dl>
        </section>
      </div>`;
    aplicarLarguras();
  }

  let diasInteracoes = 30;
  async function abaInteracoes() {
    const r = await api(`/api/painel/interacoes?dias=${diasInteracoes}`);
    const t = r.totais;
    const totalDisp = t.celular + t.computador || 1;
    const abas = r.abas || {};
    const totalAbas = (abas.itinerarios || 0) + (abas.como_chegar || 0) + (abas.sobre || 0);
    alvo.innerHTML = `
      ${cabecalho('Interações', 'Como as pessoas usam o site. Só contagens anônimas por dia: nada identifica quem visitou (sem cookies e sem IP guardado).',
        `<div class="segmentado" role="group" aria-label="Período">${[7, 30, 90, 365]
          .map(d => `<button type="button" data-dias="${d}" aria-pressed="${d === diasInteracoes}">${d === 365 ? '1 ano' : `${d} dias`}</button>`)
          .join('')}</div>`)}
      <div class="grade grade--4">
        ${indicador('bi-people', 'Visitas', fmtNum(t.visitas))}
        ${indicador('bi-bus-front', 'Consultas de linhas', fmtNum(r.totalConsultasLinhas))}
        ${indicador('bi-signpost-split', 'Buscas "Como chegar"', fmtNum(t.viagens))}
        ${indicador('bi-share', 'Links compartilhados', fmtNum(t.compartilhamentos))}
      </div>
      <section class="cartao mt">
        <h2><i class="bi bi-bar-chart" aria-hidden="true"></i>Visitas por dia</h2>
        ${graficoBarras(r.serie)}
      </section>
      <div class="grade grade--2 mt">
        <section class="cartao">
          <h2><i class="bi bi-trophy" aria-hidden="true"></i>Linhas mais consultadas</h2>
          ${ranking(r.topLinhas)}
        </section>
        <div>
          <section class="cartao">
            <h2><i class="bi bi-phone" aria-hidden="true"></i>Dispositivos</h2>
            <div class="divisao" role="img" aria-label="${fmtNum(t.celular)} celular, ${fmtNum(t.computador)} computador">
              <span class="d1" data-largura="${(t.celular / totalDisp) * 100}"></span><span class="d2" data-largura="${(t.computador / totalDisp) * 100}"></span>
            </div>
            <div class="legenda"><span><i class="c1"></i>Celular: ${fmtNum(t.celular)} (${Math.round((t.celular / totalDisp) * 100)}%)</span><span><i class="c2"></i>Computador: ${fmtNum(t.computador)} (${Math.round((t.computador / totalDisp) * 100)}%)</span></div>
          </section>
          <section class="cartao mt">
            <h2><i class="bi bi-ui-radios" aria-hidden="true"></i>Abas usadas</h2>
            <dl class="lista-chave-valor">
              <dt>Itinerários</dt><dd>${fmtNum(abas.itinerarios)}</dd>
              <dt>Como chegar</dt><dd>${fmtNum(abas.como_chegar)}</dd>
              <dt>Sobre o edital</dt><dd>${fmtNum(abas.sobre)}</dd>
              <dt>Total de trocas de aba</dt><dd>${fmtNum(totalAbas)}</dd>
            </dl>
          </section>
          <section class="cartao mt">
            <h2><i class="bi bi-moon-stars" aria-hidden="true"></i>Tema escuro</h2>
            <p>${fmtNum(t.temaEscuro)} das ${fmtNum(t.visitas)} visitas (${Math.round((t.temaEscuro / (t.visitas || 1)) * 100)}%) usaram o modo escuro.</p>
          </section>
        </div>
      </div>`;
    aplicarLarguras();
    alvo.querySelectorAll('[data-dias]').forEach(b =>
      b.addEventListener('click', () => {
        diasInteracoes = Number(b.dataset.dias);
        abrirAba('interacoes');
      })
    );
  }

  const LOTES_EMPRESA = {
    '': 'Não definido',
    '1': 'Lote 1 (Zona Norte)',
    '2': 'Lote 2 (Sul / Leste / Oeste)',
    '1e2': 'Lotes 1 e 2'
  };

  async function abaEmpresas(editarId = null) {
    const r = await api('/api/painel/empresas');
    const empresas = r.empresas || [];
    const todasLinhas = r.linhas || [];
    const emEdicao = editarId ? empresas.find(e => e.id === editarId) || null : null;
    const v = emEdicao || { nome: '', sigla: '', lote: '', cor: '#12355B', telefone: '', site: '', observacao: '', linhas: [] };
    const selecionadas = new Set(v.linhas || []);
    const comEmpresa = todasLinhas.filter(l => Boolean(l.empresa)).length;
    const semEmpresa = todasLinhas.length - comEmpresa;

    alvo.innerHTML = `
      ${cabecalho('Empresas operadoras', 'Cadastre as empresas ou consórcios e vincule as linhas que cada uma opera. A alteração vai direto para o site (com backup automático).')}
      <div class="grade grade--3">
        ${indicador('bi-building', 'Empresas cadastradas', fmtNum(empresas.length))}
        ${indicador('bi-check-circle', 'Linhas com empresa', fmtNum(comEmpresa), `de ${fmtNum(todasLinhas.length)} linhas`)}
        ${indicador('bi-question-circle', 'Linhas sem empresa', fmtNum(semEmpresa))}
      </div>
      <div class="grade grade--2 mt">
        <section class="cartao">
          <h2><i class="bi bi-${emEdicao ? 'pencil' : 'plus-circle'}" aria-hidden="true"></i>${emEdicao ? `Editar: ${esc(emEdicao.nome)}` : 'Nova empresa'}</h2>
          <form id="form-empresa" class="formulario-linha" novalidate>
            <div class="inteira">
              <label for="emp-nome">Nome da empresa ou consórcio *</label>
              <input id="emp-nome" maxlength="80" value="${esc(v.nome)}" placeholder="Ex.: Consórcio Potengi Norte" required>
            </div>
            <div>
              <label for="emp-sigla">Sigla (opcional)</label>
              <input id="emp-sigla" maxlength="16" value="${esc(v.sigla)}" placeholder="Ex.: CPN">
            </div>
            <div>
              <label for="emp-lote">Lote</label>
              <select id="emp-lote">
                ${Object.entries(LOTES_EMPRESA)
                  .map(([k, rot]) => `<option value="${k}"${String(v.lote || '') === k ? ' selected' : ''}>${esc(rot)}</option>`)
                  .join('')}
              </select>
            </div>
            <div>
              <label for="emp-cor">Cor de destaque</label>
              <div class="emp-cor-campo">
                <input id="emp-cor" type="color" value="${esc(/^#[0-9a-f]{6}$/i.test(v.cor || '') ? v.cor : '#12355B')}">
                <input id="emp-cor-hex" maxlength="7" value="${esc(/^#[0-9a-f]{6}$/i.test(v.cor || '') ? v.cor : '#12355B')}" aria-label="Cor em hexadecimal">
              </div>
            </div>
            <div>
              <label for="emp-tel">Telefone / SAC (opcional)</label>
              <input id="emp-tel" maxlength="40" value="${esc(v.telefone)}" placeholder="Ex.: (84) 3200-0000">
            </div>
            <div class="inteira">
              <label for="emp-site">Site oficial (opcional)</label>
              <input id="emp-site" maxlength="200" value="${esc(v.site)}" placeholder="https://...">
            </div>
            <div class="inteira">
              <label for="emp-obs">Observação (opcional)</label>
              <textarea id="emp-obs" maxlength="300" placeholder="Informações úteis exibidas no site sobre a empresa">${esc(v.observacao)}</textarea>
            </div>

            <div class="inteira">
              <label>Linhas operadas por esta empresa</label>
              <div class="emp-linhas-box">
                <div class="emp-linhas-topo">
                  <input id="emp-busca-linha" type="search" placeholder="Filtrar linha por número ou nome…" aria-label="Filtrar linhas">
                  <select id="emp-filtro-linha" aria-label="Filtrar por situação">
                    <option value="todas">Todas (${fmtNum(todasLinhas.length)})</option>
                    <option value="1">Lote 1 (Norte)</option>
                    <option value="2">Lote 2 (Sul/Leste/Oeste)</option>
                    <option value="sem">Só sem empresa</option>
                    <option value="sel">Só selecionadas</option>
                  </select>
                </div>
                <div class="emp-linhas-atalhos">
                  <button type="button" class="btn btn--peq" data-marcar-lote="1">Marcar Lote 1</button>
                  <button type="button" class="btn btn--peq" data-marcar-lote="2">Marcar Lote 2</button>
                  <button type="button" class="btn btn--peq" id="emp-desmarcar-todas">Desmarcar todas</button>
                  <span id="emp-qtd-sel" class="etiqueta etiqueta--info"></span>
                </div>
                <div id="emp-linhas-grade" class="emp-linhas-grade"></div>
              </div>
            </div>

            <div class="inteira acoes-form">
              <button type="submit" id="emp-salvar" class="btn btn--primario"><i class="bi bi-check2" aria-hidden="true"></i> ${emEdicao ? 'Salvar alterações' : 'Cadastrar e vincular linhas'}</button>
              ${emEdicao ? '<button type="button" id="emp-cancelar" class="btn">Cancelar</button>' : ''}
            </div>
          </form>
        </section>

        <section class="cartao">
          <h2><i class="bi bi-list-ul" aria-hidden="true"></i>Empresas cadastradas (${fmtNum(empresas.length)})</h2>
          ${
            empresas.length
              ? empresas
                  .map(emp => {
                    const loteTxt = emp.lote ? LOTES_EMPRESA[emp.lote] || `Lote ${emp.lote}` : '';
                    const chips = (emp.linhas || [])
                      .map(num => `<a class="saude-chip" href="editor?linha=${encodeURIComponent(num)}" title="Abrir linha ${esc(num)} no editor">${esc(num)}</a>`)
                      .join('');
                    return `<div class="item-lista">
                      <div class="item-lista__corpo">
                        <div class="item-lista__titulo emp-card-titulo">
                          <span class="emp-ponto-cor" data-cor="${esc(emp.cor || '#12355B')}" aria-hidden="true"></span>
                          <span>${esc(emp.nome)}</span>
                          ${emp.sigla ? `<span class="etiqueta">${esc(emp.sigla)}</span>` : ''}
                          ${loteTxt ? `<span class="etiqueta etiqueta--info">${esc(loteTxt)}</span>` : ''}
                          <span class="etiqueta etiqueta--ok">${fmtNum(emp.totalLinhas)} ${emp.totalLinhas === 1 ? 'linha' : 'linhas'}</span>
                        </div>
                        ${emp.observacao ? `<div>${esc(emp.observacao)}</div>` : ''}
                        ${
                          emp.telefone || emp.site
                            ? `<div class="item-lista__meta">${[emp.telefone ? `Tel.: ${esc(emp.telefone)}` : '', emp.site ? `<a href="${esc(emp.site)}" target="_blank" rel="noopener noreferrer">${esc(emp.site)}</a>` : ''].filter(Boolean).join(' • ')}</div>`
                            : ''
                        }
                        ${chips ? `<div class="emp-chips">${chips}</div>` : '<div class="item-lista__meta">Nenhuma linha vinculada ainda.</div>'}
                        <div class="item-lista__meta">Atualizada por ${esc(emp.atualizadoPor || emp.criadoPor || 'admin')} em ${fmtData(emp.atualizadoEm || emp.criadoEm)}</div>
                      </div>
                      <div class="item-lista__acoes">
                        <button type="button" class="btn btn--peq" data-editar-emp="${esc(emp.id)}"><i class="bi bi-pencil" aria-hidden="true"></i> Editar</button>
                        <button type="button" class="btn btn--peq btn--perigo" data-excluir-emp="${esc(emp.id)}" data-nome-emp="${esc(emp.nome)}"><i class="bi bi-trash" aria-hidden="true"></i> Excluir</button>
                      </div>
                    </div>`;
                  })
                  .join('')
              : '<p class="vazio">Nenhuma empresa cadastrada ainda. Cadastre ao lado e marque as linhas operadas por ela.</p>'
          }
        </section>
      </div>`;

    const corPicker = $('#emp-cor');
    const corHex = $('#emp-cor-hex');
    corPicker.addEventListener('input', () => (corHex.value = corPicker.value.toUpperCase()));
    corHex.addEventListener('input', () => {
      if (/^#[0-9a-f]{6}$/i.test(corHex.value)) corPicker.value = corHex.value;
    });

    const atualizarContador = () => {
      const n = selecionadas.size;
      $('#emp-qtd-sel').textContent = `${fmtNum(n)} ${n === 1 ? 'linha selecionada' : 'linhas selecionadas'}`;
    };

    const renderGradeLinhas = () => {
      const busca = $('#emp-busca-linha').value.trim().toLowerCase();
      const filtro = $('#emp-filtro-linha').value;
      const visiveis = todasLinhas.filter(l => {
        if (filtro === '1' && l.lote !== '1') return false;
        if (filtro === '2' && l.lote !== '2') return false;
        if (filtro === 'sem' && l.empresa) return false;
        if (filtro === 'sel' && !selecionadas.has(l.numero)) return false;
        if (busca && !`${l.numero} ${l.nome}`.toLowerCase().includes(busca)) return false;
        return true;
      });
      const grade = $('#emp-linhas-grade');
      if (!visiveis.length) {
        grade.innerHTML = '<p class="vazio">Nenhuma linha com esse filtro.</p>';
        atualizarContador();
        return;
      }
      grade.innerHTML = visiveis
        .map(l => {
          const marcada = selecionadas.has(l.numero);
          const outra = l.empresa && (!emEdicao || l.empresa_id !== emEdicao.id) ? l.empresa : '';
          return `<label class="emp-linha-item${marcada ? ' selecionada' : ''}" title="${esc(`${l.numero} — ${l.nome}`)}">
            <input type="checkbox" data-linha-emp="${esc(l.numero)}"${marcada ? ' checked' : ''}>
            <span class="emp-linha-item__info">
              <span class="emp-linha-item__num"><span class="emp-ponto-cor" data-cor="${esc(l.cor)}"></span>${esc(l.numero)}</span>
              <span class="emp-linha-item__nome">${esc(l.nome)}</span>
              ${outra ? `<span class="emp-linha-item__outra">Atual: ${esc(outra)}</span>` : ''}
            </span>
          </label>`;
        })
        .join('');
      aplicarLarguras(grade);
      grade.querySelectorAll('[data-linha-emp]').forEach(chk => {
        chk.addEventListener('change', () => {
          const num = chk.dataset.linhaEmp;
          if (chk.checked) selecionadas.add(num);
          else selecionadas.delete(num);
          chk.closest('.emp-linha-item')?.classList.toggle('selecionada', chk.checked);
          atualizarContador();
        });
      });
      atualizarContador();
    };

    $('#emp-busca-linha').addEventListener('input', renderGradeLinhas);
    $('#emp-filtro-linha').addEventListener('change', renderGradeLinhas);
    alvo.querySelectorAll('[data-marcar-lote]').forEach(btn => {
      btn.addEventListener('click', () => {
        const loteAlvo = btn.dataset.marcarLote;
        todasLinhas.filter(l => l.lote === loteAlvo).forEach(l => selecionadas.add(l.numero));
        renderGradeLinhas();
      });
    });
    $('#emp-desmarcar-todas').addEventListener('click', () => {
      selecionadas.clear();
      renderGradeLinhas();
    });

    $('#form-empresa').addEventListener('submit', async e => {
      e.preventDefault();
      const nome = $('#emp-nome').value.trim();
      if (!nome) {
        toast('Informe o nome da empresa ou consórcio.', true);
        $('#emp-nome').focus();
        return;
      }
      const btn = $('#emp-salvar');
      btn.disabled = true;
      try {
        const res = await api('/api/painel/empresas', {
          metodo: 'POST',
          corpo: {
            id: emEdicao?.id,
            nome,
            sigla: $('#emp-sigla').value.trim(),
            lote: $('#emp-lote').value,
            cor: /^#[0-9a-f]{6}$/i.test(corHex.value) ? corHex.value : corPicker.value,
            telefone: $('#emp-tel').value.trim(),
            site: $('#emp-site').value.trim(),
            observacao: $('#emp-obs').value.trim(),
            linhas: [...selecionadas]
          }
        });
        toast(`${emEdicao ? 'Empresa atualizada' : 'Empresa cadastrada'} com ${fmtNum(res.totalLinhas)} ${res.totalLinhas === 1 ? 'linha' : 'linhas'} vinculadas.`);
        abaEmpresas();
      } catch (err) {
        toast(err.message, true);
        btn.disabled = false;
      }
    });

    $('#emp-cancelar')?.addEventListener('click', () => abaEmpresas());
    alvo.querySelectorAll('[data-editar-emp]').forEach(b => b.addEventListener('click', () => abaEmpresas(b.dataset.editarEmp)));
    alvo.querySelectorAll('[data-excluir-emp]').forEach(b =>
      b.addEventListener('click', async () => {
        if (!confirm(`Excluir a empresa "${b.dataset.nomeEmp}"?\n\nAs linhas vinculadas ficarão sem empresa (um backup automático é salvo antes).`)) return;
        try {
          await api('/api/painel/empresas/excluir', { metodo: 'POST', corpo: { id: b.dataset.excluirEmp } });
          toast('Empresa excluída.');
          abaEmpresas();
        } catch (err) {
          toast(err.message, true);
        }
      })
    );

    aplicarLarguras();
    renderGradeLinhas();
  }

  async function abaMudancas() {
    const r = await api('/api/painel/versoes');
    const d = r.dados;
    alvo.innerHTML = `
      ${cabecalho('Mudanças nos dados', 'Cada publicação feita pelo editor do mapa guarda antes uma cópia dos dados (até 20 versões). Dá para voltar a qualquer uma.',
        '<a class="btn btn--primario" href="editor"><i class="bi bi-map" aria-hidden="true"></i> Abrir editor do mapa</a>')}
      <div class="grade grade--2">
        <section class="cartao">
          <h2><i class="bi bi-database" aria-hidden="true"></i>Dados no ar agora</h2>
          <dl class="lista-chave-valor">
            <dt>Linhas</dt><dd>${fmtNum(d.totalLinhas)}</dd>
            <dt>Paradas</dt><dd>${fmtNum(d.totalParadas)}</dd>
            <dt>Vínculos linha × parada</dt><dd>${fmtNum(d.totalVinculos)}</dd>
            ${Object.entries(d.porLote || {})
              .map(([k, v]) => `<dt>${esc(k)}</dt><dd>${fmtNum(v)} linhas</dd>`)
              .join('')}
          </dl>
        </section>
        <section class="cartao">
          <h2><i class="bi bi-file-earmark-code" aria-hidden="true"></i>Arquivos</h2>
          <div class="tabela-wrap"><table><thead><tr><th>Arquivo</th><th class="num">Tamanho</th><th>Alterado em</th></tr></thead><tbody>
          ${(d.arquivos || []).map(a => `<tr><td>${esc(a.nome)}</td><td class="num">${fmtBytes(a.tamanho)}</td><td>${fmtData(a.modificadoEm)}</td></tr>`).join('')}
          </tbody></table></div>
        </section>
      </div>
      <section class="cartao mt">
        <h2><i class="bi bi-clock-history" aria-hidden="true"></i>Versões guardadas</h2>
        ${
          r.versoes.length
            ? `<div class="tabela-wrap"><table><thead><tr><th>Data</th><th>Motivo</th><th class="num">Arquivos</th><th></th></tr></thead><tbody>
          ${r.versoes
            .map(
              v => `<tr><td>${fmtData(v.dataHora)}</td><td>${esc(v.motivo)}</td><td class="num">${fmtNum(v.arquivos)}</td>
              <td class="num"><button type="button" class="btn btn--peq" data-restaurar="${esc(v.versao)}"><i class="bi bi-arrow-counterclockwise" aria-hidden="true"></i> Restaurar</button></td></tr>`
            )
            .join('')}
          </tbody></table></div>`
            : '<p class="vazio">Nenhuma versão guardada ainda. Elas aparecem aqui a cada publicação.</p>'
        }
      </section>`;
    alvo.querySelectorAll('[data-restaurar]').forEach(b =>
      b.addEventListener('click', async () => {
        const versao = b.dataset.restaurar;
        if (!confirm(`Restaurar os dados para a versão de ${versao}?\n\nOs dados atuais viram uma nova versão guardada, então dá para desfazer depois.`)) return;
        b.disabled = true;
        try {
          const res = await api('/api/admin/restaurar-versao', { metodo: 'POST', corpo: { versao } });
          toast(res.mensagem || 'Versão restaurada.');
          abrirAba('mudancas');
        } catch (err) {
          toast(err.message, true);
          b.disabled = false;
        }
      })
    );
  }

  const TIPOS_AVISO = { info: 'Informação', alerta: 'Atenção', urgente: 'Urgente', sucesso: 'Novidade' };
  function situacaoAviso(a) {
    const agora = Date.now();
    if (!a.ativo) return '<span class="etiqueta">Desligado</span>';
    if (a.inicio && Date.parse(a.inicio) > agora) return '<span class="etiqueta etiqueta--alerta">Agendado</span>';
    if (a.fim && Date.parse(a.fim) < agora) return '<span class="etiqueta">Encerrado</span>';
    return '<span class="etiqueta etiqueta--ok">No ar</span>';
  }
  const paraCampoData = iso => {
    if (!iso) return '';
    const d = new Date(new Date(iso).getTime() - new Date().getTimezoneOffset() * 60000);
    return d.toISOString().slice(0, 16);
  };

  async function abaAvisos(editarId = null) {
    const r = await api('/api/painel/avisos');
    const emEdicao = r.avisos.find(a => a.id === editarId) || null;
    const v = emEdicao || { tipo: 'info', ativo: true };
    alvo.innerHTML = `
      ${cabecalho('Avisos do site', 'Mensagens que aparecem no topo do site para todo mundo (ex.: mudança de itinerário, obra, feriado). Cada pessoa pode fechar o aviso.')}
      <div class="grade grade--2">
        <section class="cartao">
          <h2><i class="bi bi-${emEdicao ? 'pencil' : 'plus-circle'}" aria-hidden="true"></i>${emEdicao ? 'Editar aviso' : 'Novo aviso'}</h2>
          <form id="form-aviso" class="formulario-linha" novalidate>
            <div class="inteira"><label for="av-titulo">Título</label><input id="av-titulo" maxlength="90" value="${esc(v.titulo)}" placeholder="Ex.: Mudança no itinerário da N-02"></div>
            <div class="inteira"><label for="av-msg">Mensagem</label><textarea id="av-msg" maxlength="600" placeholder="Texto do aviso">${esc(v.mensagem)}</textarea></div>
            <div><label for="av-tipo">Tipo</label><select id="av-tipo">${Object.entries(TIPOS_AVISO)
              .map(([k, n]) => `<option value="${k}"${v.tipo === k ? ' selected' : ''}>${n}</option>`)
              .join('')}</select></div>
            <div><label for="av-link">Link (opcional)</label><input id="av-link" maxlength="300" value="${esc(v.link)}" placeholder="https://... ou #/linha/N-02"></div>
            <div><label for="av-inicio">Mostrar a partir de</label><input id="av-inicio" type="datetime-local" value="${paraCampoData(v.inicio)}"></div>
            <div><label for="av-fim">Mostrar até</label><input id="av-fim" type="datetime-local" value="${paraCampoData(v.fim)}"></div>
            <div><label for="av-link-texto">Texto do link</label><input id="av-link-texto" maxlength="40" value="${esc(v.linkTexto)}" placeholder="Saiba mais"></div>
            <div class="check-linha"><input id="av-ativo" type="checkbox"${v.ativo ? ' checked' : ''}><label for="av-ativo">Aviso ligado</label></div>
            <div class="inteira"><div id="previa-aviso" class="previa-aviso" aria-live="polite"></div></div>
            <div class="inteira acoes-form">
              <button type="submit" class="btn btn--primario"><i class="bi bi-check2" aria-hidden="true"></i> ${emEdicao ? 'Salvar alterações' : 'Publicar aviso'}</button>
              ${emEdicao ? '<button type="button" id="av-cancelar" class="btn">Cancelar</button>' : ''}
            </div>
          </form>
        </section>
        <section class="cartao">
          <h2><i class="bi bi-list-ul" aria-hidden="true"></i>Avisos (${fmtNum(r.avisos.length)})</h2>
          ${
            r.avisos.length
              ? r.avisos
                  .map(
                    a => `<div class="item-lista"><div class="item-lista__corpo">
                <div class="item-lista__titulo">${esc(a.titulo || '(sem título)')} ${situacaoAviso(a)} <span class="etiqueta etiqueta--info">${esc(TIPOS_AVISO[a.tipo] || a.tipo)}</span></div>
                <div>${esc(a.mensagem)}</div>
                <div class="item-lista__meta">Criado por ${esc(a.criadoPor)} em ${fmtData(a.criadoEm)}${a.atualizadoPor && a.atualizadoEm !== a.criadoEm ? ` • editado por ${esc(a.atualizadoPor)} ${relativo(a.atualizadoEm)}` : ''}${a.inicio || a.fim ? ` • ${a.inicio ? `de ${fmtData(a.inicio)}` : ''} ${a.fim ? `até ${fmtData(a.fim)}` : ''}` : ''}</div>
              </div><div class="item-lista__acoes">
                <button type="button" class="btn btn--peq" data-editar="${esc(a.id)}"><i class="bi bi-pencil" aria-hidden="true"></i> Editar</button>
                <button type="button" class="btn btn--peq btn--perigo" data-excluir="${esc(a.id)}"><i class="bi bi-trash" aria-hidden="true"></i> Excluir</button>
              </div></div>`
                  )
                  .join('')
              : '<p class="vazio">Nenhum aviso criado.</p>'
          }
        </section>
      </div>`;

    const lerForm = () => ({
      id: emEdicao?.id,
      titulo: $('#av-titulo').value,
      mensagem: $('#av-msg').value,
      tipo: $('#av-tipo').value,
      link: $('#av-link').value.trim(),
      linkTexto: $('#av-link-texto').value,
      inicio: $('#av-inicio').value ? new Date($('#av-inicio').value).toISOString() : '',
      fim: $('#av-fim').value ? new Date($('#av-fim').value).toISOString() : '',
      ativo: $('#av-ativo').checked
    });
    const atualizarPrevia = () => {
      const f = lerForm();
      const p = $('#previa-aviso');
      p.className = `previa-aviso previa-aviso--${f.tipo}`;
      p.innerHTML = f.titulo || f.mensagem ? `<strong>Prévia:</strong> <strong>${esc(f.titulo)}</strong> ${esc(f.mensagem)} ${f.link ? `<a href="#" tabindex="-1">${esc(f.linkTexto || 'Saiba mais')}</a>` : ''}` : '<em>A prévia do aviso aparece aqui.</em>';
    };
    $('#form-aviso').addEventListener('input', atualizarPrevia);
    atualizarPrevia();
    $('#form-aviso').addEventListener('submit', async e => {
      e.preventDefault();
      try {
        await api('/api/painel/avisos', { metodo: 'POST', corpo: lerForm() });
        toast(emEdicao ? 'Aviso atualizado.' : 'Aviso publicado.');
        abaAvisos();
      } catch (err) {
        toast(err.message, true);
      }
    });
    $('#av-cancelar')?.addEventListener('click', () => abaAvisos());
    alvo.querySelectorAll('[data-editar]').forEach(b => b.addEventListener('click', () => abaAvisos(b.dataset.editar)));
    alvo.querySelectorAll('[data-excluir]').forEach(b =>
      b.addEventListener('click', async () => {
        if (!confirm('Excluir este aviso? Ele sai do site na hora.')) return;
        try {
          await api('/api/painel/avisos/excluir', { metodo: 'POST', corpo: { id: b.dataset.excluir } });
          toast('Aviso excluído.');
          abaAvisos();
        } catch (err) {
          toast(err.message, true);
        }
      })
    );
  }

  async function abaLog() {
    const r = await api('/api/painel/auditoria');
    const usuarios = [...new Set(r.registros.map(x => x.usuario).filter(Boolean))];
    const acoes = [...new Set(r.registros.map(x => x.acao))];
    alvo.innerHTML = `
      ${cabecalho('Log de alterações', 'Tudo o que foi feito na área administrativa: quem, quando, de onde e o quê (últimos 1000 registros).')}
      <div class="filtros">
        <input id="f-busca" type="search" placeholder="Buscar no detalhe…" aria-label="Buscar no log">
        <select id="f-usuario" aria-label="Filtrar por pessoa"><option value="">Todas as pessoas</option>${usuarios.map(u => `<option>${esc(u)}</option>`).join('')}</select>
        <select id="f-acao" aria-label="Filtrar por ação"><option value="">Todas as ações</option>${acoes.map(a => `<option value="${esc(a)}">${esc(nomeAcao(a))}</option>`).join('')}</select>
        <span id="f-total" class="etiqueta"></span>
      </div>
      <section class="cartao"><div class="tabela-wrap"><table><thead><tr><th>Quando</th><th>Quem</th><th>Ação</th><th>Detalhes</th><th>IP</th></tr></thead><tbody id="corpo-log"></tbody></table></div></section>`;
    const filtrar = () => {
      const busca = $('#f-busca').value.toLowerCase();
      const u = $('#f-usuario').value;
      const a = $('#f-acao').value;
      const lista = r.registros.filter(x => (!u || x.usuario === u) && (!a || x.acao === a) && (!busca || String(x.detalhes || '').toLowerCase().includes(busca)));
      $('#f-total').textContent = `${fmtNum(lista.length)} registro(s)`;
      $('#corpo-log').innerHTML = lista.length
        ? lista
            .slice(0, 400)
            .map(
              x => `<tr><td title="${esc(x.dataHora)}">${fmtData(x.dataHora)}</td><td>${esc(x.usuario || '—')}</td><td><span class="etiqueta etiqueta--info">${esc(nomeAcao(x.acao))}</span></td><td>${esc(x.detalhes)}</td><td>${esc(x.ip)}</td></tr>`
            )
            .join('')
        : '<tr><td colspan="5" class="vazio">Nenhum registro encontrado.</td></tr>';
    };
    ['#f-busca', '#f-usuario', '#f-acao'].forEach(s => $(s).addEventListener('input', filtrar));
    filtrar();
  }

  const RESULTADOS = {
    sucesso: ['Entrou', 'ok'],
    senha_incorreta: ['Senha errada', 'perigo'],
    codigo_incorreto: ['Código errado', 'alerta'],
    usuario_inexistente: ['Usuário inexistente', 'perigo'],
    bloqueado_ip: ['Bloqueado (IP)', 'perigo'],
    bloqueado_usuario: ['Bloqueado (usuário)', 'perigo']
  };

  async function abaAcessos() {
    const r = await api('/api/painel/acessos');
    const falhas24 = r.acessos.filter(a => a.resultado !== 'sucesso' && Date.now() - new Date(a.dataHora).getTime() < 86400000).length;
    alvo.innerHTML = `
      ${cabecalho('Acessos e segurança', 'Quem entrou, tentativas que falharam e sessões abertas agora.')}
      <div class="grade grade--3">
        ${indicador('bi-person-badge', 'Contas', fmtNum(r.contas.length), r.contas.map(c => esc(c.nome)).join(', '))}
        ${indicador('bi-laptop', 'Sessões abertas', fmtNum(r.sessoes.length))}
        ${indicador('bi-exclamation-triangle', 'Tentativas falhas (24 h)', fmtNum(falhas24), falhas24 ? 'Fique de olho se o número subir muito.' : 'Nenhuma tentativa suspeita.')}
      </div>
      <section class="cartao mt">
        <h2><i class="bi bi-laptop" aria-hidden="true"></i>Sessões abertas</h2>
        <div class="tabela-wrap"><table><thead><tr><th>Pessoa</th><th>Dispositivo</th><th>IP</th><th>Entrou</th><th>Último uso</th><th></th></tr></thead><tbody>
        ${r.sessoes
          .map(
            s => `<tr><td>${esc(s.nome)} ${s.atual ? '<span class="etiqueta etiqueta--ok">esta sessão</span>' : ''}</td><td>${esc(s.dispositivo)}</td><td>${esc(s.ip)}</td><td>${fmtData(s.criadoEm)}</td><td>${relativo(s.ultimoUso)}</td>
            <td class="num">${s.atual ? '' : `<button type="button" class="btn btn--peq btn--perigo" data-encerrar="${esc(s.id)}">Encerrar</button>`}</td></tr>`
          )
          .join('')}
        </tbody></table></div>
      </section>
      ${
        r.bloqueios.length
          ? `<section class="cartao mt"><h2><i class="bi bi-slash-circle" aria-hidden="true"></i>Bloqueios ativos</h2><ul>${r.bloqueios
              .map(b => `<li>${esc(b.tipo)} <strong>${esc(b.alvo)}</strong> até ${fmtData(b.ate)}</li>`)
              .join('')}</ul></section>`
          : ''
      }
      <section class="cartao mt">
        <h2><i class="bi bi-door-open" aria-hidden="true"></i>Histórico de entradas</h2>
        <div class="tabela-wrap"><table><thead><tr><th>Quando</th><th>Usuário</th><th>Resultado</th><th>Dispositivo</th><th>IP</th></tr></thead><tbody>
        ${
          r.acessos.length
            ? r.acessos
                .slice(0, 300)
                .map(a => {
                  const [txt, cls] = RESULTADOS[a.resultado] || [a.resultado, ''];
                  return `<tr><td>${fmtData(a.dataHora)}</td><td>${esc(a.usuario)}</td><td><span class="etiqueta etiqueta--${cls}">${esc(txt)}</span></td><td>${esc(a.dispositivo)}</td><td>${esc(a.ip)}</td></tr>`;
                })
                .join('')
            : '<tr><td colspan="5" class="vazio">Sem registros.</td></tr>'
        }
        </tbody></table></div>
      </section>`;
    alvo.querySelectorAll('[data-encerrar]').forEach(b =>
      b.addEventListener('click', async () => {
        try {
          await api('/api/painel/sessoes/encerrar', { metodo: 'POST', corpo: { id: b.dataset.encerrar } });
          toast('Sessão encerrada.');
          abaAcessos();
        } catch (err) {
          toast(err.message, true);
        }
      })
    );
  }

  const PRIORIDADES = { alta: ['Alta', 'perigo'], normal: ['Normal', 'info'], baixa: ['Baixa', ''] };
  async function abaNotas() {
    const r = await api('/api/painel/notas');
    const abertas = r.notas.filter(n => !n.feito);
    const feitas = r.notas.filter(n => n.feito);
    const item = n => {
      const [p, cls] = PRIORIDADES[n.prioridade] || PRIORIDADES.normal;
      return `<div class="item-lista${n.feito ? ' nota-feita' : ''}">
        <input type="checkbox" data-alternar="${esc(n.id)}" aria-label="Marcar como ${n.feito ? 'pendente' : 'feita'}"${n.feito ? ' checked' : ''}>
        <div class="item-lista__corpo"><div class="item-lista__titulo">${esc(n.texto)}</div>
        <div class="item-lista__meta"><span class="etiqueta etiqueta--${cls}">${p}</span> ${esc(n.autor)} • ${fmtData(n.criadoEm)}${n.feito ? ` • feita por ${esc(n.feitoPor)} ${relativo(n.feitoEm)}` : ''}</div></div>
        <div class="item-lista__acoes"><button type="button" class="btn btn--peq btn--perigo" data-excluir-nota="${esc(n.id)}" aria-label="Excluir nota"><i class="bi bi-trash" aria-hidden="true"></i></button></div>
      </div>`;
    };
    alvo.innerHTML = `
      ${cabecalho('Notas da equipe', 'Lembretes e tarefas combinadas entre vocês (ex.: conferir paradas da N-15, revisar horários de domingo).')}
      <section class="cartao">
        <form id="form-nota" class="filtros">
          <input id="nota-texto" maxlength="500" placeholder="Nova nota ou tarefa…" aria-label="Texto da nota" required>
          <select id="nota-prioridade" aria-label="Prioridade"><option value="normal">Prioridade normal</option><option value="alta">Prioridade alta</option><option value="baixa">Prioridade baixa</option></select>
          <button type="submit" class="btn btn--primario"><i class="bi bi-plus-lg" aria-hidden="true"></i> Adicionar</button>
        </form>
        <h2 class="mt">Em aberto (${fmtNum(abertas.length)})</h2>
        ${abertas.length ? abertas.map(item).join('') : '<p class="vazio">Nada pendente. 🎉</p>'}
        ${feitas.length ? `<h2 class="mt">Feitas (${fmtNum(feitas.length)})</h2>${feitas.slice(0, 50).map(item).join('')}` : ''}
      </section>`;
    $('#form-nota').addEventListener('submit', async e => {
      e.preventDefault();
      const texto = $('#nota-texto').value.trim();
      if (!texto) return;
      try {
        await api('/api/painel/notas', { metodo: 'POST', corpo: { texto, prioridade: $('#nota-prioridade').value } });
        abaNotas();
      } catch (err) {
        toast(err.message, true);
      }
    });
    alvo.querySelectorAll('[data-alternar]').forEach(c =>
      c.addEventListener('change', async () => {
        try {
          await api('/api/painel/notas/alternar', { metodo: 'POST', corpo: { id: c.dataset.alternar } });
          abaNotas();
        } catch (err) {
          toast(err.message, true);
        }
      })
    );
    alvo.querySelectorAll('[data-excluir-nota]').forEach(b =>
      b.addEventListener('click', async () => {
        if (!confirm('Excluir esta nota?')) return;
        try {
          await api('/api/painel/notas/excluir', { metodo: 'POST', corpo: { id: b.dataset.excluirNota } });
          abaNotas();
        } catch (err) {
          toast(err.message, true);
        }
      })
    );
  }

  async function abaPerfil() {
    const r = await api('/api/painel/acessos');
    const meus = r.acessos.filter(a => a.usuario === usuarioAtual.usuario);
    const ultimoOk = meus.filter(a => a.resultado === 'sucesso')[1]; // [0] é a entrada atual
    const minhasFalhas = meus.filter(a => a.resultado !== 'sucesso').slice(0, 10);
    const minhasSessoes = r.sessoes.filter(s => s.usuario === usuarioAtual.usuario);
    alvo.innerHTML = `
      ${cabecalho('Meu perfil', 'Seus dados de acesso e dicas de segurança.')}
      <div class="grade grade--2">
        <section class="cartao">
          <h2><i class="bi bi-person-circle" aria-hidden="true"></i>Conta</h2>
          <dl class="lista-chave-valor">
            <dt>Nome</dt><dd>${esc(usuarioAtual.nome)}</dd>
            <dt>Usuário</dt><dd>${esc(usuarioAtual.usuario)}</dd>
            <dt>Verificação em duas etapas</dt><dd>${usuarioAtual.doisFatores ? '<span class="etiqueta etiqueta--ok"><i class="bi bi-shield-check" aria-hidden="true"></i> Ativa</span>' : '<span class="etiqueta etiqueta--alerta">Desligada (fase de testes)</span>'}</dd>
            <dt>Entrada anterior</dt><dd>${ultimoOk ? `${fmtData(ultimoOk.dataHora)} • ${esc(ultimoOk.dispositivo)}` : '—'}</dd>
            <dt>Sessões abertas</dt><dd>${fmtNum(minhasSessoes.length)}</dd>
          </dl>
        </section>
        <section class="cartao">
          <h2><i class="bi bi-key" aria-hidden="true"></i>Trocar senha ou celular do autenticador</h2>
          <p>Por segurança, a senha não pode ser trocada por aqui (o servidor nem a conhece, só o hash dela). Para trocar:</p>
          <ol>
            <li>No seu computador, rode <code>node scripts/admin/criar-usuario.js</code> com o mesmo usuário.</li>
            <li>Cadastre a nova chave no app autenticador.</li>
            <li>Substitua a sua linha em <code>BUZU_ADMIN_USUARIOS</code> no servidor e reinicie.</li>
          </ol>
        </section>
      </div>
      <section class="cartao mt">
        <h2><i class="bi bi-exclamation-triangle" aria-hidden="true"></i>Tentativas que falharam na sua conta</h2>
        ${
          minhasFalhas.length
            ? `<div class="tabela-wrap"><table><thead><tr><th>Quando</th><th>Motivo</th><th>Dispositivo</th><th>IP</th></tr></thead><tbody>${minhasFalhas
                .map(a => `<tr><td>${fmtData(a.dataHora)}</td><td>${esc((RESULTADOS[a.resultado] || [a.resultado])[0])}</td><td>${esc(a.dispositivo)}</td><td>${esc(a.ip)}</td></tr>`)
                .join('')}</tbody></table></div>
              <p class="dica mt"><i class="bi bi-info-circle-fill" aria-hidden="true"></i><span>Se você não reconhece essas tentativas e alguma foi "Código errado", alguém pode saber sua senha: troque-a.</span></p>`
            : '<p class="vazio">Nenhuma tentativa falha. 👍</p>'
        }
      </section>
      <section class="cartao mt">
        <h2><i class="bi bi-lightbulb" aria-hidden="true"></i>Boas práticas</h2>
        <ul>
          <li>Não salve a senha em navegadores de computadores compartilhados.</li>
          <li>Use "Sair" ao terminar; a sessão também fecha sozinha após 1 hora sem uso.</li>
          <li>Não compartilhe o endereço do painel nem prints com o código do autenticador.</li>
        </ul>
      </section>`;
  }

  // ---------------------------------------------------------------- início
  (async () => {
    try {
      const r = await api('/api/painel/sessao', { login: true });
      if (!r.configurado) $('#aviso-sem-contas').hidden = false;
      pedeCodigo = r.pedeCodigo !== false;
      $('#grupo-codigo').hidden = !pedeCodigo;
      $('#campo-codigo').required = pedeCodigo;
      if (r.autenticado) mostrarApp(r.usuario);
      else mostrarLogin('');
    } catch (_e) {
      mostrarLogin('Não foi possível falar com o servidor.');
    }
  })();
})();
