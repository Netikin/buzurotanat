/**
 * scripts/tracar-n02.js
 * Traça a linha N-02 (Dias úteis e sábados: Gramoré <-> Bosque dos Namorados)
 * usando geocodificação Nominatim (escolhendo o ponto mais próximo do trecho anterior)
 * + roteamento real nas vias (OSRM/OpenStreetMap),
 * atualizando dados/lote-1.geojson, dados/linhas.json e dados/linha_paradas.json.
 */

const fs = require('fs');
const path = require('path');

const DIR_DADOS = path.join(__dirname, '..', 'dados');
const ARQ_LOTE1 = path.join(DIR_DADOS, 'lote-1.geojson');
const ARQ_LINHAS = path.join(DIR_DADOS, 'linhas.json');
const ARQ_PARADAS = path.join(DIR_DADOS, 'paradas.json');
const ARQ_LINHA_PARADAS = path.join(DIR_DADOS, 'linha_paradas.json');

const WAYPOINTS_IDA_TEXTO = [
  { nome: 'Av. Pirassununga (Terminal Gramoré)', bairro: 'Lagoa Azul', fixo: { lat: -5.723299, lng: -35.250606 } },
  { nome: 'Rua Riversul', bairro: 'Lagoa Azul', fixo: { lat: -5.72476, lng: -35.25131 } },
  { nome: 'Av. Piratininga', bairro: 'Lagoa Azul', fixo: { lat: -5.72511, lng: -35.25291 } },
  { nome: 'Rua Atibaia', bairro: 'Lagoa Azul', fixo: { lat: -5.72808, lng: -35.25144 } },
  { nome: 'Rua Eldorado', bairro: 'Lagoa Azul', fixo: { lat: -5.73071, lng: -35.25337 } },
  { nome: 'Av. Guararapes', bairro: 'Lagoa Azul', fixo: { lat: -5.732002, lng: -35.254302 } },
  { nome: 'Av. Tocantínea', bairro: 'Lagoa Azul', fixo: { lat: -5.733947, lng: -35.251082 } },
  { nome: 'Rua Flor do Paraíso', bairro: 'Pajuçara', fixo: { lat: -5.73479, lng: -35.24862 } },
  { nome: 'Rua São Rufino', bairro: 'Pajuçara', fixo: { lat: -5.73482, lng: -35.24786 } },
  { nome: 'Av. Gov. Antônio de Melo e Souza (Pompéia)', bairro: 'Potengi', fixo: { lat: -5.73693, lng: -35.25006 } },
  { nome: 'Av. Dr. João Medeiros Filho (Igapó)', bairro: 'Igapó', fixo: { lat: -5.76781, lng: -35.25478 } },
  { nome: 'Túnel / Av. Bacharel Tomaz Landim (Ponte de Igapó)', bairro: 'Igapó', fixo: { lat: -5.7764, lng: -35.2517 } },
  { nome: 'Rua Jandira', bairro: 'Nordeste', fixo: { lat: -5.79666, lng: -35.24060 } },
  { nome: 'Rua Doutor Mário Negócio (Viaduto da Urbana)', bairro: 'Quintas', fixo: { lat: -5.8022, lng: -35.2352 } },
  { nome: 'Av. Nevaldo Rocha (Midway Mall)', bairro: 'Tirol', fixo: { lat: -5.81095, lng: -35.2060 } },
  { nome: 'Av. Rui Barbosa', bairro: 'Tirol', fixo: { lat: -5.8091, lng: -35.1996 } },
  { nome: 'Bosque dos Namorados (Av. Alm. Alexandrino de Alencar)', bairro: 'Tirol', fixo: { lat: -5.81071, lng: -35.19501 } }
];

const WAYPOINTS_VOLTA_TEXTO = [
  { nome: 'Bosque dos Namorados (Av. Alm. Alexandrino de Alencar)', bairro: 'Tirol', fixo: { lat: -5.81071, lng: -35.19501 } },
  { nome: 'Av. Rui Barbosa', bairro: 'Tirol', fixo: { lat: -5.8087, lng: -35.1998 } },
  { nome: 'Av. Nevaldo Rocha (Midway Mall)', bairro: 'Tirol', fixo: { lat: -5.81045, lng: -35.2060 } },
  { nome: 'Rua Doutor Mário Negócio (Viaduto da Urbana)', bairro: 'Quintas', fixo: { lat: -5.8022, lng: -35.2352 } },
  { nome: 'Av. Felizardo Firmino Moura', bairro: 'Nordeste', fixo: { lat: -5.78785, lng: -35.24503 } },
  { nome: 'Ponte de Igapó / Av. Bacharel Tomaz Landim', bairro: 'Igapó', fixo: { lat: -5.7764, lng: -35.2517 } },
  { nome: 'Av. Dr. João Medeiros Filho', bairro: 'Igapó', fixo: { lat: -5.76781, lng: -35.25478 } },
  { nome: 'Praça Presidente Juscelino Kubitschek', bairro: 'Potengi', fixo: { lat: -5.75167, lng: -35.23623 } },
  { nome: 'Rua do Catetinho', bairro: 'Potengi', fixo: { lat: -5.75149, lng: -35.23738 } },
  { nome: 'Av. Gov. Antônio de Melo e Souza (Pompéia)', bairro: 'Potengi', fixo: { lat: -5.73693, lng: -35.25006 } },
  { nome: 'Rua São Rufino', bairro: 'Pajuçara', fixo: { lat: -5.73482, lng: -35.24786 } },
  { nome: 'Rua Flor do Paraíso', bairro: 'Pajuçara', fixo: { lat: -5.73479, lng: -35.24862 } },
  { nome: 'Av. Tocantínea', bairro: 'Lagoa Azul', fixo: { lat: -5.733947, lng: -35.251082 } },
  { nome: 'Rua Eldorado', bairro: 'Lagoa Azul', fixo: { lat: -5.73071, lng: -35.25337 } },
  { nome: 'Rua Atibaia', bairro: 'Lagoa Azul', fixo: { lat: -5.72808, lng: -35.25144 } },
  { nome: 'Rua Penápolis', bairro: 'Lagoa Azul', fixo: { lat: -5.72562, lng: -35.24944 } },
  { nome: 'Av. Pirassununga (Terminal Gramoré)', bairro: 'Lagoa Azul', fixo: { lat: -5.723299, lng: -35.250606 } }
];

const sleep = ms => new Promise(r => setTimeout(r, ms));
const cacheGeo = new Map();

function distMetros(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function geocodificar(wp, ptAnterior) {
  if (wp.fixo) return { ...wp.fixo, nome: wp.nome, bairro: wp.bairro };
  const q = wp.q;
  if (cacheGeo.has(q)) return { ...cacheGeo.get(q), nome: wp.nome, bairro: wp.bairro };

  const consultas = [q];
  const partes = q.split(',').map(s => s.trim());
  if (partes.length > 3) {
    consultas.push(`${partes[0]}, Natal, RN`);
  }

  for (const texto of consultas) {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=5&countrycodes=br&viewbox=-35.34,-5.68,-35.14,-5.96&bounded=1&q=${encodeURIComponent(texto)}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'BuzuRotaNatal/1.0 (contato@natal.rn.gov.br)' }
    });
    const json = await res.json();
    await sleep(1050);

    if (Array.isArray(json) && json.length > 0) {
      let escolhido = json[0];
      if (ptAnterior && json.length > 1) {
        let melhorD = Infinity;
        for (const cand of json) {
          const d = distMetros(ptAnterior.lat, ptAnterior.lng, Number(cand.lat), Number(cand.lon));
          if (d < melhorD) {
            melhorD = d;
            escolhido = cand;
          }
        }
      }
      const pt = { lat: Number(escolhido.lat), lng: Number(escolhido.lon) };
      cacheGeo.set(q, pt);
      return { ...pt, nome: wp.nome, bairro: wp.bairro };
    }
  }

  throw new Error(`Não encontrado no Nominatim: ${q}`);
}

async function rotearOSRM(pontos) {
  const coordsStr = pontos.map(p => `${p.lng},${p.lat}`).join(';');
  const url = `https://router.project-osrm.org/route/v1/driving/${coordsStr}?overview=full&geometries=geojson&steps=true`;
  const res = await fetch(url);
  const json = await res.json();
  if (json.code !== 'Ok' || !json.routes?.[0]) {
    throw new Error(`OSRM falhou: ${json.code} - ${json.message || ''}`);
  }
  return json.routes[0];
}

function extrairRuasPassos(route) {
  const ruas = [];
  for (const leg of route.legs || []) {
    for (const step of leg.steps || []) {
      const nome = (step.name || '').trim();
      if (!nome) continue;
      const loc = step.maneuver?.location || [];
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

function distPontoSegmento(lat, lng, coords) {
  const mLat = 111132;
  const mLng = 111320 * Math.cos((lat * Math.PI) / 180);
  const px = lng * mLng;
  const py = lat * mLat;
  let menor = Infinity;
  let distAcumMelhor = 0;
  let acum = 0;

  for (let i = 0; i < coords.length - 1; i++) {
    const [lng1, lat1] = coords[i];
    const [lng2, lat2] = coords[i + 1];
    const ax = lng1 * mLng, ay = lat1 * mLat;
    const bx = lng2 * mLng, by = lat2 * mLat;
    const dx = bx - ax, dy = by - ay;
    const l2 = dx * dx + dy * dy;
    const segLen = Math.sqrt(l2);
    let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    const cx = ax + t * dx, cy = ay + t * dy;
    const d = Math.hypot(px - cx, py - cy);
    if (d < menor) {
      menor = d;
      distAcumMelhor = acum + t * segLen;
    }
    acum += segLen;
  }
  return { distanciaMetros: menor, distanciaAcumulada: Math.round(distAcumMelhor) };
}

async function main() {
  console.log('Geocodificando waypoints de IDA...');
  const ptsIda = [];
  for (const wp of WAYPOINTS_IDA_TEXTO) {
    const pt = await geocodificar(wp, ptsIda[ptsIda.length - 1]);
    ptsIda.push(pt);
    console.log(`  IDA: ${wp.nome} -> [${pt.lat.toFixed(5)}, ${pt.lng.toFixed(5)}]`);
  }

  console.log('Geocodificando waypoints de VOLTA...');
  const ptsVolta = [];
  for (const wp of WAYPOINTS_VOLTA_TEXTO) {
    const pt = await geocodificar(wp, ptsVolta[ptsVolta.length - 1]);
    ptsVolta.push(pt);
    console.log(`  VOLTA: ${wp.nome} -> [${pt.lat.toFixed(5)}, ${pt.lng.toFixed(5)}]`);
  }

  console.log('Roteando IDA e VOLTA no OSRM...');
  const rotaIda = await rotearOSRM(ptsIda);
  const rotaVolta = await rotearOSRM(ptsVolta);

  const coordsIda = rotaIda.geometry.coordinates.map(c => [Number(c[0].toFixed(6)), Number(c[1].toFixed(6))]);
  const coordsVolta = rotaVolta.geometry.coordinates.map(c => [Number(c[0].toFixed(6)), Number(c[1].toFixed(6))]);
  const coordsTotal = [...coordsIda, ...coordsVolta.slice(1)];
  const indiceRetorno = coordsIda.length - 1;
  const extensaoKm = Number(((rotaIda.distance + rotaVolta.distance) / 1000).toFixed(3));

  console.log(`IDA: ${(rotaIda.distance / 1000).toFixed(2)} km (${coordsIda.length} pts)`);
  console.log(`VOLTA: ${(rotaVolta.distance / 1000).toFixed(2)} km (${coordsVolta.length} pts)`);
  console.log(`TOTAL: ${extensaoKm} km (${coordsTotal.length} pts, indice_retorno=${indiceRetorno})`);

  const ruasIda = extrairRuasPassos(rotaIda);
  const ruasVolta = extrairRuasPassos(rotaVolta);
  console.log('Ruas IDA:', ruasIda.map(r => r.logradouro).join(' -> '));
  console.log('Ruas VOLTA:', ruasVolta.map(r => r.logradouro).join(' -> '));

  // Calcula bbox
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  for (const [lng, lat] of coordsTotal) {
    if (lng < minLng) minLng = lng;
    if (lat < minLat) minLat = lat;
    if (lng > maxLng) maxLng = lng;
    if (lat > maxLat) maxLat = lat;
  }
  const bbox = [
    Number(minLng.toFixed(6)),
    Number(minLat.toFixed(6)),
    Number(maxLng.toFixed(6)),
    Number(maxLat.toFixed(6))
  ];

  // 1. Atualiza dados/lote-1.geojson
  const lote1 = JSON.parse(fs.readFileSync(ARQ_LOTE1, 'utf8'));
  const idxFeat = lote1.features.findIndex(f => f.properties?.id === 'N-02-dias_uteis_sabados');
  const novaFeature = {
    type: 'Feature',
    properties: {
      id: 'N-02-dias_uteis_sabados',
      linha_id: 'N-02',
      numero: 'N-02',
      nome: 'Gramoré/Bosque dos Namorados, via Midway Mall',
      lote: '1',
      tipo: 'atual',
      categoria_edital: 'Linha Atual (mantida)',
      sentido: 'ambos',
      dia_semana: 'dias_uteis_sabados',
      dia_rotulo: 'Dias úteis e sábados',
      extensao_km: extensaoKm,
      indice_retorno: indiceRetorno,
      cor: '#B45309'
    },
    geometry: {
      type: 'LineString',
      coordinates: coordsTotal
    }
  };
  if (idxFeat >= 0) lote1.features[idxFeat] = novaFeature;
  else lote1.features.push(novaFeature);
  fs.writeFileSync(ARQ_LOTE1, JSON.stringify(lote1), 'utf8');

  // 2. Atualiza dados/paradas.json e dados/linha_paradas.json (raio 35m para N-02 dias_uteis_sabados)
  const paradas = JSON.parse(fs.readFileSync(ARQ_PARADAS, 'utf8'));
  const linhaParadas = JSON.parse(fs.readFileSync(ARQ_LINHA_PARADAS, 'utf8'));

  const outrosVinculos = linhaParadas.filter(
    lp => !(lp.linha_id === 'N-02' && lp.dia_semana === 'dias_uteis_sabados')
  );
  const novosIda = [];
  const novosVolta = [];
  const paradasAtendidasIds = [];

  for (const fp of paradas.features || []) {
    const p = fp.properties || {};
    if (p.ativo === false) continue;
    const [lng, lat] = fp.geometry?.coordinates || [];
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

    const pIda = distPontoSegmento(lat, lng, coordsIda);
    const pVolta = distPontoSegmento(lat, lng, coordsVolta);
    const sAtend = String(p.sentidos_atendidos || 'AMBOS').toUpperCase();
    let ligou = false;

    if (pIda.distanciaMetros <= 35 && (sAtend === 'IDA' || sAtend === 'AMBOS')) {
      novosIda.push({
        linha_id: 'N-02',
        dia_semana: 'dias_uteis_sabados',
        sentido: 'IDA',
        parada_id: p.id,
        distancia_acumulada_metros: pIda.distanciaAcumulada
      });
      ligou = true;
    }
    if (pVolta.distanciaMetros <= 35 && (sAtend === 'VOLTA' || sAtend === 'AMBOS')) {
      novosVolta.push({
        linha_id: 'N-02',
        dia_semana: 'dias_uteis_sabados',
        sentido: 'VOLTA',
        parada_id: p.id,
        distancia_acumulada_metros: pVolta.distanciaAcumulada
      });
      ligou = true;
    }

    if (ligou) {
      paradasAtendidasIds.push(p.id);
      const rSet = new Set(p.rotas || []);
      rSet.add('N-02');
      p.rotas = Array.from(rSet);
    }
  }

  novosIda.sort((a, b) => a.distancia_acumulada_metros - b.distancia_acumulada_metros);
  novosVolta.sort((a, b) => a.distancia_acumulada_metros - b.distancia_acumulada_metros);
  novosIda.forEach((v, i) => (v.ordem_sequencial = i + 1));
  novosVolta.forEach((v, i) => (v.ordem_sequencial = i + 1));

  fs.writeFileSync(ARQ_PARADAS, JSON.stringify(paradas), 'utf8');
  fs.writeFileSync(ARQ_LINHA_PARADAS, JSON.stringify([...outrosVinculos, ...novosIda, ...novosVolta]), 'utf8');

  // 3. Atualiza dados/linhas.json
  const linhasJson = JSON.parse(fs.readFileSync(ARQ_LINHAS, 'utf8'));
  const n02 = linhasJson.linhas.find(l => l.numero === 'N-02');
  if (n02) {
    n02.bbox = bbox;
    n02.variantes_dia = n02.variantes_dia || {};
    n02.variantes_dia.dias_uteis_sabados = {
      dia_semana: 'dias_uteis_sabados',
      dia_rotulo: 'Dias úteis e sábados',
      nome: 'Gramoré/Bosque dos Namorados, via Midway Mall',
      extensao_km: extensaoKm,
      cor: '#B45309',
      sentido: 'ambos',
      paradas_atendidas: paradasAtendidasIds,
      integracoes: [],
      itinerario_ruas: {
        ida: ruasIda,
        volta: ruasVolta
      },
      bbox,
      fonte: 'Traçado via itinerário oficial (OSRM/OpenStreetMap)'
    };
    n02.fonte_rota_uteis = {
      tipo: 'Itinerário rua a rua',
      extensao_km: extensaoKm,
      metodo: 'Traçado gerado pela sequência oficial de ruas (Ida e Volta) sobre o mapa viário do OpenStreetMap/OSRM'
    };
  }
  fs.writeFileSync(ARQ_LINHAS, JSON.stringify(linhasJson, null, 2), 'utf8');
  console.log(`Salvo N-02 (dias_uteis_sabados) com sucesso! Paradas vinculadas: ${novosIda.length} IDA, ${novosVolta.length} VOLTA.`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
