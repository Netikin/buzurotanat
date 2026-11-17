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
    for (const l of linhasComSentido) {
      const sufixo = varias ? ` ${window.BuzuUtils.escaparHtml(l.numero)}` : '';
      const idaPx = paraLadoDireito(l.ida, 4).map(c => [c[1], c[0]]);
      const voltaPx = paraLadoDireito(l.volta, 4).map(c => [c[1], c[0]]);
      l.polIda?.setLatLngs(idaPx);
      l.polVolta?.setLatLngs(voltaPx);
      l.casIda?.setLatLngs(idaPx);
      l.casVolta?.setLatLngs(voltaPx);
      desenharSetas(idaPx, l.cor, 'Sentido ida');
      desenharSetas(voltaPx, l.corVolta, 'Sentido volta');
      marcadorPonta(idaPx[0], `<i class="bi bi-flag-fill" aria-hidden="true"></i> Terminal${sufixo}`, 'pino-ponta--inicio');
      marcadorPonta(idaPx[idaPx.length - 1], `<i class="bi bi-arrow-return-left" aria-hidden="true"></i> Retorno${sufixo}`, 'pino-ponta--retorno');
    }
  }

  let callbacks = {
    aoClicarLinha: null,
    aoClicarParada: null,
    aoArrastarParada: null,
    aoClicarMapaEditor: null,
    aoAtualizarRotaEditor: null
  };

  let modoEditorAtivo = false;
  let criarParadaNoCliqueAtivo = false;
  let modoEditorRotaAtivo = false;
  let adicionarVerticeNoCliqueAtivo = false;
  let coordsEdicaoRota = [];
  let corEdicaoRota = '#162652';
  let historicoEdicaoRota = [];

  function inicializar(idElemento = 'mapa', opcoesCallbacks = {}) {
    callbacks = { ...callbacks, ...opcoesCallbacks };

    canvasRenderer = L.canvas({ padding: 0.5, tolerance: 10 });

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
      '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> &copy; <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">OpenMapTiles</a> &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> | STTU Natal — Concorrência 11.001/2026';
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
          '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> | STTU Natal — Concorrência 11.001/2026'
      }).addTo(mapa);
    }

    camadaRedeAtual = L.layerGroup().addTo(mapa);
    camadaRotasPropostas = L.layerGroup().addTo(mapa);
    camadaViagem = L.layerGroup().addTo(mapa);
    camadaEdicaoRota = L.layerGroup().addTo(mapa);

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
      mostrarSentido = false // "Como chegar": mostra ida/volta e setas de todas as linhas do trajeto
    } = opcoes;

    camadaRotasPropostas.clearLayers();
    camadaRedeAtual.clearLayers();
    linhasComSentido = [];

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
        const estiloComum = { renderer: canvasRenderer, lineCap: 'round', lineJoin: 'round', dashArray: tracadoDesatualizado ? '10, 8' : null };
        registro.casVolta = L.polyline([], { ...estiloComum, color: corContornoRota(), weight: 9, opacity: 0.9, interactive: false, dashArray: null }).addTo(camadaRotasPropostas);
        registro.casIda = L.polyline([], { ...estiloComum, color: corContornoRota(), weight: 9, opacity: 0.9, interactive: false, dashArray: null }).addTo(camadaRotasPropostas);
        registro.polVolta = L.polyline([], { ...estiloComum, color: corVolta, weight: 5, opacity: 1 }).addTo(camadaRotasPropostas);
        registro.polIda = L.polyline([], { ...estiloComum, color: corLinha, weight: 5, opacity: 1 }).addTo(camadaRotasPropostas);
        const titulo = `<strong>${window.BuzuUtils.escaparHtml(props.numero)} — ${window.BuzuUtils.escaparHtml(props.nome)}</strong>`;
        registro.polIda.bindTooltip(`${titulo}<br><span class="tooltip-sentido">➜ Ida</span> do terminal até o ponto de retorno`, { sticky: true, className: 'tooltip-linha' });
        registro.polVolta.bindTooltip(`${titulo}<br><span class="tooltip-sentido tooltip-sentido--volta">➜ Volta</span> do ponto de retorno até o terminal`, { sticky: true, className: 'tooltip-linha' });
        linhasComSentido.push(registro);
        boundsParaEnquadrar.push(...coords.map(c => [c[1], c[0]]));
        return;
      }
      const estiloBase = ehDestacada
        ? { weight: 6, opacity: 1 }
        : visaoGeral
        ? { weight: 2.5, opacity: 0.55 }
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

      const polyline = L.polyline(latLngs, {
        renderer: canvasRenderer,
        color: corLinha,
        weight: estiloBase.weight,
        opacity: estiloBase.opacity,
        dashArray: tracadoDesatualizado ? '10, 8' : null,
        lineCap: 'round',
        lineJoin: 'round'
      });

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

      polyline.on('click', () => {
        if (typeof callbacks.aoClicarLinha === 'function') {
          callbacks.aoClicarLinha(props.linha_id || props.numero, props.dia_semana);
        }
      });

      polyline.on('mouseover', function () {
        // Na visão geral, apaga as demais linhas para a linha sob o cursor saltar aos olhos
        if (visaoGeral) {
          for (const outra of camadasHover) {
            if (outra !== this) outra.setStyle({ opacity: 0.12 });
          }
        }
        this.setStyle({ weight: estiloBase.weight + 3, opacity: 1 });
        this.bringToFront();
      });

      polyline.on('mouseout', function () {
        if (visaoGeral) {
          for (const outra of camadasHover) outra.setStyle({ opacity: estiloBase.opacity });
        }
        this.setStyle({ weight: estiloBase.weight, opacity: estiloBase.opacity });
      });

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
    const linhas = (props.rotas || []).slice(0, 10);
    const extra = (props.rotas || []).length > linhas.length ? ` +${props.rotas.length - linhas.length}` : '';
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

      marker.bindTooltip(
        `<strong>${window.BuzuUtils.escaparHtml(props.nome)}</strong><br>` +
          `[${origemTag} • Sentido: ${sentidoTag}] • Linhas: ${window.BuzuUtils.escaparHtml(
            (props.rotas || []).slice(0, 8).join(', ')
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
        if (coordsEdicaoRota.length <= 2) return;
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

  function obterCoordenadasEdicaoRota() {
    return coordsEdicaoRota.map(c => [c[0], c[1]]);
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
    atualizarSentidos();
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
    obterCoordenadasEdicaoRota,
    solicitarEnquadramentoNaProximaRenderizacao,
    invalidarTamanho,
    definirTemaMapa,
    renderizarEtapasViagem,
    limparEtapasViagem
  };
})();
