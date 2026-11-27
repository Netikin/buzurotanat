/**
 * js/app.js
 * Controlador Principal — Nova rede de ônibus, Concorrência Pública nº 11.001/2026 (STTU / Prefeitura do Natal).
 * - Diretriz DSGov / eMAG / USWDS + Fluxo Cartográfico MTA / Metropolin
 * - Dois pontos de entrada claros ("Onde estou / Endereço" e "Qual é a linha?") com navegação por teclado (↑ ↓ Enter Esc)
 * - Fluxo de dois níveis no painel lateral / bottom sheet (Terminal/Ponto -> Linhas; Linha -> Paradas e Detalhes)
 */

(function () {
  'use strict';

  const estadoUI = {
    diaSemana: 'dias_uteis_sabados',
    horarioViagemManual: false,
    filtroRede: 'transicao',
    filtroLote: 'todos',
    filtroTipo: 'todos',
    filtroAcessivel: false,
    mostrarRedeAtual: false,
    termoBuscaLinha: '',
    localizacaoUsuario: null,
    paradasProximas: [],
    paradaSelecionadaId: null,
    linhaSelecionadaId: null,
    indiceTecladoEndereco: -1,
    indiceTecladoLinha: -1,
    abaBusca: 'endereco',
    origemViagem: null,
    destinoViagem: null,
    viagemAtiva: null,
    indiceTrajetoEscolhido: 0,
    linhasViagem: [],
    etapasViagem: []
  };

  document.addEventListener('DOMContentLoaded', async () => {
    configurarAcessibilidadeTopo();
    configurarBotoesDiaSemana();
    configurarToggleLinhas();
    configurarBottomSheetMobile();
    configurarAbasBusca();
    configurarBuscaViagem();
    configurarBuscaDiretaLinhaEFiltros();

    // Os dados começam a carregar já; o mapa base é montado enquanto isso (não espera os dados)
    const promessaDados = window.BuzuDados.inicializar();

    window.BuzuMapa.inicializar('mapa', {
      aoClicarLinha: (idLinha, diaDaFeature) => {
        if (diaDaFeature && diaDaFeature !== estadoUI.diaSemana && estadoUI.diaSemana !== 'todos') {
          definirDiaSemana(diaDaFeature, false);
        }
        ajustarBottomSheetMobile('meio');
        window.location.hash = `#/linha/${encodeURIComponent(idLinha)}`;
      },
      aoMoverPontoViagem: (tipo, lat, lng) => {
        void definirPontoViagemPeloMapa(tipo, lat, lng);
      },
      aoClicarParada: idParada => {
        ajustarBottomSheetMobile('meio');
        window.location.hash = `#/parada/${encodeURIComponent(idParada)}`;
      }
    });

    const dadosEstado = await promessaDados;

    const containerFiltroRedeAtual = document.getElementById('container-filtro-rede-atual');
    if (containerFiltroRedeAtual) {
      containerFiltroRedeAtual.hidden = !dadosEstado.temRedeAtual;
    }

    // Modo escuro: troca o mapa base e redesenha linhas/paradas com as cores do tema
    document.addEventListener('buzu:tema', async e => {
      window.BuzuMapa.definirTemaMapa(e.detail?.tema === 'escuro');
      await atualizarMapaEListagens();
    });

    window.addEventListener('hashchange', processarRotaHash);
    await atualizarMapaEListagens(true);
    await processarRotaHash();

    registrarEvento('visita', '', {
      celular: window.matchMedia?.('(max-width: 760px)').matches || false,
      escuro: document.documentElement.getAttribute('data-tema') === 'escuro'
    });
    carregarAvisosPublicos();
    document.querySelector('a.btn-menu[href="sobre.html"]')?.addEventListener('click', () => registrarEvento('aba', 'sobre'));
  });

  // ---------- Estatísticas anônimas de uso (painel administrativo) ----------
  // Só contagens agregadas por dia: nada que identifique a pessoa (sem cookie, sem IP guardado).
  let ultimaLinhaRegistrada = '';
  function registrarEvento(tipo, valor = '', extras = {}) {
    try {
      const corpo = JSON.stringify({ tipo, valor: String(valor || ''), ...extras });
      const blob = new Blob([corpo], { type: 'text/plain' });
      if (!(navigator.sendBeacon && navigator.sendBeacon('/api/evento', blob))) {
        fetch('/api/evento', { method: 'POST', body: corpo, keepalive: true, credentials: 'omit' }).catch(() => {});
      }
    } catch (_e) {
      /* estatística nunca atrapalha o site */
    }
  }

  // ---------- Avisos publicados pela equipe no painel ----------
  const CHAVE_AVISOS_FECHADOS = 'buzu_avisos_fechados';
  function lerAvisosFechados() {
    try {
      return JSON.parse(localStorage.getItem(CHAVE_AVISOS_FECHADOS) || '[]');
    } catch (_e) {
      return [];
    }
  }

  async function carregarAvisosPublicos() {
    let avisos = [];
    try {
      const r = await fetch('/api/avisos', { cache: 'no-cache' });
      if (r.ok) avisos = (await r.json()).avisos || [];
    } catch (_e) {
      return;
    }
    const fechados = new Set(lerAvisosFechados());
    const visiveis = avisos.filter(a => a && a.id && !fechados.has(a.id));
    if (!visiveis.length) return;
    const ancora = document.querySelector('.aviso-independencia');
    if (!ancora) return;
    const lista = document.createElement('div');
    lista.className = 'avisos-publicos';
    const icones = { info: 'bi-info-circle-fill', alerta: 'bi-exclamation-triangle-fill', urgente: 'bi-exclamation-octagon-fill', sucesso: 'bi-check-circle-fill' };
    for (const a of visiveis) {
      const tipo = icones[a.tipo] ? a.tipo : 'info';
      const item = document.createElement('div');
      item.className = `aviso-publico aviso-publico--${tipo}`;
      item.setAttribute('role', tipo === 'urgente' ? 'alert' : 'status');
      const icone = document.createElement('i');
      icone.className = `bi ${icones[tipo]}`;
      icone.setAttribute('aria-hidden', 'true');
      const texto = document.createElement('div');
      texto.className = 'aviso-publico__texto';
      if (a.titulo) {
        const t = document.createElement('strong');
        t.textContent = a.titulo;
        texto.appendChild(t);
      }
      if (a.mensagem) {
        const m = document.createElement('span');
        m.textContent = a.mensagem;
        texto.appendChild(m);
      }
      if (a.link && (/^https:\/\//i.test(a.link) || /^[/#]/.test(a.link))) {
        const l = document.createElement('a');
        l.href = a.link;
        l.textContent = a.linkTexto || 'Saiba mais';
        if (/^https:/i.test(a.link)) {
          l.target = '_blank';
          l.rel = 'noopener noreferrer';
        }
        texto.appendChild(l);
      }
      const fechar = document.createElement('button');
      fechar.type = 'button';
      fechar.className = 'aviso-publico__fechar';
      fechar.setAttribute('aria-label', 'Fechar aviso');
      fechar.innerHTML = '<i class="bi bi-x-lg" aria-hidden="true"></i>';
      fechar.addEventListener('click', () => {
        item.remove();
        try {
          const ids = [...new Set([...lerAvisosFechados(), a.id])].slice(-50);
          localStorage.setItem(CHAVE_AVISOS_FECHADOS, JSON.stringify(ids));
        } catch (_e) {}
      });
      item.append(icone, texto, fechar);
      lista.appendChild(item);
    }
    ancora.insertAdjacentElement('afterend', lista);
  }

  function configurarAcessibilidadeTopo() {
    const btnContraste = document.getElementById('btn-alto-contraste');
    const btnFonteMaior = document.getElementById('btn-fonte-maior');
    const btnFonteNormal = document.getElementById('btn-fonte-normal');

    if (localStorage.getItem('buzu_alto_contraste') === '1') {
      document.body.classList.add('alto-contraste');
      if (btnContraste) btnContraste.setAttribute('aria-pressed', 'true');
    }

    btnContraste?.addEventListener('click', () => {
      const ativo = document.body.classList.toggle('alto-contraste');
      btnContraste.setAttribute('aria-pressed', String(ativo));
      localStorage.setItem('buzu_alto_contraste', ativo ? '1' : '0');
    });

    btnFonteMaior?.addEventListener('click', () => {
      document.documentElement.style.fontSize = '18px';
    });

    btnFonteNormal?.addEventListener('click', () => {
      document.documentElement.style.fontSize = '16px';
    });
  }

  function configurarToggleLinhas() {
    const secao = document.getElementById('secao-lista-linhas');
    const btn = document.getElementById('btn-toggle-linhas');
    if (!secao || !btn) return;

    btn.addEventListener('click', () => {
      const expandido = btn.getAttribute('aria-expanded') === 'true';
      const novoEstado = !expandido;
      btn.setAttribute('aria-expanded', String(novoEstado));
      btn.setAttribute('aria-label', novoEstado ? 'Recolher linhas propostas' : 'Mostrar linhas propostas');
      secao.classList.toggle('secao-lista-linhas--expandida', novoEstado);
      secao.classList.toggle('secao-lista-linhas--collapsed', !novoEstado);
    });
  }

  function configurarBotoesDiaSemana() {
    const botoes = document.querySelectorAll('.btn-dia[data-dia]');
    botoes.forEach(btn => {
      btn.addEventListener('click', () => {
        const novoDia = btn.getAttribute('data-dia');
        definirDiaSemana(novoDia, true);
      });
    });
  }

  async function definirDiaSemana(novoDia, reprocessarRota = true) {
    estadoUI.diaSemana = novoDia;

    document.querySelectorAll('.btn-dia[data-dia]').forEach(btn => {
      const ativo = btn.getAttribute('data-dia') === novoDia;
      btn.setAttribute('aria-pressed', String(ativo));
    });

    const avisoDia = document.getElementById('status-dia-ativo');
    if (avisoDia) {
      const rotulos = {
        dias_uteis_sabados: 'Dias úteis e sábados',
        domingos_feriados: 'Domingos e feriados',
        todos: 'Comparando todos os dias da semana'
      };
      avisoDia.textContent = rotulos[novoDia] || rotulos.dias_uteis_sabados;
    }

    if (estadoUI.localizacaoUsuario) {
      estadoUI.paradasProximas = window.BuzuDados.buscarParadasMaisProximas(
        estadoUI.localizacaoUsuario.lat,
        estadoUI.localizacaoUsuario.lng,
        estadoUI.diaSemana,
        5
      );
      renderizarResultadosProximidade();
    }

    const modoViagem = !!(
      estadoUI.viagemAtiva &&
      estadoUI.abaBusca === 'endereco' &&
      !estadoUI.linhaSelecionadaId &&
      !estadoUI.paradaSelecionadaId
    );

    if (reprocessarRota && estadoUI.linhaSelecionadaId) {
      window.BuzuMapa.solicitarEnquadramentoNaProximaRenderizacao();
      await atualizarMapaEListagens();
      renderizarVisaoDetalheLinha(estadoUI.linhaSelecionadaId);
      return;
    }

    if (reprocessarRota && estadoUI.paradaSelecionadaId) {
      await atualizarMapaEListagens();
      renderizarVisaoDetalheParada(estadoUI.paradaSelecionadaId);
      return;
    }

    if (modoViagem) {
      await executarBuscaViagem({ silencioso: true });
      return;
    }

    window.BuzuMapa.solicitarEnquadramentoNaProximaRenderizacao();
    await atualizarMapaEListagens();
  }

  /**
   * Controle do Bottom Sheet Mobile (Padrão MTA Live Subway Map)
   */
  function configurarBottomSheetMobile() {
    const botoes = document.querySelectorAll('.btn-sheet[data-sheet-alvo]');
    botoes.forEach(btn => {
      btn.addEventListener('click', () => {
        const alvo = btn.getAttribute('data-sheet-alvo');
        ajustarBottomSheetMobile(alvo);
      });
    });

    // Gestos de arrastar (touch swipe) na alça do bottom sheet mobile
    const alcaSheet = document.getElementById('alca-sheet-mobile');
    if (alcaSheet) {
      let inicioY = 0;
      let arrastando = false;
      const ordemEstados = ['minimo', 'meio', 'cheio'];

      alcaSheet.addEventListener(
        'touchstart',
        e => {
          if (!e.touches || e.touches.length === 0) return;
          inicioY = e.touches[0].clientY;
          arrastando = true;
        },
        { passive: true }
      );

      alcaSheet.addEventListener(
        'touchend',
        e => {
          if (!arrastando) return;
          arrastando = false;
          const fimY = e.changedTouches?.[0]?.clientY ?? inicioY;
          const deltaY = fimY - inicioY;
          if (Math.abs(deltaY) < 28) return;

          const layout = document.getElementById('layout-principal');
          const atual = layout?.getAttribute('data-sheet') || 'meio';
          const idxAtual = Math.max(0, ordemEstados.indexOf(atual));
          const proxIdx =
            deltaY < 0
              ? Math.min(ordemEstados.length - 1, idxAtual + 1)
              : Math.max(0, idxAtual - 1);
          ajustarBottomSheetMobile(ordemEstados[proxIdx]);
        },
        { passive: true }
      );
    }

    if (alcaSheet) {
      const alternar = () => {
        const atual = document.getElementById('layout-principal')?.getAttribute('data-sheet') || 'meio';
        ajustarBottomSheetMobile(atual === 'cheio' ? 'minimo' : atual === 'minimo' ? 'meio' : 'cheio');
      };
      alcaSheet.addEventListener('click', alternar);
      alcaSheet.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          alternar();
        }
      });
    }

    // No celular, ao digitar nos campos de busca o painel ocupa a tela (o teclado cobre o resto)
    document.getElementById('painel-controle')?.addEventListener('focusin', e => {
      if (window.innerWidth >= 960) return;
      if (e.target.matches('input[type="search"], input[type="time"]')) ajustarBottomSheetMobile('cheio');
    });

    // Botão de recolher/expandir a legenda do mapa no celular
    const btnLegenda = document.getElementById('btn-toggle-legenda');
    const caixaLegenda = document.getElementById('legenda-mapa');
    btnLegenda?.addEventListener('click', () => {
      if (!caixaLegenda) return;
      const aberta = caixaLegenda.getAttribute('data-aberta-mobile') === 'true';
      caixaLegenda.setAttribute('data-aberta-mobile', String(!aberta));
      btnLegenda.setAttribute('aria-expanded', String(!aberta));
    });

    const chkTerminalRetorno = document.getElementById('chk-mostrar-terminal-retorno');
    chkTerminalRetorno?.addEventListener('change', () => {
      window.BuzuMapa.definirMostrarTerminalRetorno(chkTerminalRetorno.checked);
    });
  }

  function ajustarBottomSheetMobile(estadoSheet) {
    const layout = document.getElementById('layout-principal');
    if (!layout) return;
    layout.setAttribute('data-sheet', estadoSheet);
    document.querySelectorAll('.btn-sheet[data-sheet-alvo]').forEach(btn => {
      btn.setAttribute('aria-pressed', String(btn.getAttribute('data-sheet-alvo') === estadoSheet));
    });
    window.BuzuMapa.invalidarTamanho();
  }

  /**
   * ENTRADA 1: Abas de busca ("Por linha" e "De → Para").
   */
  function configurarAbasBusca() {
    const abaLinha = document.getElementById('aba-busca-linha');
    const abaEndereco = document.getElementById('aba-busca-endereco');
    const painelLinha = document.getElementById('painel-busca-linha');
    const painelEndereco = document.getElementById('painel-busca-endereco');

    function ativar(nome, opcoesAtivar = {}) {
      const ehLinha = nome === 'linha';
      if (estadoUI.abaBusca !== (ehLinha ? 'linha' : 'endereco')) registrarEvento('aba', ehLinha ? 'itinerarios' : 'como_chegar');
      estadoUI.abaBusca = ehLinha ? 'linha' : 'endereco';
      document.getElementById('layout-principal')?.setAttribute('data-aba', estadoUI.abaBusca);
      if (opcoesAtivar.inicial) {
        abaLinha?.classList.toggle('active', ehLinha);
        abaLinha?.setAttribute('aria-selected', String(ehLinha));
        abaEndereco?.classList.toggle('active', !ehLinha);
        abaEndereco?.setAttribute('aria-selected', String(!ehLinha));
        if (painelLinha) painelLinha.hidden = !ehLinha;
        if (painelEndereco) painelEndereco.hidden = ehLinha;
        return;
      }

      if (abaLinha) {
        abaLinha.classList.toggle('ativa', ehLinha);
        abaLinha.classList.toggle('active', ehLinha);
        abaLinha.setAttribute('aria-selected', String(ehLinha));
      }
      if (abaEndereco) {
        abaEndereco.classList.toggle('ativa', !ehLinha);
        abaEndereco.classList.toggle('active', !ehLinha);
        abaEndereco.setAttribute('aria-selected', String(!ehLinha));
      }
      if (painelLinha) painelLinha.hidden = !ehLinha;
      if (painelEndereco) painelEndereco.hidden = ehLinha;

      if (!ehLinha && window.location.hash.startsWith('#/linha/')) {
        window.location.hash = '#/';
      }

      if (estadoUI.viagemAtiva) {
        void atualizarMapaEListagens().then(() => {
          renderizarResultadoViagem();
          if (!ehLinha && estadoUI.viagemAtiva) {
            window.BuzuMapa.enquadrarPontosViagem(
              estadoUI.viagemAtiva.origem,
              estadoUI.viagemAtiva.destino
            );
          }
        });
      } else {
        renderizarResultadoViagem();
      }

      // Ao trocar de aba a busca e a lista ficam à vista (no celular o painel sobe)
      ajustarBottomSheetMobile('meio');
      if (!ehLinha && window.innerWidth >= 960) {
        setTimeout(() => document.getElementById('input-origem-viagem')?.focus(), 60);
      }
    }

    abaLinha?.addEventListener('click', () => ativar('linha'));
    abaEndereco?.addEventListener('click', () => ativar('endereco'));

    // Aba inicial: "Como chegar"; um link direto para uma linha abre em "Linhas"
    const abaInicial = /^#\/linha(s|\/)/.test(window.location.hash || '') ? 'linha' : 'endereco';
    estadoUI.abaBusca = abaInicial;
    ativar(abaInicial, { inicial: true });
  }

  function configurarAutocompleteViagem(input, lista, aoEscolher) {
    let sugestoes = [];
    let indice = -1;
    let timer = null;
    let seqBusca = 0;

    if (!input || !lista) {
      return { fechar: () => {}, limpar: () => {} };
    }

    function fechar() {
      seqBusca++;
      clearTimeout(timer);
      lista.hidden = true;
      lista.innerHTML = '';
      indice = -1;
    }

    const tipoPonto = /origem/.test(input.id) ? 'origem' : 'destino';

    function escolher(idx) {
      if (idx === sugestoes.length) {
        // última opção da lista: marcar o ponto tocando no mapa
        fechar();
        input.blur();
        escolherPontoViagemNoMapa(tipoPonto);
        return;
      }
      const sugestao = sugestoes[idx];
      if (!sugestao) return;
      input.value = sugestao.titulo;
      fechar();
      aoEscolher(sugestao);
    }

    const ICONES_SUGESTAO = { lugar: 'bi-geo-alt-fill', rua: 'bi-signpost-split', endereco: 'bi-geo-alt' };

    function renderizar() {
      const esc = window.BuzuUtils.escaparHtml;
      lista.innerHTML =
        sugestoes
          .map(
            (s, idx) => `
          <li class="item-autocomplete${s.aproximado ? ' item-autocomplete--aprox' : ''}" role="option" tabindex="-1" data-idx="${idx}">
            <i class="bi ${ICONES_SUGESTAO[s.tipoLugar] || (s.origem === 'Parada atendida' ? 'bi-bus-front' : 'bi-geo-alt')}" aria-hidden="true"></i>
            <span class="item-autocomplete__texto">
              <strong>${esc(s.titulo)}</strong>
              <span>${esc(s.subtitulo || '')}</span>
            </span>
          </li>`
          )
          .join('') +
        `<li class="item-autocomplete item-autocomplete--mapa" role="option" tabindex="-1" data-idx="${sugestoes.length}">
            <i class="bi bi-crosshair" aria-hidden="true"></i>
            <span class="item-autocomplete__texto">
              <strong>Marcar no mapa</strong>
              <span>Não achou? Toque no lugar exato no mapa</span>
            </span>
          </li>`;

      lista.hidden = false;
      lista.querySelectorAll('.item-autocomplete').forEach(item => {
        item.addEventListener('click', () => escolher(Number(item.getAttribute('data-idx'))));
      });
    }

    input.addEventListener('input', () => {
      clearTimeout(timer);
      const valor = input.value.trim();
      if (valor.length < 2) {
        fechar();
        return;
      }
      timer = setTimeout(async () => {
        const minhaSeq = ++seqBusca;
        const locais = window.BuzuDados.buscarSugestoesEnderecoLocal(valor);
        sugestoes = locais;
        indice = -1;
        renderizar();

        const completas = await window.BuzuDados.buscarSugestoesEndereco(valor);
        if (minhaSeq !== seqBusca || input.value.trim() !== valor) return;
        sugestoes = completas;
        indice = -1;
        renderizar();
      }, 350);
    });

    input.addEventListener('keydown', e => {
      const itens = Array.from(lista.querySelectorAll('.item-autocomplete'));
      if (e.key === 'ArrowDown' && itens.length > 0) {
        e.preventDefault();
        indice = (indice + 1) % itens.length;
        atualizarDestaqueTeclado(itens, indice);
      } else if (e.key === 'ArrowUp' && itens.length > 0) {
        e.preventDefault();
        indice = (indice - 1 + itens.length) % itens.length;
        atualizarDestaqueTeclado(itens, indice);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (indice >= 0) escolher(indice);
        else if (sugestoes.length > 0 && !lista.hidden) escolher(0);
        else document.getElementById('btn-buscar-viagem')?.click();
      } else if (e.key === 'Escape') {
        fechar();
      }
    });

    document.addEventListener('click', e => {
      if (!lista.contains(e.target) && e.target !== input) fechar();
    });

    return {
      fechar,
      limpar() {
        input.value = '';
        fechar();
      }
    };
  }

  /**
   * Ponto escolhido no mapa (tocando ou arrastando o pino A/B): vira a saída ou o destino,
   * com o nome da rua quando o mapa aberto conhece, e as rotas são recalculadas.
   */
  const seqPontoMapa = { origem: 0, destino: 0 };
  async function definirPontoViagemPeloMapa(tipo, lat, lng) {
    const minhaSeq = ++seqPontoMapa[tipo];
    const input = document.getElementById(tipo === 'origem' ? 'input-origem-viagem' : 'input-destino-viagem');
    const ponto = { lat, lng, rotulo: 'Ponto marcado no mapa' };
    if (tipo === 'origem') estadoUI.origemViagem = ponto;
    else estadoUI.destinoViagem = ponto;
    if (input) input.value = 'Ponto marcado no mapa…';
    window.BuzuMapa.definirPontosViagem(estadoUI.origemViagem, estadoUI.destinoViagem, null);

    const rotulo = await window.BuzuDados.descreverPontoNoMapa(lat, lng);
    const pontoAtual = tipo === 'origem' ? estadoUI.origemViagem : estadoUI.destinoViagem;
    if (minhaSeq !== seqPontoMapa[tipo] || pontoAtual !== ponto) return;
    ponto.rotulo = rotulo;
    if (input) input.value = rotulo;

    if (estadoUI.origemViagem && estadoUI.destinoViagem) {
      await executarBuscaViagem();
    } else {
      window.BuzuMapa.definirPontosViagem(estadoUI.origemViagem, estadoUI.destinoViagem, null);
      ajustarBottomSheetMobile('meio');
      atualizarFeedbackViagem('', null);
      document.getElementById(tipo === 'origem' ? 'input-destino-viagem' : 'input-origem-viagem')?.focus();
    }
  }

  function escolherPontoViagemNoMapa(tipo) {
    const aviso = document.getElementById('aviso-escolha-mapa');
    const texto = document.getElementById('aviso-escolha-mapa-texto');
    if (texto) texto.textContent = tipo === 'origem' ? 'Toque no mapa no ponto de saída' : 'Toque no mapa no seu destino';
    if (aviso) aviso.hidden = false;
    ajustarBottomSheetMobile('minimo');
    window.BuzuMapa.escolherPontoNoMapa((lat, lng) => {
      if (aviso) aviso.hidden = true;
      void definirPontoViagemPeloMapa(tipo, lat, lng);
    });
  }

  function configurarBuscaViagem() {
    document.getElementById('btn-cancelar-escolha-mapa')?.addEventListener('click', () => {
      window.BuzuMapa.cancelarEscolhaPonto();
      const aviso = document.getElementById('aviso-escolha-mapa');
      if (aviso) aviso.hidden = true;
      ajustarBottomSheetMobile('meio');
    });

    const inputOrigem = document.getElementById('input-origem-viagem');
    const inputDestino = document.getElementById('input-destino-viagem');
    const listaOrigem = document.getElementById('lista-autocomplete-origem');
    const listaDestino = document.getElementById('lista-autocomplete-destino');
    const btnLocalizacao = document.getElementById('btn-usar-localizacao');
    const btnBuscar = document.getElementById('btn-buscar-viagem');
    const btnLimpar = document.getElementById('btn-limpar-viagem');
    const btnInverter = document.getElementById('btn-inverter-viagem');
    const selectMaxBaldeacoes = document.getElementById('select-max-baldeacoes');
    const inputHorario = document.getElementById('input-horario-viagem');
    const btnHorarioAgora = document.getElementById('btn-horario-agora');

    // Horário da viagem: começa em "agora" (Brasília) e acompanha o relógio até a pessoa escolher outro
    const sincronizarHorarioAgora = () => {
      if (estadoUI.horarioViagemManual || !inputHorario) return;
      inputHorario.value = window.BuzuDados.obterHorarioBrasilia().texto;
      atualizarNotaHorarioViagem();
    };
    sincronizarHorarioAgora();
    setInterval(sincronizarHorarioAgora, 30000);

    inputHorario?.addEventListener('change', () => {
      estadoUI.horarioViagemManual = Boolean(inputHorario.value);
      if (!inputHorario.value) sincronizarHorarioAgora();
      atualizarNotaHorarioViagem();
      if (estadoUI.origemViagem && estadoUI.destinoViagem) void executarBuscaViagem();
    });

    btnHorarioAgora?.addEventListener('click', () => {
      estadoUI.horarioViagemManual = false;
      sincronizarHorarioAgora();
      if (estadoUI.origemViagem && estadoUI.destinoViagem) void executarBuscaViagem();
    });

    selectMaxBaldeacoes?.addEventListener('change', () => {
      if (estadoUI.origemViagem && estadoUI.destinoViagem) {
        void executarBuscaViagem();
      }
    });

    btnInverter?.addEventListener('click', () => {
      const txtOrig = inputOrigem ? inputOrigem.value : '';
      const txtDest = inputDestino ? inputDestino.value : '';
      if (inputOrigem) inputOrigem.value = txtDest;
      if (inputDestino) inputDestino.value = txtOrig;

      const tempPonto = estadoUI.origemViagem;
      estadoUI.origemViagem = estadoUI.destinoViagem;
      estadoUI.destinoViagem = tempPonto;

      if (estadoUI.origemViagem && estadoUI.destinoViagem) {
        executarBuscaViagem();
      }
    });

    const autoOrigem = configurarAutocompleteViagem(inputOrigem, listaOrigem, sugestao => {
      estadoUI.origemViagem = { lat: sugestao.lat, lng: sugestao.lng, rotulo: sugestao.titulo, aproximado: !!sugestao.aproximado };
      atualizarFeedbackViagem('', null);
    });

    const autoDestino = configurarAutocompleteViagem(inputDestino, listaDestino, sugestao => {
      estadoUI.destinoViagem = { lat: sugestao.lat, lng: sugestao.lng, rotulo: sugestao.titulo, aproximado: !!sugestao.aproximado };
      atualizarFeedbackViagem('', null);
    });

    inputOrigem?.addEventListener('input', () => {
      if (estadoUI.origemViagem && inputOrigem.value !== estadoUI.origemViagem.rotulo) {
        estadoUI.origemViagem = null;
      }
    });

    inputDestino?.addEventListener('input', () => {
      if (estadoUI.destinoViagem && inputDestino.value !== estadoUI.destinoViagem.rotulo) {
        estadoUI.destinoViagem = null;
      }
    });

    btnLocalizacao?.addEventListener('click', () => {
      if (!('geolocation' in navigator)) {
        atualizarFeedbackViagem('Geolocalização não disponível. Digite a origem manualmente.', 'erro');
        return;
      }

      atualizarFeedbackViagem('Consultando a localização do dispositivo...', 'info');

      navigator.geolocation.getCurrentPosition(
        pos => {
          const { latitude, longitude } = pos.coords;
          estadoUI.origemViagem = {
            lat: latitude,
            lng: longitude,
            rotulo: 'Minha localização atual'
          };
          if (inputOrigem) inputOrigem.value = 'Minha localização atual';
          selecionarLocalizacao(latitude, longitude, 'Minha localização atual');
          if (pos.coords.accuracy > 250) {
            atualizarFeedbackViagem(
              `Sua localização está com pouca precisão (cerca de ${Math.round(pos.coords.accuracy)} m). Confira o ponto de saída no mapa.`,
              'alerta'
            );
            return;
          }

          if (!window.BuzuDados.estaNaAreaDeAtendimento(latitude, longitude)) {
            atualizarFeedbackViagem(
              'Sua localização está fora da área atendida pelas linhas (a mais de 2 km de qualquer parada). Confira a origem ou digite um endereço.',
              'alerta'
            );
          } else {
            atualizarFeedbackViagem('', null);
            document.getElementById('input-destino-viagem')?.focus();
          }
        },
        () => {
          atualizarFeedbackViagem(
            'Sem permissão para usar sua localização. Você pode digitar o endereço de saída.',
            'erro'
          );
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
      );
    });

    btnBuscar?.addEventListener('click', () => executarBuscaViagem());

    btnLimpar?.addEventListener('click', async () => {
      autoOrigem.limpar();
      autoDestino.limpar();
      estadoUI.origemViagem = null;
      estadoUI.destinoViagem = null;
      estadoUI.viagemAtiva = null;
      estadoUI.linhasViagem = [];
      estadoUI.etapasViagem = [];
      atualizarFeedbackViagem('', null);
      window.BuzuMapa.limparPontosViagem();
      renderizarResultadoViagem();
      await atualizarMapaEListagens(true);
    });
  }

  /** Hora (0-23) e texto do horário considerado na busca "Como chegar" */
  function obterHorarioViagem() {
    const valor = document.getElementById('input-horario-viagem')?.value || '';
    const m = /^(\d{1,2}):(\d{2})/.exec(valor);
    if (estadoUI.horarioViagemManual && m) {
      return { hora: Number(m[1]) % 24, texto: `${m[1].padStart(2, '0')}:${m[2]}`, agora: false };
    }
    const agora = window.BuzuDados.obterHorarioBrasilia();
    const campo = document.getElementById('input-horario-viagem');
    if (campo && !estadoUI.horarioViagemManual) campo.value = agora.texto;
    return { hora: agora.hora, texto: agora.texto, agora: true };
  }

  function atualizarNotaHorarioViagem() {
    const nota = document.getElementById('nota-horario-viagem');
    if (!nota) return;
    const { hora } = obterHorarioViagem();
    const madrugada = window.BuzuDados.ehHorarioMadrugada(hora);
    nota.className = `nota-horario-viagem ${madrugada ? 'nota-horario-viagem--madrugada' : ''}`;
    nota.innerHTML = madrugada
      ? '<i class="bi bi-moon-stars" aria-hidden="true"></i> Madrugada (00:00 às 03:59): só circulam as linhas <strong>Corujão</strong>.'
      : '<i class="bi bi-sun" aria-hidden="true"></i> Linhas regulares. Os <strong>Corujões</strong> só circulam das 00:00 às 03:59.';
  }

  function atualizarFeedbackViagem(texto, tipo) {
    const box = document.getElementById('feedback-viagem');
    if (!box) return;

    if (!texto) {
      box.hidden = true;
      box.textContent = '';
      box.className = '';
      return;
    }

    box.hidden = false;
    box.className =
      tipo === 'erro' ? 'alerta-erro' : tipo === 'sucesso' ? 'alerta-sucesso' : 'alerta-edital';
    box.textContent = texto;
  }

  async function resolverPontoViagem(input, pontoAtual) {
    if (pontoAtual && typeof pontoAtual.lat === 'number') return pontoAtual;

    const valor = input?.value.trim() || '';
    if (!valor) return null;

    const locais = window.BuzuDados.buscarSugestoesEnderecoLocal(valor);
    if (locais.length > 0) {
      return { lat: locais[0].lat, lng: locais[0].lng, rotulo: locais[0].titulo };
    }

    const sugestoes = await window.BuzuDados.buscarSugestoesEndereco(valor);
    if (!sugestoes.length) return null;

    return { lat: sugestoes[0].lat, lng: sugestoes[0].lng, rotulo: sugestoes[0].titulo, aproximado: !!sugestoes[0].aproximado };
  }

  async function executarBuscaViagem(opcoes = {}) {
    const inputOrigem = document.getElementById('input-origem-viagem');
    const inputDestino = document.getElementById('input-destino-viagem');

    const origem = await resolverPontoViagem(inputOrigem, estadoUI.origemViagem);
    if (!origem) {
      if (!opcoes.silencioso) {
        atualizarFeedbackViagem(
          'Diga de onde você sai: endereço, bairro, terminal ou um lugar conhecido.',
          'erro'
        );
        inputOrigem?.focus();
      }
      return;
    }

    const destino = await resolverPontoViagem(inputDestino, estadoUI.destinoViagem);
    if (!destino) {
      if (!opcoes.silencioso) {
        atualizarFeedbackViagem(
          'Diga para onde você vai: endereço, bairro, terminal ou um lugar conhecido.',
          'erro'
        );
        inputDestino?.focus();
      }
      return;
    }

    estadoUI.origemViagem = origem;
    estadoUI.destinoViagem = destino;
    if (inputOrigem) inputOrigem.value = origem.rotulo;
    if (inputDestino) inputDestino.value = destino.rotulo;

    atualizarFeedbackViagem('Procurando as melhores rotas…', 'info');

    const maxBaldeacoes = Number(
      document.getElementById('select-max-baldeacoes')?.value ?? 2
    );

    const horario = obterHorarioViagem();
    const madrugada = window.BuzuDados.ehHorarioMadrugada(horario.hora);
    atualizarNotaHorarioViagem();

    const resultados = await window.BuzuDados.calcularLinhasViagem(
      origem,
      destino,
      estadoUI.diaSemana,
      { maxBaldeacoes, hora: horario.hora }
    );

    estadoUI.viagemAtiva = { origem, destino, resultados, horario, madrugada };
    if (!opcoes.silencioso) registrarEvento('viagem');
    await selecionarTrajetoSugerido(0, { silencioso: opcoes.silencioso });
    if (!opcoes.silencioso && resultados.length > 0) {
      // mostra as rotas logo de cara (o formulário continua logo acima para editar)
      const rolagem = document.querySelector('.painel__rolagem');
      const secaoRotas = document.getElementById('secao-resultado-viagem');
      if (rolagem && secaoRotas) {
        const topo = secaoRotas.getBoundingClientRect().top - rolagem.getBoundingClientRect().top + rolagem.scrollTop - 8;
        rolagem.scrollTo({ top: Math.max(0, topo), behavior: 'smooth' });
      }
    }

    if (!opcoes.silencioso) {
      if (resultados.length > 0) {
        atualizarFeedbackViagem('', null);
      } else if (madrugada) {
        atualizarFeedbackViagem(
          'Das 0h às 4h só circulam as linhas Corujão, e nenhuma atende esse trajeto. As linhas comuns voltam às 4h.',
          'alerta'
        );
      } else if (maxBaldeacoes < 2) {
        atualizarFeedbackViagem(
          maxBaldeacoes === 0
            ? 'Nenhuma linha faz esse trajeto sozinha. Escolha “Melhor rota” para ver as opções com integração.'
            : 'Não há opção com até 1 integração para este trajeto. Escolha "Melhor rota" em Integrações para ver mais opções.',
          'alerta'
        );
      } else {
        atualizarFeedbackViagem(
          'Nenhuma linha passa a até 1,2 km da origem e do destino. Tente um ponto de referência mais perto de uma avenida.',
          'alerta'
        );
      }
    }
  }

  /**
   * Seleciona um trajeto específico dentre as opções sugeridas no "Como chegar"
   * e desenha APENAS a(s) linha(s) e eventual ponto de transferência daquele trajeto no mapa!
   */
  async function selecionarTrajetoSugerido(indice, opcoes = {}) {
    const viagem = estadoUI.viagemAtiva;
    if (!viagem || !Array.isArray(viagem.resultados)) return;

    const resultados = viagem.resultados;
    if (resultados.length === 0) {
      estadoUI.indiceTrajetoEscolhido = -1;
      estadoUI.linhasViagem = [];
      estadoUI.etapasViagem = [];
      window.BuzuMapa.definirPontosViagem(viagem.origem, viagem.destino, null);
      await atualizarMapaEListagens();
      renderizarResultadoViagem();
      return;
    }

    const idxValido = indice >= 0 && indice < resultados.length ? indice : 0;
    estadoUI.indiceTrajetoEscolhido = idxValido;
    const trajetoEscolhido = resultados[idxValido];

    estadoUI.linhasViagem = Array.from(
      new Set((trajetoEscolhido.linhas || []).map(l => l.numero))
    );
    // Só o caminho do passageiro: a pé + trecho percorrido de cada linha, no sentido da viagem
    estadoUI.etapasViagem = await window.BuzuDados.montarEtapasViagem(
      trajetoEscolhido,
      viagem.origem,
      viagem.destino,
      estadoUI.diaSemana
    );

    const pontosTransferencia =
      Array.isArray(trajetoEscolhido.transferencias) && trajetoEscolhido.transferencias.length > 0
        ? trajetoEscolhido.transferencias
        : trajetoEscolhido.transferencia
        ? [trajetoEscolhido.transferencia]
        : [];

    window.BuzuMapa.definirPontosViagem(viagem.origem, viagem.destino, pontosTransferencia);
    window.BuzuMapa.solicitarEnquadramentoNaProximaRenderizacao();
    await atualizarMapaEListagens();
    renderizarResultadoViagem();
    window.BuzuMapa.enquadrarPontosViagem(viagem.origem, viagem.destino, pontosTransferencia);

    if (window.innerWidth < 960 && !opcoes.silencioso) ajustarBottomSheetMobile('meio');
  }

  // ---------- Pedaços visuais reaproveitados (letreiro e etiqueta colorida da linha) ----------
  function corTextoSobre(hex) {
    const n = String(hex || '').replace('#', '');
    if (n.length < 6) return '#FFFFFF';
    const [r, g, b] = [0, 2, 4].map(i => parseInt(n.slice(i, i + 2), 16) / 255);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.55 ? '#12355B' : '#FFFFFF';
  }

  function placaLinhaHtml(numero, cor, tamanho = 'p') {
    const esc = window.BuzuUtils.escaparHtml;
    return `<span class="placa placa--${tamanho}" style="--cor-linha:${esc(cor || '#FFC94A')}">${esc(numero)}</span>`;
  }

  function etiquetaLinhaHtml(numero, cor, href) {
    const esc = window.BuzuUtils.escaparHtml;
    const estilo = `--cor-linha:${esc(cor || '#12355B')};--cor-texto-linha:${corTextoSobre(cor || '#12355B')}`;
    return href
      ? `<a href="${esc(href)}" class="etiqueta-linha" style="${estilo}">${esc(numero)}</a>`
      : `<span class="etiqueta-linha" style="${estilo}">${esc(numero)}</span>`;
  }

  function nomeParadaLimpo(nome) {
    return String(nome || '').replace(/\s*\((IDA|VOLTA)\)\s*$/i, '').trim();
  }

  function renderizarResultadoViagem() {
    const secao = document.getElementById('secao-resultado-viagem');
    const lista = document.getElementById('lista-resultado-viagem');
    const contador = document.getElementById('contador-viagem');
    const resumo = document.getElementById('resumo-viagem');
    const secaoLista = document.getElementById('secao-lista-linhas');
    const secaoPerto = document.getElementById('secao-paradas-proximas');
    const viagem = estadoUI.viagemAtiva && estadoUI.abaBusca === 'endereco' ? estadoUI.viagemAtiva : null;
    const esc = window.BuzuUtils.escaparHtml;
    const dist = window.BuzuUtils.formatarDistancia;

    if (!secao || !lista) return;

    if (secaoPerto) {
      secaoPerto.hidden = !(estadoUI.abaBusca === 'endereco' && !viagem && estadoUI.localizacaoUsuario);
    }

    if (!viagem) {
      secao.hidden = true;
      if (secaoLista) secaoLista.hidden = false;
      return;
    }

    secao.hidden = false;
    if (secaoLista) secaoLista.hidden = true;

    const resultados = viagem.resultados || [];

    if (contador) {
      contador.textContent = `${resultados.length} ${resultados.length === 1 ? 'opção' : 'opções'}`;
    }

    if (resumo) {
      const diaRotulo =
        estadoUI.diaSemana === 'domingos_feriados'
          ? 'Domingos e feriados'
          : estadoUI.diaSemana === 'todos'
          ? 'Todos os dias'
          : 'Dias úteis e sábados';

      resumo.hidden = false;
      resumo.innerHTML =
        `<span class="resumo-viagem__trajeto">${esc(viagem.origem.rotulo)} → ${esc(viagem.destino.rotulo)}</span>` +
        `<span>${esc(diaRotulo)} • saída ${esc(viagem.horario?.texto || '--:--')}${
          viagem.horario?.agora ? ' (agora)' : ''
        }${viagem.madrugada ? ' • madrugada: só linhas Corujão' : ''}</span>` +
        (viagem.origem.aproximado || viagem.destino.aproximado
          ? `<span class="alerta-edital">O número da casa não está no mapa aberto, então o ponto ${[
              viagem.origem.aproximado && 'A (saída)',
              viagem.destino.aproximado && 'B (destino)'
            ]
              .filter(Boolean)
              .join(' e ')} é aproximado. Arraste o pino no mapa até o lugar exato e as rotas se atualizam.</span>`
          : '') +
        `<button type="button" id="btn-ver-volta" class="btn-ver-volta">` +
        `<i class="bi bi-arrow-left-right" aria-hidden="true"></i> Ver a volta</button>`;
      document.getElementById('btn-ver-volta')?.addEventListener('click', () => {
        document.getElementById('btn-inverter-viagem')?.click();
      });
    }

    if (resultados.length === 0) {
      lista.innerHTML = `
        <li class="cartao">
          Nenhuma rota encontrada para esse trajeto no dia escolhido. Tente um ponto de referência
          mais perto de uma avenida, outro dia ou “Melhor rota” em Integrações.
        </li>`;
      return;
    }

    const SELOS = {
      recomendada: ['bi-star-fill', 'Recomendada', 'selo--sol'],
      menos_caminhada: ['bi-person-walking', 'Menos caminhada', ''],
      menos_integracoes: ['bi-arrow-repeat', 'Menos integrações', ''],
      mais_rapida: ['bi-lightning-charge-fill', 'Mais rápida', '']
    };
    const selosHtml = r =>
      (r.selos || [])
        .filter(s => SELOS[s])
        .map(s => `<span class="selo ${SELOS[s][2]}"><i class="bi ${SELOS[s][0]}" aria-hidden="true"></i>${SELOS[s][1]}</span>`)
        .join('');

    const minutosAPe = metros => Math.max(1, Math.round((metros || 0) / 75));

    const passosHtml = r => {
      const linhas = r.linhas || [];
      const trechos =
        Array.isArray(r.trechos) && r.trechos.length
          ? r.trechos
          : [
              {
                numero: linhas[0]?.numero,
                sentido: linhas[0]?.sentido,
                paradaDesembarqueNome: r.desembarque?.nome,
                distanciaMetros: r.distanciaTrechoMetros
              }
            ];
      const corDe = num => (linhas.find(l => l.numero === num) || {}).cor || '#12355B';
      const passos = [];
      const embarqueNome = nomeParadaLimpo(r.embarque?.nome) || 'a parada de embarque';
      const peIni = r.acessoEmbarqueMetros || 0;
      passos.push(
        `<li class="passo"><span class="passo__marca" aria-hidden="true"></span><span class="passo__texto">${
          peIni > 30
            ? `Caminhe ${dist(peIni)} (${r.embarque?.tempoMinutos || minutosAPe(peIni)} min) até a parada <b>${esc(embarqueNome)}</b>.`
            : `Vá até a parada <b>${esc(embarqueNome)}</b>.`
        }</span></li>`
      );

      trechos.forEach((tr, i) => {
        const cor = corDe(tr.numero);
        const sentido = tr.sentido ? `, sentido ${esc(String(tr.sentido).toLowerCase())}` : '';
        const segue = tr.sentidoDesembarque && tr.sentidoDesembarque !== tr.sentido
          ? ` (o ônibus passa pelo retorno e segue no sentido ${esc(String(tr.sentidoDesembarque).toLowerCase())})`
          : '';
        const desce = nomeParadaLimpo(tr.paradaDesembarqueNome) || nomeParadaLimpo(r.desembarque?.nome) || 'a parada indicada';
        if (i > 0) {
          passos.push(
            `<li class="passo passo--troca"><span class="passo__marca" aria-hidden="true"></span><span class="passo__texto">Integração em <b>${esc(
              nomeParadaLimpo(trechos[i - 1].paradaDesembarqueNome) || 'ponto de integração'
            )}</b>: desça e pegue a linha <b>${esc(tr.numero)}</b> no mesmo ponto ou bem perto.</span></li>`
          );
        }
        passos.push(
          `<li class="passo passo--onibus" style="--cor-linha:${esc(cor)}"><span class="passo__marca" aria-hidden="true"></span><span class="passo__texto">Pegue a linha <b>${esc(
            tr.numero
          )}</b>${sentido}${segue}.<span class="passo__detalhe">Desça em <b>${esc(desce)}</b> — cerca de ${dist(
            tr.distanciaMetros || 0
          )} de ônibus.</span></span></li>`
        );
      });

      const peFim = r.acessoDesembarqueMetros || 0;
      passos.push(
        `<li class="passo passo--fim"><span class="passo__marca" aria-hidden="true"></span><span class="passo__texto">${
          peFim > 30 ? `Caminhe ${dist(peFim)} até o destino.` : 'Você chegou ao destino.'
        }</span></li>`
      );
      return `<ol class="passos">${passos.join('')}</ol>`;
    };

    lista.innerHTML = resultados
      .map((r, idx) => {
        const linhas = r.linhas || [];
        const ehSelecionado = idx === estadoUI.indiceTrajetoEscolhido;
        const numInteg = r.tipo === 'direta' ? 0 : r.numTransferencias || Math.max(1, linhas.length - 1);
        const aPe = (r.acessoEmbarqueMetros || 0) + (r.acessoDesembarqueMetros || 0);
        const resumoTxt = [
          `${dist(aPe)} a pé`,
          numInteg === 0 ? 'sem integração' : `${numInteg} ${numInteg === 1 ? 'integração' : 'integrações'}`
        ].join(' • ');
        const identLinhas = linhas
          .map(l => (ehSelecionado ? placaLinhaHtml(l.numero, l.cor) : etiquetaLinhaHtml(l.numero, l.cor)))
          .join('<span class="cartao-rota__mais" aria-hidden="true">+</span>');
        const tempo = r.tempoEstimadoMin
          ? `<span class="cartao-rota__tempo">${r.tempoEstimadoMin} <small>min</small></span>`
          : '';

        const separador =
          idx === 1
            ? `<li class="separador-opcoes" aria-hidden="true"><span>Outras opções</span><small>Com mais integrações ou um pouco mais demoradas. Toque em uma para ver no mapa.</small></li>`
            : '';

        if (!ehSelecionado) {
          const troca = (r.transferencias || []).map(t => nomeParadaLimpo(t.nome)).filter(Boolean);
          return `${separador}
          <li class="cartao cartao-rota cartao-rota--compacto" data-card-trajeto="${idx}" role="button" tabindex="0" aria-pressed="false" aria-label="Ver esta rota no mapa: ${esc(
            linhas.map(l => l.numero).join(' + ')
          )}${r.tempoEstimadoMin ? `, cerca de ${r.tempoEstimadoMin} minutos` : ''}">
            <div class="cartao-rota__topo">
              <div class="cartao-rota__linhas">${identLinhas}${selosHtml(r)}</div>
              ${tempo}
            </div>
            <span class="cartao-rota__resumo">${
              troca.length ? `Troca em ${esc(troca.join(' e '))} • ` : ''
            }${esc(resumoTxt)}</span>
          </li>`;
        }

        const linksLinhas = linhas
          .map(
            l =>
              `<a href="#/linha/${encodeURIComponent(l.numero)}" class="btn-secundario"><i class="bi bi-bus-front" aria-hidden="true"></i> Ver linha ${esc(
                l.numero
              )}</a>`
          )
          .join('');

        return `${separador}
          <li class="cartao cartao-rota cartao-rota--ativo" data-card-trajeto="${idx}" aria-current="true">
            <div class="cartao-rota__topo">
              <div class="cartao-rota__linhas">${identLinhas}${selosHtml(r)}</div>
              ${tempo}
            </div>
            <span class="cartao-rota__resumo">${esc(resumoTxt)} • ${linhas.length} ${linhas.length === 1 ? 'linha' : 'linhas'}</span>
            ${passosHtml(r)}
            <div class="ao-vivo"><span>Próximo ${esc(linhas[0]?.numero || 'ônibus')}</span><span><i class="bi bi-broadcast" aria-hidden="true"></i> ao vivo em breve</span></div>
            <div class="acoes-cartao">${linksLinhas}</div>
          </li>`;
      })
      .join('') +
      `<li class="nota-algoritmo">O tempo estimado soma a caminhada, a espera média no ponto e a viagem. A espera usa o intervalo previsto no edital para cada linha. Damos preferência à parada mais perto de você e ao menor número de integrações.</li>`;

    lista.querySelectorAll('[data-card-trajeto][role="button"]').forEach(card => {
      const escolher = () => {
        const idx = Number(card.getAttribute('data-card-trajeto'));
        void selecionarTrajetoSugerido(idx, { focarMapaNoCelular: true });
      };
      card.addEventListener('click', escolher);
      card.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          escolher();
        }
      });
    });
  }

  /**
   * ENTRADA 2: Busca Direta "Qual é a linha?" com Autocomplete e Teclado (Padrão Metropolin)
   */
  function configurarBuscaDiretaLinhaEFiltros() {
    const selLote = document.getElementById('filtro-lote');
    const selTipo = document.getElementById('filtro-tipo');
    const chkAcessivel = document.getElementById('filtro-acessivel');
    const chkRedeAtual = document.getElementById('filtro-rede-atual');
    const selLinhaRapida = document.getElementById('sel-linha-rapida');
    const inputBuscaLinha = document.getElementById('filtro-busca-linha');
    const listaAutoLinha = document.getElementById('lista-autocomplete-linha');
    const btnBuscarLinha = document.getElementById('btn-buscar-linha');

    let linhasSugeridas = [];

    selLinhaRapida?.addEventListener('change', () => {
      const val = selLinhaRapida.value.trim();
      if (val) {
        window.location.hash = `#/linha/${encodeURIComponent(val)}`;
      } else {
        window.location.hash = '#/';
      }
    });

    selLote?.addEventListener('change', async () => {
      estadoUI.filtroLote = selLote.value;
      window.BuzuMapa.solicitarEnquadramentoNaProximaRenderizacao();
      await atualizarMapaEListagens();
    });

    selTipo?.addEventListener('change', async () => {
      estadoUI.filtroTipo = selTipo.value;
      await atualizarMapaEListagens();
    });

    chkAcessivel?.addEventListener('change', async () => {
      estadoUI.filtroAcessivel = chkAcessivel.checked;
      await atualizarMapaEListagens();
    });

    chkRedeAtual?.addEventListener('change', async () => {
      estadoUI.mostrarRedeAtual = chkRedeAtual.checked;
      await atualizarMapaEListagens();
    });

    inputBuscaLinha?.addEventListener('input', async () => {
      estadoUI.termoBuscaLinha = inputBuscaLinha.value;
      window.BuzuMapa.solicitarEnquadramentoNaProximaRenderizacao();
      await atualizarMapaEListagens();

      const termo = inputBuscaLinha.value.trim();
      if (!termo) {
        fecharAutocompleteLinha();
        return;
      }

      linhasSugeridas = window.BuzuDados.filtrarLinhas({
        diaSemana: estadoUI.diaSemana,
        lote: 'todos',
        tipo: 'todos',
        termo
      });
      estadoUI.indiceTecladoLinha = -1;
      renderizarAutocompleteLinha(linhasSugeridas);
    });

    inputBuscaLinha?.addEventListener('keydown', e => {
      const itens = listaAutoLinha ? Array.from(listaAutoLinha.querySelectorAll('.item-autocomplete')) : [];
      if (e.key === 'ArrowDown' && itens.length > 0) {
        e.preventDefault();
        estadoUI.indiceTecladoLinha = (estadoUI.indiceTecladoLinha + 1) % itens.length;
        atualizarDestaqueTeclado(itens, estadoUI.indiceTecladoLinha);
      } else if (e.key === 'ArrowUp' && itens.length > 0) {
        e.preventDefault();
        estadoUI.indiceTecladoLinha = (estadoUI.indiceTecladoLinha - 1 + itens.length) % itens.length;
        atualizarDestaqueTeclado(itens, estadoUI.indiceTecladoLinha);
      } else if (e.key === 'Enter' && linhasSugeridas.length > 0) {
        e.preventDefault();
        const idx = estadoUI.indiceTecladoLinha >= 0 ? estadoUI.indiceTecladoLinha : 0;
        const linhaEscolhida = linhasSugeridas[idx];
        if (linhaEscolhida) {
          fecharAutocompleteLinha();
          window.location.hash = `#/linha/${encodeURIComponent(linhaEscolhida.numero)}`;
        }
      } else if (e.key === 'Escape') {
        fecharAutocompleteLinha();
      }
    });

    btnBuscarLinha?.addEventListener('click', () => {
      const termo = inputBuscaLinha?.value.trim() || '';
      if (!termo) {
        inputBuscaLinha?.focus();
        return;
      }

      const encontradas = window.BuzuDados.filtrarLinhas({
        diaSemana: estadoUI.diaSemana,
        lote: 'todos',
        tipo: 'todos',
        termo
      });

      if (encontradas.length > 0) {
        fecharAutocompleteLinha();
        window.location.hash = `#/linha/${encodeURIComponent(encontradas[0].numero)}`;
      }
    });

    document.addEventListener('click', e => {
      if (!listaAutoLinha?.contains(e.target) && e.target !== inputBuscaLinha) {
        fecharAutocompleteLinha();
      }
    });

    function renderizarAutocompleteLinha(linhas) {
      if (!listaAutoLinha) return;
      if (!linhas || linhas.length === 0) {
        fecharAutocompleteLinha();
        return;
      }

      listaAutoLinha.innerHTML = linhas
        .slice(0, 6)
        .map(
          (l, idx) => `
          <li class="item-autocomplete" role="option" tabindex="-1" data-idx="${idx}">
            <strong>Linha ${window.BuzuUtils.escaparHtml(l.numero)} — ${window.BuzuUtils.escaparHtml(
              l.nome
            )}</strong>
            <span>${window.BuzuUtils.escaparHtml(l.categoria_edital || l.tipo)} • Lote ${window.BuzuUtils.escaparHtml(
              l.lote
            )} • ${window.BuzuUtils.escaparHtml(l.dia_ativo_rotulo)}</span>
          </li>
        `
        )
        .join('');

      listaAutoLinha.hidden = false;

      listaAutoLinha.querySelectorAll('.item-autocomplete').forEach(item => {
        item.addEventListener('click', () => {
          const idx = Number(item.getAttribute('data-idx'));
          const l = linhas[idx];
          if (l) {
            fecharAutocompleteLinha();
            window.location.hash = `#/linha/${encodeURIComponent(l.numero)}`;
          }
        });
      });
    }

    function fecharAutocompleteLinha() {
      if (listaAutoLinha) {
        listaAutoLinha.hidden = true;
        listaAutoLinha.innerHTML = '';
        estadoUI.indiceTecladoLinha = -1;
      }
    }
  }

  function atualizarDestaqueTeclado(itensDom, indiceAtivo) {
    itensDom.forEach((el, i) => {
      if (i === indiceAtivo) {
        el.classList.add('ativo-teclado');
        el.scrollIntoView({ block: 'nearest' });
      } else {
        el.classList.remove('ativo-teclado');
      }
    });
  }

  function obterGeolocalizacaoNavegador() {
    if (!('geolocation' in navigator)) {
      mostrarMensagemLocalizacao(
        'Geolocalização não disponível neste navegador. Utilize o campo de endereço abaixo.',
        'erro'
      );
      return;
    }

    mostrarMensagemLocalizacao('Consultando localização do dispositivo...', 'info');

    navigator.geolocation.getCurrentPosition(
      pos => {
        const { latitude, longitude } = pos.coords;

        if (!window.BuzuDados.estaNaAreaDeAtendimento(latitude, longitude)) {
          mostrarMensagemLocalizacao(
            'Sua localização está fora da área atendida pelas linhas. Exibindo as paradas mais próximas, ou busque por um bairro ou endereço abaixo.',
            'alerta'
          );
        } else {
          mostrarMensagemLocalizacao(
            'Localização calculada no dispositivo com sucesso (LGPD).',
            'sucesso'
          );
        }

        selecionarLocalizacao(latitude, longitude, 'Minha localização atual');
      },
      erro => {
        let msg = 'Não foi possível obter a localização.';
        if (erro.code === erro.PERMISSION_DENIED) {
          msg =
            'Permissão de localização negada (ou conexão HTTP sem HTTPS). Digite seu bairro, endereço ou CEP no campo abaixo.';
        } else if (erro.code === erro.TIMEOUT) {
          msg = 'Tempo esgotado ao buscar sinal de GPS. Digite seu endereço ou bairro no campo abaixo.';
        }
        mostrarMensagemLocalizacao(msg, 'erro');
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  }

  function mostrarMensagemLocalizacao(texto, tipo = 'info') {
    const box = document.getElementById('feedback-localizacao');
    if (!box) return;
    box.hidden = false;
    box.className =
      tipo === 'erro' ? 'alerta-erro' : tipo === 'sucesso' ? 'alerta-sucesso' : 'alerta-edital';
    box.textContent = texto;
  }

  function selecionarLocalizacao(lat, lng, rotulo) {
    estadoUI.localizacaoUsuario = { lat, lng, rotulo };
    estadoUI.paradasProximas = window.BuzuDados.buscarParadasMaisProximas(
      lat,
      lng,
      estadoUI.diaSemana,
      5
    );

    window.BuzuMapa.definirPosicaoUsuario(lat, lng, rotulo);
    renderizarResultadosProximidade();
  }

  /**
   * Renderiza as 3 a 5 paradas/terminais mais próximos (Ordem por distância, tempo a pé × 1,3 a 4,5 km/h)
   */
  function renderizarResultadosProximidade() {
    const secao = document.getElementById('secao-paradas-proximas');
    const lista = document.getElementById('lista-paradas-proximas');
    const subtitulo = document.getElementById('subtitulo-paradas-proximas');

    if (!secao || !lista) return;
    secao.hidden = false;

    const loc = estadoUI.localizacaoUsuario;
    const esc = window.BuzuUtils.escaparHtml;
    if (subtitulo && loc) subtitulo.textContent = `A partir de: ${loc.rotulo}`;
    secao.hidden = estadoUI.abaBusca !== 'endereco' || !!estadoUI.viagemAtiva;

    if (estadoUI.paradasProximas.length === 0) {
      lista.innerHTML = '<li class="cartao">Nenhuma parada perto para o dia escolhido.</li>';
      return;
    }

    lista.innerHTML = estadoUI.paradasProximas
      .slice(0, 4)
      .map(p => {
        const linhasParada = window.BuzuDados.obterLinhasDaParadaNoDia(p.id, estadoUI.diaSemana);
        const etiquetas = linhasParada
          .map(num => {
            const l = window.BuzuDados.obterLinhaPorId(num, estadoUI.diaSemana);
            return etiquetaLinhaHtml(num, l?.cor, `#/linha/${encodeURIComponent(num)}`);
          })
          .join('');
        return `
        <li class="cartao cartao-parada">
          <div class="cartao-parada__topo">
            <a href="#/parada/${encodeURIComponent(p.id)}" class="cartao-parada__nome">${esc(p.nome)}</a>
            <span class="cartao-parada__dist">${window.BuzuUtils.formatarDistancia(p.distanciaPeMetros)}<small>~${p.tempoMinutos} min a pé</small></span>
          </div>
          ${etiquetas ? `<div class="cartao-parada__linhas" aria-label="Linhas que passam aqui">${etiquetas}</div>` : ''}
        </li>`;
      })
      .join('');
  }

  async function atualizarMapaEListagens(enquadrarInicial = false) {
    const modoViagem = !!(
      estadoUI.viagemAtiva &&
      estadoUI.abaBusca === 'endereco' &&
      !estadoUI.linhaSelecionadaId &&
      !estadoUI.paradaSelecionadaId
    );
    const linhaSelecionadaAtiva = !!estadoUI.linhaSelecionadaId;

    const lotesParaCarregar =
      modoViagem || linhaSelecionadaAtiva
        ? ['1', '2']
        : estadoUI.filtroLote === 'todos'
        ? ['1', '2']
        : [String(estadoUI.filtroLote)];

    const colecoesLotes = await Promise.all(
      lotesParaCarregar.map(idLote => window.BuzuDados.carregarGeoJsonLote(idLote))
    );

    let linhasFiltradas;
    let numerosPermitidos;

    if (modoViagem) {
      numerosPermitidos = new Set(estadoUI.linhasViagem.map(num => String(num).toUpperCase()));
      linhasFiltradas = numerosPermitidos.size
        ? window.BuzuDados.filtrarLinhas({
            diaSemana: estadoUI.diaSemana,
            lote: 'todos',
            tipo: 'todos',
            termo: ''
          }).filter(linha => numerosPermitidos.has(String(linha.numero).toUpperCase()))
        : [];
    } else {
      linhasFiltradas = window.BuzuDados.filtrarLinhas({
        diaSemana: estadoUI.diaSemana,
        rede: estadoUI.filtroRede,
        lote: estadoUI.filtroLote,
        tipo: estadoUI.filtroTipo,
        apenasAcessiveis: estadoUI.filtroAcessivel,
        termo: estadoUI.termoBuscaLinha
      });
      numerosPermitidos = new Set(linhasFiltradas.map(l => String(l.numero).toUpperCase()));
    }

    if (linhaSelecionadaAtiva) {
      const numeroSelecionado = String(estadoUI.linhaSelecionadaId).toUpperCase();
      const linhaSelecionada = window.BuzuDados.obterLinhaPorId(
        estadoUI.linhaSelecionadaId,
        estadoUI.diaSemana
      );
      if (linhaSelecionada) {
        linhasFiltradas = [linhaSelecionada];
        numerosPermitidos = new Set([numeroSelecionado]);
      }
    }

    const featuresRotas = [];
    // No "Como chegar" o mapa não desenha as linhas inteiras (ida + volta): só as etapas do trajeto
    if (!modoViagem) {
      for (const fc of colecoesLotes) {
        for (const feat of fc?.features || []) {
          const num = String(feat.properties?.numero || feat.properties?.linha_id || '').toUpperCase();
          if (numerosPermitidos.has(num)) {
            featuresRotas.push(feat);
          }
        }
      }
    }

    if (enquadrarInicial) {
      window.BuzuMapa.solicitarEnquadramentoNaProximaRenderizacao();
    }

    const estadoDados = window.BuzuDados.obterEstado();
    window.BuzuMapa.renderizarRotas(featuresRotas, {
      linhaDestacadaId: estadoUI.linhaSelecionadaId,
      diaSemana: estadoUI.diaSemana,
      mostrarRedeAtual: estadoUI.mostrarRedeAtual,
      redeAtualGeoJson: estadoDados.redeAtualGeoJson,
      mostrarSentido: modoViagem,
      // filtro Ida/Volta no canto do mapa: só na aba "Itinerários"
      filtroSentido: !modoViagem
    });

    const linhasComTracadoNoDia = new Set();
    for (const feat of featuresRotas) {
      const pF = feat.properties || {};
      const dF = pF.dia_semana || 'todos';
      if (estadoUI.diaSemana === 'todos' || dF === 'todos' || dF === estadoUI.diaSemana) {
        linhasComTracadoNoDia.add(String(pF.numero || pF.linha_id || '').toUpperCase());
      }
    }

    const paradasDia = window.BuzuDados.obterParadasPorDia(estadoUI.diaSemana, {
      incluirInativas: false,
      incluirVirtuaisNoMapa: linhaSelecionadaAtiva
    });
    let paradasVisiveis = modoViagem
      ? []
      : paradasDia
          .filter(feat => {
            const pid = feat.properties?.id;
            const rotasDia = window.BuzuDados.obterLinhasDaParadaNoDia(pid, estadoUI.diaSemana);
            feat.properties.rotas_dia = rotasDia;
            // Paradas sem linha associada só aparecem na visão geral (nunca no detalhe de uma linha)
            if (rotasDia.length === 0) return !linhaSelecionadaAtiva;
            return rotasDia.some(rota => numerosPermitidos.has(rota) && linhasComTracadoNoDia.has(rota));
          });

    if (estadoUI.paradaSelecionadaId) {
      const paradaSelecionada = window.BuzuDados.obterParadaPorId(estadoUI.paradaSelecionadaId);
      if (paradaSelecionada && !paradasVisiveis.includes(paradaSelecionada)) {
        paradasVisiveis = [...paradasVisiveis, paradaSelecionada];
      }
    }

    if (modoViagem) {
      window.BuzuMapa.renderizarEtapasViagem(estadoUI.etapasViagem || []);
    } else {
      window.BuzuMapa.limparEtapasViagem();
    }

    window.BuzuMapa.renderizarParadas(paradasVisiveis, estadoUI.paradaSelecionadaId, {
      linhaSelecionada: linhaSelecionadaAtiva,
      corLinha: linhaSelecionadaAtiva ? linhasFiltradas[0]?.cor || null : null
    });

    atualizarSelectLinhaRapida();
    renderizarListaLinhasTextual(linhasFiltradas);
  }

  function atualizarSelectLinhaRapida() {
    const sel = document.getElementById('sel-linha-rapida');
    if (!sel) return;

    const todasLinhas = window.BuzuDados.filtrarLinhas({
      diaSemana: estadoUI.diaSemana,
      rede: estadoUI.filtroRede,
      lote: estadoUI.filtroLote,
      tipo: estadoUI.filtroTipo,
      apenasAcessiveis: estadoUI.filtroAcessivel,
      termo: ''
    });

    const valorAtual = estadoUI.linhaSelecionadaId ? String(estadoUI.linhaSelecionadaId) : '';
    const opcoesHtml = [
      `<option value="">Ver todas as linhas no mapa (${todasLinhas.length} linhas)</option>`,
      ...todasLinhas.map(l => {
        const selecionado =
          valorAtual && String(l.numero).toUpperCase() === valorAtual.toUpperCase()
            ? 'selected'
            : '';
        return `<option value="${window.BuzuUtils.escaparHtml(l.numero)}" ${selecionado}>${window.BuzuUtils.escaparHtml(
          l.numero
        )} - ${window.BuzuUtils.escaparHtml(l.nome)}</option>`;
      })
    ];
    sel.innerHTML = opcoesHtml.join('');
    if (valorAtual) {
      sel.value = valorAtual;
    }
  }

  /** "Linha de Bairro (B)", "Linha Estrutural (E)"… a partir do número da linha */
  function categoriaComLetra(linha) {
    const num = String(linha.numero || '').toUpperCase();
    const letra = /^[BEDRC]\d/.test(num) ? num[0] : '';
    const nomes = { B: 'Linha de Bairro', E: 'Linha Estrutural', D: 'Linha Direta', R: 'Linha Regional', C: 'Corujão' };
    if (letra) return `${nomes[letra]} (${letra})`;
    if (linha.tipo === 'atual' || /^(N|O|L)-|^58[57]$/.test(num)) return 'Linha atual mantida';
    return linha.categoria_edital || linha.tipo || 'Linha';
  }

  function regiaoDaLinha(linha, curta = false) {
    if (String(linha.lote) === '1') return curta ? 'Zona Norte' : 'Zona Norte — Lote 1';
    if (String(linha.lote) === '2') return curta ? 'Sul, Leste e Oeste' : 'Sul, Leste e Oeste — Lote 2';
    return '—';
  }

  function formatarNumero(valor) {
    return typeof valor === 'number' ? valor.toLocaleString('pt-BR') : '-';
  }

  /**
   * Célula do quadro FUNCIONAMENTO: mostra o intervalo do edital ("a cada 13 min"),
   * "Não opera" quando o edital prevê 0, ou SIM/NÃO quando não há dado do edital.
   */
  function celulaFuncionamento(intervalo, operaPeloDia) {
    if (intervalo === undefined) {
      return `<div class="subtitulo-colunas-tempo-funcionamento ${operaPeloDia ? 'sim' : 'nao'}">${
        operaPeloDia ? 'SIM' : 'NÃO'
      }</div>`;
    }
    if (intervalo === null) {
      return '<div class="subtitulo-colunas-tempo-funcionamento sim">Madrugada</div>';
    }
    if (!intervalo) {
      return '<div class="subtitulo-colunas-tempo-funcionamento nao">Não opera</div>';
    }
    return `<div class="subtitulo-colunas-tempo-funcionamento sim">A cada ${Math.round(intervalo)} min</div>`;
  }

  function badgeSituacaoRota(linha) {
    if (linha.situacao_rota === 'indefinida') {
      return '<span class="badge-tipo badge-rota-indefinida"><i class="bi bi-hourglass-split" aria-hidden="true"></i> Rota ainda não divulgada</span>';
    }
    if (linha.situacao_rota === 'alterada') {
      return '<span class="badge-tipo badge-rota-alterada"><i class="bi bi-exclamation-triangle" aria-hidden="true"></i> Traçado em atualização</span>';
    }
    if (linha.situacao_rota === 'parcial') {
      return '<span class="badge-tipo badge-rota-parcial"><i class="bi bi-calendar-week" aria-hidden="true"></i> Rota só de domingo</span>';
    }
    return '';
  }

  /**
   * Aviso exibido no detalhe da linha quando o traçado não existe ou está desatualizado
   */
  function avisoSituacaoRota(linha) {
    if (linha.situacao_rota === 'indefinida') {
      return `
        <div class="aviso-rota aviso-rota--indefinida" role="note">
          <i class="bi bi-hourglass-split" aria-hidden="true"></i>
          <div>
            <strong>Rota ainda não definida.</strong>
            Esta linha faz parte da rede de início da concessão (edital da Concorrência nº 11.001/2026),
            mas o traçado e as paradas ainda não estão disponíveis.
            ${linha.aviso_rota ? window.BuzuUtils.escaparHtml(linha.aviso_rota) : ''}
            Assim que a STTU divulgar a rota, ela será incluída aqui.
          </div>
        </div>`;
    }
    if (linha.situacao_rota === 'alterada') {
      return `
        <div class="aviso-rota aviso-rota--alterada" role="note">
          <i class="bi bi-exclamation-triangle" aria-hidden="true"></i>
          <div>
            <strong>Traçado em atualização.</strong>
            ${window.BuzuUtils.escaparHtml(linha.aviso_rota || 'O edital de 2026 alterou o itinerário desta linha.')}
            ${
              linha.fonte_rota
                ? 'O traçado será atualizado quando a STTU divulgar a nova rota.'
                : 'O traçado no mapa ainda é o do projeto de 2021 e será atualizado quando a STTU divulgar a nova rota.'
            }
          </div>
        </div>`;
    }
    if (linha.situacao_rota === 'parcial') {
      const ehDomingo = linha.dia_ativo_codigo === 'domingos_feriados' || estadoUI.diaSemana === 'domingos_feriados';
      return `
        <div class="aviso-rota ${ehDomingo ? 'aviso-rota--info' : 'aviso-rota--indefinida'}" role="note">
          <i class="bi ${ehDomingo ? 'bi-info-circle' : 'bi-calendar-week'}" aria-hidden="true"></i>
          <div>
            ${
              ehDomingo
                ? '<strong>Rota de domingos e feriados.</strong>'
                : '<strong>Rota de dias úteis e sábados ainda não divulgada.</strong> Por enquanto só há o itinerário de domingos e feriados (OSO da STTU): para vê-lo, escolha <em>Domingos e feriados</em> em CIRCULAÇÃO.'
            }
            ${ehDomingo ? window.BuzuUtils.escaparHtml(linha.aviso_rota || '') : ''}
          </div>
        </div>`;
    }
    return '';
  }

  let observadorListaLinhas = null;

  function renderizarListaLinhasTextual(linhas) {
    const listaEl = document.getElementById('lista-linhas-propostas');
    const contadorEl = document.getElementById('contador-linhas');
    if (!listaEl) return;

    if (observadorListaLinhas) {
      observadorListaLinhas.disconnect();
      observadorListaLinhas = null;
    }

    if (contadorEl) {
      contadorEl.textContent = `${linhas.length} ${linhas.length === 1 ? 'linha' : 'linhas'}`;
    }

    if (linhas.length === 0) {
      listaEl.innerHTML = `
        <li class="cartao">Nenhuma linha encontrada com esses filtros.</li>
      `;
      return;
    }

    const montarHtmlCartao = linha => `
        <li>
          <a href="#/linha/${encodeURIComponent(linha.numero)}" class="cartao cartao-linha">
            ${placaLinhaHtml(linha.numero, linha.cor)}
            <span class="cartao-linha__texto">
              <span class="cartao-linha__nome">${window.BuzuUtils.escaparHtml(linha.nome)}</span>
              <span class="cartao-linha__meta">
                <span>${window.BuzuUtils.escaparHtml(categoriaComLetra(linha))}</span>
                <span>${window.BuzuUtils.escaparHtml(regiaoDaLinha(linha, true))}</span>
                ${badgeSituacaoRota(linha)}
              </span>
            </span>
            <i class="bi bi-chevron-right" aria-hidden="true"></i>
          </a>
        </li>`;

    // Renderização incremental / virtualizada em lotes de 20 itens para manter fluidez no celular
    const TAM_LOTE = 20;
    let renderizados = 0;
    listaEl.innerHTML = '';

    const renderizarProximoLote = () => {
      const sentinelaAntiga = listaEl.querySelector('.sentinela-lista-linhas');
      if (sentinelaAntiga) sentinelaAntiga.remove();

      const fatia = linhas.slice(renderizados, renderizados + TAM_LOTE);
      if (fatia.length === 0) return;

      listaEl.insertAdjacentHTML('beforeend', fatia.map(montarHtmlCartao).join(''));
      renderizados += fatia.length;

      if (renderizados < linhas.length) {
        const liSentinela = document.createElement('li');
        liSentinela.className = 'sentinela-lista-linhas';
        liSentinela.style.listStyle = 'none';
        liSentinela.style.textAlign = 'center';
        liSentinela.style.padding = '8px 0';
        liSentinela.innerHTML = `<button type="button" class="btn-secundario">Mostrar mais linhas (${renderizados} de ${linhas.length})</button>`;
        liSentinela.querySelector('button')?.addEventListener('click', renderizarProximoLote);
        listaEl.appendChild(liSentinela);

        if (typeof IntersectionObserver !== 'undefined') {
          observadorListaLinhas = new IntersectionObserver(
            entries => {
              if (entries.some(en => en.isIntersecting)) {
                observadorListaLinhas?.disconnect();
                renderizarProximoLote();
              }
            },
            { rootMargin: '180px' }
          );
          observadorListaLinhas.observe(liSentinela);
        }
      }
    };

    renderizarProximoLote();
  }

  /**
   * Roteador por Hash (Fluxo de Dois Níveis no Painel Lateral / Bottom Sheet)
   */
  async function processarRotaHash() {
    const hash = window.location.hash || '#/';
    const containerDetalhe = document.getElementById('visao-detalhe');
    const containerExploracao = document.getElementById('visao-exploracao');
    const faixaItinerario = document.getElementById('faixa-itinerario-topo');

    const [caminhoHash, queryString] = hash.split('?');
    document
      .getElementById('layout-principal')
      ?.setAttribute('data-vista', /^#\/(linha|parada)\//.test(caminhoHash) ? 'detalhe' : 'inicio');
    document.getElementById('painel-controle')?.querySelector('.painel__rolagem')?.scrollTo(0, 0);
    if (queryString) {
      const params = new URLSearchParams(queryString);
      const diaParam = params.get('dia');
      if (diaParam && ['dias_uteis_sabados', 'domingos_feriados', 'todos'].includes(diaParam)) {
        await definirDiaSemana(diaParam, false);
      }
    }

    if (caminhoHash.startsWith('#/linha/')) {
      const idLinha = decodeURIComponent(caminhoHash.replace('#/linha/', '').trim());
      estadoUI.linhaSelecionadaId = idLinha;
      estadoUI.paradaSelecionadaId = null;

      if (containerExploracao) containerExploracao.hidden = true;
      if (containerDetalhe) containerDetalhe.hidden = false;

      window.BuzuMapa.solicitarEnquadramentoNaProximaRenderizacao();
      await atualizarMapaEListagens();
      renderizarVisaoDetalheLinha(idLinha);
      return;
    }

    if (faixaItinerario) faixaItinerario.hidden = true;
    const pillMapa = document.getElementById('pill-linha-mapa');
    if (pillMapa) pillMapa.hidden = true;

    if (caminhoHash.startsWith('#/parada/')) {
      const idParada = decodeURIComponent(caminhoHash.replace('#/parada/', '').trim());
      estadoUI.paradaSelecionadaId = idParada;
      estadoUI.linhaSelecionadaId = null;

      if (containerExploracao) containerExploracao.hidden = true;
      if (containerDetalhe) containerDetalhe.hidden = false;

      await atualizarMapaEListagens();
      renderizarVisaoDetalheParada(idParada);
      return;
    }

    estadoUI.linhaSelecionadaId = null;
    estadoUI.paradaSelecionadaId = null;
    if (containerDetalhe) containerDetalhe.hidden = true;
    if (containerExploracao) containerExploracao.hidden = false;

    await atualizarMapaEListagens();
    renderizarResultadoViagem();
  }

  /**
   * NÍVEL 2 DO FLUXO: Detalhe da Linha Selecionada (#/linha/B1)
   * Estrutura idêntica a https://virtual.granderecife.pe.gov.br/rumo/itinerarios/?codigo-linha=001
   */
  function renderizarVisaoDetalheLinha(idLinha) {
    const container = document.getElementById('visao-detalhe');
    const faixaTopo = document.getElementById('faixa-itinerario-topo');
    const faixaNum = document.getElementById('faixa-numero-linha');
    const faixaTexto = document.getElementById('faixa-texto-linha');
    if (!container) return;

    const linha = window.BuzuDados.obterLinhaPorId(idLinha, estadoUI.diaSemana);
    if (linha && linha.numero !== ultimaLinhaRegistrada) {
      ultimaLinhaRegistrada = linha.numero;
      registrarEvento('linha', linha.numero);
    }
    if (!linha) {
      if (faixaTopo) faixaTopo.hidden = true;
      container.innerHTML = `
        <div class="bloco-secao">
          <a href="#/" class="btn-secundario"><i class="bi bi-arrow-left" aria-hidden="true"></i> Voltar</a>
          <div class="alerta-erro">Linha "${window.BuzuUtils.escaparHtml(idLinha)}" não localizada.</div>
        </div>
      `;
      return;
    }

    // Atualiza a Faixa Superior (.faixa-itinerario) igual ao RUMO
    if (faixaTopo && faixaNum && faixaTexto) {
      faixaTopo.hidden = false;
      faixaNum.textContent = linha.numero;
      faixaNum.style.setProperty('--cor-linha', linha.cor || '#FFC94A');
      faixaTexto.textContent = linha.nome;
    }

    // Atualiza a etiqueta flutuante sobre o mapa com o código e nome da linha destacada
    const pillMapa = document.getElementById('pill-linha-mapa');
    const pillNum = document.getElementById('pill-linha-mapa-num');
    const pillNome = document.getElementById('pill-linha-mapa-nome');
    if (pillMapa && pillNum && pillNome) {
      pillMapa.hidden = false;
      pillNum.textContent = linha.numero;
      pillNum.style.setProperty('--cor-linha', linha.cor || '#FFC94A');
      pillNome.textContent = linha.nome;
    }

    if (Array.isArray(linha.bbox)) {
      window.BuzuMapa.enquadrarBbox(linha.bbox);
    }

    const urlCompartilhavel = `${window.location.origin}${window.location.pathname}#/linha/${encodeURIComponent(
      linha.numero
    )}?dia=${encodeURIComponent(linha.dia_ativo_codigo)}`;

    // Dias de funcionamento (Seg-Sex, Sáb, Dom/Feriado) igual à caixa FUNCIONAMENTO do RUMO
    const diasDisp = linha.dias_disponiveis || ['dias_uteis_sabados'];
    const operaUtilSab = diasDisp.includes('dias_uteis_sabados');
    const operaDom = diasDisp.includes('domingos_feriados');

    // Dados operacionais do edital (Tabela 17): intervalos, frota, veículo, extensão
    const op = linha.operacao || null;

    // Quilometragem (Ida, Volta, Total): usa a extensão oficial (ida + volta) do edital quando houver
    const kmTotal = Number(op?.extensao_ida_volta_km || linha.extensao_km || 0);
    const kmMeiaViagem = kmTotal > 0 ? (kmTotal / 2).toFixed(2).replace('.', ',') : '-';
    const kmTotalFormatado = kmTotal > 0 ? kmTotal.toFixed(2).replace('.', ',') : '-';

    // Obtém a sequência ordenada de Logradouros (Ruas / Avenidas) e Bairros da linha (Ida e Volta)
    function extrairRuasDeVinculosFallback(sentidoAlvo) {
      const estadoDados = window.BuzuDados.obterEstado();
      const vinculos = (estadoDados.linhaParadas || [])
        .filter(
          lp =>
            String(lp.linha_id).toUpperCase() === String(linha.numero).toUpperCase() &&
            String(lp.sentido).toUpperCase() === sentidoAlvo &&
            (estadoUI.diaSemana === 'todos' ||
              !lp.dia_semana ||
              lp.dia_semana === linha.dia_ativo_codigo ||
              lp.dia_semana === 'todos')
        )
        .sort((a, b) => a.ordem_sequencial - b.ordem_sequencial);

      const listaRuas = [];
      for (const v of vinculos) {
        const feat = window.BuzuDados.obterParadaPorId(v.parada_id);
        if (!feat) continue;
        const p = feat.properties || {};
        const logradouro =
          p.logradouro ||
          String(p.nome || '')
            .replace(/\s*\([^)]*\)\s*$/, '')
            .trim();
        if (!logradouro || logradouro.startsWith('Parada ')) continue;
        const bairro = p.bairro || 'Natal';
        const ult = listaRuas[listaRuas.length - 1];
        if (!ult || ult.logradouro.toUpperCase() !== logradouro.toUpperCase()) {
          listaRuas.push({
            ordem: listaRuas.length + 1,
            logradouro,
            bairro,
            lat: feat.geometry.coordinates[1],
            lng: feat.geometry.coordinates[0]
          });
        }
      }
      return listaRuas;
    }

    const ruasIda =
      Array.isArray(linha.itinerario_ruas?.ida) && linha.itinerario_ruas.ida.length > 0
        ? linha.itinerario_ruas.ida
        : extrairRuasDeVinculosFallback('IDA');

    const ruasVolta =
      Array.isArray(linha.itinerario_ruas?.volta) && linha.itinerario_ruas.volta.length > 0
        ? linha.itinerario_ruas.volta
        : extrairRuasDeVinculosFallback('VOLTA');

    const esc = window.BuzuUtils.escaparHtml;
    const corLinha = linha.cor || '#12355B';
    const empresaLinha = linha.empresa ? String(linha.empresa).trim() : '';
    const vd = op?.viagens_dia || null;

    // Funcionamento: dias úteis, sábado e domingo (une dias úteis e sábado quando os números são iguais)
    const linhasFunc = [];
    if (op) {
      const dia = (rotulo, frota, intervalo, viagens) => ({ rotulo, frota, intervalo, viagens });
      const du = dia('Dias úteis', op.frota_du, op.intervalo_du, vd?.du);
      const sab = dia('Sábado', op.frota_sab, op.intervalo_sab, vd?.sab);
      const dom = dia('Domingo e feriado', op.frota_dom, op.intervalo_dom, vd?.dom);
      if (du.frota === sab.frota && du.intervalo === sab.intervalo && du.viagens === sab.viagens) {
        linhasFunc.push({ ...du, rotulo: 'Dias úteis e sábado' }, dom);
      } else {
        linhasFunc.push(du, sab, dom);
      }
    }
    const celulaIntervalo = v => (v === null ? 'madrugada' : v ? `${Math.round(v)} <small>min</small>` : '—');
    const tabelaFuncionamento = op
      ? `
        <table class="tabela-func">
          <caption class="sr-only">Funcionamento da linha ${esc(linha.numero)} por dia</caption>
          <thead>
            <tr><th scope="col"><span class="sr-only">Dia</span></th><th scope="col">Ônibus em operação</th><th scope="col">Um ônibus a cada</th><th scope="col">Viagens no dia (ida e volta)</th></tr>
          </thead>
          <tbody>
            ${linhasFunc
              .map(f =>
                !f.frota && !f.intervalo
                  ? `<tr><th scope="row">${esc(f.rotulo)}</th><td colspan="3" class="nao-opera">Não opera</td></tr>`
                  : `<tr><th scope="row">${esc(f.rotulo)}</th><td>${formatarNumero(f.frota)}</td><td>${celulaIntervalo(
                      f.intervalo
                    )}</td><td>${typeof f.viagens === 'number' ? formatarNumero(f.viagens) : '—'}</td></tr>`
              )
              .join('')}
          </tbody>
        </table>
        <p class="nota-fonte">${
          linha.tipo === 'noturna' ? 'Linha Corujão: viagens na madrugada, todos os dias. ' : ''
        }Fonte: edital, Anexo I.3, Tabela 17. Nos dias úteis, os números são do horário de pico da manhã. Viagens no dia = quilômetros rodados no dia ÷ extensão de ida e volta.</p>`
      : `
        <table class="tabela-func">
          <caption class="sr-only">Dias de funcionamento da linha ${esc(linha.numero)}</caption>
          <tbody>
            <tr><th scope="row">Dias úteis e sábado</th><td>${operaUtilSab ? 'Opera' : '<span class="nao-opera">Não opera</span>'}</td></tr>
            <tr><th scope="row">Domingo e feriado</th><td>${operaDom ? 'Opera' : '<span class="nao-opera">Não opera</span>'}</td></tr>
          </tbody>
        </table>`;

    function montarListaRuas(modoSentido) {
      const itens = modoSentido === 'VOLTA' ? ruasVolta : ruasIda;
      if (!itens || itens.length === 0) {
        return `<li class="rua rua--vazia"><span class="rua__texto">${
          linha.situacao_rota === 'indefinida' || (linha.situacao_rota === 'parcial' && !linha.itinerario_ruas)
            ? `Itinerário ainda não divulgado pela STTU${linha.situacao_rota === 'parcial' ? ' para este dia' : ''}.`
            : 'Veja o traçado da linha no mapa.'
        }</span></li>`;
      }
      return itens
        .map(
          it => `
          <li class="rua tr-parada-clicavel" data-lat="${it.lat}" data-lng="${it.lng}" tabindex="0" role="button" aria-label="Mostrar ${esc(it.logradouro)} no mapa">
            <span class="rua__ponto" aria-hidden="true"></span>
            <span class="rua__texto"><span class="rua__nome">${esc(it.logradouro)}</span><span class="rua__bairro">${esc(it.bairro || 'Natal')}</span></span>
          </li>`
        )
        .join('');
    }

    container.innerHTML = `
      <div class="bloco" style="--cor-linha:${esc(corLinha)}">
        <div class="barra-detalhe">
          <a href="#/" class="btn-secundario"><i class="bi bi-arrow-left" aria-hidden="true"></i> Voltar</a>
          <button type="button" id="btn-copiar-link-linha" class="btn-secundario" data-url="${esc(urlCompartilhavel)}">
            <i class="bi bi-share" aria-hidden="true"></i> <span>Compartilhar</span>
          </button>
        </div>

        ${avisoSituacaoRota(linha)}

        <div class="ficha">
          <div class="ficha__item"><span class="ficha__rotulo">Tarifa</span><span class="ficha__valor ficha__valor--grande">R$ 5,20</span></div>
          <div class="ficha__item"><span class="ficha__rotulo">Tipo</span><span class="ficha__valor">${esc(categoriaComLetra(linha))}</span></div>
          <div class="ficha__item"><span class="ficha__rotulo">Região</span><span class="ficha__valor">${esc(regiaoDaLinha(linha))}</span></div>
          <div class="ficha__item"><span class="ficha__rotulo">Ônibus</span><span class="ficha__valor">${esc(op?.veiculo || '—')}</span></div>
          <div class="ficha__item"><span class="ficha__rotulo">Extensão</span><span class="ficha__valor">${
            kmTotal > 0 ? `${kmTotalFormatado} km <small>(ida e volta)</small>` : '—'
          }</span></div>
          <div class="ficha__item"><span class="ficha__rotulo">Empresa</span><span class="ficha__valor">${
            empresaLinha ? esc(empresaLinha) : 'Ainda não definida'
          }</span></div>
        </div>

        <section class="bloco" aria-labelledby="titulo-funcionamento">
          <h3 class="bloco__titulo" id="titulo-funcionamento">Funcionamento</h3>
          ${tabelaFuncionamento}
        </section>

        <section class="itinerario" aria-labelledby="titulo-itinerario">
          <div class="itinerario__topo">
            <h3 class="bloco__titulo" id="titulo-itinerario">Itinerário</h3>
            <div class="sentidos" role="group" aria-label="Sentido do itinerário">
              <button type="button" data-sentido-itinerario="IDA" aria-pressed="true">Ida (${ruasIda.length})</button>
              <button type="button" data-sentido-itinerario="VOLTA" aria-pressed="false">Volta (${ruasVolta.length})</button>
            </div>
          </div>
          <ol class="ruas" id="tbody-itinerario-rumo">${montarListaRuas('IDA')}</ol>
          <p class="nota-fonte">A ordem das paradas foi calculada a partir do traçado de cada sentido. Confira sempre a sinalização no ponto. Toque em uma rua para vê-la no mapa.</p>
        </section>
      </div>
    `;

    const listaRuas = document.getElementById('tbody-itinerario-rumo');
    function vincularCliquesTabela() {
      listaRuas?.querySelectorAll('.tr-parada-clicavel').forEach(item => {
        const focar = () => {
          const lat = Number(item.getAttribute('data-lat'));
          const lng = Number(item.getAttribute('data-lng'));
          if (Number.isFinite(lat) && Number.isFinite(lng)) {
            window.BuzuMapa.focarParada(lat, lng, item.getAttribute('data-parada-id'));
            ajustarBottomSheetMobile('meio');
          }
        };
        item.addEventListener('click', focar);
        item.addEventListener('keydown', e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            focar();
          }
        });
      });
    }
    vincularCliquesTabela();

    container.querySelectorAll('[data-sentido-itinerario]').forEach(btn => {
      btn.addEventListener('click', () => {
        const sentido = btn.getAttribute('data-sentido-itinerario');
        container.querySelectorAll('[data-sentido-itinerario]').forEach(b => b.setAttribute('aria-pressed', String(b === btn)));
        if (listaRuas) listaRuas.innerHTML = montarListaRuas(sentido);
        vincularCliquesTabela();
      });
    });

    const btnCopiar = document.getElementById('btn-copiar-link-linha');
    btnCopiar?.addEventListener('click', async () => {
      const url = btnCopiar.getAttribute('data-url') || window.location.href;
      registrarEvento('compartilhar');
      if (navigator.share && window.matchMedia?.('(pointer: coarse)').matches) {
        try {
          await navigator.share({ title: `Linha ${linha.numero} — BuzuRota`, text: `Linha ${linha.numero}: ${linha.nome}`, url });
          return;
        } catch (_e) {
          /* cancelado: tenta copiar */
        }
      }
      try {
        await navigator.clipboard.writeText(url);
        btnCopiar.innerHTML = '<i class="bi bi-check2" aria-hidden="true"></i> <span>Link copiado</span>';
      } catch (_e) {
        window.prompt('Copie o link desta linha:', url);
      }
    });
  }

  /**
   * NÍVEL 1 DO FLUXO: Clicar em Terminal/Ponto -> Ver Linhas Atendidas (#/parada/P-001)
   */
  function renderizarVisaoDetalheParada(idParada) {
    const container = document.getElementById('visao-detalhe');
    if (!container) return;

    const featParada = window.BuzuDados.obterParadaPorId(idParada);
    if (!featParada) {
      container.innerHTML = `
        <div class="bloco-secao">
          <a href="#/" class="btn-secundario" style="margin-bottom:12px;">← Voltar</a>
          <div class="alerta-erro">Ponto ou terminal não localizado.</div>
        </div>
      `;
      return;
    }

    const props = featParada.properties || {};
    const [lng, lat] = featParada.geometry.coordinates;
    window.BuzuMapa.focarParada(lat, lng, props.id);

    const sUpper = String(props.sentidos_atendidos || 'AMBOS').toUpperCase();
    const sentidoTexto =
      sUpper === 'IDA'
        ? 'Atende o sentido IDA'
        : sUpper === 'VOLTA'
        ? 'Atende o sentido VOLTA'
        : 'Atende os dois sentidos (IDA e VOLTA)';

    container.innerHTML = `
      <div class="bloco-secao">
        <a href="#/" class="btn-secundario" style="margin-bottom:12px;">
          <i class="bi bi-arrow-left" aria-hidden="true"></i>
          Voltar para busca e linhas
        </a>

        <div style="margin-bottom:8px;display:flex;gap:6px;flex-wrap:wrap;">
          <span class="badge-tipo">${window.BuzuUtils.escaparHtml(props.tipo || 'parada')}</span>
          <span class="badge-tipo">Origem: ${window.BuzuUtils.escaparHtml(props.origem || 'manual')}</span>
          <span class="badge-tipo">${window.BuzuUtils.escaparHtml(props.dia_rotulo || 'Todos os dias')}</span>
        </div>
        <h2 style="margin:4px 0 10px 0;font-size:1.2rem;font-weight:900;">
          ${window.BuzuUtils.escaparHtml(props.nome)}
        </h2>

        <div class="grade-especificacoes">
          <div class="item-especificacao">
            <span>Sentidos Atendidos</span>
            <strong>${sentidoTexto}</strong>
          </div>
          <div class="item-especificacao">
            <span>Status no Sistema</span>
            <strong>${props.ativo !== false ? 'Ativa (' + (props.origem || 'manual').toUpperCase() + ')' : 'Inativa'}</strong>
          </div>
        </div>

        <h3 class="titulo-secao" style="margin-top:16px;">
          <span>Linhas propostas que atendem este ponto</span>
          <i class="bi bi-bus-front" aria-hidden="true"></i>
        </h3>
        <ul class="lista-cartoes">
          ${(() => {
            const rotasDoDia = window.BuzuDados.obterLinhasDaParadaNoDia(props.id, estadoUI.diaSemana);
            if (rotasDoDia.length === 0) {
              return `<li class="cartao-item">Nenhuma linha com traçado ativo atende este ponto no dia selecionado.</li>`;
            }
            return rotasDoDia
              .map(codRota => {
                const objLinha = window.BuzuDados.obterLinhaPorId(codRota, estadoUI.diaSemana);
                return `
                  <li class="cartao-item">
                    <div class="cabecalho-cartao">
                      <div>
                        <span class="badge-numero-linha">${window.BuzuUtils.escaparHtml(codRota)}</span>
                        <strong style="margin-left:8px;font-size:1rem;">${window.BuzuUtils.escaparHtml(
                          objLinha ? objLinha.nome : `Linha ${codRota}`
                        )}</strong>
                      </div>
                      <a href="#/linha/${encodeURIComponent(codRota)}" class="btn-primario">
                        Ver paradas e rota
                      </a>
                    </div>
                  </li>
                `;
              })
              .join('');
          })()}
        </ul>

        ${
          (props.integracoes_descricao || []).length > 0
            ? `
              <h3 class="titulo-secao" style="margin-top:16px;">
                <span>Conexões tarifárias previstas neste ponto</span>
                <i class="bi bi-arrow-left-right" aria-hidden="true"></i>
              </h3>
              <ul class="lista-cartoes">
                ${props.integracoes_descricao
                  .map(
                    desc => `<li class="cartao-item" style="padding:10px 12px;font-size:0.9rem;font-weight:600;">${window.BuzuUtils.escaparHtml(desc)}</li>`
                  )
                  .join('')}
              </ul>
            `
            : ''
        }
      </div>
    `;
  }

})();
