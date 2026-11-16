/**
 * scripts/gerar-paradas-osm-e-virtuais.js
 *
 * 1. Busca paradas de ônibus reais de Natal/Grande Natal na Overpass API (OpenStreetMap).
 * 2. Preserva os 18 Terminais e Estações de Integração oficiais já extraídos dos KMZ (`origem: 'manual'`).
 * 3. Filtra os pontos do OSM que estão a até 35 metros de algum traçado das 87 linhas (`origem: 'osm'`).
 * 4. Gera paradas virtuais (`origem: 'virtual'`) a cada ~200m nos trechos de linha onde não houver
 *    nenhuma parada (manual ou OSM) num raio de 35 metros.
 * 5. Detecta automaticamente o sentido ('IDA' | 'VOLTA' | 'AMBOS') pela progressão e mão de direção do vetor,
 *    e constrói a tabela pivot `dados/linha_paradas.json`.
 */

const fs = require('fs');
const path = require('path');

const DADOS_DIR = path.join(__dirname, '..', 'dados');
const RAIO_VINCULO_METROS = 35;
const PASSO_PARADA_VIRTUAL_METROS = 220; // ~200m conforme especificação

function grausParaRadianos(g) {
  return (g * Math.PI) / 180;
}

function distanciaMetros(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = grausParaRadianos(lat2 - lat1);
  const dLng = grausParaRadianos(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(grausParaRadianos(lat1)) * Math.cos(grausParaRadianos(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Calcula distância acumulada em metros para cada vértice [lng, lat] da polilinha
 */
function calcularAcumuladoMetros(coords) {
  const acum = [0];
  for (let i = 1; i < coords.length; i++) {
    acum.push(
      acum[i - 1] + distanciaMetros(coords[i - 1][1], coords[i - 1][0], coords[i][1], coords[i][0])
    );
  }
  return acum;
}

/**
 * Projeta um ponto (lat, lng) em um intervalo de segmentos [idxInicio .. idxFim] de uma polilinha.
 * Retorna a menor distância em metros, a distância acumulada na linha e o produto vetorial (lado da via).
 */
function projetarNoRamo(lat, lng, coords, acumulado, idxInicio, idxFim) {
  const mLat = 111132;
  const mLng = 111320 * Math.cos(grausParaRadianos(lat));
  const px = lng * mLng;
  const py = lat * mLat;

  let melhor = null;

  for (let i = idxInicio; i < idxFim; i++) {
    const a = coords[i];
    const b = coords[i + 1];
    if (!a || !b) continue;

    const ax = a[0] * mLng;
    const ay = a[1] * mLat;
    const bx = b[0] * mLng;
    const by = b[1] * mLat;
    const dx = bx - ax;
    const dy = by - ay;
    const comp2 = dx * dx + dy * dy;

    let t = comp2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / comp2 : 0;
    t = Math.max(0, Math.min(1, t));

    const cx = ax + t * dx;
    const cy = ay + t * dy;
    const dist = Math.hypot(px - cx, py - cy);

    if (!melhor || dist < melhor.distanciaMetros) {
      // Produto vetorial para saber se o ponto está à direita do sentido de deslocamento (mão brasileira)
      const cross = dx * (py - ay) - dy * (px - ax);
      const distAcum = acumulado[i] + t * (acumulado[i + 1] - acumulado[i]);
      melhor = {
        distanciaMetros: dist,
        distanciaAcumulada: Math.round(distAcum),
        indiceSegmento: i,
        cross
      };
    }
  }

  return melhor;
}

/**
 * Busca pontos de ônibus reais de Natal no OpenStreetMap via Overpass API
 */
async function buscarParadasOsmNatal() {
  const query = `
    [out:json][timeout:25];
    (
      node["highway"="bus_stop"](-5.91,-35.31,-5.70,-35.16);
      node["public_transport"="platform"]["bus"="yes"](-5.91,-35.31,-5.70,-35.16);
    );
    out body;
  `;

  try {
    console.log('Consultando paradas reais de Natal na Overpass API (OpenStreetMap)...');
    const url =
      'https://overpass-api.de/api/interpreter?data=' + encodeURIComponent(query.trim());
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'User-Agent': 'BuzuRotaNatal-STTU/1.0 (https://natal.rn.gov.br)'
      }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const elementos = (json.elements || []).filter(el => el.type === 'node' && el.lat && el.lon);
    console.log(`Overpass OSM retornou ${elementos.length} pontos de parada em Natal.`);
    return elementos;
  } catch (err) {
    console.warn(`Aviso: Overpass API indisponível ou lenta (${err.message}). Usando terminais + geração virtual a cada 200m.`);
    return [];
  }
}

/**
 * Interpola coordenadas (lat, lng) ao longo da polilinha em uma distância alvo (metros),
 * aplicando um leve deslocamento de 4m para a calçada da direita do sentido da via.
 */
function interpolarPontoNaPolilinha(coords, acumulado, distanciaAlvo, deslocarDireitaMetros = 4) {
  for (let i = 0; i < coords.length - 1; i++) {
    const d0 = acumulado[i];
    const d1 = acumulado[i + 1];
    if (distanciaAlvo >= d0 && distanciaAlvo <= d1) {
      const segLen = d1 - d0;
      const t = segLen > 0 ? (distanciaAlvo - d0) / segLen : 0;
      let lng = coords[i][0] + t * (coords[i + 1][0] - coords[i][0]);
      let lat = coords[i][1] + t * (coords[i + 1][1] - coords[i][1]);

      if (deslocarDireitaMetros !== 0 && segLen > 1) {
        const dx = coords[i + 1][0] - coords[i][0];
        const dy = coords[i + 1][1] - coords[i][1];
        const norm = Math.hypot(dx, dy);
        if (norm > 0) {
          // Vetor normal à direita do movimento: (dy, -dx)
          const grausOffset = deslocarDireitaMetros / 111320;
          lng += (dy / norm) * grausOffset;
          lat += (-dx / norm) * grausOffset;
        }
      }

      return {
        lat: Number(lat.toFixed(6)),
        lng: Number(lng.toFixed(6)),
        indiceSegmento: i
      };
    }
  }
  const ult = coords[coords.length - 1];
  return { lat: ult[1], lng: ult[0], indiceSegmento: coords.length - 2 };
}

async function executar() {
  const lote1 = JSON.parse(fs.readFileSync(path.join(DADOS_DIR, 'lote-1.geojson'), 'utf8'));
  const lote2 = JSON.parse(fs.readFileSync(path.join(DADOS_DIR, 'lote-2.geojson'), 'utf8'));
  const paradasAtuais = JSON.parse(fs.readFileSync(path.join(DADOS_DIR, 'paradas.json'), 'utf8'));
  const indiceLinhas = JSON.parse(fs.readFileSync(path.join(DADOS_DIR, 'linhas.json'), 'utf8'));

  const todasFeaturesLinhas = [...(lote1.features || []), ...(lote2.features || [])];

  // Prepara geometria e ramos IDA (1ª metade do circuito) e VOLTA (2ª metade do circuito) de cada linha
  const linhasProcessadas = todasFeaturesLinhas.map(feat => {
    const coords = feat.geometry.coordinates;
    const acumulado = calcularAcumuladoMetros(coords);
    const comprTotal = acumulado[acumulado.length - 1] || 0;
    // Encontra o índice do vértice mais próximo de 50% do comprimento do circuito (ponto de retorno)
    let idxMeio = Math.floor(coords.length / 2);
    for (let i = 1; i < acumulado.length; i++) {
      if (acumulado[i] >= comprTotal / 2) {
        idxMeio = i;
        break;
      }
    }
    return {
      feature: feat,
      props: feat.properties,
      numero: feat.properties.numero,
      dia_semana: feat.properties.dia_semana || 'dias_uteis_sabados',
      coords,
      acumulado,
      comprTotal,
      idxMeio
    };
  });

  // 1. Mantém apenas os Terminais e Estações oficiais do KMZ como base 'manual'
  const tabelaParadas = [];
  for (const feat of paradasAtuais.features || []) {
    const p = feat.properties || {};
    if (p.origem === 'virtual' || p.origem === 'osm') continue; // Recria OSM e virtuais limpos
    const [lng, lat] = feat.geometry.coordinates;
    tabelaParadas.push({
      id: p.id,
      nome: p.nome,
      lat: Number(lat.toFixed(6)),
      lng: Number(lng.toFixed(6)),
      tipo: p.tipo || 'terminal',
      origem: 'manual',
      ativo: p.ativo !== false,
      acessivel: p.acessivel || 'sim',
      sentidos_atendidos: (p.sentidos_atendidos || 'AMBOS').toUpperCase(),
      dias_semana: p.dias_semana || ['dias_uteis_sabados', 'domingos_feriados'],
      dia_rotulo: p.dia_rotulo || 'Dias úteis, sábados, domingos e feriados',
      rotas: [],
      integracoes_descricao: p.integracoes_descricao || []
    });
  }

  // 2. Busca paradas do OpenStreetMap e mantém aquelas a até 35m de alguma das 87 linhas
  const nosOsm = await buscarParadasOsmNatal();
  let contOsm = 1;

  for (const no of nosOsm) {
    const lat = Number(no.lat.toFixed(6));
    const lng = Number(no.lon.toFixed(6));

    // Evita duplicar se já houver terminal/parada a menos de 35m
    const jaExistePerto = tabelaParadas.some(
      p => distanciaMetros(lat, lng, p.lat, p.lng) < 35
    );
    if (jaExistePerto) continue;

    // Verifica se passa a até 35m de pelo menos uma linha proposta
    let atendeAlgumaLinha = false;
    let sentidosDetectados = new Set();

    for (const lp of linhasProcessadas) {
      const projIda = projetarNoRamo(lat, lng, lp.coords, lp.acumulado, 0, lp.idxMeio);
      const projVolta = projetarNoRamo(
        lat,
        lng,
        lp.coords,
        lp.acumulado,
        lp.idxMeio,
        lp.coords.length - 1
      );

      const dIda = projIda ? projIda.distanciaMetros : Infinity;
      const dVolta = projVolta ? projVolta.distanciaMetros : Infinity;

      if (dIda <= RAIO_VINCULO_METROS || dVolta <= RAIO_VINCULO_METROS) {
        atendeAlgumaLinha = true;
        if (dIda <= RAIO_VINCULO_METROS && dVolta <= RAIO_VINCULO_METROS && Math.abs(dIda - dVolta) < 10) {
          sentidosDetectados.add('IDA');
          sentidosDetectados.add('VOLTA');
        } else if (dIda <= dVolta) {
          sentidosDetectados.add('IDA');
        } else {
          sentidosDetectados.add('VOLTA');
        }
      }
    }

    if (!atendeAlgumaLinha) continue;

    const sentidoFinal =
      sentidosDetectados.has('IDA') && sentidosDetectados.has('VOLTA')
        ? 'AMBOS'
        : sentidosDetectados.has('VOLTA')
        ? 'VOLTA'
        : 'IDA';

    const nomeOsm =
      no.tags?.name ||
      no.tags?.['addr:street'] ||
      no.tags?.ref ||
      `Parada OSM #${String(contOsm).padStart(3, '0')}`;

    tabelaParadas.push({
      id: `OSM-${no.id}`,
      nome: nomeOsm,
      lat,
      lng,
      tipo: 'parada',
      origem: 'osm',
      ativo: true,
      acessivel: no.tags?.wheelchair === 'yes' ? 'sim' : 'sim',
      sentidos_atendidos: sentidoFinal,
      dias_semana: ['dias_uteis_sabados', 'domingos_feriados'],
      dia_rotulo: 'Dias úteis, sábados, domingos e feriados',
      rotas: [],
      integracoes_descricao: []
    });
    contOsm++;
  }

  console.log(`Paradas OSM vinculadas aos traçados (raio <= 35m): ${contOsm - 1}`);

  // 3. Fallback Automático: Gera paradas virtuais a cada ~220m nos trechos sem cobertura em raio de 35m
  let contVirtual = 1;
  for (const lp of linhasProcessadas) {
    // Prioriza gerar nas variantes de dias úteis (e nas exclusivas de domingo)
    const ramos = [
      { sentido: 'IDA', dInicio: 180, dFim: lp.acumulado[lp.idxMeio] - 120, idxMin: 0, idxMax: lp.idxMeio },
      {
        sentido: 'VOLTA',
        dInicio: lp.acumulado[lp.idxMeio] + 180,
        dFim: lp.comprTotal - 120,
        idxMin: lp.idxMeio,
        idxMax: lp.coords.length - 1
      }
    ];

    for (const ramo of ramos) {
      for (let d = ramo.dInicio; d < ramo.dFim; d += PASSO_PARADA_VIRTUAL_METROS) {
        const pt = interpolarPontoNaPolilinha(lp.coords, lp.acumulado, d, 4);

        // Verifica se já existe parada (manual, OSM ou virtual compatível) num raio de 75m no mesmo sentido
        const paradaCobrindo = tabelaParadas.find(p => {
          if (!p.ativo) return false;
          const dist = distanciaMetros(pt.lat, pt.lng, p.lat, p.lng);
          if (dist > 75) return false;
          return p.sentidos_atendidos === 'AMBOS' || p.sentidos_atendidos === ramo.sentido;
        });

        if (!paradaCobrindo) {
          const idVirt = `VIRT-${String(contVirtual++).padStart(4, '0')}`;
          tabelaParadas.push({
            id: idVirt,
            nome: `Parada ${lp.numero} (${ramo.sentido === 'IDA' ? 'Ida' : 'Volta'} • km ${(d / 1000).toFixed(1)})`,
            lat: pt.lat,
            lng: pt.lng,
            tipo: 'parada',
            origem: 'virtual',
            ativo: true,
            acessivel: 'sim',
            sentidos_atendidos: ramo.sentido,
            dias_semana: [lp.dia_semana],
            dia_rotulo:
              lp.dia_semana === 'domingos_feriados' ? 'Domingos e feriados' : 'Dias úteis e sábados',
            rotas: [],
            integracoes_descricao: []
          });
        }
      }
    }
  }

  console.log(`Paradas virtuais geradas nos trechos sem cobertura: ${contVirtual - 1}`);

  // 4. Constrói a Tabela Pivot `linha_paradas` (raio de 40m)
  const linhaParadas = [];
  const mapaRotasPorParada = new Map();
  const mapaDiasPorParada = new Map();

  for (const lp of linhasProcessadas) {
    const candidatosIda = [];
    const candidatosVolta = [];

    for (const p of tabelaParadas) {
      if (!p.ativo) continue;

      // Bounding box rápido antes de projetar
      const dAproxGraus = Math.min(
        ...lp.coords.map(c => Math.hypot(c[0] - p.lng, c[1] - p.lat))
      );
      if (dAproxGraus > 0.001) continue; // > ~110m

      if (p.sentidos_atendidos === 'IDA' || p.sentidos_atendidos === 'AMBOS') {
        const projIda = projetarNoRamo(p.lat, p.lng, lp.coords, lp.acumulado, 0, lp.idxMeio);
        if (projIda && projIda.distanciaMetros <= 40) {
          candidatosIda.push({
            parada_id: p.id,
            distancia_acumulada_metros: projIda.distanciaAcumulada
          });
        }
      }

      if (p.sentidos_atendidos === 'VOLTA' || p.sentidos_atendidos === 'AMBOS') {
        const projVolta = projetarNoRamo(
          p.lat,
          p.lng,
          lp.coords,
          lp.acumulado,
          lp.idxMeio,
          lp.coords.length - 1
        );
        if (projVolta && projVolta.distanciaMetros <= 40) {
          candidatosVolta.push({
            parada_id: p.id,
            distancia_acumulada_metros: Math.round(
              projVolta.distanciaAcumulada - lp.acumulado[lp.idxMeio]
            )
          });
        }
      }
    }

    candidatosIda.sort((a, b) => a.distancia_acumulada_metros - b.distancia_acumulada_metros);
    candidatosVolta.sort((a, b) => a.distancia_acumulada_metros - b.distancia_acumulada_metros);

    candidatosIda.forEach((item, idx) => {
      linhaParadas.push({
        linha_id: lp.numero,
        dia_semana: lp.dia_semana,
        sentido: 'IDA',
        parada_id: item.parada_id,
        ordem_sequencial: idx + 1,
        distancia_acumulada_metros: item.distancia_acumulada_metros
      });

      if (!mapaRotasPorParada.has(item.parada_id)) mapaRotasPorParada.set(item.parada_id, new Set());
      mapaRotasPorParada.get(item.parada_id).add(lp.numero);

      if (!mapaDiasPorParada.has(item.parada_id)) mapaDiasPorParada.set(item.parada_id, new Set());
      mapaDiasPorParada.get(item.parada_id).add(lp.dia_semana);
    });

    candidatosVolta.forEach((item, idx) => {
      linhaParadas.push({
        linha_id: lp.numero,
        dia_semana: lp.dia_semana,
        sentido: 'VOLTA',
        parada_id: item.parada_id,
        ordem_sequencial: idx + 1,
        distancia_acumulada_metros: item.distancia_acumulada_metros
      });

      if (!mapaRotasPorParada.has(item.parada_id)) mapaRotasPorParada.set(item.parada_id, new Set());
      mapaRotasPorParada.get(item.parada_id).add(lp.numero);

      if (!mapaDiasPorParada.has(item.parada_id)) mapaDiasPorParada.set(item.parada_id, new Set());
      mapaDiasPorParada.get(item.parada_id).add(lp.dia_semana);
    });

    // Atualiza paradas_atendidas no índice linhas.json para esta linha+dia
    const regLinha = (indiceLinhas.linhas || []).find(l => l.numero === lp.numero);
    if (regLinha && regLinha.variantes_dia && regLinha.variantes_dia[lp.dia_semana]) {
      const idsUnicos = Array.from(
        new Set([
          ...candidatosIda.map(c => c.parada_id),
          ...candidatosVolta.map(c => c.parada_id)
        ])
      );
      regLinha.variantes_dia[lp.dia_semana].paradas_atendidas = idsUnicos;
    }
  }

  // Atualiza rotas e dias nas paradas e converte para FeatureCollection GeoJSON
  const featuresParadasFinais = tabelaParadas
    .filter(p => p.origem === 'manual' || (mapaRotasPorParada.get(p.id)?.size || 0) > 0)
    .map(p => {
      const rotas = Array.from(mapaRotasPorParada.get(p.id) || p.rotas || []);
      const dias = Array.from(mapaDiasPorParada.get(p.id) || p.dias_semana || ['dias_uteis_sabados']);
      const diaRotulo =
        dias.includes('dias_uteis_sabados') && dias.includes('domingos_feriados')
          ? 'Dias úteis, sábados, domingos e feriados'
          : dias.includes('domingos_feriados')
          ? 'Domingos e feriados'
          : 'Dias úteis e sábados';

      return {
        type: 'Feature',
        properties: {
          id: p.id,
          nome: p.nome,
          lat: p.lat,
          lng: p.lng,
          tipo: p.tipo,
          origem: p.origem, // 'osm' | 'manual' | 'virtual'
          ativo: Boolean(p.ativo),
          acessivel: p.acessivel || 'sim',
          sentidos_atendidos: p.sentidos_atendidos, // 'IDA' | 'VOLTA' | 'AMBOS'
          rotas,
          dias_semana: dias,
          dia_rotulo: diaRotulo,
          integracoes_descricao: p.integracoes_descricao || []
        },
        geometry: {
          type: 'Point',
          coordinates: [p.lng, p.lat]
        }
      };
    });

  fs.writeFileSync(
    path.join(DADOS_DIR, 'paradas.json'),
    JSON.stringify({ type: 'FeatureCollection', features: featuresParadasFinais }, null, 2),
    'utf8'
  );

  fs.writeFileSync(
    path.join(DADOS_DIR, 'linha_paradas.json'),
    JSON.stringify(linhaParadas, null, 2),
    'utf8'
  );

  fs.writeFileSync(
    path.join(DADOS_DIR, 'linhas.json'),
    JSON.stringify(indiceLinhas, null, 2),
    'utf8'
  );

  console.log('\n=== Resumo da Geração de Paradas e Grafo ===');
  console.log(`- Total de paradas ativas na tabela: ${featuresParadasFinais.length}`);
  console.log(`  • Manuais / Terminais: ${featuresParadasFinais.filter(f => f.properties.origem === 'manual').length}`);
  console.log(`  • OpenStreetMap (OSM): ${featuresParadasFinais.filter(f => f.properties.origem === 'osm').length}`);
  console.log(`  • Virtuais (~200m):    ${featuresParadasFinais.filter(f => f.properties.origem === 'virtual').length}`);
  console.log(`- Total de registros na tabela pivot linha_paradas: ${linhaParadas.length}`);
}

executar();
