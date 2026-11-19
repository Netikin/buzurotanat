/**
 * js/mapa.js
 * Camada Cartográfica de Transporte (Padrão MTA Live Subway Map / Stamen / nyc-transport-network):
 * - Mapa base neutro dessaturado para que as cores das linhas dominem
 * - Renderização em L.canvas() para 85 linhas
 * - Deslocamento paralelo entre traçados sobrepostos (técnica Stamen/MetroMatch)
 * - Fluxo de dois níveis: clicar em terminal/parada ou linha abre direto no painel lateral / bottom sheet,
 *   nunca cobrindo o mapa com modal ou popup bloqueante.
 */

window.BuzuMapa = (function () {
  'use strict';

  const CENTRO_NATAL = [-5.752, -35.236];
  const ZOOM_INICIAL = 13;

  let mapa = null;
  let canvasRenderer = null;
  let camadaRotasPropostas = null;
  let camadaRedeAtual = null;
  let camadaViagem = null;
  let camadaEdicaoRota = null;
  let clusterParadas = null;
  let marcadorUsuario = null;
  let circuloPrecisaoUsuario = null;
  let indiceMarkersParadas = new Map();
  let ehRequisitadoEnquadramento = false;

  // Paradas fora do modo editor: círculos leves em canvas próprio (acima das linhas)
  let renderParadas = null;
  let camadaParadasPrincipais = null; // terminais e pontos de integração (sempre visíveis)
  let camadaParadasComuns = null; // paradas comuns (aparecem ao aproximar o mapa)
  let zoomMinimoParadas = 15;
  let controleDicaZoom = null;
  let camadaMapaBase = null;
  let temaEscuro = false;

  const ESTILO_MAPA_CLARO = 'https://tiles.openfreemap.org/styles/positron';
  const ESTILO_MAPA_ESCURO = 'https://tiles.openfreemap.org/styles/dark';

  function corContornoRota() {
    return temaEscuro ? '#0b1220' : '#FFFFFF';
  }

  // ---------- Sentido da viagem (ida / volta) da linha selecionada ----------
  let camadaSentidos = null; // setas e marcadores de terminal/retorno
  let linhasComSentido = []; // [{ idaLatLngs, voltaLatLngs, cor }] para redesenhar ao mudar o zoom
  let camadaEtapas = null; // "Como chegar": só o caminho do passageiro
  let etapasViagem = []; // [{ tipo: 'pe'|'onibus', coords, cor, numero }]

  function misturarCor(hex, alvo, fracao) {
    const h = String(hex || '#0057B8').replace('#', '');
    const n = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
    const rgb = [0, 2, 4].map(i => parseInt(n.slice(i, i + 2), 16));
    const t = alvo === 'branco' ? 255 : 0;
    return '#' + rgb.map(v => Math.round(v + (t - v) * fracao).toString(16).padStart(2, '0')).join('');
  }

  /**
   * Índice do ponto de retorno: o informado no traçado ou, nos traçados em laço do projeto,
   * o ponto mais distante do terminal entre 40% e 60% do percurso (ida e volta têm extensões parecidas).
   */
  function indiceRetorno(coords, props) {
    const informado = Number(props.indice_retorno);
    if (Number.isInteger(informado) && informado > 0 && informado < coords.length - 1) return informado;
    const acum = window.BuzuUtils.calcularComprimentoAcumulado(coords);
    const total = acum[acum.length - 1] || 1;
    const [x0, y0] = coords[0];
    let melhor = Math.floor(coords.length / 2);
    let maior = -1;
    coords.forEach(([x, y], i) => {
      const f = acum[i] / total;
      if (f < 0.4 || f > 0.6) return;
      const d = (x - x0) ** 2 + (y - y0) ** 2;
      if (d > maior) {
        maior = d;
        melhor = i;
      }
    });
    return melhor;
  }

  function corEhClara(hex) {
    const n = String(hex || '').replace('#', '');
    if (n.length < 6) return false;
    const [r, g, b] = [0, 2, 4].map(i => parseInt(n.slice(i, i + 2), 16) / 255);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.6;
  }

  /** Desloca o traçado para o lado direito do sentido de circulação (mão de direção no Brasil) */
  function paraLadoDireito(coords, pixels) {
    const lat = coords[0]?.[1] || -5.8;
    const metrosPorPixel = (40075016.686 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, mapa.getZoom() + 8);
    return window.BuzuUtils.deslocarPolilinhaMetros(coords, -pixels * metrosPorPixel);
  }

  function iconeSeta(angulo, cor) {
    return L.divIcon({
      className: '',
      html: `<div class="seta-sentido${corEhClara(cor) ? ' seta-sentido--clara' : ''}" style="--cor-seta:${cor};transform:rotate(${angulo}deg)"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3.5 10.5 8 5 12.5" /></svg></div>`,
      iconSize: [18, 18],
      iconAnchor: [9, 9]
    });
  }

  /** Coloca setas a cada ~120 px ao longo da polilinha, apontando no sentido do percurso */
  function desenharSetas(latLngs, cor, rotulo, ESPACO = 120) {
    if (latLngs.length < 2) return;
    const pts = latLngs.map(ll => mapa.latLngToLayerPoint(ll));
    // trecho curto na tela: ao menos uma seta no meio
    let totalPx = 0;
    for (let i = 1; i < pts.length; i++) totalPx += pts[i - 1].distanceTo(pts[i]);
    let acumulado = totalPx < ESPACO ? totalPx / 2 : ESPACO * 0.5;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const seg = a.distanceTo(b);
      while (acumulado <= seg && seg > 0) {
        const f = acumulado / seg;
        const p = L.point(a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f);
        const angulo = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
        L.marker(mapa.layerPointToLatLng(p), {
          icon: iconeSeta(angulo, cor),
          interactive: false,
          keyboard: false,
          title: rotulo,
          pane: 'paneSetas'
        }).addTo(camadaSentidos);
        acumulado += ESPACO;
      }
      acumulado -= seg;
    }
  }

  function marcadorPonta(latLng, texto, classe) {
    L.marker(latLng, {
      icon: L.divIcon({
        className: '',
        html: `<div class="pino-ponta ${classe}">${texto}</div>`,
        iconSize: null,
        iconAnchor: [0, 0]
      }),
      interactive: false,
      keyboard: false,
      pane: 'paneSetas'
    }).addTo(camadaSentidos);
  }

  /** Redesenha setas e pontas (chamado ao renderizar e a cada mudança de zoom) */
  function atualizarSentidos() {
    if (!camadaSentidos) return;
    camadaSentidos.clearLayers();
    const varias = linhasComSentido.length > 1;
    // setas dos trechos de ônibus do "Como chegar"
    for (const e of etapasViagem) {
      if (e.tipo === 'onibus') desenharSetas(e.coords.map(c => [c[1], c[0]]), e.cor, `Linha ${e.numero}`, 70);
    }
    const filtroAtivo = filtroSentidoVisivel();
    const verIda = !filtroAtivo || sentidosVisiveis.ida;
    const verVolta = !filtroAtivo || sentidosVisiveis.volta;
    for (const l of linhasComSentido) {
      const sufixo = varias ? ` ${window.BuzuUtils.escaparHtml(l.numero)}` : '';
      const idaPx = paraLadoDireito(l.ida, 4).map(c => [c[1], c[0]]);
      const voltaPx = paraLadoDireito(l.volta, 4).map(c => [c[1], c[0]]);
      l.idaPx = idaPx;
      l.voltaPx = voltaPx;
      l.polIda?.setLatLngs(verIda ? idaPx : []);
      l.polVolta?.setLatLngs(verVolta ? voltaPx : []);
      l.casIda?.setLatLngs(verIda ? idaPx : []);
      l.casVolta?.setLatLngs(verVolta ? voltaPx : []);
      if (verIda) desenharSetas(idaPx, l.cor, 'Sentido ida');
      if (verVolta) desenharSetas(voltaPx, l.corVolta, 'Sentido volta');
      if (mostrarTerminalRetorno) {
        marcadorPonta(idaPx[0], `<i class="bi bi-flag-fill" aria-hidden="true"></i> Terminal${sufixo}`, 'pino-ponta--inicio');
        marcadorPonta(idaPx[idaPx.length - 1], `<i class="bi bi-arrow-return-left" aria-hidden="true"></i> Retorno${sufixo}`, 'pino-ponta--retorno');
      }
    }
    atualizarControleSentido();
    atualizarPercursoAnimado();
  }

  // ---------- Filtro Ida / Volta (aba "Itinerários") ----------
  let permitirFiltroSentido = false;
  let sentidosVisiveis = { ida: true, volta: true };
  let linhaDoFiltro = null; // ao trocar de linha, volta a mostrar os dois sentidos
  let controleSentido = null;
  let ajustarCantoInferiorEsquerdo = () => {};

  function filtroSentidoVisivel() {
    return permitirFiltroSentido && linhasComSentido.length === 1;
  }

  function criarControleSentido() {
    const Controle = L.Control.extend({
      options: { position: 'bottomleft' },
      onAdd() {
        const div = L.DomUtil.create('div', 'filtro-sentido-mapa');
        div.setAttribute('role', 'group');
        div.setAttribute('aria-label', 'Sentidos exibidos no mapa');
        div.innerHTML =
          '<label class="filtro-sentido-item"><input type="checkbox" data-sentido="ida" checked><span class="filtro-sentido-cor" data-cor="ida"></span>Ida</label>' +
          '<label class="filtro-sentido-item"><input type="checkbox" data-sentido="volta" checked><span class="filtro-sentido-cor" data-cor="volta"></span>Volta</label>';
        L.DomEvent.disableClickPropagation(div);
        L.DomEvent.disableScrollPropagation(div);
        div.addEventListener('change', e => {
          const chk = e.target.closest('input[data-sentido]');
          if (!chk) return;
          sentidosVisiveis[chk.dataset.sentido] = chk.checked;
          atualizarSentidos();
        });
        return div;
      }
    });
    return new Controle();
  }

  function atualizarControleSentido() {
    if (!mapa) return;
    if (!filtroSentidoVisivel()) {
      if (controleSentido) {
        controleSentido.remove();
        controleSentido = null;
      }
      linhaDoFiltro = null;
      sentidosVisiveis = { ida: true, volta: true };
      return;
    }
    const l = linhasComSentido[0];
    if (linhaDoFiltro !== l.numero) {
      linhaDoFiltro = l.numero;
      sentidosVisiveis = { ida: true, volta: true };
    }
    if (!controleSentido) controleSentido = criarControleSentido().addTo(mapa);
    ajustarCantoInferiorEsquerdo();
    const div = controleSentido.getContainer();
    div.querySelectorAll('input[data-sentido]').forEach(chk => {
      chk.checked = sentidosVisiveis[chk.dataset.sentido];
    });
    div.querySelector('[data-cor="ida"]').style.background = l.cor;
    div.querySelector('[data-cor="volta"]').style.background = l.corVolta;
  }

  // ---------- Ponto em movimento ao longo do percurso (estilo "GPS") ----------
  // Itinerários: percorre a linha selecionada (ida e depois volta, conforme o filtro).
  // Como chegar: percorre o caminho do passageiro, etapa por etapa (a pé e de ônibus).
  const animacao = {
    marcador: null,
    quadro: null,
    trechos: [], // [{ pts: [[lat,lng],...], acum: [m...], total }]
    total: 0,
    percorrido: 0,
    chave: '',
    ultimoInstante: 0,
    duracaoMs: 15000
  };
  const VELOCIDADE_PONTO_M_POR_MS = 0.8; // 800 m de mapa por segundo
  const reduzirMovimento =
    typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function distanciaMetros(a, b) {
    const kx = 111320 * Math.cos((a[0] * Math.PI) / 180);
    return Math.hypot((b[1] - a[1]) * kx, (b[0] - a[0]) * 110540);
  }

  function montarTrecho(pts) {
    const acum = [0];
    for (let i = 1; i < pts.length; i++) acum.push(acum[i - 1] + distanciaMetros(pts[i - 1], pts[i]));
    return { pts, acum, total: acum[acum.length - 1] };
  }

  function caminhosParaAnimar() {
    if (etapasViagem.length) {
      return {
        chave: 'viagem:' + etapasViagem.map(e => `${e.tipo}${e.numero || ''}${e.coords.length}`).join('|'),
        cor: etapasViagem.find(e => e.tipo === 'onibus')?.cor,
        trechos: etapasViagem.filter(e => e.coords?.length > 1).map(e => e.coords.map(c => [c[1], c[0]]))
      };
    }
    if (linhasComSentido.length !== 1) return null;
    const l = linhasComSentido[0];
    const filtroAtivo = filtroSentidoVisivel();
    const verIda = !filtroAtivo || sentidosVisiveis.ida;
    const verVolta = !filtroAtivo || sentidosVisiveis.volta;
    const trechos = [];
    if (verIda && l.idaPx?.length > 1) trechos.push(l.idaPx);
    if (verVolta && l.voltaPx?.length > 1) trechos.push(l.voltaPx);
    return { chave: `linha:${l.numero}:${l.ida.length}:${verIda}:${verVolta}`, cor: l.cor, trechos };
  }

  function pararPercursoAnimado() {
    if (animacao.quadro) cancelAnimationFrame(animacao.quadro);
    animacao.quadro = null;
    animacao.marcador?.remove();
    animacao.marcador = null;
    animacao.trechos = [];
    animacao.chave = '';
  }

  function atualizarPercursoAnimado() {
    if (!mapa) return;
    const alvo = caminhosParaAnimar();
    if (!alvo || !alvo.trechos.length) {
      pararPercursoAnimado();
      return;
    }
    const trechos = alvo.trechos.map(montarTrecho).filter(t => t.total > 0);
    const total = trechos.reduce((s, t) => s + t.total, 0);
    if (!total) {
      pararPercursoAnimado();
      return;
    }
    // Mesmo percurso (ex.: só mudou o zoom): continua de onde estava; senão recomeça do início
    const fracao = animacao.chave === alvo.chave && animacao.total ? animacao.percorrido / animacao.total : 0;
    animacao.chave = alvo.chave;
    animacao.trechos = trechos;
    animacao.total = total;
    animacao.percorrido = fracao * total;
    // Velocidade constante (~0,8 km por segundo): igual com ida + volta, só ida ou só volta.
    // Percursos muito curtos levam pelo menos 4 s, para o ponto não "piscar" de uma ponta à outra.
    animacao.duracaoMs = Math.max(4000, total / VELOCIDADE_PONTO_M_POR_MS);

    if (!animacao.marcador) {
      animacao.marcador = L.marker(posicaoNoPercurso(animacao.percorrido), {
        icon: L.divIcon({
          className: '',
          html: '<div class="ponto-gps" aria-hidden="true"><span class="ponto-gps-pulso"></span><span class="ponto-gps-centro"></span></div>',
          iconSize: [22, 22],
          iconAnchor: [11, 11]
        }),
        interactive: false,
        keyboard: false,
        pane: 'panePontoGps'
      }).addTo(mapa);
    }
    animacao.marcador.setLatLng(posicaoNoPercurso(animacao.percorrido));

    if (!animacao.quadro && !reduzirMovimento) {
      animacao.ultimoInstante = performance.now();
      animacao.quadro = requestAnimationFrame(passoAnimacao);
    }
  }

  function passoAnimacao(agora) {
    // limita o salto quando a aba volta do segundo plano
    const dt = Math.min(100, agora - animacao.ultimoInstante);
    animacao.ultimoInstante = agora;
    animacao.percorrido = (animacao.percorrido + (animacao.total * dt) / animacao.duracaoMs) % animacao.total;
    animacao.marcador?.setLatLng(posicaoNoPercurso(animacao.percorrido));
    animacao.quadro = requestAnimationFrame(passoAnimacao);
  }

  function posicaoNoPercurso(distancia) {
    let resto = distancia;
    for (const t of animacao.trechos) {
      if (resto <= t.total) {
        // busca binária do segmento
        let lo = 0;
        let hi = t.acum.length - 1;
        while (hi - lo > 1) {
          const meio = (lo + hi) >> 1;
          if (t.acum[meio] <= resto) lo = meio;
          else hi = meio;
        }
        const seg = t.acum[hi] - t.acum[lo] || 1;
        const f = (resto - t.acum[lo]) / seg;
        const a = t.pts[lo];
        const b = t.pts[hi];
        return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
      }
      resto -= t.total;
    }
    const ultimo = animacao.trechos[animacao.trechos.length - 1];
    return ultimo.pts[ultimo.pts.length - 1];
  }

  let mostrarTerminalRetorno = true;

  function definirMostrarTerminalRetorno(ativo) {
    mostrarTerminalRetorno = Boolean(ativo);
    atualizarSentidos();
    if (modoEditorRotaAtivo) desenharEditorRota();
  }

  let callbacks = {
    aoClicarLinha: null,
    aoClicarParada: null,
    aoArrastarParada: null,
    aoClicarMapaEditor: null,
    aoAtualizarRotaEditor: null,
    aoAtualizarDesenhador: null
  };

  let modoEditorAtivo = false;
  let criarParadaNoCliqueAtivo = false;
  let modoEditorRotaAtivo = false;
  let adicionarVerticeNoCliqueAtivo = false;
  let coordsEdicaoRota = [];
  let corEdicaoRota = '#162652';
  let historicoEdicaoRota = [];

  let camadaDesenhadorRota = null;
  const desenhador = {
    ativo: false,
    sentidoAtivo: 'IDA',
    inserirNoMeio: false,
    waypointsIda: [],
    waypointsVolta: [],
    coordsIda: [],
    coordsVolta: [],
    ruasIda: [],
    ruasVolta: [],
    distIdaKm: 0,
    distVoltaKm: 0,
    carregando: false,
    erroRoteamento: ''
  };

  function inicializar(idElemento = 'mapa', opcoesCallbacks = {}) {
    callbacks = { ...callbacks, ...opcoesCallbacks };

    canvasRenderer = L.canvas({ padding: 0.5, tolerance: 15 });

    mapa = L.map(idElemento, {
      center: CENTRO_NATAL,
      zoom: ZOOM_INICIAL,
      maxZoom: 19, // necessário para o agrupamento de paradas (markercluster)
      renderer: canvasRenderer,
      zoomControl: false,
      preferCanvas: true
    });

    // Posiciona controles de zoom no canto superior direito para não colidir com o painel/bottom sheet
    L.control.zoom({ position: 'topright' }).addTo(mapa);

    // Mapa base: OpenFreeMap (gratuito, sem chave, sem limite de acessos), estilo claro "Positron".
    // Se o MapLibre não carregar (CDN fora do ar ou navegador sem WebGL), usa os tiles do OpenStreetMap.
    const creditoMapa =
      '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> &copy; <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">OpenMapTiles</a> &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';
    const suportaWebGL = (() => {
      try {
        const c = document.createElement('canvas');
        return !!(c.getContext('webgl2') || c.getContext('webgl'));
      } catch (_e) {
        return false;
      }
    })();

    temaEscuro = document.documentElement.getAttribute('data-tema') === 'escuro';
    if (typeof L.maplibreGL === 'function' && suportaWebGL) {
      camadaMapaBase = L.maplibreGL({
        style: temaEscuro ? ESTILO_MAPA_ESCURO : ESTILO_MAPA_CLARO,
        attribution: creditoMapa
      }).addTo(mapa);
    } else {
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>'
      }).addTo(mapa);
    }

    // Os controles do canto inferior esquerdo (filtro Ida/Volta, dica de zoom) ficam sempre acima dos
    // créditos do mapa, que em telas estreitas ocupam a largura toda e podem quebrar em duas linhas.
    const creditos = mapa.attributionControl?.getContainer();
    const cantoInferiorEsquerdo = mapa.getContainer().querySelector('.leaflet-bottom.leaflet-left');
    if (creditos && cantoInferiorEsquerdo) {
      ajustarCantoInferiorEsquerdo = () => {
        cantoInferiorEsquerdo.style.bottom = `${creditos.offsetHeight}px`;
      };
      ajustarCantoInferiorEsquerdo();
      if (typeof ResizeObserver === 'function') new ResizeObserver(ajustarCantoInferiorEsquerdo).observe(creditos);
      mapa.on('resize', ajustarCantoInferiorEsquerdo);
    }

    camadaRedeAtual = L.layerGroup().addTo(mapa);
    camadaRotasPropostas = L.layerGroup().addTo(mapa);
    camadaViagem = L.layerGroup().addTo(mapa);
    camadaEdicaoRota = L.layerGroup().addTo(mapa);
    camadaDesenhadorRota = L.layerGroup().addTo(mapa);

    if (typeof L.markerClusterGroup === 'function') {
      clusterParadas = L.markerClusterGroup({
        showCoverageOnHover: false,
        maxClusterRadius: 38,
        spiderfyOnMaxZoom: true,
        disableClusteringAtZoom: 15
      });
    } else {
      clusterParadas = L.layerGroup();
    }
    mapa.addLayer(clusterParadas);

    mapa.createPane('paneParadas');
    mapa.getPane('paneParadas').style.zIndex = 450; // acima das linhas (overlayPane = 400)
    mapa.getPane('paneParadas').style.pointerEvents = 'none';
    renderParadas = L.canvas({ pane: 'paneParadas', padding: 0.5, tolerance: 6 });
    camadaParadasPrincipais = L.layerGroup().addTo(mapa);
    camadaParadasComuns = L.layerGroup();

    const DicaZoom = L.Control.extend({
      options: { position: 'bottomleft' },
      onAdd() {
        const div = L.DomUtil.create('div', 'dica-zoom-paradas');
        div.innerHTML = '<i class="bi bi-zoom-in" aria-hidden="true"></i> Aproxime o mapa para ver as paradas';
        div.hidden = true;
        return div;
      }
    });
    controleDicaZoom = new DicaZoom().addTo(mapa);
    mapa.on('zoomend', atualizarVisibilidadeParadas);

    mapa.createPane('paneSetas');
    mapa.getPane('paneSetas').style.zIndex = 460; // acima das linhas e das paradas comuns
    mapa.getPane('paneSetas').style.pointerEvents = 'none';
    camadaSentidos = L.layerGroup().addTo(mapa);
    camadaEtapas = L.layerGroup().addTo(mapa);
    mapa.createPane('panePontoGps');
    mapa.getPane('panePontoGps').style.zIndex = 640; // acima de setas, paradas e marcadores
    mapa.getPane('panePontoGps').style.pointerEvents = 'none';
    mapa.on('zoomend', atualizarSentidos);

    // Clique no mapa durante o Modo Editor Administrativo (nova parada ou estender rota)
    mapa.on('click', e => {
      if (modoEditorAtivo && criarParadaNoCliqueAtivo && typeof callbacks.aoClicarMapaEditor === 'function') {
        callbacks.aoClicarMapaEditor(e.latlng.lat, e.latlng.lng);
        return;
      }
      if (modoEditorRotaAtivo && adicionarVerticeNoCliqueAtivo) {
        registrarHistoricoEdicaoRota();
        coordsEdicaoRota.push([Number(e.latlng.lng.toFixed(6)), Number(e.latlng.lat.toFixed(6))]);
        desenharEditorRota();
        notificarAtualizacaoRotaEditor();
        return;
      }
      if (desenhador.ativo) {
        const lista =
          desenhador.sentidoAtivo === 'VOLTA' ? desenhador.waypointsVolta : desenhador.waypointsIda;
        const novoWp = {
          lat: Number(e.latlng.lat.toFixed(6)),
          lng: Number(e.latlng.lng.toFixed(6))
        };
        if (desenhador.inserirNoMeio && lista.length >= 2) {
          let melhorPos = lista.length;
          let menorDesvio = Infinity;
          for (let i = 0; i < lista.length - 1; i++) {
            const a = lista[i];
            const b = lista[i + 1];
            const dAB = window.BuzuUtils.calcularDistanciaGeodesica(a.lat, a.lng, b.lat, b.lng);
            const dAN = window.BuzuUtils.calcularDistanciaGeodesica(a.lat, a.lng, novoWp.lat, novoWp.lng);
            const dNB = window.BuzuUtils.calcularDistanciaGeodesica(novoWp.lat, novoWp.lng, b.lat, b.lng);
            const desvio = dAN + dNB - dAB;
            if (desvio < menorDesvio) {
              menorDesvio = desvio;
              melhorPos = i + 1;
            }
          }
          lista.splice(melhorPos, 0, novoWp);
        } else {
          lista.push(novoWp);
        }
        void recalcularSentidoDesenhador(desenhador.sentidoAtivo);
      }
    });

    return mapa;
  }

  /**
   * Ícones cartográficos institucionais (Quadrado para Terminal, Círculo Laranja para Integração, Verde para Parada)
   */
  function criarIconeParada(tipo = 'parada', destacada = false, origem = 'manual') {
    const t = String(tipo || 'parada').toLowerCase();
    let classeTipo = 'marcador-parada';
    let sigla = 'P';
    let tituloTipo = 'Parada';

    if (t.includes('terminal')) {
      classeTipo = 'marcador-terminal';
      sigla = 'T';
      tituloTipo = 'Terminal';
    } else if (t.includes('integração') || t.includes('integracao') || t.includes('estação')) {
      classeTipo = 'marcador-integracao';
      sigla = 'I';
      tituloTipo = 'Estação / Ponto de Integração';
    } else if (origem === 'virtual') {
      sigla = 'V';
      tituloTipo = 'Parada Virtual (~200m)';
    }

    const tamanho = destacada ? 32 : origem === 'virtual' ? 22 : 25;
    const bgExtra = origem === 'virtual' ? 'background:#345786;' : '';
    const destaqueCss = destacada ? 'outline: 4px solid #FFBE2E; z-index: 900;' : '';

    return L.divIcon({
      className: '',
      html: `<div class="marcador-mapa ${classeTipo}" style="width:${tamanho}px;height:${tamanho}px;${bgExtra}${destaqueCss}" aria-label="${tituloTipo}">${sigla}</div>`,
      iconSize: [tamanho, tamanho],
      iconAnchor: [tamanho / 2, tamanho / 2]
    });
  }

  /**
   * Renderiza as linhas em L.canvas() aplicando deslocamento paralelo Stamen/MetroMatch
   * quando múltiplas rotas compartilham o mapa simultaneamente.
   */
  function renderizarRotas(featuresGeoJson = [], opcoes = {}) {
    if (!mapa) return;

    const {
      linhaDestacadaId = null,
      diaSemana = 'dias_uteis_sabados',
      mostrarRedeAtual = false,
      redeAtualGeoJson = null,
      mostrarSentido = false, // "Como chegar": mostra ida/volta e setas de todas as linhas do trajeto
      filtroSentido = false // "Itinerários": mostra o filtro Ida/Volta da linha selecionada
    } = opcoes;

    camadaRotasPropostas.clearLayers();
    camadaRedeAtual.clearLayers();
    linhasComSentido = [];
    permitirFiltroSentido = Boolean(filtroSentido) && !mostrarSentido;

    // Camada opcional de rede atual em linha sólida fina
    if (mostrarRedeAtual && redeAtualGeoJson && Array.isArray(redeAtualGeoJson.features)) {
      L.geoJSON(redeAtualGeoJson, {
        renderer: canvasRenderer,
        style: () => ({
          color: '#374151',
          weight: 2,
          opacity: 0.8
        }),
        onEachFeature: (feat, layer) => {
          const p = feat.properties || {};
          layer.bindTooltip(`Rede Atual: ${p.numero || ''} ${p.nome || ''}`, { sticky: true });
        }
      }).addTo(camadaRedeAtual);
    }

    const featuresVisiveis = featuresGeoJson.filter(feat => {
      const p = feat.properties || {};
      if (diaSemana === 'todos') return true;
      if (!p.dia_semana || p.dia_semana === 'todos') return true;
      return p.dia_semana === diaSemana;
    });

    const boundsParaEnquadrar = [];
    const totalVisiveis = featuresVisiveis.length;
    // Visão geral com muitas linhas: traços finos e translúcidos, para formar uma "malha" legível
    // em que cada linha só ganha destaque ao passar o mouse/tocar.
    const visaoGeral = !linhaDestacadaId && totalVisiveis > 6;
    const camadasHover = [];

    featuresVisiveis.forEach((feat, idxFeature) => {
      if (!feat.geometry || feat.geometry.type !== 'LineString') return;
      const props = feat.properties || {};
      const sentido = props.sentido || 'ambos';

      // Deslocamento paralelo só quando há poucas linhas (evita o efeito "espaguete" na visão geral)
      const coordsProcessadas = visaoGeral
        ? feat.geometry.coordinates
        : window.BuzuUtils.obterCoordenadasCartograficas(
            feat.geometry.coordinates,
            sentido,
            idxFeature,
            totalVisiveis
          );

      const latLngs = coordsProcessadas.map(c => [c[1], c[0]]);
      const ehDestacada =
        linhaDestacadaId &&
        (String(props.linha_id).toUpperCase() === String(linhaDestacadaId).toUpperCase() ||
          String(props.numero).toUpperCase() === String(linhaDestacadaId).toUpperCase());

      const corLinha = props.cor || (props.lote === '2' ? '#D9531E' : '#0057B8');
      const tracadoDesatualizado = props.situacao_rota === 'alterada';

      // Linha selecionada: ida e volta separadas, cada uma do seu lado da via, com setas de sentido
      if ((ehDestacada || mostrarSentido) && feat.geometry.coordinates.length > 3) {
        const coords = feat.geometry.coordinates;
        const corte = indiceRetorno(coords, props);
        const ida = coords.slice(0, corte + 1);
        const volta = coords.slice(corte);
        const corVolta = temaEscuro ? misturarCor(corLinha, 'branco', 0.45) : misturarCor(corLinha, 'branco', 0.5);
        const registro = { ida, volta, cor: corLinha, corVolta, numero: props.numero };
        const movel =
          (typeof window.matchMedia === 'function' &&
            (window.matchMedia('(max-width: 760px)').matches ||
              window.matchMedia('(pointer: coarse)').matches)) ||
          window.innerWidth <= 760;
        const estiloComum = { renderer: canvasRenderer, lineCap: 'round', lineJoin: 'round', dashArray: tracadoDesatualizado ? '10, 8' : null, interactive: !movel };
        registro.casVolta = L.polyline([], { ...estiloComum, color: corContornoRota(), weight: 9, opacity: 0.9, interactive: false, dashArray: null }).addTo(camadaRotasPropostas);
        registro.casIda = L.polyline([], { ...estiloComum, color: corContornoRota(), weight: 9, opacity: 0.9, interactive: false, dashArray: null }).addTo(camadaRotasPropostas);
        registro.polVolta = L.polyline([], { ...estiloComum, color: corVolta, weight: 5, opacity: 1 }).addTo(camadaRotasPropostas);
        registro.polIda = L.polyline([], { ...estiloComum, color: corLinha, weight: 5, opacity: 1 }).addTo(camadaRotasPropostas);
        const titulo = `<strong>${window.BuzuUtils.escaparHtml(props.numero)} — ${window.BuzuUtils.escaparHtml(props.nome)}</strong>`;
        if (!movel) {
          registro.polIda.bindTooltip(`${titulo}<br><span class="tooltip-sentido">➜ Ida</span> do terminal até o ponto de retorno`, { sticky: true, className: 'tooltip-linha' });
          registro.polVolta.bindTooltip(`${titulo}<br><span class="tooltip-sentido tooltip-sentido--volta">➜ Volta</span> do ponto de retorno até o terminal`, { sticky: true, className: 'tooltip-linha' });
          registro.polIda.on('click', e => {
            L.popup({ maxWidth: 280 })
              .setLatLng(e.latlng)
              .setContent(`${titulo}<br><small>Sentido IDA • ${window.BuzuUtils.escaparHtml(props.dia_rotulo || '')}</small>`)
              .openOn(mapa);
          });
          registro.polVolta.on('click', e => {
            L.popup({ maxWidth: 280 })
              .setLatLng(e.latlng)
              .setContent(`${titulo}<br><small>Sentido VOLTA • ${window.BuzuUtils.escaparHtml(props.dia_rotulo || '')}</small>`)
              .openOn(mapa);
          });
        }
        linhasComSentido.push(registro);
        boundsParaEnquadrar.push(...coords.map(c => [c[1], c[0]]));
        return;
      }
      const estiloBase = ehDestacada
        ? { weight: 6, opacity: 1 }
        : visaoGeral
        ? { weight: 3.2, opacity: 0.65 }
        : { weight: 4.5, opacity: linhaDestacadaId ? 0.25 : 0.9 };

      // Contorno branco (casing) apenas na linha em destaque ou com poucas linhas no mapa
      let casing = null;
      if (!visaoGeral) {
        casing = L.polyline(latLngs, {
          renderer: canvasRenderer,
          color: corContornoRota(),
          weight: estiloBase.weight + 4,
          opacity: ehDestacada ? 0.95 : 0.6,
          lineCap: 'round',
          lineJoin: 'round',
          interactive: false
        }).addTo(camadaRotasPropostas);
      }

      if (ehDestacada || !linhaDestacadaId) {
        boundsParaEnquadrar.push(...latLngs);
      }

      const ehMovel =
        (typeof window.matchMedia === 'function' &&
          (window.matchMedia('(max-width: 760px)').matches ||
            window.matchMedia('(pointer: coarse)').matches)) ||
        window.innerWidth <= 760;

      const polyline = L.polyline(latLngs, {
        renderer: canvasRenderer,
        color: corLinha,
        weight: estiloBase.weight,
        opacity: estiloBase.opacity,
        dashArray: tracadoDesatualizado ? '10, 8' : null,
        lineCap: 'round',
        lineJoin: 'round',
        interactive: !ehMovel
      });

      if (!ehMovel) {
        polyline.bindTooltip(
          `<strong>${window.BuzuUtils.escaparHtml(props.numero)} — ${window.BuzuUtils.escaparHtml(
            props.nome
          )}</strong><br>` +
            `${window.BuzuUtils.escaparHtml(props.dia_rotulo || 'Dias úteis e sábados')} • Lote ${window.BuzuUtils.escaparHtml(
              props.lote || '1'
            )}` +
            (tracadoDesatualizado ? '<br><em>Traçado em atualização (edital 2026)</em>' : '') +
            '<br><small>Clique para ver o itinerário</small>',
          { sticky: true, className: 'tooltip-linha' }
        );

        polyline.on('click', e => {
          L.popup({ maxWidth: 280 })
            .setLatLng(e.latlng)
            .setContent(
              `<strong>${window.BuzuUtils.escaparHtml(props.numero)} — ${window.BuzuUtils.escaparHtml(
                props.nome
              )}</strong><br><small>${window.BuzuUtils.escaparHtml(
                props.dia_rotulo || 'Dias úteis e sábados'
              )} • Lote ${window.BuzuUtils.escaparHtml(props.lote || '1')}</small>`
            )
            .openOn(mapa);

          if (typeof callbacks.aoClicarLinha === 'function') {
            callbacks.aoClicarLinha(props.linha_id || props.numero, props.dia_semana);
          }
        });
      }

      polyline.addTo(camadaRotasPropostas);
      camadasHover.push(polyline);
      if (ehDestacada) {
        casing?.bringToFront();
        polyline.bringToFront();
      }
    });

    if (ehRequisitadoEnquadramento && boundsParaEnquadrar.length > 0) {
      mapa.fitBounds(boundsParaEnquadrar, { padding: [42, 42], maxZoom: 16, animate: false });
      ehRequisitadoEnquadramento = false;
    }
    atualizarSentidos();
  }

  function solicitarEnquadramentoNaProximaRenderizacao() {
    ehRequisitadoEnquadramento = true;
  }

  /**
   * Renderiza paradas/terminais.
   * Fluxo de dois níveis: clicar no ponto abre direto no painel lateral/bottom sheet,
   * sem abrir modal nem popup cobrindo o mapa.
   */
  function ehParadaPrincipal(tipo) {
    const t = String(tipo || '').toLowerCase();
    return t.includes('terminal') || t.includes('integração') || t.includes('integracao') || t.includes('estação');
  }

  function atualizarVisibilidadeParadas() {
    if (!mapa || !camadaParadasComuns) return;
    const mostrar = !modoEditorAtivo && mapa.getZoom() >= zoomMinimoParadas;
    if (mostrar && !mapa.hasLayer(camadaParadasComuns)) mapa.addLayer(camadaParadasComuns);
    if (!mostrar && mapa.hasLayer(camadaParadasComuns)) mapa.removeLayer(camadaParadasComuns);

    const elDica = controleDicaZoom?.getContainer();
    if (elDica) {
      elDica.hidden = modoEditorAtivo || mostrar || camadaParadasComuns.getLayers().length === 0;
    }
  }

  function textoTooltipParada(props) {
    const listaRotas = props.rotas_dia || props.rotas || [];
    const linhas = listaRotas.slice(0, 10);
    const extra = listaRotas.length > linhas.length ? ` +${listaRotas.length - linhas.length}` : '';
    const tipo = ehParadaPrincipal(props.tipo) ? `<span class="tooltip-parada-tipo">${window.BuzuUtils.escaparHtml(props.tipo)}</span><br>` : '';
    return (
      `${tipo}<strong>${window.BuzuUtils.escaparHtml(props.nome)}</strong>` +
      (linhas.length ? `<br>Linhas: ${window.BuzuUtils.escaparHtml(linhas.join(', '))}${extra}` : '')
    );
  }

  /**
   * Paradas no modo de consulta (não editor):
   *  - Terminais e integrações: círculo maior com borda escura, sempre visíveis.
   *  - Paradas comuns: pontos pequenos (estilo mapa de metrô), só a partir do zoom 15
   *    (ou 13 quando uma linha está selecionada), para não poluir a visão geral.
   */
  function renderizarParadasConsulta(featuresParadas, idParadaDestacada, opcoes) {
    const { linhaSelecionada = false, corLinha = null } = opcoes;
    zoomMinimoParadas = linhaSelecionada ? 13 : 15;
    const corBorda = temaEscuro ? '#e2e8f0' : '#1e293b';
    const corPreenchimento = temaEscuro ? '#0f172a' : '#ffffff';

    for (const feat of featuresParadas) {
      if (!feat.geometry || feat.geometry.type !== 'Point') continue;
      const [lng, lat] = feat.geometry.coordinates;
      const props = feat.properties || {};
      const ehDestacada = idParadaDestacada && String(props.id) === String(idParadaDestacada);
      const principal = ehParadaPrincipal(props.tipo);
      const virtual = props.origem === 'virtual';

      const estilo = ehDestacada
        ? { radius: 10, color: corBorda, weight: 3, fillColor: '#FFBE2E', fillOpacity: 1 }
        : principal
        ? { radius: 7, color: corBorda, weight: 3, fillColor: corPreenchimento, fillOpacity: 1 }
        : {
            radius: virtual ? 3.5 : 4.5,
            color: corLinha || (temaEscuro ? '#94a3b8' : '#475569'),
            weight: 2,
            fillColor: corPreenchimento,
            fillOpacity: 1
          };

      const marker = L.circleMarker([lat, lng], { renderer: renderParadas, ...estilo });
      marker.bindTooltip(textoTooltipParada(props), { direction: 'top', offset: [0, -6], className: 'tooltip-parada' });
      marker.on('click', () => {
        if (typeof callbacks.aoClicarParada === 'function') {
          callbacks.aoClicarParada(props.id);
        }
      });

      (principal || ehDestacada ? camadaParadasPrincipais : camadaParadasComuns).addLayer(marker);
      indiceMarkersParadas.set(String(props.id), marker);
    }
    atualizarVisibilidadeParadas();
  }

  function renderizarParadas(featuresParadas = [], idParadaDestacada = null, opcoes = {}) {
    if (!mapa || !clusterParadas) return;

    clusterParadas.clearLayers();
    camadaParadasPrincipais?.clearLayers();
    camadaParadasComuns?.clearLayers();
    indiceMarkersParadas.clear();

    if (!modoEditorAtivo) {
      renderizarParadasConsulta(featuresParadas, idParadaDestacada, opcoes);
      return;
    }
    atualizarVisibilidadeParadas();

    // Modo Editor (Admin): marcadores arrastáveis com sigla, agrupados
    for (const feat of featuresParadas) {
      if (!feat.geometry || feat.geometry.type !== 'Point') continue;
      const [lng, lat] = feat.geometry.coordinates;
      const props = feat.properties || {};
      const ehDestacada = idParadaDestacada && String(props.id) === String(idParadaDestacada);

      const marker = L.marker([lat, lng], {
        icon: criarIconeParada(props.tipo, ehDestacada, props.origem),
        draggable: modoEditorAtivo, // Marcadores arrastáveis quando o Admin ativa o Editor de Paradas!
        title: `${props.nome} (${props.tipo || 'parada'})`,
        alt: `${props.nome} - ${props.tipo || 'parada'}`
      });

      const origemTag = (props.origem || 'manual').toUpperCase();
      const sentidoTag = (props.sentidos_atendidos || 'AMBOS').toUpperCase();
      const dicaEditor = modoEditorAtivo ? '<br><em>🛠️ Arraste para ajustar posição ou clique para editar sentido</em>' : '';

      const listaRotasEditor = props.rotas_dia || props.rotas || [];
      marker.bindTooltip(
        `<strong>${window.BuzuUtils.escaparHtml(props.nome)}</strong><br>` +
          `[${origemTag} • Sentido: ${sentidoTag}] • Linhas: ${window.BuzuUtils.escaparHtml(
            listaRotasEditor.slice(0, 8).join(', ')
          )}${dicaEditor}`,
        { direction: 'top', offset: [0, -14] }
      );

      marker.on('click', () => {
        if (typeof callbacks.aoClicarParada === 'function') {
          callbacks.aoClicarParada(props.id);
        }
      });

      marker.on('dragend', e => {
        const pos = e.target.getLatLng();
        if (typeof callbacks.aoArrastarParada === 'function') {
          callbacks.aoArrastarParada(props.id, pos.lat, pos.lng);
        }
      });

      clusterParadas.addLayer(marker);
      indiceMarkersParadas.set(String(props.id), marker);
    }
  }

  function definirModoEditorParadas(ativo, criarNoClique = false) {
    modoEditorAtivo = Boolean(ativo);
    criarParadaNoCliqueAtivo = Boolean(criarNoClique);
    const elMapa = document.getElementById('mapa');
    if (elMapa) {
      elMapa.style.cursor =
        (modoEditorAtivo && criarParadaNoCliqueAtivo) ||
        (modoEditorRotaAtivo && adicionarVerticeNoCliqueAtivo)
          ? 'crosshair'
          : '';
    }
  }

  function registrarHistoricoEdicaoRota() {
    historicoEdicaoRota.push(coordsEdicaoRota.map(c => [c[0], c[1]]));
    if (historicoEdicaoRota.length > 35) {
      historicoEdicaoRota.shift();
    }
  }

  function notificarAtualizacaoRotaEditor() {
    if (typeof callbacks.aoAtualizarRotaEditor === 'function') {
      const acum = window.BuzuUtils.calcularComprimentoAcumulado(coordsEdicaoRota);
      const km = Number(((acum[acum.length - 1] || 0) / 1000).toFixed(2));
      callbacks.aoAtualizarRotaEditor({
        vertices: coordsEdicaoRota.length,
        extensaoKm: km,
        podeDesfazer: historicoEdicaoRota.length > 0
      });
    }
  }

  function desenharEditorRota() {
    if (!camadaEdicaoRota) return;
    camadaEdicaoRota.clearLayers();
    if (!modoEditorRotaAtivo || coordsEdicaoRota.length === 0) return;

    const latLngs = coordsEdicaoRota.map(c => [c[1], c[0]]);
    const polilinhaEditavel = L.polyline(latLngs, {
      color: corEdicaoRota || '#e0621f',
      weight: 5,
      opacity: 0.95
    }).addTo(camadaEdicaoRota);

    // Se houver muitos vértices, mostra todos até 260 para manter fluidez no navegador
    const passo = coordsEdicaoRota.length > 260 ? Math.ceil(coordsEdicaoRota.length / 260) : 1;

    for (let i = 0; i < coordsEdicaoRota.length; i += passo) {
      const idxAtual = i;
      const [lng, lat] = coordsEdicaoRota[idxAtual];
      const ehExtremo = idxAtual === 0 || idxAtual === coordsEdicaoRota.length - 1;

      const iconeVertice = L.divIcon({
        className: '',
        html: `<div class="vertice-editor-rota ${ehExtremo ? 'extremo' : ''}" title="Vértice ${idxAtual + 1} (arraste para mover; clique direito para remover)"></div>`,
        iconSize: [ehExtremo ? 16 : 12, ehExtremo ? 16 : 12],
        iconAnchor: [ehExtremo ? 8 : 6, ehExtremo ? 8 : 6]
      });

      const marker = L.marker([lat, lng], {
        icon: iconeVertice,
        draggable: true,
        zIndexOffset: ehExtremo ? 800 : 600
      });

      marker.on('dragstart', () => {
        registrarHistoricoEdicaoRota();
      });

      marker.on('drag', e => {
        const pos = e.target.getLatLng();
        coordsEdicaoRota[idxAtual] = [Number(pos.lng.toFixed(6)), Number(pos.lat.toFixed(6))];
        polilinhaEditavel.setLatLngs(coordsEdicaoRota.map(c => [c[1], c[0]]));
      });

      marker.on('dragend', () => {
        desenharEditorRota();
        notificarAtualizacaoRotaEditor();
      });

      marker.on('contextmenu', e => {
        L.DomEvent.stopPropagation(e);
        if (coordsEdicaoRota.length === 0) return;
        registrarHistoricoEdicaoRota();
        coordsEdicaoRota.splice(idxAtual, 1);
        desenharEditorRota();
        notificarAtualizacaoRotaEditor();
      });

      marker.addTo(camadaEdicaoRota);

      // Ponto médio '+' para inserir novo vértice entre i e i+passo
      const proxIdx = idxAtual + passo;
      if (proxIdx < coordsEdicaoRota.length) {
        const [lng2, lat2] = coordsEdicaoRota[proxIdx];
        const midLat = (lat + lat2) / 2;
        const midLng = (lng + lng2) / 2;
        const iconeMid = L.divIcon({
          className: '',
          html: `<div class="vertice-intermediario-rota" title="Clique para adicionar ponto aqui">+</div>`,
          iconSize: [12, 12],
          iconAnchor: [6, 6]
        });
        const midMarker = L.marker([midLat, midLng], {
          icon: iconeMid,
          zIndexOffset: 500
        });
        midMarker.on('click', () => {
          registrarHistoricoEdicaoRota();
          const posInserir = Math.min(idxAtual + 1, coordsEdicaoRota.length);
          coordsEdicaoRota.splice(posInserir, 0, [Number(midLng.toFixed(6)), Number(midLat.toFixed(6))]);
          desenharEditorRota();
          notificarAtualizacaoRotaEditor();
        });
        midMarker.addTo(camadaEdicaoRota);
      }
    }

    if (mostrarTerminalRetorno && coordsEdicaoRota.length >= 2) {
      const pIni = coordsEdicaoRota[0];
      const idxRet = indiceRetorno(coordsEdicaoRota, {});
      const pRet = coordsEdicaoRota[idxRet] || coordsEdicaoRota[coordsEdicaoRota.length - 1];
      [
        { pt: pIni, texto: '<i class="bi bi-flag-fill" aria-hidden="true"></i> Terminal', cls: 'pino-ponta--inicio' },
        { pt: pRet, texto: '<i class="bi bi-arrow-return-left" aria-hidden="true"></i> Retorno', cls: 'pino-ponta--retorno' }
      ].forEach(item => {
        L.marker([item.pt[1], item.pt[0]], {
          icon: L.divIcon({
            className: '',
            html: `<div class="pino-ponta ${item.cls}">${item.texto}</div>`,
            iconSize: null,
            iconAnchor: [0, 0]
          }),
          interactive: false,
          keyboard: false,
          zIndexOffset: 950
        }).addTo(camadaEdicaoRota);
      });
    }
  }

  function definirModoEditorRota(ativo, coordenadas = [], cor = '#e0621f', enquadrar = true) {
    modoEditorRotaAtivo = Boolean(ativo);
    adicionarVerticeNoCliqueAtivo = false;
    historicoEdicaoRota = [];
    corEdicaoRota = cor || '#e0621f';
    coordsEdicaoRota = modoEditorRotaAtivo
      ? (coordenadas || []).map(c => [Number(c[0]), Number(c[1])])
      : [];

    desenharEditorRota();
    if (modoEditorRotaAtivo && enquadrar && coordsEdicaoRota.length >= 2) {
      mapa.fitBounds(
        coordsEdicaoRota.map(c => [c[1], c[0]]),
        { padding: [45, 45], maxZoom: 16 }
      );
    }
    const elMapa = document.getElementById('mapa');
    if (elMapa) elMapa.style.cursor = '';
    notificarAtualizacaoRotaEditor();
  }

  function definirAdicionarVerticeCliqueRota(ativo) {
    adicionarVerticeNoCliqueAtivo = Boolean(ativo);
    const elMapa = document.getElementById('mapa');
    if (elMapa) {
      elMapa.style.cursor = modoEditorRotaAtivo && adicionarVerticeNoCliqueAtivo ? 'crosshair' : '';
    }
  }

  function desfazerEdicaoRota() {
    if (!modoEditorRotaAtivo || historicoEdicaoRota.length === 0) return false;
    coordsEdicaoRota = historicoEdicaoRota.pop();
    desenharEditorRota();
    notificarAtualizacaoRotaEditor();
    return true;
  }

  function limparTodosVerticesRota() {
    if (!modoEditorRotaAtivo) return false;
    if (coordsEdicaoRota.length > 0) {
      registrarHistoricoEdicaoRota();
    }
    coordsEdicaoRota = [];
    if (camadaRotasPropostas) camadaRotasPropostas.clearLayers();
    if (camadaSentidos) camadaSentidos.clearLayers();
    desenharEditorRota();
    notificarAtualizacaoRotaEditor();
    return true;
  }

  function obterCoordenadasEdicaoRota() {
    return coordsEdicaoRota.map(c => [c[0], c[1]]);
  }

  // =========================================================================
  // Desenhador Interativo DE -> PARA pelas Ruas (OSRM) — IDA e VOLTA -> Linha Única
  // =========================================================================
  function extrairRuasOSRM(route) {
    const ruas = [];
    for (const leg of route?.legs || []) {
      for (const step of leg?.steps || []) {
        const nome = String(step?.name || '').trim();
        if (!nome) continue;
        const loc = step?.maneuver?.location || [];
        const ant = ruas[ruas.length - 1];
        if (!ant || ant.logradouro.toUpperCase() !== nome.toUpperCase()) {
          ruas.push({
            ordem: ruas.length + 1,
            logradouro: nome,
            bairro: 'Natal',
            lat: Number((loc[1] || 0).toFixed(6)),
            lng: Number((loc[0] || 0).toFixed(6))
          });
        }
      }
    }
    return ruas;
  }

  function notificarDesenhador() {
    if (typeof callbacks.aoAtualizarDesenhador === 'function') {
      callbacks.aoAtualizarDesenhador({
        ativo: desenhador.ativo,
        sentidoAtivo: desenhador.sentidoAtivo,
        inserirNoMeio: desenhador.inserirNoMeio,
        qtdWaypointsIda: desenhador.waypointsIda.length,
        qtdWaypointsVolta: desenhador.waypointsVolta.length,
        qtdCoordsIda: desenhador.coordsIda.length,
        qtdCoordsVolta: desenhador.coordsVolta.length,
        distIdaKm: desenhador.distIdaKm,
        distVoltaKm: desenhador.distVoltaKm,
        carregando: desenhador.carregando,
        erroRoteamento: desenhador.erroRoteamento
      });
    }
  }

  async function recalcularSentidoDesenhador(sentido) {
    const ehVolta = sentido === 'VOLTA';
    const waypoints = ehVolta ? desenhador.waypointsVolta : desenhador.waypointsIda;

    if (waypoints.length === 0) {
      if (ehVolta) {
        desenhador.coordsVolta = [];
        desenhador.ruasVolta = [];
        desenhador.distVoltaKm = 0;
      } else {
        desenhador.coordsIda = [];
        desenhador.ruasIda = [];
        desenhador.distIdaKm = 0;
      }
      renderizarCamadaDesenhador();
      notificarDesenhador();
      return;
    }

    if (waypoints.length === 1) {
      const unico = [[waypoints[0].lng, waypoints[0].lat]];
      if (ehVolta) {
        desenhador.coordsVolta = unico;
        desenhador.ruasVolta = [];
        desenhador.distVoltaKm = 0;
      } else {
        desenhador.coordsIda = unico;
        desenhador.ruasIda = [];
        desenhador.distIdaKm = 0;
      }
      renderizarCamadaDesenhador();
      notificarDesenhador();
      return;
    }

    desenhador.carregando = true;
    desenhador.erroRoteamento = '';
    notificarDesenhador();

    try {
      const coordsStr = waypoints.map(w => `${w.lng},${w.lat}`).join(';');
      const url = `https://router.project-osrm.org/route/v1/driving/${coordsStr}?overview=full&geometries=geojson&steps=true`;
      const res = await fetch(url);
      const json = await res.json();
      if (json.code !== 'Ok' || !json.routes?.[0]) {
        throw new Error(json.message || 'OSRM não encontrou caminho');
      }
      const rota = json.routes[0];
      const coordsLimpas = (rota.geometry?.coordinates || []).map(c => [
        Number(c[0].toFixed(6)),
        Number(c[1].toFixed(6))
      ]);
      const km = Number(((rota.distance || 0) / 1000).toFixed(3));
      const ruas = extrairRuasOSRM(rota);

      if (ehVolta) {
        desenhador.coordsVolta = coordsLimpas;
        desenhador.distVoltaKm = km;
        desenhador.ruasVolta = ruas;
      } else {
        desenhador.coordsIda = coordsLimpas;
        desenhador.distIdaKm = km;
        desenhador.ruasIda = ruas;
      }
    } catch (err) {
      // Fallback reto caso OSRM falhe
      const fallback = waypoints.map(w => [w.lng, w.lat]);
      const acum = window.BuzuUtils.calcularComprimentoAcumulado(fallback);
      const km = Number(((acum[acum.length - 1] || 0) / 1000).toFixed(3));
      if (ehVolta) {
        desenhador.coordsVolta = fallback;
        desenhador.distVoltaKm = km;
      } else {
        desenhador.coordsIda = fallback;
        desenhador.distIdaKm = km;
      }
      desenhador.erroRoteamento = `OSRM indisponível (${err.message}); usando linha reta nos trechos.`;
    } finally {
      desenhador.carregando = false;
      renderizarCamadaDesenhador();
      notificarDesenhador();
    }
  }

  function renderizarCamadaDesenhador() {
    if (!camadaDesenhadorRota) return;
    camadaDesenhadorRota.clearLayers();
    if (!desenhador.ativo) return;

    const ehIdaAtiva = desenhador.sentidoAtivo === 'IDA';

    // Desenha traçado IDA (#162652)
    if (desenhador.coordsIda.length >= 2) {
      L.polyline(
        desenhador.coordsIda.map(c => [c[1], c[0]]),
        {
          color: '#162652',
          weight: ehIdaAtiva ? 6 : 4,
          opacity: ehIdaAtiva ? 0.95 : 0.42,
          dashArray: ehIdaAtiva ? null : '8, 6'
        }
      ).addTo(camadaDesenhadorRota);
    }

    // Desenha traçado VOLTA (#e0621f)
    if (desenhador.coordsVolta.length >= 2) {
      L.polyline(
        desenhador.coordsVolta.map(c => [c[1], c[0]]),
        {
          color: '#e0621f',
          weight: !ehIdaAtiva ? 6 : 4,
          opacity: !ehIdaAtiva ? 0.95 : 0.42,
          dashArray: !ehIdaAtiva ? null : '8, 6'
        }
      ).addTo(camadaDesenhadorRota);
    }

    // Marcadores numerados arrastáveis para o sentido ativo
    const listaAtiva = ehIdaAtiva ? desenhador.waypointsIda : desenhador.waypointsVolta;
    const classeCor = ehIdaAtiva ? 'ida' : 'volta';

    listaAtiva.forEach((wp, idx) => {
      const ehInicio = idx === 0;
      const ehFim = idx === listaAtiva.length - 1 && listaAtiva.length > 1;
      const rotulo = ehInicio
        ? ehIdaAtiva
          ? 'DE'
          : 'RET'
        : ehFim
        ? ehIdaAtiva
          ? 'PARA'
          : 'TERM'
        : String(idx + 1);

      const icone = L.divIcon({
        className: '',
        html: `<div class="waypoint-desenhador-rota waypoint-desenhador-rota--${classeCor} ${
          ehInicio || ehFim ? 'extremo' : ''
        }" title="Ponto ${idx + 1} (arraste para ajustar a rua; botão direito remove)">${rotulo}</div>`,
        iconSize: [ehInicio || ehFim ? 36 : 24, 24],
        iconAnchor: [ehInicio || ehFim ? 18 : 12, 12]
      });

      const mk = L.marker([wp.lat, wp.lng], {
        icon: icone,
        draggable: true,
        zIndexOffset: 900
      });

      mk.on('dragend', e => {
        const pos = e.target.getLatLng();
        listaAtiva[idx] = {
          lat: Number(pos.lat.toFixed(6)),
          lng: Number(pos.lng.toFixed(6))
        };
        void recalcularSentidoDesenhador(desenhador.sentidoAtivo);
      });

      mk.on('contextmenu', e => {
        L.DomEvent.stopPropagation(e);
        listaAtiva.splice(idx, 1);
        void recalcularSentidoDesenhador(desenhador.sentidoAtivo);
      });

      mk.addTo(camadaDesenhadorRota);
    });
  }

  function extrairAncorasDePolilinha(coords, maxAncoras = 9) {
    if (!Array.isArray(coords) || coords.length === 0) return [];
    if (coords.length === 1) return [{ lat: Number(coords[0][1].toFixed(6)), lng: Number(coords[0][0].toFixed(6)) }];
    const acum = window.BuzuUtils.calcularComprimentoAcumulado(coords);
    const total = acum[acum.length - 1] || 0;
    const qtd = Math.min(maxAncoras, Math.max(2, Math.round(total / 1800) + 1));
    const ancoras = [{ lat: Number(coords[0][1].toFixed(6)), lng: Number(coords[0][0].toFixed(6)) }];

    for (let k = 1; k < qtd - 1; k++) {
      const alvo = (total * k) / (qtd - 1);
      let idx = 1;
      while (idx < acum.length - 1 && acum[idx] < alvo) idx++;
      ancoras.push({
        lat: Number(coords[idx][1].toFixed(6)),
        lng: Number(coords[idx][0].toFixed(6))
      });
    }
    const ult = coords[coords.length - 1];
    ancoras.push({ lat: Number(ult[1].toFixed(6)), lng: Number(ult[0].toFixed(6)) });
    return ancoras;
  }

  function definirModoDesenhadorRota(ativo, opcoes = {}) {
    desenhador.ativo = Boolean(ativo);
    if (desenhador.ativo) {
      desenhador.sentidoAtivo = 'IDA';
      desenhador.erroRoteamento = '';
      const coordsOrig = Array.isArray(opcoes.coordenadasExistentes)
        ? opcoes.coordenadasExistentes.map(c => [Number(c[0]), Number(c[1])])
        : [];

      if (coordsOrig.length >= 4) {
        const corte =
          Number.isInteger(opcoes.indiceRetorno) &&
          opcoes.indiceRetorno > 0 &&
          opcoes.indiceRetorno < coordsOrig.length - 1
            ? opcoes.indiceRetorno
            : indiceRetorno(coordsOrig, {});
        const ida = coordsOrig.slice(0, corte + 1);
        const volta = coordsOrig.slice(corte);

        desenhador.coordsIda = ida;
        desenhador.coordsVolta = volta;
        desenhador.waypointsIda = extrairAncorasDePolilinha(ida, 9);
        desenhador.waypointsVolta = extrairAncorasDePolilinha(volta, 9);

        const acumIda = window.BuzuUtils.calcularComprimentoAcumulado(ida);
        const acumVolta = window.BuzuUtils.calcularComprimentoAcumulado(volta);
        desenhador.distIdaKm = Number(((acumIda[acumIda.length - 1] || 0) / 1000).toFixed(3));
        desenhador.distVoltaKm = Number(((acumVolta[acumVolta.length - 1] || 0) / 1000).toFixed(3));
        desenhador.ruasIda = opcoes.itinerarioRuas?.ida || [];
        desenhador.ruasVolta = opcoes.itinerarioRuas?.volta || [];
        desenhador.inserirNoMeio = true;

        mapa.fitBounds(
          coordsOrig.map(c => [c[1], c[0]]),
          { padding: [45, 45], maxZoom: 16 }
        );
      } else {
        desenhador.waypointsIda = [];
        desenhador.waypointsVolta = [];
        desenhador.coordsIda = [];
        desenhador.coordsVolta = [];
        desenhador.ruasIda = [];
        desenhador.ruasVolta = [];
        desenhador.distIdaKm = 0;
        desenhador.distVoltaKm = 0;
        desenhador.inserirNoMeio = false;
      }
    }
    renderizarCamadaDesenhador();
    const elMapa = document.getElementById('mapa');
    if (elMapa) {
      elMapa.style.cursor = desenhador.ativo ? 'crosshair' : '';
    }
    notificarDesenhador();
  }

  function alternarModoInsercaoDesenhador() {
    desenhador.inserirNoMeio = !desenhador.inserirNoMeio;
    notificarDesenhador();
    return desenhador.inserirNoMeio;
  }

  function definirSentidoDesenhador(sentido) {
    desenhador.sentidoAtivo = sentido === 'VOLTA' ? 'VOLTA' : 'IDA';
    renderizarCamadaDesenhador();
    notificarDesenhador();
  }

  function desfazerPontoDesenhador() {
    const lista =
      desenhador.sentidoAtivo === 'VOLTA' ? desenhador.waypointsVolta : desenhador.waypointsIda;
    if (lista.length === 0) return;
    lista.pop();
    void recalcularSentidoDesenhador(desenhador.sentidoAtivo);
  }

  function limparSentidoDesenhador() {
    if (desenhador.sentidoAtivo === 'VOLTA') desenhador.waypointsVolta = [];
    else desenhador.waypointsIda = [];
    void recalcularSentidoDesenhador(desenhador.sentidoAtivo);
  }

  async function gerarVoltaInvertidaDesenhador() {
    if (desenhador.waypointsIda.length < 2) return false;
    desenhador.waypointsVolta = desenhador.waypointsIda
      .slice()
      .reverse()
      .map(w => ({ lat: w.lat, lng: w.lng }));
    desenhador.sentidoAtivo = 'VOLTA';
    await recalcularSentidoDesenhador('VOLTA');
    return true;
  }

  function obterDadosDesenhadorRota() {
    const ida = desenhador.coordsIda || [];
    const volta = desenhador.coordsVolta || [];
    const coordsUnificadas =
      ida.length >= 2 && volta.length >= 2
        ? [...ida, ...volta.slice(1)]
        : ida.length >= 2
        ? [...ida]
        : [...volta];
    const indiceRetorno = ida.length >= 2 && volta.length >= 2 ? ida.length - 1 : null;

    return {
      coordsIda: ida,
      coordsVolta: volta,
      coordsUnificadas,
      indiceRetorno,
      ruasIda: desenhador.ruasIda || [],
      ruasVolta: desenhador.ruasVolta || [],
      distIdaKm: desenhador.distIdaKm,
      distVoltaKm: desenhador.distVoltaKm
    };
  }

  function enquadrarBbox(bbox) {
    if (!mapa || !Array.isArray(bbox) || bbox.length < 4) return;
    const [minLng, minLat, maxLng, maxLat] = bbox;
    mapa.fitBounds(
      [
        [minLat, minLng],
        [maxLat, maxLng]
      ],
      { padding: [45, 45], maxZoom: 16 }
    );
  }

  function focarParada(lat, lng, idParada) {
    if (!mapa) return;
    mapa.setView([lat, lng], 16, { animate: true });
    const marker = indiceMarkersParadas.get(String(idParada));
    if (!marker) return;
    if (modoEditorAtivo && clusterParadas && typeof clusterParadas.zoomToShowLayer === 'function') {
      clusterParadas.zoomToShowLayer(marker, () => {
        marker.openTooltip();
      });
    } else {
      mapa.once('moveend', () => marker.openTooltip());
    }
  }

  /**
   * Troca o mapa base entre claro e escuro (chamado pelo botão de tema)
   */
  function definirTemaMapa(escuro) {
    temaEscuro = Boolean(escuro);
    const mlMap = camadaMapaBase && typeof camadaMapaBase.getMaplibreMap === 'function'
      ? camadaMapaBase.getMaplibreMap()
      : null;
    if (mlMap) {
      mlMap.setStyle(temaEscuro ? ESTILO_MAPA_ESCURO : ESTILO_MAPA_CLARO);
    }
  }

  function definirPosicaoUsuario(lat, lng, rotulo = 'Sua localização') {
    if (!mapa) return;

    if (marcadorUsuario) mapa.removeLayer(marcadorUsuario);
    if (circuloPrecisaoUsuario) mapa.removeLayer(circuloPrecisaoUsuario);

    const iconeUsuario = L.divIcon({
      className: '',
      html: `<div class="marcador-mapa marcador-usuario" style="width:22px;height:22px;" title="${window.BuzuUtils.escaparHtml(
        rotulo
      )}"></div>`,
      iconSize: [22, 22],
      iconAnchor: [11, 11]
    });

    circuloPrecisaoUsuario = L.circle([lat, lng], {
      radius: 160,
      color: '#B50909',
      weight: 1.5,
      fillColor: '#B50909',
      fillOpacity: 0.08,
      interactive: false
    }).addTo(mapa);

    marcadorUsuario = L.marker([lat, lng], {
      icon: iconeUsuario,
      title: rotulo
    })
      .addTo(mapa)
      .bindTooltip(`<strong>Sua referência:</strong> ${window.BuzuUtils.escaparHtml(rotulo)}`, {
        direction: 'top',
        offset: [0, -12]
      });

    mapa.setView([lat, lng], 15, { animate: true });
  }

  function invalidarTamanho() {
    if (mapa) {
      setTimeout(() => mapa.invalidateSize(), 120);
    }
  }

  /**
   * Marcadores "A" (origem), "B" (destino) e pontos de transferência (T1, T2, T3...) da busca De → Para.
   */
  function definirPontosViagem(origem, destino, transferenciaOuLista = null) {
    if (!mapa || !camadaViagem) return;
    camadaViagem.clearLayers();

    const criarMarcador = (ponto, rotulo, classe, sigla) => {
      if (!ponto || typeof ponto.lat !== 'number' || typeof ponto.lng !== 'number') return;

      const icone = L.divIcon({
        className: '',
        html: `<div class="marcador-mapa marcador-viagem ${classe}" 
style="width:30px;height:30px;font-size:13px;">${sigla}</div>`,
        iconSize: [30, 30],
        iconAnchor: [15, 15]
      });

      L.marker([ponto.lat, ponto.lng], { icon: icone, title: rotulo, alt: rotulo })
        .bindTooltip(`<strong>${sigla}: ${window.BuzuUtils.escaparHtml(rotulo)}</strong>`, {
          direction: 'top',
          offset: [0, -16]
        })
        .addTo(camadaViagem);
    };

    criarMarcador(origem, origem?.rotulo || origem?.titulo || 'Origem', 'marcador-origem', 'A');
    criarMarcador(destino, destino?.rotulo || destino?.titulo || 'Destino', 'marcador-destino', 'B');

    const listaTrans = Array.isArray(transferenciaOuLista)
      ? transferenciaOuLista
      : transferenciaOuLista
      ? [transferenciaOuLista]
      : [];

    listaTrans.forEach((trans, idx) => {
      const sigla = listaTrans.length === 1 ? '↻' : `↻${idx + 1}`;
      criarMarcador(
        trans,
        trans.nome || `Ponto de integração ${idx + 1}`,
        'marcador-transferencia',
        sigla
      );
    });
  }

  /**
   * "Como chegar": desenha somente o caminho do passageiro — a pé (tracejado) e, de ônibus,
   * apenas o trecho percorrido de cada linha, no sentido da viagem, com setas.
   */
  function renderizarEtapasViagem(etapas = []) {
    if (!camadaEtapas) return;
    camadaEtapas.clearLayers();
    etapasViagem = etapas;
    for (const e of etapas) {
      const latLngs = e.coords.map(c => [c[1], c[0]]);
      if (e.tipo === 'pe') {
        L.polyline(latLngs, {
          renderer: canvasRenderer,
          color: temaEscuro ? '#cbd5e1' : '#475569',
          weight: 3.5,
          opacity: 0.95,
          dashArray: '2, 8',
          lineCap: 'round',
          interactive: true
        })
          .bindTooltip(`<i class="bi bi-person-walking" aria-hidden="true"></i> ${window.BuzuUtils.escaparHtml(e.rotulo || 'A pé')}`, { sticky: true })
          .addTo(camadaEtapas);
        continue;
      }
      for (const ext of e.extensoes || []) {
        L.polyline(ext.map(c => [c[1], c[0]]), {
          renderer: canvasRenderer,
          color: e.cor || '#0057B8',
          weight: 4,
          opacity: 0.35,
          lineCap: 'round',
          lineJoin: 'round',
          interactive: false
        }).addTo(camadaEtapas);
      }
      L.polyline(latLngs, {
        renderer: canvasRenderer,
        color: corContornoRota(),
        weight: 11,
        opacity: 0.95,
        lineCap: 'round',
        lineJoin: 'round',
        interactive: false
      }).addTo(camadaEtapas);
      L.polyline(latLngs, {
        renderer: canvasRenderer,
        color: e.cor || '#0057B8',
        weight: 6.5,
        opacity: 1,
        lineCap: 'round',
        lineJoin: 'round',
        dashArray: e.aproximado ? '10, 8' : null
      })
        .bindTooltip(
          `<strong>${window.BuzuUtils.escaparHtml(e.rotulo || '')}</strong><br>Trecho percorrido nesta linha` +
            (e.aproximado ? '<br><em>Traçado aproximado</em>' : ''),
          { sticky: true, className: 'tooltip-linha' }
        )
        .addTo(camadaEtapas);
    }
    desenharParadasDaViagem(etapas);
    atualizarSentidos();
  }

  /**
   * Paradas do "Como chegar": embarque/desembarque em destaque, até 3 paradas antes/depois
   * (onde também dá para embarcar ou descer) e, bem discretas, as paradas do caminho.
   */
  function desenharParadasDaViagem(etapas) {
    const fundo = temaEscuro ? '#0f172a' : '#ffffff';
    for (const e of etapas) {
      if (e.tipo !== 'onibus') continue;
      const cor = e.cor || '#0057B8';
      const numero = window.BuzuUtils.escaparHtml(e.numero || '');
      // ordem de desenho: caminho < alternativas < destaques
      const ordem = { caminho: 0, alternativa_embarque: 1, alternativa_desembarque: 1, embarque: 2, desembarque: 2 };
      for (const p of [...(e.paradas || [])].sort((a, b) => ordem[a.papel] - ordem[b.papel])) {
        const nome = window.BuzuUtils.escaparHtml(p.nome);
        const ll = [p.lat, p.lng];
        if (p.papel === 'caminho') {
          L.circleMarker(ll, { renderer: renderParadas, radius: 2.8, color: cor, weight: 1.5, fillColor: fundo, fillOpacity: 1 })
            .bindTooltip(`<strong>${nome}</strong><br><small>Parada no caminho da linha ${numero}</small>`, { direction: 'top', className: 'tooltip-parada' })
            .addTo(camadaEtapas);
        } else if (p.papel === 'alternativa_embarque' || p.papel === 'alternativa_desembarque') {
          const texto = p.papel === 'alternativa_embarque' ? 'Também dá para embarcar aqui' : 'Também dá para descer aqui';
          L.circleMarker(ll, { renderer: renderParadas, radius: 4.5, color: cor, weight: 2.5, fillColor: fundo, fillOpacity: 1 })
            .bindTooltip(`<span class="tooltip-parada-tipo">${texto} • ${numero}</span><br><strong>${nome}</strong>`, { direction: 'top', className: 'tooltip-parada' })
            .addTo(camadaEtapas);
        } else {
          const embarque = p.papel === 'embarque';
          L.circleMarker(ll, { renderer: renderParadas, radius: 8, color: fundo, weight: 3, fillColor: cor, fillOpacity: 1 })
            .bindTooltip(`<span class="tooltip-parada-tipo">${embarque ? 'Embarque' : 'Desembarque'} • linha ${numero}</span><br><strong>${nome}</strong>`, { direction: 'top', className: 'tooltip-parada' })
            .addTo(camadaEtapas);
          L.marker(ll, {
            icon: L.divIcon({
              className: '',
              html: `<div class="pino-parada-viagem" style="--cor-pino:${cor}"><i class="bi ${embarque ? 'bi-box-arrow-in-right' : 'bi-box-arrow-right'}" aria-hidden="true"></i> ${embarque ? 'Embarque' : 'Desça aqui'} • ${numero}</div>`,
              iconSize: null,
              iconAnchor: [0, 0]
            }),
            interactive: false,
            keyboard: false,
            pane: 'paneSetas'
          }).addTo(camadaEtapas);
        }
      }
    }
  }

  function limparEtapasViagem() {
    etapasViagem = [];
    camadaEtapas?.clearLayers();
    atualizarSentidos();
  }

  function limparPontosViagem() {
    if (camadaViagem) camadaViagem.clearLayers();
  }

  function enquadrarPontosViagem(origem, destino, transferenciaOuLista = null) {
    if (!mapa || !origem || !destino) return;
    const pontos = [
      [origem.lat, origem.lng],
      [destino.lat, destino.lng]
    ];
    const listaTrans = Array.isArray(transferenciaOuLista)
      ? transferenciaOuLista
      : transferenciaOuLista
      ? [transferenciaOuLista]
      : [];

    for (const t of listaTrans) {
      if (t && typeof t.lat === 'number' && typeof t.lng === 'number') {
        pontos.push([t.lat, t.lng]);
      }
    }
    mapa.fitBounds(pontos, { padding: [55, 55], maxZoom: 15 });
  }

  return {
    inicializar,
    renderizarRotas,
    renderizarParadas,
    enquadrarBbox,
    focarParada,
    definirPosicaoUsuario,
    definirPontosViagem,
    limparPontosViagem,
    enquadrarPontosViagem,
    definirModoEditorParadas,
    definirModoEditorRota,
    definirAdicionarVerticeCliqueRota,
    desfazerEdicaoRota,
    limparTodosVerticesRota,
    obterCoordenadasEdicaoRota,
    definirModoDesenhadorRota,
    definirSentidoDesenhador,
    alternarModoInsercaoDesenhador,
    desfazerPontoDesenhador,
    limparSentidoDesenhador,
    gerarVoltaInvertidaDesenhador,
    obterDadosDesenhadorRota,
    solicitarEnquadramentoNaProximaRenderizacao,
    invalidarTamanho,
    definirTemaMapa,
    renderizarEtapasViagem,
    limparEtapasViagem,
    definirMostrarTerminalRetorno
  };
})();
