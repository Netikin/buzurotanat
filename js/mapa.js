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
      renderer: canvasRenderer,
      zoomControl: false,
      preferCanvas: true
    });

    // Posiciona controles de zoom no canto superior direito para não colidir com o painel/bottom sheet
    L.control.zoom({ position: 'topright' }).addTo(mapa);

    // Tiles OpenStreetMap com paleta neutra cartográfica aplicada via CSS (.leaflet-tile-pane)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> | STTU Natal — Licitação 021/2023'
    }).addTo(mapa);

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
      redeAtualGeoJson = null
    } = opcoes;

    camadaRotasPropostas.clearLayers();
    camadaRedeAtual.clearLayers();

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

    featuresVisiveis.forEach((feat, idxFeature) => {
      if (!feat.geometry || feat.geometry.type !== 'LineString') return;
      const props = feat.properties || {};
      const sentido = props.sentido || 'ambos';

      // Aplica deslocamento paralelo Stamen/MetroMatch apenas quando há mais de um traçado visível
      // ou quando sentido for "ida"/"volta" no futuro. Para uma única linha com sentido="ambos", mantém 0m.
      const coordsProcessadas = window.BuzuUtils.obterCoordenadasCartograficas(
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

      const opacidade = linhaDestacadaId ? (ehDestacada ? 1.0 : 0.22) : 0.95;
      const espessura = ehDestacada ? 6.5 : 4.5;
      const corLinha = props.cor || (props.lote === '2' ? '#D9531E' : '#0057B8');

      // Casing (contorno cartográfico branco sólido) para garantir contraste sobre o mapa neutro
      if (ehDestacada || totalVisiveis <= 15) {
        L.polyline(latLngs, {
          renderer: canvasRenderer,
          color: '#FFFFFF',
          weight: espessura + 3,
          opacity: ehDestacada ? 0.95 : 0.7,
          interactive: false
        }).addTo(camadaRotasPropostas);
      }

      if (ehDestacada || !linhaDestacadaId) {
        boundsParaEnquadrar.push(...latLngs);
      }

      // Linha proposta em traçado tracejado nítido
      const polyline = L.polyline(latLngs, {
        renderer: canvasRenderer,
        color: corLinha,
        weight: espessura,
        opacity: opacidade,
        dashArray: '12, 6',
        lineCap: 'butt',
        lineJoin: 'round'
      });

      polyline.bindTooltip(
        `<strong>[${window.BuzuUtils.escaparHtml(props.numero)}] ${window.BuzuUtils.escaparHtml(
          props.nome
        )}</strong><br>` +
          `${window.BuzuUtils.escaparHtml(props.dia_rotulo || 'Dias úteis e sábados')} • Lote ${window.BuzuUtils.escaparHtml(
            props.lote || '1'
          )}`,
        { sticky: true }
      );

      polyline.on('click', () => {
        if (typeof callbacks.aoClicarLinha === 'function') {
          callbacks.aoClicarLinha(props.linha_id || props.numero, props.dia_semana);
        }
      });

      polyline.on('mouseover', function () {
        this.setStyle({ weight: espessura + 2, opacity: 1 });
      });

      polyline.on('mouseout', function () {
        this.setStyle({ weight: espessura, opacity: opacidade });
      });

      polyline.addTo(camadaRotasPropostas);
    });

    if (ehRequisitadoEnquadramento && boundsParaEnquadrar.length > 0) {
      mapa.fitBounds(boundsParaEnquadrar, { padding: [42, 42], maxZoom: 16 });
      ehRequisitadoEnquadramento = false;
    }
  }

  function solicitarEnquadramentoNaProximaRenderizacao() {
    ehRequisitadoEnquadramento = true;
  }

  /**
   * Renderiza paradas/terminais.
   * Fluxo de dois níveis: clicar no ponto abre direto no painel lateral/bottom sheet,
   * sem abrir modal nem popup cobrindo o mapa.
   */
  function renderizarParadas(featuresParadas = [], idParadaDestacada = null) {
    if (!mapa || !clusterParadas) return;

    clusterParadas.clearLayers();
    indiceMarkersParadas.clear();

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
    if (marker && clusterParadas && typeof clusterParadas.zoomToShowLayer === 'function') {
      clusterParadas.zoomToShowLayer(marker, () => {
        marker.openTooltip();
      });
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
    invalidarTamanho
  };
})();
