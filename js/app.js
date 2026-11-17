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
    modoEditorParadas: false,
    criarParadaCliqueAtivo: false,
    mostrarVirtuaisNoMapa: false,
    modoEditorRota: false,
    editorRotaLinha: null,
    editorRotaDia: 'dias_uteis_sabados',
    estenderRotaCliqueAtivo: false
  };

  document.addEventListener('DOMContentLoaded', async () => {
    configurarAcessibilidadeTopo();
    configurarBotoesDiaSemana();
    configurarBottomSheetMobile();
    configurarAbasBusca();
    configurarBuscaViagem();
    configurarBuscaDiretaLinhaEFiltros();
    configurarModalAdmin();

    const dadosEstado = await window.BuzuDados.inicializar();

    const containerFiltroRedeAtual = document.getElementById('container-filtro-rede-atual');
    if (containerFiltroRedeAtual) {
      containerFiltroRedeAtual.hidden = !dadosEstado.temRedeAtual;
    }

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
      },
      aoArrastarParada: async (idParada, novoLat, novoLng) => {
        await window.BuzuDados.moverParadaNoMapa(idParada, novoLat, novoLng, true);
        await atualizarMapaEListagens();
        if (String(estadoUI.paradaSelecionadaId) === String(idParada)) {
          renderizarVisaoDetalheParada(idParada);
        } else {
          window.location.hash = `#/parada/${encodeURIComponent(idParada)}`;
        }
      },
      aoClicarMapaEditor: async (lat, lng) => {
        const nova = await window.BuzuDados.criarOuEditarParadaNoMapa({
          lat,
          lng,
          nome: `Parada Revisada (${lat.toFixed(4)}, ${lng.toFixed(4)})`,
          origem: 'manual',
          ativo: true,
          sentidos_atendidos: 'AUTO'
        });
        estadoUI.criarParadaCliqueAtivo = false;
        const btnCriar = document.getElementById('btn-editor-criar-clique');
        if (btnCriar) btnCriar.setAttribute('aria-pressed', 'false');
        window.BuzuMapa.definirModoEditorParadas(estadoUI.modoEditorParadas, false);
        await atualizarMapaEListagens();
        if (nova?.properties?.id) {
          window.location.hash = `#/parada/${encodeURIComponent(nova.properties.id)}`;
        }
      },
      aoAtualizarRotaEditor: info => {
        const elInfo = document.getElementById('info-barra-editor-rota');
        const btnDesfazer = document.getElementById('btn-rota-desfazer');
        if (elInfo && info) {
          elInfo.textContent = `${info.vertices} vértices • ${info.extensaoKm.toFixed(2).replace('.', ',')} km — Arraste pontos, clique no + para inserir, botão direito remove`;
        }
        if (btnDesfazer && info) {
          btnDesfazer.disabled = !info.podeDesfazer;
        }
      }
    });

    // Modo escuro: troca o mapa base e redesenha linhas/paradas com as cores do tema
    document.addEventListener('buzu:tema', async e => {
      window.BuzuMapa.definirTemaMapa(e.detail?.tema === 'escuro');
      await atualizarMapaEListagens();
    });

    window.addEventListener('hashchange', processarRotaHash);
    await atualizarMapaEListagens(true);
    await processarRotaHash();
  });

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

    // Botão de recolher/expandir a legenda do mapa no celular
    const btnLegenda = document.getElementById('btn-toggle-legenda');
    const caixaLegenda = document.getElementById('legenda-mapa');
    btnLegenda?.addEventListener('click', () => {
      if (!caixaLegenda) return;
      const aberta = caixaLegenda.getAttribute('data-aberta-mobile') === 'true';
      caixaLegenda.setAttribute('data-aberta-mobile', String(!aberta));
      btnLegenda.setAttribute('aria-expanded', String(!aberta));
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

          if (!window.BuzuUtils.estaNaAreaDeNatal(latitude, longitude)) {
            atualizarFeedbackViagem(
              'Sua localização está fora dos limites de Natal. Confira a origem ou digite um endereço.',
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
      atualizarFeedbackViagem('', null);
      window.BuzuMapa.limparPontosViagem();
      renderizarResultadoViagem();
      await atualizarMapaEListagens(true);
    });
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
      document.getElementById('select-max-baldeacoes')?.value ?? 3
    );

    const resultados = await window.BuzuDados.calcularLinhasViagem(
      origem,
      destino,
      estadoUI.diaSemana,
      { maxBaldeacoes }
    );

    estadoUI.viagemAtiva = { origem, destino, resultados };
    await selecionarTrajetoSugerido(0, { silencioso: opcoes.silencioso });

    if (!opcoes.silencioso) {
      if (resultados.length > 0) {
        atualizarFeedbackViagem('', null);
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
        `Operação: ${window.BuzuUtils.escaparHtml(diaRotulo)} • Grafo Dijkstra (limite 1,2 km a pé a 1,2 m/s × 1,3; penalidade de baldeação: 7 min).`;
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
                  tr.sentido ? ` (${window.BuzuUtils.escaparHtml(tr.sentido)})` : ''
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
                  'Troque para a próxima linha (+7 min penalidade de transbordo)'
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

        return `
          <li class="cartao-item ${ehSelecionado ? 'destacado cartao-trajeto-ativo' : ''}" data-card-trajeto="${idx}">
            <div class="cabecalho-cartao">
              <div>
                <div class="linha-badges-viagem">${badges}</div>
                <span class="badge-tipo" style="margin-top:6px;display:inline-block;">
                  ${
                    r.tipo === 'direta'
                      ? 'Trajeto direto (sem baldeação)'
                      : `Com ${r.numTransferencias || Math.max(1, (r.linhas?.length || 2) - 1)} ${
                          (r.numTransferencias || Math.max(1, (r.linhas?.length || 2) - 1)) === 1
                            ? 'transferência'
                            : 'transferências'
                        }`
                  }
                </span>
              </div>
              <span class="badge-distancia" title="Distância total e tempo ponderado">
                ~${window.BuzuUtils.formatarDistancia(r.totalMetros || 0)}${
          r.custoDijkstraMin ? ` • ~${Math.round(r.custoDijkstraMin)} min` : ''
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

        if (!window.BuzuUtils.estaNaAreaDeNatal(latitude, longitude)) {
          mostrarMensagemLocalizacao(
            'Coordenada atual fora do município do Natal. Exibindo as paradas propostas mais próximas ou busque por um bairro de Natal abaixo.',
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
            ${(p.rotas || [])
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
    for (const fc of colecoesLotes) {
      for (const feat of fc?.features || []) {
        const num = String(feat.properties?.numero || feat.properties?.linha_id || '').toUpperCase();
        if (numerosPermitidos.has(num)) {
          featuresRotas.push(feat);
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
      redeAtualGeoJson: estadoDados.redeAtualGeoJson
    });

    const paradasDia = window.BuzuDados.obterParadasPorDia(estadoUI.diaSemana, {
      incluirInativas: estadoUI.modoEditorParadas,
      incluirVirtuaisNoMapa: estadoUI.mostrarVirtuaisNoMapa || linhaSelecionadaAtiva
    });
    let paradasVisiveis = paradasDia.filter(feat => {
      const rotas = (feat.properties?.rotas || []).map(rota => String(rota).toUpperCase());
      // Paradas sem linha associada só aparecem na visão geral (nunca no detalhe de uma linha)
      if (rotas.length === 0) return !linhaSelecionadaAtiva;
      return rotas.some(rota => numerosPermitidos.has(rota));
    });

    if (estadoUI.paradaSelecionadaId) {
      const paradaSelecionada = window.BuzuDados.obterParadaPorId(estadoUI.paradaSelecionadaId);
      if (paradaSelecionada && !paradasVisiveis.includes(paradaSelecionada)) {
        paradasVisiveis = [...paradasVisiveis, paradaSelecionada];
      }
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

  function renderizarListaLinhasTextual(linhas) {
    const listaEl = document.getElementById('lista-linhas-propostas');
    const contadorEl = document.getElementById('contador-linhas');
    if (!listaEl) return;

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

    listaEl.innerHTML = linhas
      .map(linha => {
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
      })
      .join('');
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
          ${(props.rotas || [])
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
            .join('')}
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
      await window.BuzuDados.excluirParadaNoMapa(props.id);
      window.location.hash = '#/';
    });
  }

  /**
   * Modal Técnico de Acesso Restrito (Admin JSON / KML / KMZ)
   */
  function configurarModalAdmin() {
    const btnAbrir = document.getElementById('btn-acesso-restrito');
    const modal = document.getElementById('modal-admin');
    const btnFechar = document.getElementById('btn-fechar-modal-admin');
    const formSenha = document.getElementById('form-login-admin');
    const areaDesbloqueada = document.getElementById('area-admin-desbloqueada');
    const inputSenha = document.getElementById('input-chave-admin');
    const feedbackAdmin = document.getElementById('feedback-admin');
    const textareaJson = document.getElementById('textarea-json-admin');
    const inputArquivo = document.getElementById('input-arquivo-admin');
    const btnSalvarJson = document.getElementById('btn-aplicar-json-admin');
    const btnBaixarJson = document.getElementById('btn-baixar-json-admin');
    const btnRestaurar = document.getElementById('btn-restaurar-padrao-admin');
    const btnAtivarEditorMapa = document.getElementById('btn-ativar-editor-mapa');
    const barraEditorMapa = document.getElementById('barra-editor-mapa');
    const btnEditorCriarClique = document.getElementById('btn-editor-criar-clique');
    const chkEditorVirtuais = document.getElementById('chk-editor-mostrar-virtuais');
    const btnEditorSair = document.getElementById('btn-editor-sair');

    const btnAtivarEditorRota = document.getElementById('btn-ativar-editor-rota');
    const selectLinhaVisual = document.getElementById('select-linha-editor-visual');
    const selectDiaVisual = document.getElementById('select-dia-editor-visual');
    const barraEditorRota = document.getElementById('barra-editor-rota');
    const btnRotaDesfazer = document.getElementById('btn-rota-desfazer');
    const btnRotaEstender = document.getElementById('btn-rota-estender-clique');
    const btnRotaSalvar = document.getElementById('btn-rota-salvar-mapa');
    const btnRotaSair = document.getElementById('btn-rota-sair');

    btnAtivarEditorMapa?.addEventListener('click', async () => {
      if (estadoUI.modoEditorRota) sairModoEditorRota(false);
      estadoUI.modoEditorParadas = true;
      estadoUI.criarParadaCliqueAtivo = false;
      if (modal) modal.hidden = true;
      if (barraEditorMapa) barraEditorMapa.hidden = false;
      window.BuzuMapa.definirModoEditorParadas(true, false);
      await atualizarMapaEListagens();
    });

    async function abrirEditorRotaNoMapa(numeroLinha, diaSemana) {
      const dadosRota = await window.BuzuDados.obterCoordenadasRota(numeroLinha, diaSemana);
      if (!dadosRota) {
        mostrarFeedbackAdmin(`Traçado da linha ${numeroLinha} não encontrado.`, 'erro');
        return;
      }

      if (estadoUI.modoEditorParadas) {
        estadoUI.modoEditorParadas = false;
        estadoUI.criarParadaCliqueAtivo = false;
        if (barraEditorMapa) barraEditorMapa.hidden = true;
        window.BuzuMapa.definirModoEditorParadas(false, false);
      }

      estadoUI.modoEditorRota = true;
      estadoUI.editorRotaLinha = numeroLinha;
      estadoUI.editorRotaDia = dadosRota.diaReal;
      estadoUI.estenderRotaCliqueAtivo = false;
      estadoUI.linhaSelecionadaId = numeroLinha;
      estadoUI.paradaSelecionadaId = null;

      if (modal) modal.hidden = true;
      if (barraEditorRota) barraEditorRota.hidden = false;
      const tituloBarra = document.getElementById('titulo-barra-editor-rota');
      if (tituloBarra) {
        tituloBarra.textContent = `Editando Linha ${numeroLinha} (${
          dadosRota.diaReal === 'domingos_feriados' ? 'Domingos' : 'Úteis/Sáb'
        })`;
      }
      if (btnRotaEstender) btnRotaEstender.setAttribute('aria-pressed', 'false');

      await atualizarMapaEListagens();
      window.BuzuMapa.definirModoEditorRota(
        true,
        dadosRota.coordenadas,
        dadosRota.feature?.properties?.cor || '#e0621f',
        true
      );
      renderizarFormularioEditorRota(numeroLinha, dadosRota.diaReal);
    }

    async function sairModoEditorRota(voltarParaLinha = true) {
      estadoUI.modoEditorRota = false;
      estadoUI.estenderRotaCliqueAtivo = false;
      if (barraEditorRota) barraEditorRota.hidden = true;
      window.BuzuMapa.definirModoEditorRota(false, []);
      if (voltarParaLinha && estadoUI.editorRotaLinha) {
        window.location.hash = `#/linha/${encodeURIComponent(estadoUI.editorRotaLinha)}`;
      }
      await atualizarMapaEListagens();
    }

    function renderizarFormularioEditorRota(numeroLinha, diaReal) {
      const containerDetalhe = document.getElementById('visao-detalhe');
      const containerExploracao = document.getElementById('visao-exploracao');
      const linha = window.BuzuDados.obterLinhaPorId(numeroLinha, diaReal);
      if (!containerDetalhe || !linha) return;

      if (containerExploracao) containerExploracao.hidden = true;
      containerDetalhe.hidden = false;

      const corAtual = /^#[0-9a-f]{6}$/i.test(String(linha.cor || '')) ? linha.cor : '#162652';

      containerDetalhe.innerHTML = `
        <div class="bloco-secao bloco-secao-destaque">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:10px;">
            <strong style="font-size:1.05rem;color:#162652;">
              <i class="bi bi-bezier2"></i> Editando Linha ${window.BuzuUtils.escaparHtml(linha.numero)}
            </strong>
            <span class="badge-tipo">${
              diaReal === 'domingos_feriados' ? 'Domingos e feriados' : 'Dias úteis e sábados'
            }</span>
          </div>

          <div class="alerta-edital" style="margin-bottom:12px;font-size:0.82rem;">
            <strong>Como editar no mapa:</strong><br>
            • <strong>Arraste</strong> os pontos brancos para ajustar curvas e ruas.<br>
            • Clique nos círculos <strong>+</strong> entre os pontos para criar novos vértices.<br>
            • Clique com o <strong>botão direito</strong> em um ponto para removê-lo.
          </div>

          <div class="campo-grupo">
            <label for="edit-rota-nome" class="consulta-search-label">Nome / Itinerário resumido da linha:</label>
            <input type="text" id="edit-rota-nome" class="form-control-rumo" value="${window.BuzuUtils.escaparHtml(
              linha.nome
            )}">
          </div>

          <div class="grade-filtros">
            <div>
              <label for="edit-rota-lote" class="consulta-search-label">Lote:</label>
              <select id="edit-rota-lote" class="form-select-rumo">
                <option value="1" ${String(linha.lote) === '1' ? 'selected' : ''}>Lote 1 (Norte)</option>
                <option value="2" ${String(linha.lote) === '2' ? 'selected' : ''}>Lote 2 (Sul / Leste / Oeste)</option>
              </select>
            </div>
            <div>
              <label for="edit-rota-categoria" class="consulta-search-label">Categoria:</label>
              <select id="edit-rota-categoria" class="form-select-rumo">
                <option value="Linha de Bairro" ${String(linha.categoria_edital).includes('Bairro') ? 'selected' : ''}>Linha de Bairro</option>
                <option value="Linhas Estruturais" ${String(linha.categoria_edital).includes('Estrutur') ? 'selected' : ''}>Linha Estrutural</option>
                <option value="Linhas Regionais" ${String(linha.categoria_edital).includes('Region') ? 'selected' : ''}>Linha Regional</option>
                <option value="Linhas Diretas" ${String(linha.categoria_edital).includes('Diret') ? 'selected' : ''}>Linha Direta</option>
                <option value="Linhas Corujões" ${String(linha.categoria_edital).includes('Coruj') ? 'selected' : ''}>Corujão / Noturna</option>
              </select>
            </div>
            <div>
              <label for="edit-rota-cor" class="consulta-search-label">Cor no mapa:</label>
              <input type="color" id="edit-rota-cor" class="form-control-rumo" style="padding:4px;" value="${window.BuzuUtils.escaparHtml(
                corAtual
              )}">
            </div>
            <div>
              <label for="edit-rota-horario" class="consulta-search-label">Horário previsto:</label>
              <input type="text" id="edit-rota-horario" class="form-control-rumo" value="${window.BuzuUtils.escaparHtml(
                linha.horario_operacao || '05:00 às 23:00'
              )}">
            </div>
          </div>

          <div class="campo-grupo" style="margin-top:8px;">
            <label for="edit-rota-tarifa" class="consulta-search-label">Tarifa / Sistema:</label>
            <input type="text" id="edit-rota-tarifa" class="form-control-rumo" value="${window.BuzuUtils.escaparHtml(
              linha.tarifa || 'Sistema Natal'
            )}">
          </div>

          <div id="feedback-editor-rota" hidden style="margin:10px 0;"></div>

          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;">
            <button type="button" id="btn-salvar-rota-form" class="btn-rumo-primary" style="flex:1;">
              <i class="bi bi-save"></i> Salvar Alterações e Recalcular (40m)
            </button>
            <button type="button" id="btn-cancelar-rota-form" class="btn-rumo-secondary">
              Cancelar
            </button>
          </div>
        </div>
      `;

      document.getElementById('btn-salvar-rota-form')?.addEventListener('click', salvarEdicaoRotaAtual);
      document.getElementById('btn-cancelar-rota-form')?.addEventListener('click', () => {
        void sairModoEditorRota(true);
      });
    }

    async function salvarEdicaoRotaAtual() {
      if (!estadoUI.modoEditorRota || !estadoUI.editorRotaLinha) return;
      const coords = window.BuzuMapa.obterCoordenadasEdicaoRota();
      const metadados = {
        nome: document.getElementById('edit-rota-nome')?.value.trim(),
        lote: document.getElementById('edit-rota-lote')?.value,
        categoria_edital: document.getElementById('edit-rota-categoria')?.value,
        cor: document.getElementById('edit-rota-cor')?.value,
        horario_operacao: document.getElementById('edit-rota-horario')?.value.trim(),
        tarifa: document.getElementById('edit-rota-tarifa')?.value.trim()
      };

      const box = document.getElementById('feedback-editor-rota');
      try {
        const res = await window.BuzuDados.atualizarRotaNoMapa(
          estadoUI.editorRotaLinha,
          estadoUI.editorRotaDia,
          coords,
          metadados
        );
        await atualizarMapaEListagens();
        if (box) {
          box.hidden = false;
          box.className = 'alerta-sucesso';
          box.textContent = `Salvo! ${res.extensao_km.toFixed(2).replace('.', ',')} km • ${res.vertices} vértices • ${res.paradasVinculadas} paradas vinculadas (40m).`;
        }
      } catch (err) {
        if (box) {
          box.hidden = false;
          box.className = 'alerta-erro';
          box.textContent = `Erro ao salvar: ${err.message}`;
        }
      }
    }

    btnAtivarEditorRota?.addEventListener('click', () => {
      const num = selectLinhaVisual?.value;
      const dia = selectDiaVisual?.value || 'dias_uteis_sabados';
      if (num) void abrirEditorRotaNoMapa(num, dia);
    });

    btnRotaDesfazer?.addEventListener('click', () => {
      window.BuzuMapa.desfazerEdicaoRota();
    });

    btnRotaEstender?.addEventListener('click', () => {
      estadoUI.estenderRotaCliqueAtivo = !estadoUI.estenderRotaCliqueAtivo;
      btnRotaEstender.setAttribute('aria-pressed', String(estadoUI.estenderRotaCliqueAtivo));
      window.BuzuMapa.definirAdicionarVerticeCliqueRota(estadoUI.estenderRotaCliqueAtivo);
    });

    btnRotaSalvar?.addEventListener('click', () => {
      void salvarEdicaoRotaAtual();
    });

    btnRotaSair?.addEventListener('click', () => {
      void sairModoEditorRota(true);
    });

    btnEditorCriarClique?.addEventListener('click', () => {
      estadoUI.criarParadaCliqueAtivo = !estadoUI.criarParadaCliqueAtivo;
      btnEditorCriarClique.setAttribute('aria-pressed', String(estadoUI.criarParadaCliqueAtivo));
      window.BuzuMapa.definirModoEditorParadas(
        estadoUI.modoEditorParadas,
        estadoUI.criarParadaCliqueAtivo
      );
    });

    chkEditorVirtuais?.addEventListener('change', async () => {
      estadoUI.mostrarVirtuaisNoMapa = chkEditorVirtuais.checked;
      await atualizarMapaEListagens();
    });

    btnEditorSair?.addEventListener('click', async () => {
      estadoUI.modoEditorParadas = false;
      estadoUI.criarParadaCliqueAtivo = false;
      if (barraEditorMapa) barraEditorMapa.hidden = true;
      window.BuzuMapa.definirModoEditorParadas(false, false);
      await atualizarMapaEListagens();
    });

    btnAbrir?.addEventListener('click', () => {
      if (!modal) return;
      modal.hidden = false;
      if (estadoUI.adminDesbloqueado) {
        preencherEditorComDadosAtuais();
      } else {
        inputSenha?.focus();
      }
    });

    btnFechar?.addEventListener('click', () => {
      if (modal) modal.hidden = true;
    });

    modal?.addEventListener('click', e => {
      if (e.target === modal) modal.hidden = true;
    });

    formSenha?.addEventListener('submit', async e => {
      e.preventDefault();
      const senhaDigitada = (inputSenha?.value || '').trim();
      const resultado = await autenticarAdminNoServidor(senhaDigitada);
      if (resultado.ok) {
        estadoUI.adminDesbloqueado = true;
        if (resultado.token && typeof window.BuzuDados.definirTokenAdmin === 'function') {
          window.BuzuDados.definirTokenAdmin(resultado.token);
        }
        if (inputSenha) inputSenha.value = '';
        formSenha.hidden = true;
        if (areaDesbloqueada) areaDesbloqueada.hidden = false;
        if (feedbackAdmin) feedbackAdmin.hidden = true;
        preencherEditorComDadosAtuais();
      } else {
        if (feedbackAdmin) {
          feedbackAdmin.hidden = false;
          feedbackAdmin.className = 'alerta-erro';
          feedbackAdmin.textContent = resultado.erro || 'Chave técnica inválida.';
        }
      }
    });

    function preencherEditorComDadosAtuais() {
      if (!textareaJson) return;
      const pacote = window.BuzuDados.exportarPacoteCompletoJson();
      const selectLinha = document.getElementById('select-linha-edicao-admin');

      if (selectLinha) {
        const valorAtual =
          selectLinha.value ||
          (estadoUI.linhaSelecionadaId ? String(estadoUI.linhaSelecionadaId) : '');
        const opcoesLinhas = (pacote.indice?.linhas || [])
          .map(
            l =>
              `<option value="${window.BuzuUtils.escaparHtml(l.numero)}">Linha ${window.BuzuUtils.escaparHtml(
                l.numero
              )} — ${window.BuzuUtils.escaparHtml(l.nome)}</option>`
          )
          .join('');
        selectLinha.innerHTML = `<option value="">Selecione uma linha (ou importe um arquivo abaixo)</option>${opcoesLinhas}`;
        if (valorAtual && [...selectLinha.options].some(o => o.value === valorAtual)) {
          selectLinha.value = valorAtual;
        }
      }

      if (selectLinhaVisual) {
        const valorVis =
          selectLinhaVisual.value ||
          (estadoUI.linhaSelecionadaId ? String(estadoUI.linhaSelecionadaId) : '');
        const opcoesVis = (pacote.indice?.linhas || [])
          .map(
            l =>
              `<option value="${window.BuzuUtils.escaparHtml(l.numero)}">${window.BuzuUtils.escaparHtml(
                l.numero
              )} — ${window.BuzuUtils.escaparHtml(l.nome)}</option>`
          )
          .join('');
        selectLinhaVisual.innerHTML = opcoesVis;
        if (valorVis && [...selectLinhaVisual.options].some(o => o.value === valorVis)) {
          selectLinhaVisual.value = valorVis;
        }
      }

      const linhaEscolhida = selectLinha?.value || '';
      if (!linhaEscolhida) {
        textareaJson.value = '';
        textareaJson.placeholder =
          'Selecione uma linha acima para editar o JSON dela (evita travar a guia com todas as 87 linhas e 2.276 paradas), ou use "Baixar JSON Consolidado" / "Abrir Editor de Paradas no Mapa".';
        return;
      }

      // Isola apenas o JSON da linha selecionada para edição rápida e segura sem travar o navegador!
      const linhaMeta = (pacote.indice?.linhas || []).find(l => l.numero === linhaEscolhida);
      const paradasLinha = (pacote.paradas?.features || []).filter(f =>
        (f.properties?.rotas || []).includes(linhaEscolhida)
      );
      const lotesLinha = {};
      for (const [idLote, fc] of Object.entries(pacote.lotesGeoJson || {})) {
        const feats = (fc?.features || []).filter(
          f => f.properties?.numero === linhaEscolhida || f.properties?.linha_id === linhaEscolhida
        );
        if (feats.length > 0) {
          lotesLinha[idLote] = { type: 'FeatureCollection', features: feats };
        }
      }
      const recorteIsolado = {
        indice: { linhas: linhaMeta ? [linhaMeta] : [] },
        paradas: { type: 'FeatureCollection', features: paradasLinha },
        lotesGeoJson: lotesLinha
      };
      textareaJson.value = JSON.stringify(recorteIsolado, null, 2);
    }

    document.getElementById('select-linha-edicao-admin')?.addEventListener('change', () => {
      preencherEditorComDadosAtuais();
    });

    inputArquivo?.addEventListener('change', async () => {
      const arquivo = inputArquivo.files?.[0];
      if (!arquivo) return;

      try {
        const nomeArq = arquivo.name.toLowerCase();
        if (nomeArq.endsWith('.json') || nomeArq.endsWith('.geojson')) {
          const texto = await arquivo.text();
          if (textareaJson) textareaJson.value = texto;
          mostrarFeedbackAdmin(`Arquivo "${arquivo.name}" carregado. Clique em "Aplicar e Salvar Rotas".`, 'sucesso');
        } else if (nomeArq.endsWith('.kml')) {
          const textoKml = await arquivo.text();
          const fc = window.BuzuDados.converterKmlTextoParaGeoJson(textoKml, '1');
          if (textareaJson) textareaJson.value = JSON.stringify(fc, null, 2);
          mostrarFeedbackAdmin(`Arquivo KML "${arquivo.name}" convertido para GeoJSON simplificado.`, 'sucesso');
        } else if (nomeArq.endsWith('.kmz')) {
          const textoKml = await extrairKmlDeKmzNoNavegador(arquivo);
          const fc = window.BuzuDados.converterKmlTextoParaGeoJson(textoKml, '1');
          if (textareaJson) textareaJson.value = JSON.stringify(fc, null, 2);
          mostrarFeedbackAdmin(`Arquivo KMZ "${arquivo.name}" extraído e convertido para JSON.`, 'sucesso');
        }
      } catch (err) {
        mostrarFeedbackAdmin(`Erro ao processar arquivo: ${err.message}`, 'erro');
      }
    });

    btnSalvarJson?.addEventListener('click', async () => {
      try {
        const obj = JSON.parse(textareaJson.value);
        const modo = document.getElementById('select-modo-importacao')?.value || 'mesclar';
        window.BuzuDados.importarJsonAdmin(obj, modo);
        window.BuzuMapa.solicitarEnquadramentoNaProximaRenderizacao();
        await atualizarMapaEListagens(true);
        preencherEditorComDadosAtuais();
        mostrarFeedbackAdmin('Rotas e paradas gravadas e atualizadas no mapa!', 'sucesso');
      } catch (err) {
        mostrarFeedbackAdmin(`Erro de sintaxe JSON: ${err.message}`, 'erro');
      }
    });

    btnBaixarJson?.addEventListener('click', () => {
      const pacote = window.BuzuDados.exportarPacoteCompletoJson();
      const blob = new Blob([JSON.stringify(pacote, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'buzu-rotas-pacote-completo.json';
      a.click();
      URL.revokeObjectURL(url);
    });

    btnRestaurar?.addEventListener('click', async () => {
      window.BuzuDados.restaurarDadosPadrao();
      await window.BuzuDados.inicializar();
      await atualizarMapaEListagens(true);
      preencherEditorComDadosAtuais();
      mostrarFeedbackAdmin('Base restaurada para os arquivos originais da pasta ./dados/.', 'sucesso');
    });

    function mostrarFeedbackAdmin(msg, tipo) {
      if (!feedbackAdmin) return;
      feedbackAdmin.hidden = false;
      feedbackAdmin.className = tipo === 'erro' ? 'alerta-erro' : 'alerta-sucesso';
      feedbackAdmin.textContent = msg;
    }
  }

  async function autenticarAdminNoServidor(chave) {
    if (!chave) return { ok: false, erro: 'Informe a chave de administrador.' };
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chave })
      });
      const dados = await res.json().catch(() => ({}));
      if (res.ok && dados.ok) {
        return { ok: true, token: dados.token || '' };
      }
      return { ok: false, erro: dados.erro || 'Chave técnica inválida.' };
    } catch (_e) {
      return { ok: false, erro: 'Servidor de autenticação indisponível.' };
    }
  }

  async function extrairKmlDeKmzNoNavegador(arquivoKmz) {
    const buffer = await arquivoKmz.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const view = new DataView(buffer);

    let offset = 0;
    while (offset + 30 < bytes.length) {
      const sig = view.getUint32(offset, true);
      if (sig !== 0x04034b50) break;

      const metodoCompressao = view.getUint16(offset + 8, true);
      const tamComprimido = view.getUint32(offset + 18, true);
      const tamNome = view.getUint16(offset + 26, true);
      const tamExtra = view.getUint16(offset + 28, true);

      const nomeEntrada = new TextDecoder().decode(bytes.subarray(offset + 30, offset + 30 + tamNome));
      const inicioDados = offset + 30 + tamNome + tamExtra;
      const dadosEntrada = bytes.subarray(inicioDados, inicioDados + tamComprimido);

      if (nomeEntrada.toLowerCase().endsWith('.kml')) {
        if (metodoCompressao === 0) {
          return new TextDecoder('utf-8').decode(dadosEntrada);
        }
        if (metodoCompressao === 8 && typeof DecompressionStream !== 'undefined') {
          const ds = new DecompressionStream('deflate-raw');
          const writer = ds.writable.getWriter();
          writer.write(dadosEntrada);
          writer.close();
          const res = new Response(ds.readable);
          return await res.text();
        }
      }
      offset = inicioDados + tamComprimido;
    }
    throw new Error('Não foi possível extrair doc.kml deste KMZ no navegador.');
  }
})();
