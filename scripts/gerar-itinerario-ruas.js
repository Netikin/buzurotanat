/**
 * scripts/gerar-itinerario-ruas.js
 * Extrai a sequência real de Logradouros (Ruas, Avenidas, Rodovias, Viadutos, Pontes) e Bairros
 * do OpenStreetMap para todas as 87 linhas propostas (Ida e Volta) a partir do traçado GeoJSON,
 * salvando `itinerario_ruas` em `dados/linhas.json` e atualizando os nomes das paradas em `dados/paradas.json`.
 */

const fs = require('fs');
const path = require('path');

const DIR_DADOS = path.join(__dirname, '..', 'dados');
const ARQ_LINHAS = path.join(DIR_DADOS, 'linhas.json');
const ARQ_PARADAS = path.join(DIR_DADOS, 'paradas.json');
const ARQ_LOTE1 = path.join(DIR_DADOS, 'lote-1.geojson');
const ARQ_LOTE2 = path.join(DIR_DADOS, 'lote-2.geojson');
const ARQ_CACHE_VIAS = path.join(DIR_DADOS, 'osm-vias-cache.json');

function distMetros(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function consultarFatiasOverpass(query) {
  const endpoints = [
    'https://overpass.kumi.systems/api/interpreter',
    'https://overpass-api.de/api/interpreter',
    'https://overpass.private.coffee/api/interpreter'
  ];

  for (const url of endpoints) {
    try {
      const fullUrl = `${url}?data=${encodeURIComponent(query.trim())}`;
      const res = await fetch(fullUrl, {
        method: 'GET',
        signal: AbortSignal.timeout(25000),
        headers: {
          Accept: 'application/json',
          'User-Agent': 'BuzuRotaNatal/1.0 (contato@natal.rn.gov.br)'
        }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      console.warn(`Falha em ${url}: ${e.message}`);
    }
  }
  return { elements: [] };
}

async function obterViasEBairrosOSM() {
  if (fs.existsSync(ARQ_CACHE_VIAS)) {
    console.log('Carregando vias e bairros do cache local:', ARQ_CACHE_VIAS);
    return JSON.parse(fs.readFileSync(ARQ_CACHE_VIAS, 'utf8'));
  }

  console.log('Consultando vias e bairros de Natal na Overpass API...');
  const bbox = '-5.91,-35.31,-5.70,-35.16';
  const qPrincipais = `
[out:json][timeout:25];
(
  way["highway"="trunk"]["name"](${bbox});
  way["highway"="primary"]["name"](${bbox});
  way["highway"="secondary"]["name"](${bbox});
  way["highway"="tertiary"]["name"](${bbox});
  way["highway"="unclassified"]["name"](${bbox});
  node["place"="suburb"]["name"](${bbox});
  node["place"="neighbourhood"]["name"](${bbox});
);
out body geom;
`;
  const qResidenciaisNorte = `
[out:json][timeout:25];
way["highway"="residential"]["name"](-5.80,-35.31,-5.70,-35.16);
out body geom;
`;
  const qResidenciaisSul = `
[out:json][timeout:25];
way["highway"="residential"]["name"](-5.91,-35.31,-5.80,-35.16);
out body geom;
`;

  const todosElementos = [];
  for (const [rotulo, q] of [
    ['Vias principais e bairros', qPrincipais],
    ['Vias residenciais Zona Norte', qResidenciaisNorte],
    ['Vias residenciais Zona Sul/Leste/Oeste', qResidenciaisSul]
  ]) {
    console.log(`Baixando: ${rotulo}...`);
    const json = await consultarFatiasOverpass(q);
    console.log(`  -> ${(json.elements || []).length} elementos recebidos.`);
    todosElementos.push(...(json.elements || []));
  }

  const consolidado = { elements: todosElementos };
  if (todosElementos.length > 0) {
    fs.writeFileSync(ARQ_CACHE_VIAS, JSON.stringify(consolidado), 'utf8');
  }
  console.log(`Elementos OSM baixados com sucesso: ${todosElementos.length}`);
  return consolidado;
}

async function executar() {
  const osmData = await obterViasEBairrosOSM();
  const elements = osmData.elements || [];

  const bairros = [];
  // Grade espacial para segmentos de vias (células de ~0.003 graus ~ 330m)
  const TAM_CELULA = 0.003;
  const gradeVias = new Map();

  function chaveCelula(lat, lng) {
    return `${Math.floor(lat / TAM_CELULA)}:${Math.floor(lng / TAM_CELULA)}`;
  }

  let totalSegmentos = 0;

  for (const el of elements) {
    if (el.type === 'node' && el.tags && el.tags.name && el.tags.place) {
      bairros.push({
        nome: el.tags.name.trim(),
        lat: el.lat,
        lng: el.lon
      });
    } else if (el.type === 'way' && el.tags && el.tags.name && Array.isArray(el.geometry)) {
      const nomeVia = el.tags.name.trim();
      const bairroTag = (
        el.tags['addr:suburb'] ||
        el.tags['is_in:suburb'] ||
        el.tags['addr:district'] ||
        ''
      ).trim();
      const geom = el.geometry;
      for (let i = 0; i < geom.length - 1; i++) {
        const p1 = geom[i];
        const p2 = geom[i + 1];
        const mLat = (p1.lat + p2.lat) / 2;
        const mLng = (p1.lon + p2.lon) / 2;
        const seg = {
          nome: nomeVia,
          bairroTag,
          lat1: p1.lat,
          lng1: p1.lon,
          lat2: p2.lat,
          lng2: p2.lon,
          mLat,
          mLng
        };
        const ch = chaveCelula(mLat, mLng);
        if (!gradeVias.has(ch)) gradeVias.set(ch, []);
        gradeVias.get(ch).push(seg);
        totalSegmentos++;
      }
    }
  }

  console.log(`Indexados ${totalSegmentos} segmentos de ruas e ${bairros.length} bairros.`);

  function encontrarBairroMaisProximo(lat, lng) {
    let melhor = '';
    let menorD = Infinity;
    for (const b of bairros) {
      const d = distMetros(lat, lng, b.lat, b.lng);
      if (d < menorD) {
        menorD = d;
        melhor = b.nome;
      }
    }
    return menorD <= 3500 ? melhor : 'Natal';
  }

  function distPontoSegmentoMetros(lat, lng, seg) {
    const cosLat = Math.cos((lat * Math.PI) / 180);
    const px = lng * cosLat * 111320;
    const py = lat * 110540;
    const x1 = seg.lng1 * cosLat * 111320;
    const y1 = seg.lat1 * 110540;
    const x2 = seg.lng2 * cosLat * 111320;
    const y2 = seg.lat2 * 110540;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const l2 = dx * dx + dy * dy;
    let t = l2 === 0 ? 0 : ((px - x1) * dx + (py - y1) * dy) / l2;
    t = Math.max(0, Math.min(1, t));
    const projX = x1 + t * dx;
    const projY = y1 + t * dy;
    return Math.hypot(px - projX, py - projY);
  }

  function encontrarViaMaisProxima(lat, lng, raioMax = 65) {
    const cLat = Math.floor(lat / TAM_CELULA);
    const cLng = Math.floor(lng / TAM_CELULA);
    let melhorSeg = null;
    let menorDist = raioMax;

    for (let dLat = -1; dLat <= 1; dLat++) {
      for (let dLng = -1; dLng <= 1; dLng++) {
        const lista = gradeVias.get(`${cLat + dLat}:${cLng + dLng}`);
        if (!lista) continue;
        for (const seg of lista) {
          const d = distPontoSegmentoMetros(lat, lng, seg);
          if (d < menorDist) {
            menorDist = d;
            melhorSeg = seg;
          }
        }
      }
    }

    if (!melhorSeg) return null;
    const bairro = melhorSeg.bairroTag || encontrarBairroMaisProximo(lat, lng);
    return {
      logradouro: melhorSeg.nome,
      bairro,
      distancia: menorDist
    };
  }

  // Extrai a sequência ordenada de ruas ao longo de uma lista de coordenadas [lng, lat]
  function extrairSequenciaRuas(coords) {
    if (!Array.isArray(coords) || coords.length < 2) return [];
    const sequencia = [];
    let distAcum = 0;
    let ultimaAmostra = -100;

    for (let i = 0; i < coords.length; i++) {
      const [lng, lat] = coords[i];
      if (i > 0) {
        const [lngAnt, latAnt] = coords[i - 1];
        distAcum += distMetros(latAnt, lngAnt, lat, lng);
      }
      if (distAcum - ultimaAmostra < 55 && i !== 0 && i !== coords.length - 1) {
        continue;
      }
      ultimaAmostra = distAcum;

      const via = encontrarViaMaisProxima(lat, lng, 70);
      if (!via) continue;

      const anterior = sequencia[sequencia.length - 1];
      if (!anterior || anterior.logradouro.toUpperCase() !== via.logradouro.toUpperCase()) {
        // Evita ping-pong imediato A -> B -> A em cruzamentos curtos (< 90m)
        const penultimo = sequencia[sequencia.length - 2];
        if (
          penultimo &&
          penultimo.logradouro.toUpperCase() === via.logradouro.toUpperCase() &&
          distAcum - anterior.distMetros < 110
        ) {
          sequencia.pop();
          continue;
        }

        sequencia.push({
          ordem: sequencia.length + 1,
          logradouro: via.logradouro,
          bairro: via.bairro,
          lat: Number(lat.toFixed(6)),
          lng: Number(lng.toFixed(6)),
          distMetros: Math.round(distAcum)
        });
      }
    }

    return sequencia.map((item, idx) => ({
      ordem: idx + 1,
      logradouro: item.logradouro,
      bairro: item.bairro,
      lat: item.lat,
      lng: item.lng
    }));
  }

  const lote1 = JSON.parse(fs.readFileSync(ARQ_LOTE1, 'utf8'));
  const lote2 = JSON.parse(fs.readFileSync(ARQ_LOTE2, 'utf8'));
  const todasFeatures = [...(lote1.features || []), ...(lote2.features || [])];

  // Mapa: `${numero}|${dia_semana}` -> coords concatenadas ou maior LineString
  const coordsPorLinhaDia = new Map();
  for (const feat of todasFeatures) {
    const num = String(feat.properties?.numero || feat.properties?.linha_id || '').toUpperCase();
    const dia = feat.properties?.dia_semana || 'dias_uteis_sabados';
    const chave = `${num}|${dia}`;
    const coords = feat.geometry?.coordinates || [];
    if (!coordsPorLinhaDia.has(chave)) {
      coordsPorLinhaDia.set(chave, []);
    }
    coordsPorLinhaDia.get(chave).push(...coords);
  }

  const linhasJson = JSON.parse(fs.readFileSync(ARQ_LINHAS, 'utf8'));
  let totalRuasExtraidas = 0;

  for (const linha of linhasJson.linhas || []) {
    const num = String(linha.numero).toUpperCase();
    const coordsUtil =
      coordsPorLinhaDia.get(`${num}|dias_uteis_sabados`) ||
      coordsPorLinhaDia.get(`${num}|domingos_feriados`) ||
      [];
    const coordsDom = coordsPorLinhaDia.get(`${num}|domingos_feriados`) || coordsUtil;

    // Em circuitos/traçados de ida e volta na mesma geometria, dividimos ao meio para Ida e Volta
    const meio = Math.max(2, Math.floor(coordsUtil.length / 2));
    const coordsIda = coordsUtil.slice(0, meio + 1);
    const coordsVolta = coordsUtil.slice(meio).length >= 2 ? coordsUtil.slice(meio) : [...coordsIda].reverse();

    const ruasIda = extrairSequenciaRuas(coordsIda);
    const ruasVolta = extrairSequenciaRuas(coordsVolta);

    linha.itinerario_ruas = {
      ida: ruasIda,
      volta: ruasVolta
    };

    if (linha.variantes_dia?.dias_uteis_sabados) {
      linha.variantes_dia.dias_uteis_sabados.itinerario_ruas = {
        ida: ruasIda,
        volta: ruasVolta
      };
    }

    if (linha.variantes_dia?.domingos_feriados) {
      const meioDom = Math.max(2, Math.floor(coordsDom.length / 2));
      const ruasIdaDom = extrairSequenciaRuas(coordsDom.slice(0, meioDom + 1));
      const ruasVoltaDom = extrairSequenciaRuas(
        coordsDom.slice(meioDom).length >= 2 ? coordsDom.slice(meioDom) : [...coordsDom].reverse()
      );
      linha.variantes_dia.domingos_feriados.itinerario_ruas = {
        ida: ruasIdaDom,
        volta: ruasVoltaDom
      };
    }

    totalRuasExtraidas += ruasIda.length + ruasVolta.length;
  }

  fs.writeFileSync(ARQ_LINHAS, JSON.stringify(linhasJson, null, 2), 'utf8');
  console.log(`Salvo itinerario_ruas em dados/linhas.json (${totalRuasExtraidas} registros de logradouros).`);

  // Também atualiza o nome das paradas virtuais/OSM genéricas em dados/paradas.json para o nome real da rua + bairro!
  if (fs.existsSync(ARQ_PARADAS)) {
    const paradasJson = JSON.parse(fs.readFileSync(ARQ_PARADAS, 'utf8'));
    let paradasRenomeadas = 0;
    for (const feat of paradasJson.features || []) {
      const p = feat.properties || {};
      const [lng, lat] = feat.geometry?.coordinates || [];
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

      const ehNomeGenerico =
        !p.nome ||
        p.nome.startsWith('Parada ') ||
        p.nome.startsWith('Ponto OSM');

      if (ehNomeGenerico) {
        const via = encontrarViaMaisProxima(lat, lng, 85);
        if (via) {
          p.nome = `${via.logradouro} (${via.bairro})`;
          p.logradouro = via.logradouro;
          p.bairro = via.bairro;
          paradasRenomeadas++;
        } else {
          const b = encontrarBairroMaisProximo(lat, lng);
          p.nome = `Via Local (${b})`;
          p.bairro = b;
        }
      }
    }
    fs.writeFileSync(ARQ_PARADAS, JSON.stringify(paradasJson, null, 2), 'utf8');
    console.log(`Paradas atualizadas com nomes reais de ruas e bairros: ${paradasRenomeadas}`);
  }
}

executar().catch(err => {
  console.error(err);
  process.exit(1);
});
