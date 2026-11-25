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
    adminDesbloqueado: false,
    indiceTecladoEndereco: -1,
    indiceTecladoLinha: -1,
    abaBusca: 'linha',
    origemViagem: null,
    destinoViagem: null,
    viagemAtiva: null,
    indiceTrajetoEscolhido: 0,
    linhasViagem: [],
    etapasViagem: [],
    modoEditorParadas: false,
    criarParadaCliqueAtivo: false,
    mostrarVirtuaisNoMapa: false,
    modoEditorRota: false,
    editorRotaLinha: null,
    editorRotaDia: 'dias_uteis_sabados',
    estenderRotaCliqueAtivo: false,
    modoDesenhadorRota: false,
    desenhadorLinha: null,
    desenhadorDia: 'dias_uteis_sabados'
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

    // Relógio e data ao vivo no cabeçalho (padrão RUMO Grande Recife)
    const elData = document.getElementById('rumo-data-atual');
    const elHora = document.getElementById('rumo-hora-atual');
    function atualizarRelogioRumo() {
      const agora = new Date();
      if (elData) {
        elData.textContent = agora.toLocaleDateString('pt-BR', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric'
        });
      }
      if (elHora) {
        elHora.textContent = agora.toLocaleTimeString('pt-BR', {
          hour: '2-digit',
          minute: '2-digit'
        });
      }
    }
    atualizarRelogioRumo();
    setInterval(atualizarRelogioRumo, 30000);

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

    if (reprocessarRota && estadoUI.modoEditorRota && estadoUI.editorRotaLinha && typeof estadoUI.reabrirEditorRotaNoDia === 'function') {
      const diaEdit = novoDia === 'todos' ? 'dias_uteis_sabados' : novoDia;
      await estadoUI.reabrirEditorRotaNoDia(estadoUI.editorRotaLinha, diaEdit);
      return;
    }

    if (reprocessarRota && estadoUI.modoDesenhadorRota && estadoUI.desenhadorLinha && typeof estadoUI.reabrirDesenhadorNoDia === 'function') {
      const diaEdit = novoDia === 'todos' ? 'dias_uteis_sabados' : novoDia;
      await estadoUI.reabrirDesenhadorNoDia(estadoUI.desenhadorLinha, diaEdit);
      return;
    }

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

    function ativar(nome) {
      const ehLinha = nome === 'linha';
      if (estadoUI.abaBusca !== (ehLinha ? 'linha' : 'endereco')) registrarEvento('aba', ehLinha ? 'itinerarios' : 'como_chegar');
      estadoUI.abaBusca = ehLinha ? 'linha' : 'endereco';

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

      if (!ehLinha) {
        setTimeout(() => document.getElementById('input-origem-viagem')?.focus(), 60);
      }
    }

    abaLinha?.addEventListener('click', () => ativar('linha'));
    abaEndereco?.addEventListener('click', () => ativar('endereco'));
  }

  function configurarAutocompleteViagem(input, lista, aoEscolher) {
    let sugestoes = [];
    let indice = -1;
    let timer = null;

    if (!input || !lista) {
      return { fechar: () => {}, limpar: () => {} };
    }

    function fechar() {
      lista.hidden = true;
      lista.innerHTML = '';
      indice = -1;
    }

    function escolher(idx) {
      const sugestao = sugestoes[idx];
      if (!sugestao) return;
      input.value = sugestao.titulo;
      fechar();
      aoEscolher(sugestao);
    }

    function renderizar() {
      if (!sugestoes.length) {
        fechar();
        return;
      }

      lista.innerHTML = sugestoes
        .map(
          (s, idx) => `
          <li class="item-autocomplete" role="option" tabindex="-1" data-idx="${idx}">
            <strong>${window.BuzuUtils.escaparHtml(s.titulo)}</strong>
            <span>${window.BuzuUtils.escaparHtml(s.subtitulo || '')}</span>
          </li>`
        )
        .join('');

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
        const locais = window.BuzuDados.buscarSugestoesEnderecoLocal(valor);
        sugestoes = locais;
        indice = -1;
        renderizar();

        const completas = await window.BuzuDados.buscarSugestoesEndereco(valor);
        if (input.value.trim() !== valor) return;
        sugestoes = completas;
        indice = -1;
        renderizar();
      }, 200);
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
        else if (sugestoes.length > 0) escolher(0);
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

  function configurarBuscaViagem() {
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
      estadoUI.origemViagem = { lat: sugestao.lat, lng: sugestao.lng, rotulo: sugestao.titulo };
      atualizarFeedbackViagem('', null);
    });

    const autoDestino = configurarAutocompleteViagem(inputDestino, listaDestino, sugestao => {
      estadoUI.destinoViagem = { lat: sugestao.lat, lng: sugestao.lng, rotulo: sugestao.titulo };
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

          if (!window.BuzuDados.estaNaAreaDeAtendimento(latitude, longitude)) {
            atualizarFeedbackViagem(
              'Sua localização está fora da área atendida pelas linhas (a mais de 2 km de qualquer parada). Confira a origem ou digite um endereço.',
              'alerta'
            );
          } else {
            atualizarFeedbackViagem('Localização obtida com sucesso. Informe o destino (B).', 'sucesso');
          }
        },
        () => {
          atualizarFeedbackViagem(
            'Não foi possível obter a localização (permissão ou HTTPS). Digite a origem manualmente.',
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

    return { lat: sugestoes[0].lat, lng: sugestoes[0].lng, rotulo: sugestoes[0].titulo };
  }

  async function executarBuscaViagem(opcoes = {}) {
    const inputOrigem = document.getElementById('input-origem-viagem');
    const inputDestino = document.getElementById('input-destino-viagem');

    const origem = await resolverPontoViagem(inputOrigem, estadoUI.origemViagem);
    if (!origem) {
      if (!opcoes.silencioso) {
        atualizarFeedbackViagem(
          'Informe a origem (DE): endereço, bairro, terminal ou ponto de referência.',
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
          'Informe o destino (PARA): endereço, bairro, terminal ou ponto de referência.',
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

    atualizarFeedbackViagem('Calculando as linhas que atendem este trajeto...', 'info');

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

    if (!opcoes.silencioso) {
      if (resultados.length > 0) {
        atualizarFeedbackViagem('', null);
      } else if (madrugada) {
        atualizarFeedbackViagem(
          `Às ${horario.texto} (madrugada) só circulam as linhas Corujão, e nenhuma delas atende este trajeto a até 1,2 km dos pontos informados. As linhas regulares voltam a partir das 04:00.`,
          'alerta'
        );
      } else if (maxBaldeacoes < 2) {
        atualizarFeedbackViagem(
          maxBaldeacoes === 0
            ? 'Nenhuma linha faz este trajeto sozinha (sem integração). Escolha "Melhor rota" em Integrações para ver as opções com integração.'
            : 'Não há opção com até 1 integração para este trajeto. Escolha "Melhor rota" em Integrações para ver mais opções.',
          'alerta'
        );
      } else {
        atualizarFeedbackViagem(
          'Não encontramos linhas com acesso a até 1,2 km dos pontos informados. Tente um terminal/bairro próximo ou selecione outro dia de operação.',
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

    if (opcoes.focarMapaNoCelular && window.innerWidth <= 960) {
      document.getElementById('mapa')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  function renderizarResultadoViagem() {
    const secao = document.getElementById('secao-resultado-viagem');
    const lista = document.getElementById('lista-resultado-viagem');
    const contador = document.getElementById('contador-viagem');
    const resumo = document.getElementById('resumo-viagem');
    const secaoLista = document.getElementById('secao-lista-linhas');
    const viagem = estadoUI.viagemAtiva && estadoUI.abaBusca === 'endereco' ? estadoUI.viagemAtiva : null;

    if (!secao || !lista) return;

    if (!viagem) {
      secao.hidden = true;
      if (secaoLista) secaoLista.hidden = false;
      return;
    }

    secao.hidden = false;
    if (secaoLista) secaoLista.hidden = true;

    const resultados = viagem.resultados || [];

    if (contador) {
      contador.textContent = `${resultados.length} ${resultados.length === 1 ? 'OPÇÃO' : 'OPÇÕES'}`;
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
        `<strong>A:</strong> ${window.BuzuUtils.escaparHtml(viagem.origem.rotulo)} → ` +
        `<strong>B:</strong> ${window.BuzuUtils.escaparHtml(viagem.destino.rotulo)}<br>` +
        `Operação: ${window.BuzuUtils.escaparHtml(diaRotulo)} • Horário: ${window.BuzuUtils.escaparHtml(
          viagem.horario?.texto || '--:--'
        )}${viagem.horario?.agora ? ' (agora, Brasília)' : ''} — ${
          viagem.madrugada ? 'somente linhas Corujão' : 'linhas regulares (sem Corujão)'
        }<br>` +
        `<span class="nota-algoritmo">Priorizamos a parada mais perto de você e o menor número de integrações. Tempo estimado inclui caminhada, espera média no ponto e viagem.</span>` +
        `<button type="button" id="btn-ver-volta" class="btn-ver-volta">` +
        `<i class="bi bi-arrow-left-right" aria-hidden="true"></i> Ver a volta: ${window.BuzuUtils.escaparHtml(
          viagem.destino.rotulo
        )} → ${window.BuzuUtils.escaparHtml(viagem.origem.rotulo)}</button>`;
      document.getElementById('btn-ver-volta')?.addEventListener('click', () => {
        document.getElementById('btn-inverter-viagem')?.click();
      });
    }

    if (resultados.length === 0) {
      lista.innerHTML = `
        <li class="cartao-item">
          Nenhuma linha atende aos dois pontos para o dia selecionado.
          Tente buscar por um terminal ou bairro próximo, confira o dia de operação
          ou use um ponto de referência mais próximo do traçado.
        </li>`;
      return;
    }

    const SELOS = {
      recomendada: ['bi-star-fill', 'Recomendada'],
      menos_caminhada: ['bi-person-walking', 'Menos caminhada'],
      menos_integracoes: ['bi-arrow-repeat', 'Menos integrações'],
      mais_rapida: ['bi-lightning-charge-fill', 'Mais rápida']
    };
    const seloHtml = r =>
      (r.selos || []).length
        ? `<div class="selos-viagem">${r.selos
            .filter(s => SELOS[s])
            .map(s => `<span class="selo-viagem selo-viagem--${s}"><i class="bi ${SELOS[s][0]}" aria-hidden="true"></i> ${SELOS[s][1]}</span>`)
            .join('')}</div>`
        : '';

    const passo = (letra, classe, fundo, titulo, descricao) => `
      <div class="passo-viagem">
        <span class="letra-passo ${classe}" ${fundo ? `style="background:${fundo};"` : ''}>${letra}</span>
        <div class="passo-conteudo">
          <strong>${titulo}</strong>
          <span>${descricao}</span>
        </div>
      </div>`;

    lista.innerHTML = resultados
      .map((r, idx) => {
        const linhas = r.linhas || [];
        const badges = linhas
          .map(l => {
            const cor = window.BuzuUtils.escaparHtml(l.cor || '#0d63c9');
            return `<span class="badge-numero-linha" style="background:${cor};">${window.BuzuUtils.escaparHtml(
              l.numero
            )}</span>`;
          })
          .join('<span class="seta-viagem" aria-hidden="true">→</span>');

        const nomesLinhas = linhas
          .map(
            l =>
              `${window.BuzuUtils.escaparHtml(l.numero)} — ${window.BuzuUtils.escaparHtml(l.nome)}`
          )
          .join(' • ');

        const passos = [];

        passos.push(
          passo(
            'A',
            'letra-origem',
            '',
            `Caminhe até ${window.BuzuUtils.escaparHtml(r.embarque?.nome || 'o ponto de embarque')}`,
            `${window.BuzuUtils.formatarDistancia(r.acessoEmbarqueMetros || 0)} • ~${
              r.embarque?.tempoMinutos || 0
            } min a pé`
          )
        );

        if (r.tipo === 'transferencia') {
          const trechos = r.trechos || [];
          const listaTrans =
            Array.isArray(r.transferencias) && r.transferencias.length > 0
              ? r.transferencias
              : r.transferencia
              ? [r.transferencia]
              : [];

          trechos.forEach((tr, iTrecho) => {
            const linhaInfo = linhas[iTrecho] || { numero: tr.numero, cor: '#0d63c9' };
            const proxTrans = listaTrans[iTrecho];
            const destinoTrechoNome = proxTrans
              ? proxTrans.nome
              : tr.paradaDesembarqueNome || r.desembarque?.nome || 'o ponto de desembarque';

            passos.push(
              passo(
                window.BuzuUtils.escaparHtml(linhaInfo.numero || String(iTrecho + 1)),
                'letra-linha',
                window.BuzuUtils.escaparHtml(linhaInfo.cor || '#0d63c9'),
                `Embarque na linha ${window.BuzuUtils.escaparHtml(linhaInfo.numero || '')}${
                  // embarcou no terminal e o ônibus segue no outro sentido: mostra o sentido em que ele sai
                  tr.sentidoDesembarque || tr.sentido
                    ? ` (sentido ${window.BuzuUtils.escaparHtml(tr.sentidoDesembarque || tr.sentido)})`
                    : ''
                }`,
                `Siga até ${window.BuzuUtils.escaparHtml(destinoTrechoNome)} (~${window.BuzuUtils.formatarDistancia(
                  tr.distanciaMetros || 0
                )})`
              )
            );

            if (proxTrans && iTrecho < trechos.length - 1) {
              passos.push(
                passo(
                  listaTrans.length > 1 ? `↻${iTrecho + 1}` : '↻',
                  'letra-transferencia',
                  '',
                  `Integração ${listaTrans.length > 1 ? iTrecho + 1 : ''} em ${window.BuzuUtils.escaparHtml(
                    proxTrans.nome || 'ponto de integração'
                  )}`,
                  'Desça e pegue a próxima linha no mesmo ponto ou bem perto (o tempo estimado já inclui a espera média)'
                )
              );
            }
          });
        } else {
          passos.push(
            passo(
              window.BuzuUtils.escaparHtml(linhas[0]?.numero || '1'),
              'letra-linha',
              window.BuzuUtils.escaparHtml(linhas[0]?.cor || '#0d63c9'),
              `Siga na linha ${window.BuzuUtils.escaparHtml(linhas[0]?.numero || '')}`,
              `Trecho de ~${window.BuzuUtils.formatarDistancia(
                r.distanciaTrechoMetros || 0
              )} no traçado proposto até ${window.BuzuUtils.escaparHtml(
                r.desembarque?.nome || 'o destino'
              )}`
            )
          );
        }

        passos.push(
          passo(
            'B',
            'letra-destino',
            '',
            `Desembarque em ${window.BuzuUtils.escaparHtml(
              r.desembarque?.nome || 'o ponto mais próximo'
            )}`,
            `Caminhe ${window.BuzuUtils.formatarDistancia(
              r.acessoDesembarqueMetros || 0
            )} até o destino • ~${r.desembarque?.tempoMinutos || 0} min a pé`
          )
        );

        const ehSelecionado = idx === estadoUI.indiceTrajetoEscolhido;

        const btnEscolherTrajeto = `
          <button
            type="button"
            class="${ehSelecionado ? 'btn-primario btn-trajeto-ativo' : 'btn-secundario'} btn-escolher-trajeto"
            data-idx-trajeto="${idx}"
            aria-pressed="${ehSelecionado}"
          >
            <span class="material-symbols-outlined" aria-hidden="true">${
              ehSelecionado ? 'check_circle' : 'route'
            }</span>
            <span>${ehSelecionado ? 'Trajeto selecionado no mapa' : 'Escolher este trajeto'}</span>
          </button>`;

        const links = linhas
          .map(
            l =>
              `<a href="#/linha/${encodeURIComponent(l.numero)}" class="btn-secundario" title="Abrir ficha completa da linha ${window.BuzuUtils.escaparHtml(
                l.numero
              )}">Detalhes ${window.BuzuUtils.escaparHtml(
                l.numero
              )}</a>`
          )
          .join('');

        const separador =
          idx === 1
            ? `<li class="separador-opcoes" aria-hidden="true"><span>Outras opções (${resultados.length - 1})</span><small>Com mais integrações ou um pouco mais demoradas — escolha a que preferir</small></li>`
            : '';
        return `${separador}
          <li class="cartao-item ${ehSelecionado ? 'destacado cartao-trajeto-ativo' : ''}" data-card-trajeto="${idx}">
            <div class="cabecalho-cartao">
              <div>
                ${seloHtml(r)}
                <div class="linha-badges-viagem">${badges}</div>
                <span class="badge-tipo" style="margin-top:6px;display:inline-block;">
                  ${
                    r.tipo === 'direta'
                      ? 'Linha direta (sem integração)'
                      : `${r.numTransferencias || Math.max(1, (r.linhas?.length || 2) - 1)} ${
                          (r.numTransferencias || Math.max(1, (r.linhas?.length || 2) - 1)) === 1
                            ? 'integração'
                            : 'integrações'
                        }`
                  }
                </span>
              </div>
              <span class="badge-distancia" title="Tempo estimado (caminhada + espera média + viagem) e distância total">
                ${r.tempoEstimadoMin ? `~${r.tempoEstimadoMin} min • ` : ''}${window.BuzuUtils.formatarDistancia(r.totalMetros || 0)}${
          (r.acessoEmbarqueMetros || 0) + (r.acessoDesembarqueMetros || 0) > 0
            ? ` • ${window.BuzuUtils.formatarDistancia((r.acessoEmbarqueMetros || 0) + (r.acessoDesembarqueMetros || 0))} a pé`
            : ''
        }
              </span>
            </div>
            <p style="margin:6px 0 0 0;font-size:0.9rem;font-weight:700;">
              ${nomesLinhas}
            </p>
            <div class="viagem-passos">${passos.join('')}</div>
            <div class="acoes-cartao">
              ${btnEscolherTrajeto}
              ${links}
            </div>
          </li>`;
      })
      .join('');

    // Eventos dos botões "Escolher este trajeto"
    lista.querySelectorAll('.btn-escolher-trajeto').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.getAttribute('data-idx-trajeto'));
        void selecionarTrajetoSugerido(idx, { focarMapaNoCelular: true });
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
    if (subtitulo && loc) {
      subtitulo.textContent = `Referência: ${loc.rotulo} • Caminhada estimada (distância geodésica × 1,3 a 4,5 km/h)`;
    }

    if (estadoUI.paradasProximas.length === 0) {
      lista.innerHTML = `<li class="cartao-item">Nenhuma parada localizada para o dia selecionado.</li>`;
      return;
    }

    lista.innerHTML = estadoUI.paradasProximas
      .map(
        (p, idx) => `
        <li class="cartao-item ${idx === 0 ? 'destacado' : ''}">
          <div class="cabecalho-cartao">
            <div>
              <span class="badge-tipo">${window.BuzuUtils.escaparHtml(p.tipo)}</span>
              <span class="badge-tipo">${window.BuzuUtils.escaparHtml(p.dia_rotulo)}</span>
              <h3 style="margin:6px 0 0 0;font-size:1rem;font-weight:800;">
                ${idx + 1}. ${window.BuzuUtils.escaparHtml(p.nome)}
              </h3>
            </div>
            <span class="badge-distancia" title="Distância e tempo estimado a pé">
              ${window.BuzuUtils.formatarDistancia(p.distanciaPeMetros)} (~${p.tempoMinutos} min a pé)
            </span>
          </div>
          <div class="metadados-item">
            <span><strong>Sentido:</strong> ${window.BuzuUtils.escaparHtml(p.textoSentido)}</span>
            <span>| <strong>Acessível:</strong> ${p.acessivel === 'sim' ? 'Sim' : 'Consultar edital'}</span>
          </div>
          <div style="margin-top:8px;font-size:0.88rem;">
            <strong>Linhas propostas que passam aqui:</strong>
            ${window.BuzuDados.obterLinhasDaParadaNoDia(p.id, estadoUI.diaSemana)
              .map(
                r =>
                  `<a href="#/linha/${encodeURIComponent(
                    r
                  )}" class="badge-numero-linha" style="text-decoration:none;margin-left:6px;padding:2px 8px;font-size:0.85rem;">${window.BuzuUtils.escaparHtml(
                    r
                  )}</a>`
              )
              .join('')}
          </div>
          <div class="acoes-cartao">
            <a href="#/parada/${encodeURIComponent(p.id)}" class="btn-secundario">
              <span class="material-symbols-outlined" aria-hidden="true">place</span>
              Selecionar ponto e ver conexões
            </a>
          </div>
        </li>
      `
      )
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
      filtroSentido: estadoUI.abaBusca === 'linha'
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
      incluirInativas: estadoUI.modoEditorParadas,
      incluirVirtuaisNoMapa: estadoUI.mostrarVirtuaisNoMapa || linhaSelecionadaAtiva
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
      contadorEl.textContent = `${linhas.length} ${linhas.length === 1 ? 'LINHA' : 'LINHAS'}`;
    }

    if (linhas.length === 0) {
      listaEl.innerHTML = `
        <li class="cartao-item">
          Nenhuma linha localizada para os critérios selecionados.
        </li>
      `;
      return;
    }

    const montarHtmlCartao = linha => {
      const varUtil = linha.variantes_dia?.dias_uteis_sabados;
      const varDom = linha.variantes_dia?.domingos_feriados;
      const temVariacaoDomingo =
        varUtil &&
        varDom &&
        (varUtil.nome !== varDom.nome || varUtil.extensao_km !== varDom.extensao_km);

      return `
        <li class="cartao-item">
          <div class="cabecalho-cartao">
            <div style="display:flex;align-items:flex-start;gap:10px;">
              <span class="badge-numero-linha" style="background:${window.BuzuUtils.escaparHtml(
                linha.cor || '#172554'
              )};">
                ${window.BuzuUtils.escaparHtml(linha.numero)}
              </span>
              <div>
                <strong style="font-size:0.98rem;display:block;font-weight:700;">
                  ${window.BuzuUtils.escaparHtml(linha.nome)}
                </strong>
                <div style="margin-top:4px;display:flex;gap:6px;flex-wrap:wrap;">
                  <span class="badge-tipo">${window.BuzuUtils.escaparHtml(
                    linha.categoria_edital || linha.tipo
                  )}</span>
                  <span class="badge-tipo">Lote ${window.BuzuUtils.escaparHtml(linha.lote)}</span>
                  ${badgeSituacaoRota(linha)}
                </div>
              </div>
            </div>
          </div>

          <div class="metadados-item">
            <span><strong>Operação:</strong> ${window.BuzuUtils.escaparHtml(linha.dia_ativo_rotulo)}</span>
            ${
              linha.extensao_km
                ? `<span>| <strong>Extensão:</strong> ${Number(linha.extensao_km).toLocaleString('pt-BR')} km</span>`
                : ''
            }
          </div>

          ${
            temVariacaoDomingo
              ? `<p style="margin:6px 0 0 0;font-size:0.8rem;color:#162652;font-weight:700;">
                  Possui itinerário diferenciado entre Dias úteis/sábados e Domingos/feriados.
                 </p>`
              : ''
          }

          <div class="acoes-cartao">
            <a href="#/linha/${encodeURIComponent(linha.numero)}" class="btn-primario">
              <i class="bi bi-signpost-split"></i>
              <span>Ver itinerário e dados da linha</span>
            </a>
          </div>
        </li>
      `;
    };

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
        liSentinela.innerHTML = `<button type="button" class="btn-rumo-secondary">Mostrar mais linhas (${renderizados} de ${linhas.length})</button>`;
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
          <a href="#/" class="btn-secundario" style="margin-bottom:12px;">
            <i class="bi bi-arrow-left"></i> Voltar à consulta geral
          </a>
          <div class="alerta-erro">Linha "${window.BuzuUtils.escaparHtml(idLinha)}" não localizada.</div>
        </div>
      `;
      return;
    }

    // Atualiza a Faixa Superior (.faixa-itinerario) igual ao RUMO
    if (faixaTopo && faixaNum && faixaTexto) {
      faixaTopo.hidden = false;
      faixaNum.textContent = linha.numero;
      faixaNum.style.backgroundColor = linha.cor || '#172554';
      faixaTexto.textContent = linha.nome;
    }

    // Atualiza a etiqueta flutuante sobre o mapa com o código e nome da linha destacada
    const pillMapa = document.getElementById('pill-linha-mapa');
    const pillNum = document.getElementById('pill-linha-mapa-num');
    const pillNome = document.getElementById('pill-linha-mapa-nome');
    if (pillMapa && pillNum && pillNome) {
      pillMapa.hidden = false;
      pillNum.textContent = linha.numero;
      pillNum.style.backgroundColor = linha.cor || '#162652';
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

    function montarLinhasTabela(modoSentido) {
      const itens = modoSentido === 'VOLTA' ? ruasVolta : ruasIda;

      if (!itens || itens.length === 0) {
        return linha.situacao_rota === 'indefinida' || (linha.situacao_rota === 'parcial' && !linha.itinerario_ruas)
          ? `<tr><td colspan="3" style="padding:12px;">Itinerário ainda não divulgado pela STTU${
              linha.situacao_rota === 'parcial' ? ' para este dia' : ''
            }.</td></tr>`
          : `<tr><td colspan="3" style="padding:12px;">Consulte o traçado da linha no mapa ao lado.</td></tr>`;
      }

      return itens
        .map(
          (it, idx) => `
          <tr class="tr-parada-clicavel" data-lat="${it.lat}" data-lng="${it.lng}" title="Clique para focar este logradouro no mapa">
            <td class="col-num">${it.ordem || idx + 1}</td>
            <td class="col-logradouro">${window.BuzuUtils.escaparHtml(it.logradouro)}</td>
            <td class="col-bairro">${window.BuzuUtils.escaparHtml(it.bairro || 'Natal')}</td>
          </tr>
        `
        )
        .join('');
    }

    const sentidoInicial = 'IDA';
    const tarifaCurta =
      linha.tarifa && linha.tarifa.length <= 22 ? linha.tarifa : 'Sistema Natal';
    const empresaLinha = linha.empresa ? String(linha.empresa).trim() : '';

    container.innerHTML = `
      <div class="barra-acoes-detalhe-rumo">
        <a href="#/" class="btn-rumo-voltar">
          <i class="bi bi-arrow-left"></i>
          <span>Todas as linhas</span>
        </a>
        <button type="button" id="btn-copiar-link-linha" class="btn-rumo-voltar" data-url="${window.BuzuUtils.escaparHtml(
          urlCompartilhavel
        )}">
          <i class="bi bi-share"></i>
          <span>Compartilhar linha</span>
        </button>
      </div>

      ${avisoSituacaoRota(linha)}

      <!-- Estrutura exata de 2 sub-colunas (.colunas-conteudo-linha) do /rumo/itinerarios/ -->
      <div class="colunas-conteudo-linha">

        <!-- SUB-COLUNA 1: DADOS DA LINHA + QUILOMETRAGEM -->
        <div class="sub-coluna-1">
          <div class="linha-informacoes-gerais">
            <div class="coluna-informacao-gerais">
              <div class="linha1-informacao-gerais">
                <span class="icone-titulos"><i class="bi bi-file-earmark-text"></i></span>
                <span class="titulo-informacao-gerais">DADOS DA LINHA</span>
              </div>

              <div class="container-interno-informacao-tempo-funcionamento">
                <div class="linha2-informacao-gerais">
                  <div class="coluna1-linha2-informacao-gerais">
                    <div class="titulo-colunas-informacao-gerais">Lote</div>
                  </div>
                  <div class="coluna2-linha2-informacao-gerais">
                    <div class="titulo-colunas-informacao-gerais">Categoria</div>
                  </div>
                  <div class="coluna3-linha2-informacao-gerais">
                    <div class="titulo-colunas-informacao-gerais">Tarifa</div>
                  </div>
                </div>

                <div class="linha3-informacao-gerais">
                  <div class="coluna1-linha3-informacao-gerais">
                    <div class="subtitulo-colunas-informacao-gerais">Lote ${window.BuzuUtils.escaparHtml(
                      linha.lote
                    )}</div>
                  </div>
                  <div class="coluna2-linha3-informacao-gerais">
                    <div class="subtitulo-colunas-informacao-gerais">${window.BuzuUtils.escaparHtml(
                      linha.categoria_edital || linha.tipo
                    )}</div>
                  </div>
                  <div class="coluna3-linha3-informacao-gerais">
                    <div class="subtitulo-colunas-informacao-gerais">${window.BuzuUtils.escaparHtml(
                      tarifaCurta
                    )}</div>
                  </div>
                </div>

                <div class="linha-empresa-informacao-gerais">
                  <span class="titulo-colunas-informacao-gerais">
                    <i class="bi bi-building" aria-hidden="true"></i> Empresa operadora
                  </span>
                  <span class="subtitulo-colunas-informacao-gerais${
                    empresaLinha ? '' : ' subtitulo-colunas-informacao-gerais--vazio'
                  }">${empresaLinha ? window.BuzuUtils.escaparHtml(empresaLinha) : 'Não informada'}</span>
                </div>

                <button type="button" id="btn-expandir-dados-rumo" class="btn-expandir">
                  <span>Mais informações</span>
                  <i class="bi bi-chevron-down" id="icone-expandir-rumo"></i>
                </button>

                <div id="dados-extras-rumo" class="dados-extras">
                  <div class="linha1-informacao-gerais" style="margin-top:4px;">
                    <span class="icone-titulos"><i class="bi bi-speedometer2"></i></span>
                    <span class="titulo-informacao-gerais" style="font-size:13px;">QUILOMETRAGEM E OPERAÇÃO</span>
                  </div>

                  <div class="container-interno-informacao-tempo-funcionamento">
                    <div class="linha2-informacao-gerais">
                      <div class="coluna1-linha2-informacao-gerais">
                        <div class="titulo-colunas-informacao-gerais">Ida (est.)</div>
                      </div>
                      <div class="coluna2-linha2-informacao-gerais">
                        <div class="titulo-colunas-informacao-gerais">Volta (est.)</div>
                      </div>
                      <div class="coluna3-linha2-informacao-gerais">
                        <div class="titulo-colunas-informacao-gerais">Total</div>
                      </div>
                    </div>
                    <div class="linha3-informacao-gerais">
                      <div class="coluna1-linha3-informacao-gerais">
                        <div class="subtitulo-colunas-informacao-gerais">${kmMeiaViagem} km</div>
                      </div>
                      <div class="coluna2-linha3-informacao-gerais">
                        <div class="subtitulo-colunas-informacao-gerais">${kmMeiaViagem} km</div>
                      </div>
                      <div class="coluna3-linha3-informacao-gerais">
                        <div class="subtitulo-colunas-informacao-gerais">${kmTotalFormatado} km</div>
                      </div>
                    </div>
                  </div>

                  <div class="info-operacao-edital">
                    ${
                      op
                        ? `
                    <div><strong>Veículo:</strong> ${window.BuzuUtils.escaparHtml(op.veiculo || '-')}</div>
                    <div><strong>Ônibus no pico (dias úteis):</strong> ${formatarNumero(op.frota_du)}</div>
                    <div><strong>Tempo de uma volta completa:</strong> ${
                      op.tempo_ciclo_min ? `${Math.round(op.tempo_ciclo_min)} min` : '-'
                    }</div>
                    <div><strong>Viagens por mês:</strong> ${formatarNumero(op.viagens_mes)}</div>`
                        : ''
                    }
                    <div><strong>Frota acessível:</strong> ${
                      linha.acessivel ? 'Sim (100% acessível)' : 'Consultar edital'
                    }</div>
                    ${op ? '<div class="fonte-edital">Fonte: edital da Concorrência nº 11.001/2026, Anexo I.3, Tabela 17.</div>' : ''}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- SUB-COLUNA 2: FUNCIONAMENTO (SEG-SEX / SÁB / DOM) + TABELA DE ITINERÁRIO POR RUAS -->
        <div class="sub-coluna-2">
          <div class="linha-tempo-funcionamento">
            <div class="coluna-tempo-funcionamento">
              <div class="linha1-tempo-funcionamento">
                <span class="icone-titulos"><i class="bi bi-clock"></i></span>
                <span class="titulo-tempo-funcionamento">FUNCIONAMENTO</span>
              </div>

              <div class="container-interno-informacao-tempo-funcionamento">
                <div class="linha2-tempo-funcionamento">
                  <div class="coluna1-linha2-tempo-funcionamento">
                    <div class="titulo-colunas-tempo-funcionamento">Seg. a Sex.</div>
                  </div>
                  <div class="coluna2-linha2-tempo-funcionamento">
                    <div class="titulo-colunas-tempo-funcionamento">Sábado</div>
                  </div>
                  <div class="coluna3-linha2-tempo-funcionamento">
                    <div class="titulo-colunas-tempo-funcionamento">Dom. / Feriado</div>
                  </div>
                </div>

                <div class="linha3-tempo-funcionamento">
                  <div class="coluna1-linha3-tempo-funcionamento">
                    ${celulaFuncionamento(op ? op.intervalo_du : undefined, operaUtilSab)}
                  </div>
                  <div class="coluna2-linha3-tempo-funcionamento">
                    ${celulaFuncionamento(op ? op.intervalo_sab : undefined, operaUtilSab)}
                  </div>
                  <div class="coluna3-linha3-tempo-funcionamento">
                    ${celulaFuncionamento(op ? op.intervalo_dom : undefined, operaDom)}
                  </div>
                </div>
                ${
                  op
                    ? `<p class="nota-funcionamento">${
                        linha.tipo === 'noturna'
                          ? 'Linha Corujão: viagens na madrugada, todos os dias.'
                          : 'Intervalo máximo entre ônibus no horário de pico, conforme o edital (Tabela 17).'
                      }</p>`
                    : ''
                }
              </div>
            </div>
          </div>

          <!-- Tabela Zebrada de Itinerário por Logradouros / Ruas (.tabela-itinerario do RUMO) -->
          <div class="linha-itinerario-partidas">
            <div class="coluna-itinerario-partidas">
              <div class="linha1-itinerario-partidas">
                <div class="titulo-itinerario-partidas">
                  <i class="bi bi-signpost-split"></i>
                  <span>ITINERÁRIO</span>
                </div>

                <select id="itinerario-sentido-select" class="itinerario-select" aria-label="Selecionar sentido do itinerário">
                  <option value="IDA" selected>Sentido IDA (${ruasIda.length} vias)</option>
                  <option value="VOLTA">Sentido VOLTA (${ruasVolta.length} vias)</option>
                </select>
              </div>

              <div class="tabela-wrapper">
                <table class="tabela-itinerario">
                  <thead>
                    <tr>
                      <th class="col-num">ORD</th>
                      <th class="col-logradouro">LOGRADOURO</th>
                      <th class="col-bairro">BAIRRO</th>
                    </tr>
                  </thead>
                  <tbody id="tbody-itinerario-rumo">
                    ${montarLinhasTabela(sentidoInicial)}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>

      </div>
    `;

    // Botão "Mais informações" (expande QUILOMETRAGEM igual ao RUMO)
    const btnExpandir = document.getElementById('btn-expandir-dados-rumo');
    const dadosExtras = document.getElementById('dados-extras-rumo');
    const iconeExpandir = document.getElementById('icone-expandir-rumo');
    btnExpandir?.addEventListener('click', () => {
      if (!dadosExtras) return;
      const aberto = dadosExtras.classList.toggle('aberto');
      if (iconeExpandir) {
        iconeExpandir.className = aberto ? 'bi bi-chevron-up' : 'bi bi-chevron-down';
      }
    });

    // Troca de sentido na tabela de itinerário (Ida / Volta / Principais)
    const selectSentido = document.getElementById('itinerario-sentido-select');
    const tbodyItinerario = document.getElementById('tbody-itinerario-rumo');
    function vincularCliquesTabela() {
      tbodyItinerario?.querySelectorAll('.tr-parada-clicavel').forEach(tr => {
        tr.addEventListener('click', () => {
          const lat = Number(tr.getAttribute('data-lat'));
          const lng = Number(tr.getAttribute('data-lng'));
          const pid = tr.getAttribute('data-parada-id');
          if (Number.isFinite(lat) && Number.isFinite(lng)) {
            window.BuzuMapa.focarParada(lat, lng, pid);
            if (window.innerWidth <= 960) {
              document.getElementById('mapa')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
          }
        });
      });
    }
    vincularCliquesTabela();

    selectSentido?.addEventListener('change', () => {
      if (!tbodyItinerario) return;
      tbodyItinerario.innerHTML = montarLinhasTabela(selectSentido.value);
      vincularCliquesTabela();
    });

    const btnCopiar = document.getElementById('btn-copiar-link-linha');
    btnCopiar?.addEventListener('click', async () => {
      const url = btnCopiar.getAttribute('data-url') || window.location.href;
      try {
        await navigator.clipboard.writeText(url);
        registrarEvento('compartilhar');
        btnCopiar.innerHTML = '<i class="bi bi-check2"></i> <span>Copiado!</span>';
      } catch (_e) {
        window.prompt('Copie o link direto desta linha:', url);
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

    const vinculosPivot = window.BuzuDados.obterVinculosLinhaParadas(props.id);

    const blocoEditorAdmin =
      estadoUI.adminDesbloqueado || estadoUI.modoEditorParadas
        ? `
          <div class="bloco-secao bloco-secao-destaque" style="margin-top:12px;">
            <h3 class="titulo-secao" style="margin-top:0;">
              <span>🛠️ Revisão Manual da Parada (Raio 40m)</span>
              <span class="badge-tipo">${window.BuzuUtils.escaparHtml(props.origem || 'manual')}</span>
            </h3>
            <div class="campo-grupo">
              <label for="edit-parada-nome" class="campo-label">Nome da parada:</label>
              <input type="text" id="edit-parada-nome" class="campo-input" value="${window.BuzuUtils.escaparHtml(
                props.nome
              )}">
            </div>
            <div class="grade-filtros">
              <div>
                <label for="edit-parada-sentido" class="campo-label">Sentido Atendido:</label>
                <select id="edit-parada-sentido" class="campo-select">
                  <option value="IDA" ${sUpper === 'IDA' ? 'selected' : ''}>IDA (mão de ida)</option>
                  <option value="VOLTA" ${sUpper === 'VOLTA' ? 'selected' : ''}>VOLTA (mão oposta)</option>
                  <option value="AMBOS" ${sUpper === 'AMBOS' ? 'selected' : ''}>AMBOS os sentidos</option>
                  <option value="AUTO">Auto-detectar pelo vetor da via</option>
                </select>
              </div>
              <div>
                <label for="edit-parada-origem" class="campo-label">Origem do Ponto:</label>
                <select id="edit-parada-origem" class="campo-select">
                  <option value="manual" ${props.origem === 'manual' ? 'selected' : ''}>Manual (Revisado)</option>
                  <option value="osm" ${props.origem === 'osm' ? 'selected' : ''}>OpenStreetMap (OSM)</option>
                  <option value="virtual" ${props.origem === 'virtual' ? 'selected' : ''}>Virtual (~200m)</option>
                </select>
              </div>
            </div>
            <label class="rumo-check" style="margin-top:10px;">
              <input type="checkbox" id="edit-parada-ativo" ${props.ativo !== false ? 'checked' : ''}>
              <span>Parada ativa no grafo de roteamento (Dijkstra)</span>
            </label>
            <div class="acoes-cartao" style="margin-top:12px;">
              <button type="button" id="btn-salvar-edicao-parada" class="btn-primario">
                <span class="material-symbols-outlined" aria-hidden="true">save</span>
                Salvar e Recalcular Grafo (40m)
              </button>
              <button type="button" id="btn-excluir-parada" class="btn-secundario" style="color:#b91c1c;border-color:#f3b4b4;">
                <span class="material-symbols-outlined" aria-hidden="true">delete</span>
                Excluir Parada
              </button>
            </div>
            <p style="margin:8px 0 0;font-size:0.76rem;color:var(--rumo-muted);">
              Coordenadas: <code>${lat.toFixed(6)}, ${lng.toFixed(6)}</code> • Vínculos em <code>linha_paradas</code>: <strong>${
          vinculosPivot.length
        }</strong>
            </p>
          </div>
        `
        : '';

    container.innerHTML = `
      <div class="bloco-secao">
        <a href="#/" class="btn-secundario" style="margin-bottom:12px;">
          <span class="material-symbols-outlined" aria-hidden="true">arrow_back</span>
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

        ${blocoEditorAdmin}

        <h3 class="titulo-secao" style="margin-top:16px;">
          <span>Linhas propostas que atendem este ponto</span>
          <span class="material-symbols-outlined" aria-hidden="true">directions_bus</span>
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
                <span class="material-symbols-outlined" aria-hidden="true">sync_alt</span>
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

    // Eventos do formulário de Revisão Manual da Parada
    document.getElementById('btn-salvar-edicao-parada')?.addEventListener('click', async () => {
      const novoNome = document.getElementById('edit-parada-nome')?.value.trim() || props.nome;
      const novoSentido = document.getElementById('edit-parada-sentido')?.value || 'AMBOS';
      const novaOrigem = document.getElementById('edit-parada-origem')?.value || 'manual';
      const novoAtivo = document.getElementById('edit-parada-ativo')?.checked !== false;

      await window.BuzuDados.criarOuEditarParadaNoMapa({
        id: props.id,
        nome: novoNome,
        lat,
        lng,
        tipo: props.tipo,
        origem: novaOrigem,
        ativo: novoAtivo,
        sentidos_atendidos: novoSentido
      });
      await atualizarMapaEListagens();
      renderizarVisaoDetalheParada(props.id);
    });

    document.getElementById('btn-excluir-parada')?.addEventListener('click', async () => {
      const ok = window.confirm(
        `Tem certeza que deseja excluir a parada "${props.nome}"? Ela será removida do rascunho local e do roteador.`
      );
      if (!ok) return;
      await window.BuzuDados.excluirParadaNoMapa(props.id);
      window.location.hash = '#/';
    });
  }

})();
