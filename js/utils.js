/**
 * js/utils.js
 * Funções utilitárias de geometria, cálculo geodésico, simplificação (Douglas-Peucker)
 * e deslocamento paralelo cartográfico (técnica Stamen / MetroMatch para evitar sobreposição).
 */

window.BuzuUtils = (function () {
  'use strict';

  const RAIO_TERRA_METROS = 6371000;
  const FATOR_CAMINHADA_URBANA = 1.3; // Distância geodésica × 1,3 conforme edital
  const VELOCIDADE_CAMINHADA_M_POR_MIN = 75; // 4,5 km/h = 75 m/min
  const TOLERANCIA_PADRAO_GRAUS = 0.00005; // ~5,5 metros em Natal-RN

  const LIMITES_NATAL = {
    minLat: -6.15,
    maxLat: -5.55,
    minLng: -35.48,
    maxLng: -35.10
  };

  function grausParaRadianos(graus) {
    return (graus * Math.PI) / 180;
  }

  function calcularDistanciaGeodesica(lat1, lng1, lat2, lng2) {
    const dLat = grausParaRadianos(lat2 - lat1);
    const dLng = grausParaRadianos(lng2 - lng1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(grausParaRadianos(lat1)) *
        Math.cos(grausParaRadianos(lat2)) *
        Math.sin(dLng / 2) *
        Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return RAIO_TERRA_METROS * c;
  }

  function calcularCaminhada(latOrigem, lngOrigem, latDestino, lngDestino) {
    const distanciaGeodesica = calcularDistanciaGeodesica(latOrigem, lngOrigem, latDestino, lngDestino);
    const distanciaPeMetros = Math.round(distanciaGeodesica * FATOR_CAMINHADA_URBANA);
    const tempoMinutos = Math.max(1, Math.round(distanciaPeMetros / VELOCIDADE_CAMINHADA_M_POR_MIN));

    return {
      distanciaGeodesica: Math.round(distanciaGeodesica),
      distanciaPeMetros,
      tempoMinutos
    };
  }

  function formatarDistancia(metros) {
    if (metros < 1000) {
      return `${Math.round(metros)} m`;
    }
    return `${(metros / 1000).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 2 })} km`;
  }

  function estaNaAreaDeNatal(lat, lng) {
    return (
      lat >= LIMITES_NATAL.minLat &&
      lat <= LIMITES_NATAL.maxLat &&
      lng >= LIMITES_NATAL.minLng &&
      lng <= LIMITES_NATAL.maxLng
    );
  }

  function distanciaPontoSegmento(p, a, b) {
    let x = a[0];
    let y = a[1];
    let dx = b[0] - x;
    let dy = b[1] - y;

    if (dx !== 0 || dy !== 0) {
      const t = ((p[0] - x) * dx + (p[1] - y) * dy) / (dx * dx + dy * dy);
      if (t > 1) {
        x = b[0];
        y = b[1];
      } else if (t > 0) {
        x += dx * t;
        y += dy * t;
      }
    }
    dx = p[0] - x;
    dy = p[1] - y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  /**
   * Simplificação Ramer-Douglas-Peucker (tolerância ~0.00005)
   */
  function simplificarLineString(coords, tolerancia = TOLERANCIA_PADRAO_GRAUS) {
    if (!Array.isArray(coords) || coords.length <= 2) {
      return coords;
    }

    let dmax = 0;
    let indiceMax = 0;
    const ultimo = coords.length - 1;

    for (let i = 1; i < ultimo; i++) {
      const d = distanciaPontoSegmento(coords[i], coords[0], coords[ultimo]);
      if (d > dmax) {
        indiceMax = i;
        dmax = d;
      }
    }

    if (dmax > tolerancia) {
      const parte1 = simplificarLineString(coords.slice(0, indiceMax + 1), tolerancia);
      const parte2 = simplificarLineString(coords.slice(indiceMax), tolerancia);
      return parte1.slice(0, parte1.length - 1).concat(parte2);
    }

    return [coords[0], coords[ultimo]];
  }

  /**
   * Aplica deslocamento perpendicular em metros a uma polilinha [lng, lat].
   * Usado em dois cenários cartográficos:
   * 1. Técnica Stamen/MetroMatch: separar linhas diferentes que compartilham o mesmo corredor viário
   *    para que as 85 linhas nunca virem um borrão sobreposto.
   * 2. Preparação para o futuro: se uma linha tiver duas geometrias separadas ("ida" e "volta"),
   *    desloca ~10m para cada lado. Quando sentido === "ambos" e há apenas 1 traçado ativo, mantém 0m.
   */
  function deslocarPolilinhaMetros(coords, metrosOffset = 0) {
    if (!metrosOffset || !Array.isArray(coords) || coords.length < 2) {
      return coords;
    }

    const grausPorMetro = 1 / 111320;
    const deltaGraus = metrosOffset * grausPorMetro;

    return coords.map((ponto, idx) => {
      const ant = coords[Math.max(0, idx - 1)];
      const prox = coords[Math.min(coords.length - 1, idx + 1)];
      const dx = prox[0] - ant[0];
      const dy = prox[1] - ant[1];
      const comp = Math.sqrt(dx * dx + dy * dy);
      if (comp === 0) return ponto;

      const nx = -dy / comp;
      const ny = dx / comp;
      return [
        Number((ponto[0] + nx * deltaGraus).toFixed(6)),
        Number((ponto[1] + ny * deltaGraus).toFixed(6))
      ];
    });
  }

  /**
   * Projeta um ponto (lat, lng) sobre a polilinha [lng, lat] mais próxima.
   * Retorna a distância em metros, o ponto projetado e o trecho/posição onde ocorreu.
   */
  function projetarPontoNaPolilinha(lat, lng, coords) {
    if (!Array.isArray(coords) || coords.length < 2) return null;

    const metrosPorGrauLat = 111132;
    const metrosPorGrauLng = 111320 * Math.cos(grausParaRadianos(lat));
    const px = lng * metrosPorGrauLng;
    const py = lat * metrosPorGrauLat;

    let melhor = {
      distanciaMetros: Infinity,
      lat,
      lng,
      indiceSegmento: 0,
      fracao: 0
    };

    for (let i = 0; i < coords.length - 1; i++) {
      const a = coords[i];
      const b = coords[i + 1];
      const ax = a[0] * metrosPorGrauLng;
      const ay = a[1] * metrosPorGrauLat;
      const bx = b[0] * metrosPorGrauLng;
      const by = b[1] * metrosPorGrauLat;
      const dx = bx - ax;
      const dy = by - ay;
      const comp2 = dx * dx + dy * dy;

      let t = comp2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / comp2 : 0;
      t = Math.max(0, Math.min(1, t));

      const cx = ax + t * dx;
      const cy = ay + t * dy;
      const d = Math.sqrt((px - cx) * (px - cx) + (py - cy) * (py - cy));

      if (d < melhor.distanciaMetros) {
        melhor = {
          distanciaMetros: d,
          lat: cy / metrosPorGrauLat,
          lng: cx / metrosPorGrauLng,
          indiceSegmento: i,
          fracao: t
        };
      }
    }

    return melhor;
  }

  /**
   * Calcula a distância geodésica acumulada (em metros) ao longo de cada vértice da polilinha.
   */
  function calcularComprimentoAcumulado(coords) {
    const acumulado = [0];
    for (let i = 1; i < coords.length; i++) {
      acumulado.push(
        acumulado[i - 1] +
          calcularDistanciaGeodesica(coords[i - 1][1], coords[i - 1][0], coords[i][1], coords[i][0])
      );
    }
    return acumulado;
  }

  /**
   * Converte uma projeção em distância acumulada (metros) desde o início da polilinha.
   */
  function posicaoNaPolilinha(comprimentoAcumulado, projecao) {
    if (!projecao || !Array.isArray(comprimentoAcumulado) || comprimentoAcumulado.length < 2) return 0;
    const i = Math.max(0, Math.min(projecao.indiceSegmento, comprimentoAcumulado.length - 2));
    const inicio = comprimentoAcumulado[i];
    const fim = comprimentoAcumulado[i + 1];
    return inicio + projecao.fracao * (fim - inicio);
  }

  /**
   * Calcula o deslocamento perpendicular (em metros) para uma feature de linha:
   * - Se sentido === "ida" ou "volta" (futuro), aplica +10m ou -10m.
   * - Se sentido === "ambos" (atual), NUNCA duplica a linha; aplica apenas o offset Stamen/MetroMatch
   *   entre linhas diferentes quando há múltiplos traçados visíveis simultaneamente no corredor.
   */
  function obterCoordenadasCartograficas(coords, sentido = 'ambos', indiceCorredor = 0, totalCorredor = 1) {
    let offsetMetros = 0;

    // Futuro: geometrias separadas para ida e volta
    if (sentido === 'ida') {
      offsetMetros += 10;
    } else if (sentido === 'volta') {
      offsetMetros -= 10;
    }

    // Técnica Stamen / MetroMatch: quando mais de uma linha está visível, distribui lateralmente
    // em faixas paralelas (-12m, -6m, 0m, +6m, +12m) para evitar borrão sobreposto
    if (totalCorredor > 1) {
      const faixa = (indiceCorredor % 5) - 2; // -2, -1, 0, 1, 2
      offsetMetros += faixa * 6;
    }

    return deslocarPolilinhaMetros(coords, offsetMetros);
  }

  function escaparHtml(texto) {
    if (texto === null || texto === undefined) return '';
    return String(texto)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function normalizarTexto(str) {
    return String(str || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }

  function calcularBbox(coords) {
    let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
    for (const [lng, lat] of coords) {
      if (lng < minLng) minLng = lng;
      if (lat < minLat) minLat = lat;
      if (lng > maxLng) maxLng = lng;
      if (lat > maxLat) maxLat = lat;
    }
    return [minLng, minLat, maxLng, maxLat];
  }

  return {
    calcularDistanciaGeodesica,
    calcularCaminhada,
    formatarDistancia,
    estaNaAreaDeNatal,
    simplificarLineString,
    projetarPontoNaPolilinha,
    calcularComprimentoAcumulado,
    posicaoNaPolilinha,
    deslocarPolilinhaMetros,
    obterCoordenadasCartograficas,
    escaparHtml,
    normalizarTexto,
    calcularBbox,
    TOLERANCIA_PADRAO_GRAUS
  };
})();
