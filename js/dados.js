/**
 * js/dados.js
 * Gerenciamento de dados GeoJSON por lote sob demanda, filtro por dias da semana,
 * busca de paradas próximas e importação/exportação via Acesso Restrito (Admin JSON / KML).
 */

window.BuzuDados = (function () {
  'use strict';

  const CHAVE_STORAGE_ADMIN = 'buzu_natal_admin_json_v1';

  // Dados reais convertidos de ./rotas/Mapa da linha B1.kmz como fallback seguro caso aberto via file://
  const FALLBACK_INICIAL = {
    indice: {
      versao: '2023.021-natal',
      aviso_sentido_padrao: 'A ida e a volta utilizam o mesmo traçado no mapa. A ordem das paradas por sentido deve ser confirmada no edital.',
      lotes: [
        { id: '1', nome: 'Lote 1 (Norte)', cor: '#0057B8', arquivo: 'dados/lote-1.geojson' },
        { id: '2', nome: 'Lote 2 (Sul / Leste / Oeste)', cor: '#D9531E', arquivo: 'dados/lote-2.geojson' }
      ],
      dias_operacionais: [
        { codigo: 'dias_uteis_sabados', rotulo: 'Dias úteis e sábados' },
        { codigo: 'domingos_feriados', rotulo: 'Domingos e feriados' }
      ],
      linhas: [
        {
          id: 'B1',
          numero: 'B1',
          nome: 'Brasil Novo/Av. Moema Tinoco',
          lote: '1',
          empresa: null,
          tipo: 'alimentadora',
          categoria_edital: 'Linha de Bairro',
          sentido: 'ambos',
          cor: '#B857EC',
          acessivel: true,
          tarifa: 'Tarifa Social / Sistema Natal (conforme edital)',
          frequencia_pico: 'Consultar quadro de horários do edital',
          frequencia_entre_pico: 'Consultar quadro de horários do edital',
          horario_operacao: '05:00 às 23:00',
          ordem_confirmada_por_sentido: false,
          dias_disponiveis: ['dias_uteis_sabados', 'domingos_feriados'],
          variantes_dia: {
            dias_uteis_sabados: {
              dia_semana: 'dias_uteis_sabados',
              dia_rotulo: 'Dias úteis e sábados',
              nome: 'Brasil Novo/Av. Moema Tinoco',
              extensao_km: 3.748,
              cor: '#B857EC',
              sentido: 'ambos',
              paradas_atendidas: ['P-001', 'P-002', 'P-003'],
              integracoes: [
                'E1 - Terminal Parque das Dunas/Alecrim (Linhas Estruturais)',
                'E2 - Terminal Parque das Dunas/Mirassol, via Av. Sen. Salgado Filho (Linhas Estruturais)',
                'D6A - Terminal Cidade da Esperança/Pajuçara (ida Av. das Fronteiras/volta Av. Dr. João Medeiros Filho) (Linhas Diretas)',
                'D6B - Terminal Cidade da Esperança/Pajuçara (ida Av. Dr. João Medeiros Filho/volta Av. das Fronteiras) (Linhas Diretas)'
              ],
              bbox: [-35.2367, -5.7424, -35.22603, -5.73425]
            },
            domingos_feriados: {
              dia_semana: 'domingos_feriados',
              dia_rotulo: 'Domingos e feriados',
              nome: 'Brasil Novo/Santa Catarina',
              extensao_km: 15.483,
              cor: '#333CE7',
              sentido: 'ambos',
              paradas_atendidas: ['P-004', 'P-005'],
              integracoes: [
                'R1 - Parque das Dunas/Panatis, via Rua Castelo Branco/Av. Pompéia (Linhas Regionais)',
                'R2 - Santa Cecília/Panatis, via Rua Norte Brasil/Av. Pompéia (Linhas Regionais)',
                'E5 - Terminal Soledade/Candelária, via Ponte Newton Navarro/Av. Prudente de Morais (Linhas Estruturais)',
                'E6 - Terminal Soledade/Ponta Negra, via Ponte de Igapó (Linhas Estruturais)',
                'E7 - Terminal Soledade/Praia do Meio, via Ponte de Igapó (Linhas Estruturais)',
                'R3 - Pajuçara/Panatis, via Av. Itapetinga (Linhas Regionais)',
                'R4 - Gramoré/Santa Catarina, via Dom Pedro/Av. Pompéia (Linhas Regionais)',
                'R5 - Nova Natal/Santa Catarina, via Rua Bela Vista (Linhas Regionais)',
                'R6A - Alvorada IV/Santa Catarina (ida Av. Boa Sorte/volta Rua José Luís da Silva) (Linhas Regionais)',
                'R6B - Jardim Progresso/Santa Catarina (ida Rua José Luís da Silva/volta Av. Boa Sorte) (Linhas Regionais)',
                'R7 - Vale Dourado/Santa Catarina, via Av. Santarém (Linhas Regionais)',
                'R8 - Parque dos Coqueiros/Santa Catarina, via Vila Paraíso (Linhas Regionais)',
                'R9 - Terminal Soledade/Residencial Redinha, via Soledade II/Mar del Plata (Linhas Regionais)',
                'R10 - Redinha/Santa Catarina (Linhas Regionais)'
              ],
              bbox: [-35.25412, -5.7626, -35.22604, -5.72743]
            }
          },
          bbox: [-35.25412, -5.7626, -35.22603, -5.72743]
        }
      ]
    },
    paradas: {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: {
            id: 'P-001',
            nome: 'Terminal do Brasil Novo',
            tipo: 'terminal',
            acessivel: 'sim',
            rotas: ['B1'],
            dias_semana: ['dias_uteis_sabados'],
            dia_rotulo: 'Dias úteis e sábados',
            sentidos_atendidos: 'ambos',
            integracoes_descricao: []
          },
          geometry: { type: 'Point', coordinates: [-35.234935, -5.741128] }
        },
        {
          type: 'Feature',
          properties: {
            id: 'P-002',
            nome: 'Local de integração - ida',
            tipo: 'ponto de integração',
            acessivel: 'sim',
            rotas: ['B1'],
            dias_semana: ['dias_uteis_sabados'],
            dia_rotulo: 'Dias úteis e sábados',
            sentidos_atendidos: 'ida',
            integracoes_descricao: [
              'B1 - Brasil Novo/Av. Moema Tinoco (Linha de Bairro)',
              'E1 - Terminal Parque das Dunas/Alecrim (Linhas Estruturais)',
              'E2 - Terminal Parque das Dunas/Mirassol, via Av. Sen. Salgado Filho (Linhas Estruturais)',
              'D6A - Terminal Cidade da Esperança/Pajuçara (ida Av. das Fronteiras/volta Av. Dr. João Medeiros Filho) (Linhas Diretas)'
            ]
          },
          geometry: { type: 'Point', coordinates: [-35.22722, -5.736771] }
        },
        {
          type: 'Feature',
          properties: {
            id: 'P-003',
            nome: 'Local de integração - volta',
            tipo: 'ponto de integração',
            acessivel: 'sim',
            rotas: ['B1'],
            dias_semana: ['dias_uteis_sabados'],
            dia_rotulo: 'Dias úteis e sábados',
            sentidos_atendidos: 'volta',
            integracoes_descricao: [
              'B1 - Brasil Novo/Av. Moema Tinoco (Linha de Bairro)',
              'E1 - Terminal Parque das Dunas/Alecrim (Linhas Estruturais)',
              'E2 - Terminal Parque das Dunas/Mirassol, via Av. Sen. Salgado Filho (Linhas Estruturais)',
              'D6B - Terminal Cidade da Esperança/Pajuçara (ida Av. Dr. João Medeiros Filho/volta Av. das Fronteiras) (Linhas Diretas)'
            ]
          },
          geometry: { type: 'Point', coordinates: [-35.226794, -5.737262] }
        },
        {
          type: 'Feature',
          properties: {
            id: 'P-004',
            nome: 'Terminal Estrutural Parque das Dunas',
            tipo: 'terminal',
            acessivel: 'sim',
            rotas: ['B1'],
            dias_semana: ['domingos_feriados'],
            dia_rotulo: 'Domingos e feriados',
            sentidos_atendidos: 'ambos',
            integracoes_descricao: [
              'B1 - Brasil Novo/Santa Catarina (Linha de Bairro)',
              'R1 - Parque das Dunas/Panatis, via Rua Castelo Branco/Av. Pompéia (Linhas Regionais)',
              'R2 - Santa Cecília/Panatis, via Rua Norte Brasil/Av. Pompéia (Linhas Regionais)'
            ]
          },
          geometry: { type: 'Point', coordinates: [-35.236507, -5.729216] }
        },
        {
          type: 'Feature',
          properties: {
            id: 'P-005',
            nome: 'Estação de Integração de Santa Catarina',
            tipo: 'ponto de integração',
            acessivel: 'sim',
            rotas: ['B1'],
            dias_semana: ['domingos_feriados'],
            dia_rotulo: 'Domingos e feriados',
            sentidos_atendidos: 'ambos',
            integracoes_descricao: [
              'B1 - Brasil Novo/Santa Catarina (Linha de Bairro)',
              'E5 - Terminal Soledade/Candelária, via Ponte Newton Navarro/Av. Prudente de Morais (Linhas Estruturais)',
              'E6 - Terminal Soledade/Ponta Negra, via Ponte de Igapó (Linhas Estruturais)',
              'E7 - Terminal Soledade/Praia do Meio, via Ponte de Igapó (Linhas Estruturais)',
              'R1 - Parque das Dunas/Panatis, via Rua Castelo Branco/Av. Pompéia (Linhas Regionais)',
              'R2 - Santa Cecília/Panatis, via Rua Norte Brasil/Av. Pompéia (Linhas Regionais)',
              'R3 - Pajuçara/Panatis, via Av. Itapetinga (Linhas Regionais)',
              'R4 - Gramoré/Santa Catarina, via Dom Pedro/Av. Pompéia (Linhas Regionais)',
              'R5 - Nova Natal/Santa Catarina, via Rua Bela Vista (Linhas Regionais)',
              'R6A - Alvorada IV/Santa Catarina (ida Av. Boa Sorte/volta Rua José Luís da Silva) (Linhas Regionais)',
              'R6B - Jardim Progresso/Santa Catarina (ida Rua José Luís da Silva/volta Av. Boa Sorte) (Linhas Regionais)',
              'R7 - Vale Dourado/Santa Catarina, via Av. Santarém (Linhas Regionais)',
              'R8 - Parque dos Coqueiros/Santa Catarina, via Vila Paraíso (Linhas Regionais)',
              'R9 - Terminal Soledade/Residencial Redinha, via Soledade II/Mar del Plata (Linhas Regionais)',
              'R10 - Redinha/Santa Catarina (Linhas Regionais)'
            ]
          },
          geometry: { type: 'Point', coordinates: [-35.252669, -5.762084] }
        }
      ]
    },
    lote1: {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: {
            id: 'B1-dias_uteis_sabados',
            linha_id: 'B1',
            numero: 'B1',
            nome: 'Brasil Novo/Av. Moema Tinoco',
            lote: '1',
            tipo: 'alimentadora',
            categoria_edital: 'Linha de Bairro',
            sentido: 'ambos',
            dia_semana: 'dias_uteis_sabados',
            dia_rotulo: 'Dias úteis e sábados',
            extensao_km: 3.748,
            cor: '#B857EC'
          },
          geometry: {
            type: 'LineString',
            coordinates: [
              [-35.23517, -5.74128], [-35.23243, -5.73813], [-35.23186, -5.73858], [-35.23171, -5.73854],
              [-35.22962, -5.73594], [-35.22866, -5.7343], [-35.22859, -5.73425], [-35.22781, -5.73466],
              [-35.2275, -5.73494], [-35.22732, -5.73523], [-35.22725, -5.73552], [-35.22725, -5.73639],
              [-35.22717, -5.73683], [-35.22642, -5.73799], [-35.22632, -5.73809], [-35.22614, -5.7381],
              [-35.22603, -5.73788], [-35.22663, -5.73753], [-35.22702, -5.73697], [-35.22717, -5.73655],
              [-35.22751, -5.73666], [-35.2287, -5.73546], [-35.22914, -5.73515], [-35.22976, -5.73608],
              [-35.23143, -5.73815], [-35.23207, -5.73767], [-35.23562, -5.74171], [-35.23597, -5.7423],
              [-35.23621, -5.7424], [-35.2367, -5.74173], [-35.23642, -5.74147], [-35.23564, -5.74185],
              [-35.23517, -5.74128]
            ]
          }
        },
        {
          type: 'Feature',
          properties: {
            id: 'B1-domingos_feriados',
            linha_id: 'B1',
            numero: 'B1',
            nome: 'Brasil Novo/Santa Catarina',
            lote: '1',
            tipo: 'alimentadora',
            categoria_edital: 'Linha de Bairro',
            sentido: 'ambos',
            dia_semana: 'domingos_feriados',
            dia_rotulo: 'Domingos e feriados',
            extensao_km: 15.483,
            cor: '#333CE7'
          },
          geometry: {
            type: 'LineString',
            coordinates: [
              [-35.23665, -5.72907], [-35.23606, -5.7294], [-35.23585, -5.72939], [-35.2349, -5.7279],
              [-35.2348, -5.7279], [-35.23286, -5.73027], [-35.23193, -5.73169], [-35.23004, -5.7335],
              [-35.22944, -5.73385], [-35.23038, -5.73536], [-35.2297, -5.73599], [-35.23143, -5.73815],
              [-35.23207, -5.73767], [-35.23562, -5.74171], [-35.23597, -5.7423], [-35.23621, -5.7424],
              [-35.23675, -5.74172], [-35.23747, -5.74221], [-35.23777, -5.74191], [-35.23784, -5.74194],
              [-35.23835, -5.74229], [-35.23902, -5.74293], [-35.24288, -5.7461], [-35.23727, -5.75342],
              [-35.24043, -5.7554], [-35.25062, -5.7615], [-35.2518, -5.76198], [-35.2526, -5.7626],
              [-35.25278, -5.76254], [-35.25412, -5.76178], [-35.25358, -5.76085], [-35.25203, -5.76177],
              [-35.25196, -5.76196], [-35.25223, -5.76234], [-35.2522, -5.76247], [-35.2521, -5.76248],
              [-35.24223, -5.75651], [-35.24032, -5.75547], [-35.23539, -5.75237], [-35.23645, -5.75091],
              [-35.23829, -5.75205], [-35.24114, -5.74829], [-35.23876, -5.74639], [-35.24044, -5.74414],
              [-35.23831, -5.74231], [-35.23777, -5.74195], [-35.23749, -5.74225], [-35.23676, -5.74177],
              [-35.23623, -5.74243], [-35.23601, -5.74243], [-35.23564, -5.74185], [-35.23243, -5.73813],
              [-35.23186, -5.73858], [-35.23171, -5.73854], [-35.2296, -5.73592], [-35.22861, -5.73423],
              [-35.22787, -5.73467], [-35.22752, -5.73498], [-35.22731, -5.73542], [-35.22729, -5.73657],
              [-35.22717, -5.73701], [-35.22639, -5.73803], [-35.22618, -5.73813], [-35.22604, -5.73802],
              [-35.22606, -5.7378], [-35.22638, -5.73767], [-35.22658, -5.73749], [-35.22705, -5.73679],
              [-35.22713, -5.73639], [-35.22714, -5.73541], [-35.22747, -5.7348], [-35.22821, -5.7342],
              [-35.22986, -5.73345], [-35.23081, -5.73249], [-35.23158, -5.73185], [-35.23214, -5.73113],
              [-35.23359, -5.7289], [-35.23476, -5.72763], [-35.23491, -5.7277], [-35.23512, -5.72804],
              [-35.23611, -5.72743], [-35.23696, -5.72878], [-35.23693, -5.72887], [-35.23665, -5.72907]
            ]
          }
        }
      ]
    },
    lote2: {
      type: 'FeatureCollection',
      features: []
    },
    locaisNatal: [
      { nome: 'Terminal do Brasil Novo (Zona Norte)', bairro: 'Pajuçara', cep: '59133-360', lat: -5.741128, lng: -35.234935, tipo: 'Terminal de Ônibus' },
      { nome: 'Av. Moema Tinoco da Cunha Lima (Pajuçara)', bairro: 'Pajuçara', cep: '59133-400', lat: -5.73677, lng: -35.22722, tipo: 'Avenida / Integração' },
      { nome: 'Terminal Estrutural Parque das Dunas (Zona Norte)', bairro: 'Lagoa Azul', cep: '59135-000', lat: -5.729216, lng: -35.236507, tipo: 'Terminal de Ônibus' },
      { nome: 'Estação de Integração de Santa Catarina (Potengi)', bairro: 'Potengi', cep: '59124-000', lat: -5.762084, lng: -35.252669, tipo: 'Estação de Integração' },
      { nome: 'Brasil Novo (Conjunto Brasil Novo - Pajuçara)', bairro: 'Pajuçara', cep: '59133-360', lat: -5.74113, lng: -35.23494, tipo: 'Bairro / Conjunto' },
      { nome: 'Santa Catarina (Zona Norte)', bairro: 'Potengi', cep: '59112-000', lat: -5.7585, lng: -35.2512, tipo: 'Bairro' },
      { nome: 'Alecrim (Centro Comercial)', bairro: 'Alecrim', cep: '59030-000', lat: -5.7952, lng: -35.2179, tipo: 'Bairro' },
      { nome: 'Midway Mall / Tirol', bairro: 'Tirol', cep: '59015-000', lat: -5.8112, lng: -35.2063, tipo: 'Referência' },
      { nome: 'Campus UFRN / Mirassol', bairro: 'Lagoa Nova', cep: '59078-970', lat: -5.8398, lng: -35.2036, tipo: 'Referência' }
    ]
  };

  let estado = {
    indice: null,
    paradas: null,
    linhaParadas: [], // Tabela pivot: { linha_id, dia_semana, sentido: 'IDA'|'VOLTA', parada_id, ordem_sequencial, distancia_acumulada_metros }
    grafoMemoria: {}, // Cache de arestas do grafo Dijkstra por dia_semana
    locaisNatal: [],
    cacheGeoJsonLotes: {}, // idLote -> FeatureCollection
    redeAtualGeoJson: null,
    temRedeAtual: false
  };

  const cacheSugestoesEndereco = new Map();

  /**
   * Inicializa a base de dados:
   * 1. Verifica se o Administrador salvou um JSON customizado no Acesso Restrito (localStorage)
   * 2. Caso contrário, busca dados/linhas.json, dados/paradas.json e dados/locais-natal.json
   */
  async function inicializar() {
    let carregouServidor = false;

    try {
      const [resIndice, resParadas, resPivot] = await Promise.all([
        fetch('dados/linhas.json', { cache: 'no-store' }),
        fetch('dados/paradas.json', { cache: 'no-store' }),
        fetch('dados/linha_paradas.json', { cache: 'no-store' }).catch(() => null)
      ]);
      if (resIndice.ok && resParadas.ok) {
        estado.indice = await resIndice.json();
        estado.paradas = await resParadas.json();
        if (resPivot && resPivot.ok) {
          estado.linhaParadas = await resPivot.json();
        }
        carregouServidor = true;
      }
    } catch (_err) {
      carregouServidor = false;
    }

    const adminSalvo = carregarOverrideAdmin();

    if (!carregouServidor) {
      if (adminSalvo && adminSalvo.indice && adminSalvo.paradas) {
        estado.indice = adminSalvo.indice;
        estado.paradas = adminSalvo.paradas;
        if (adminSalvo.lotesGeoJson) {
          estado.cacheGeoJsonLotes = { ...adminSalvo.lotesGeoJson };
        }
      } else {
        estado.indice = JSON.parse(JSON.stringify(FALLBACK_INICIAL.indice));
        estado.paradas = JSON.parse(JSON.stringify(FALLBACK_INICIAL.paradas));
        estado.cacheGeoJsonLotes['1'] = JSON.parse(JSON.stringify(FALLBACK_INICIAL.lote1));
        estado.cacheGeoJsonLotes['2'] = JSON.parse(JSON.stringify(FALLBACK_INICIAL.lote2));
      }
    } else if (adminSalvo && adminSalvo.indice && Array.isArray(adminSalvo.indice.linhas)) {
      // Se o servidor tem dados novos (ex: convertidos da pasta ./rotas/), garante que nenhuma
      // linha salva apenas no navegador se perca, mas mantém todas as linhas novas do servidor!
      const numerosNoServidor = new Set((estado.indice.linhas || []).map(l => l.numero));
      for (const linhaLocal of adminSalvo.indice.linhas) {
        if (!numerosNoServidor.has(linhaLocal.numero)) {
          estado.indice.linhas.push(linhaLocal);
        }
      }
    }

    // Carrega dicionário de locais de Natal para autocomplete instantâneo
    try {
      const resLocais = await fetch('dados/locais-natal.json');
      if (resLocais.ok) {
        estado.locaisNatal = await resLocais.json();
      } else {
        estado.locaisNatal = FALLBACK_INICIAL.locaisNatal;
      }
    } catch (_e) {
      estado.locaisNatal = FALLBACK_INICIAL.locaisNatal;
    }

    // Verifica se há camada opcional de rede atual (dados/rede-atual.geojson)
    if (!estado.redeAtualGeoJson) {
      try {
        const resRedeAtual = await fetch('dados/rede-atual.geojson');
        if (resRedeAtual.ok) {
          const gj = await resRedeAtual.json();
          if (gj && Array.isArray(gj.features) && gj.features.length > 0) {
            estado.redeAtualGeoJson = gj;
            estado.temRedeAtual = true;
          }
        }
      } catch (_e) {
        estado.temRedeAtual = false;
      }
    }

    return estado;
  }

  /**
   * Carrega sob demanda o GeoJSON de um lote específico (1 ou 2)
   * e garante simplificação das geometrias com tolerância ~0.00005 antes de renderizar
   */
  async function carregarGeoJsonLote(idLote) {
    const id = String(idLote);
    if (estado.cacheGeoJsonLotes[id]) {
      return estado.cacheGeoJsonLotes[id];
    }

    const configLote = (estado.indice?.lotes || []).find(l => String(l.id) === id);
    const caminho = configLote ? configLote.arquivo : `dados/lote-${id}.geojson`;

    try {
      const res = await fetch(caminho, { cache: 'no-store' });
      if (!res.ok) throw new Error(`Lote ${id} não encontrado via HTTP`);
      const geojson = await res.json();

      // Garante simplificação de cada LineString em memória caso tenha muitos vértices
      for (const feat of geojson.features || []) {
        if (feat.geometry && feat.geometry.type === 'LineString' && feat.geometry.coordinates.length > 100) {
          const coords = feat.geometry.coordinates;
          const tol = window.BuzuUtils.TOLERANCIA_PADRAO_GRAUS;
          const ret = Number(feat.properties?.indice_retorno);
          if (Number.isInteger(ret) && ret > 0 && ret < coords.length - 1) {
            // Simplifica ida e volta separadamente para o ponto de retorno continuar no lugar certo
            const ida = window.BuzuUtils.simplificarLineString(coords.slice(0, ret + 1), tol);
            const volta = window.BuzuUtils.simplificarLineString(coords.slice(ret), tol);
            feat.geometry.coordinates = [...ida, ...volta.slice(1)];
            feat.properties.indice_retorno = ida.length - 1;
          } else {
            feat.geometry.coordinates = window.BuzuUtils.simplificarLineString(coords, tol);
          }
        }
      }

      estado.cacheGeoJsonLotes[id] = geojson;
      return geojson;
    } catch (_err) {
      const fallback = id === '1' ? FALLBACK_INICIAL.lote1 : FALLBACK_INICIAL.lote2;
      estado.cacheGeoJsonLotes[id] = JSON.parse(JSON.stringify(fallback));
      return estado.cacheGeoJsonLotes[id];
    }
  }

  /**
   * Retorna todas as linhas filtradas por dia da semana, lote, tipo, acessibilidade e termo de busca
   */
  function filtrarLinhas({ diaSemana = 'dias_uteis_sabados', lote = 'todos', tipo = 'todos', apenasAcessiveis = false, termo = '', rede = 'todos' } = {}) {
    const todas = estado.indice?.linhas || [];
    const termoNorm = window.BuzuUtils.normalizarTexto(termo);

    return todas
      .filter(linha => {
        if (diaSemana !== 'todos') {
          const diasDisp = linha.dias_disponiveis || ['dias_uteis_sabados'];
          if (!diasDisp.includes(diaSemana) && !diasDisp.includes('todos')) {
            return false;
          }
        }
        if (lote !== 'todos' && String(linha.lote) !== String(lote)) {
          return false;
        }
        if (rede !== 'todos' && (linha.rede || 'transicao') !== rede) {
          return false;
        }
        if (tipo !== 'todos' && linha.tipo !== tipo && linha.categoria_edital !== tipo) {
          return false;
        }
        if (apenasAcessiveis && !linha.acessivel) {
          return false;
        }
        if (termoNorm) {
          const varDia = obterDadosLinhaNoDia(linha, diaSemana);
          const numeroNorm = window.BuzuUtils.normalizarTexto(linha.numero);
          const numeroLimpo = numeroNorm.replace(/[^a-z0-9]/g, '');
          const termoLimpo = termoNorm.replace(/[^a-z0-9]/g, '');
          const alvo = window.BuzuUtils.normalizarTexto(
            `${linha.numero} ${numeroLimpo} ${linha.nome} ${varDia.nome}`
          );

          // Se digitou apenas números (ex.: "79", "2", "33"), aceita com ou sem prefixo/zero à esquerda (ex.: "N-79", "N-02", "O-33A")
          if (/^\d+$/.test(termoLimpo)) {
            const numDigitado = Number(termoLimpo);
            const matchDigitos = numeroLimpo.match(/\d+/);
            const bateNumeroExato =
              matchDigitos &&
              (matchDigitos[0].includes(termoLimpo) || Number(matchDigitos[0]) === numDigitado);
            if (!bateNumeroExato && !alvo.includes(termoNorm)) return false;
          } else if (termoLimpo && numeroLimpo.includes(termoLimpo)) {
            // Aceita "n79", "N-79", "o33", "b4", etc. com ou sem hífen
            return true;
          } else if (!alvo.includes(termoNorm)) {
            return false;
          }
        }
        return true;
      })
      .map(linha => obterDadosLinhaNoDia(linha, diaSemana));
  }

  /**
   * Retorna os metadados consolidados da linha de acordo com o dia da semana selecionado
   */
  function obterDadosLinhaNoDia(linha, diaSemana = 'dias_uteis_sabados') {
    if (!linha) return null;
    const variantes = linha.variantes_dia || {};
    let varianteAtiva = variantes[diaSemana];

    // Só usa a variante de outro dia na visão "Todos". Num dia específico, linha sem traçado
    // para aquele dia fica sem rota (ex.: linhas atuais com rota divulgada só para domingos).
    if (!varianteAtiva && diaSemana === 'todos') {
      const primeiraChave = Object.keys(variantes)[0];
      varianteAtiva = primeiraChave ? variantes[primeiraChave] : null;
    }

    if (!varianteAtiva) {
      return {
        ...linha,
        dia_ativo_codigo: diaSemana,
        dia_ativo_rotulo: diaSemana === 'domingos_feriados' ? 'Domingos e feriados' : 'Dias úteis e sábados',
        paradas_atendidas: linha.paradas_atendidas || [],
        integracoes: linha.integracoes || []
      };
    }

    return {
      ...linha,
      nome_base: linha.nome,
      nome: varianteAtiva.nome || linha.nome,
      cor: varianteAtiva.cor || linha.cor,
      extensao_km: varianteAtiva.extensao_km ?? linha.extensao_km,
      sentido: varianteAtiva.sentido || linha.sentido || 'ambos',
      paradas_atendidas: varianteAtiva.paradas_atendidas || linha.paradas_atendidas || [],
      integracoes: varianteAtiva.integracoes || linha.integracoes || [],
      itinerario_ruas: varianteAtiva.itinerario_ruas || linha.itinerario_ruas || null,
      bbox: varianteAtiva.bbox || linha.bbox,
      dia_ativo_codigo: varianteAtiva.dia_semana || diaSemana,
      dia_ativo_rotulo: varianteAtiva.dia_rotulo || 'Dias úteis e sábados'
    };
  }

  function obterLinhaPorId(idOuNumero, diaSemana = 'dias_uteis_sabados') {
    const chave = String(idOuNumero || '').toUpperCase().trim();
    const encontrada = (estado.indice?.linhas || []).find(
      l => String(l.id).toUpperCase() === chave || String(l.numero).toUpperCase() === chave
    );
    return encontrada ? obterDadosLinhaNoDia(encontrada, diaSemana) : null;
  }

  /**
   * Retorna paradas filtradas pelo dia da semana selecionado.
   * Por padrão retorna apenas paradas com `ativo !== false`.
   */
  function obterParadasPorDia(diaSemana = 'dias_uteis_sabados', opcoes = {}) {
    const { incluirInativas = false, incluirVirtuaisNoMapa = false } = opcoes;
    const todas = estado.paradas?.features || [];

    return todas.filter(f => {
      const p = f.properties || {};
      if (!incluirInativas && p.ativo === false) return false;
      if (!incluirVirtuaisNoMapa && p.origem === 'virtual') return false;
      if (diaSemana === 'todos') return true;
      const dias = p.dias_semana;
      if (!Array.isArray(dias) || dias.length === 0) return true;
      return dias.includes(diaSemana) || dias.includes('todos');
    });
  }

  function obterParadaPorId(idParada) {
    return (estado.paradas?.features || []).find(
      f => String(f.properties?.id).toUpperCase() === String(idParada).toUpperCase()
    ) || null;
  }

  /**
   * Calcula as 3 a 5 paradas/terminais mais próximos de uma coordenada (lat, lng)
   * considerando o dia da semana selecionado.
   */
  function buscarParadasMaisProximas(lat, lng, diaSemana = 'dias_uteis_sabados', limite = 5) {
    const paradasDia = obterParadasPorDia(diaSemana);
    const calculadas = paradasDia.map(feat => {
      const [pLng, pLat] = feat.geometry.coordinates;
      const caminhada = window.BuzuUtils.calcularCaminhada(lat, lng, pLat, pLng);
      const props = feat.properties || {};

      // Texto de sentido seguindo regra estrita: nunca inventar sentido
      let textoSentido = 'Atende os dois sentidos';
      if (props.sentidos_atendidos === 'ida') {
        textoSentido = 'Ponto de integração (sentido ida)';
      } else if (props.sentidos_atendidos === 'volta') {
        textoSentido = 'Ponto de integração (sentido volta)';
      }

      return {
        feature: feat,
        id: props.id,
        nome: props.nome,
        tipo: props.tipo || 'parada',
        acessivel: props.acessivel || 'sim',
        rotas: props.rotas || [],
        dia_rotulo: props.dia_rotulo || 'Todos os dias',
        sentidos_atendidos: props.sentidos_atendidos || 'ambos',
        textoSentido,
        integracoes_descricao: props.integracoes_descricao || [],
        lat: pLat,
        lng: pLng,
        ...caminhada
      };
    });

    calculadas.sort((a, b) => a.distanciaPeMetros - b.distanciaPeMetros);
    return calculadas.slice(0, limite);
  }

  /**
   * Busca síncrona na base local (paradas/terminais + bairros/CEPs de Natal).
   * Usada para exibir sugestões instantâneas enquanto o Nominatim responde.
   */
  function buscarSugestoesEnderecoLocal(consulta) {
    const qNorm = window.BuzuUtils.normalizarTexto(consulta);
    if (!qNorm || qNorm.length < 2) return [];

    const resultados = [];

    // 1. Paradas e terminais cadastrados
    // (só paradas em uso por alguma linha; no máximo 4, terminais primeiro)
    const paradasAchadas = [];
    for (const f of estado.paradas?.features || []) {
      const p = f.properties || {};
      if (p.ativo === false || !(p.rotas || []).length) continue;
      const textoParada = window.BuzuUtils.normalizarTexto(`${p.nome} ${p.bairro || ''} ${p.tipo}`);
      if (textoParada.includes(qNorm)) {
        const linhas = p.rotas.slice(0, 6).join(', ') + (p.rotas.length > 6 ? ` +${p.rotas.length - 6}` : '');
        paradasAchadas.push({
          titulo: p.nome,
          subtitulo: [/terminal/i.test(p.tipo) ? 'Terminal' : 'Parada', p.bairro, `Linhas: ${linhas}`].filter(Boolean).join(' • '),
          lat: f.geometry.coordinates[1],
          lng: f.geometry.coordinates[0],
          origem: 'Parada atendida',
          terminal: /terminal|integra/i.test(p.tipo)
        });
      }
    }
    paradasAchadas.sort((a, b) => Number(b.terminal) - Number(a.terminal));
    resultados.push(...paradasAchadas.slice(0, 4));

    // 2. Bairros, CEPs e referências de Natal
    for (const local of estado.locaisNatal) {
      const textoLocal = window.BuzuUtils.normalizarTexto(
        `${local.nome} ${local.bairro} ${local.cep}`
      );
      if (textoLocal.includes(qNorm)) {
        resultados.push({
          titulo: local.nome,
          subtitulo: `${local.bairro} • CEP ${local.cep} (${local.tipo})`,
          lat: local.lat,
          lng: local.lng,
          origem: 'Base Natal'
        });
      }
    }

    return resultados;
  }

  /**
   * Busca de endereço / CEP / bairro / ponto de referência (local + Nominatim OSM)
   */
  // Região metropolitana (Natal + bairros de divisa dos municípios vizinhos)
  const VIEWBOX_METROPOLITANA = '-35.45,-5.60,-35.10,-6.05';
  const RAIO_ATENDIMENTO_M = 2000;

  /**
   * Área de atendimento: a até 2 km de alguma parada em uso — em qualquer município.
   * (Bairros de divisa dos municípios vizinhos também são atendidos por linhas de Natal.)
   */
  let gradeAtendimento = null;
  function estaNaAreaDeAtendimento(lat, lng) {
    if (!gradeAtendimento) {
      gradeAtendimento = new Set();
      for (const f of estado.paradas?.features || []) {
        if (f.properties?.ativo === false) continue;
        const [x, y] = f.geometry.coordinates;
        gradeAtendimento.add(`${Math.floor(x / 0.01)}|${Math.floor(y / 0.01)}`);
      }
      if (gradeAtendimento.size === 0) gradeAtendimento = null;
    }
    if (!gradeAtendimento) return window.BuzuUtils.estaNaAreaDeNatal(lat, lng);
    const cx = Math.floor(lng / 0.01);
    const cy = Math.floor(lat / 0.01);
    let candidato = false;
    for (let dx = -2; dx <= 2 && !candidato; dx++) {
      for (let dy = -2; dy <= 2 && !candidato; dy++) {
        if (gradeAtendimento.has(`${cx + dx}|${cy + dy}`)) candidato = true;
      }
    }
    if (!candidato) return false;
    for (const f of estado.paradas?.features || []) {
      if (f.properties?.ativo === false) continue;
      const [x, y] = f.geometry.coordinates;
      if (Math.abs(x - lng) > 0.02 || Math.abs(y - lat) > 0.02) continue;
      if (window.BuzuUtils.calcularDistanciaGeodesica(lat, lng, y, x) <= RAIO_ATENDIMENTO_M) return true;
    }
    return false;
  }

  /** "Rua, Bairro — Município" (o município só aparece quando não é Natal) */
  function descreverEnderecoOsm(item) {
    const a = item.address || {};
    const local = item.name || a.road || a.pedestrian || item.display_name.split(',')[0];
    const rua = a.road && a.road !== local ? a.road : null;
    const bairro = a.suburb || a.neighbourhood || a.quarter || a.city_district || null;
    const municipio = a.city || a.town || a.municipality || a.village || null;
    const partes = [local, rua, bairro].filter(Boolean);
    const foraDeNatal = municipio && municipio !== 'Natal';
    return {
      titulo: partes.slice(0, 2).join(', ') + (foraDeNatal ? ` — ${municipio}` : ''),
      subtitulo: [bairro, municipio].filter(Boolean).join(' • ') || item.display_name,
      municipio: municipio || null
    };
  }

  async function buscarSugestoesEndereco(consulta) {
    const qNorm = window.BuzuUtils.normalizarTexto(consulta);
    if (!qNorm || qNorm.length < 2) return [];

    if (cacheSugestoesEndereco.has(qNorm)) {
      return cacheSugestoesEndereco.get(qNorm);
    }

    const resultados = buscarSugestoesEnderecoLocal(consulta);

    // 3. Complementa com o geocodificador público do OpenStreetMap (Nominatim) em toda a região
    // metropolitana — inclui bairros de divisa de São Gonçalo do Amarante, Parnamirim, Macaíba e
    // Extremoz. Só entram endereços dentro da área de atendimento (perto de alguma parada atendida).
    let consultaOnlineOk = consulta.trim().length < 3;
    if (consulta.trim().length >= 3) {
      const texto = consulta.trim();
      const variantes = [
        { q: texto, extra: `&viewbox=${VIEWBOX_METROPOLITANA}&bounded=1` },
        // o Nominatim às vezes só acha a rua quando a cidade está no texto
        { q: `${texto}, Natal`, extra: `&viewbox=${VIEWBOX_METROPOLITANA}&bounded=0` }
      ];
      const vistos = new Set(resultados.map(r => `${r.lat.toFixed(4)}|${r.lng.toFixed(4)}`));
      let encontrados = 0;
      for (const v of variantes) {
        if (encontrados >= 3) break;
        let timerAbort = null;
        let itensOsm = [];
        try {
          const url = `https://nominatim.openstreetmap.org/search?format=json&limit=8&countrycodes=br&addressdetails=1${v.extra}&q=${encodeURIComponent(v.q)}`;
          const controlador = typeof AbortController !== 'undefined' ? new AbortController() : null;
          if (controlador) timerAbort = setTimeout(() => controlador.abort(), 4000);
          const res = await fetch(url, {
            headers: { 'Accept-Language': 'pt-BR' },
            signal: controlador ? controlador.signal : undefined
          });
          if (!res.ok) continue;
          itensOsm = await res.json();
          consultaOnlineOk = true;
        } catch (_e) {
          // Se 3G falhar ou offline, os resultados locais continuam funcionando
          continue;
        } finally {
          if (timerAbort) clearTimeout(timerAbort);
        }
        for (const item of itensOsm) {
          const lat = parseFloat(item.lat);
          const lng = parseFloat(item.lon);
          const chave = `${lat.toFixed(4)}|${lng.toFixed(4)}`;
          if (vistos.has(chave) || !estaNaAreaDeAtendimento(lat, lng)) continue;
          vistos.add(chave);
          encontrados++;
          resultados.push({ ...descreverEnderecoOsm(item), lat, lng, origem: 'OpenStreetMap' });
        }
      }
    }

    const resultadoFinal = resultados.slice(0, 7);
    // só guarda em cache quando a consulta online respondeu (falha de rede não vira "sem resultado")
    if (consultaOnlineOk || resultadoFinal.length > 0) cacheSugestoesEndereco.set(qNorm, resultadoFinal);

    if (cacheSugestoesEndereco.size > 60) {
      const primeiraChave = cacheSugestoesEndereco.keys().next().value;
      cacheSugestoesEndereco.delete(primeiraChave);
    }

    return resultadoFinal;
  }

  /**
   * Retorna a parada/terminal mais próxima de um ponto (lat/lng) dentro de uma lista de feições.
   */
  function obterParadaMaisProximaDoPonto(ponto, paradasFeatures) {
    let melhor = null;

    for (const feat of paradasFeatures || []) {
      if (!feat.geometry || feat.geometry.type !== 'Point') continue;
      const [lng, lat] = feat.geometry.coordinates;
      const caminhada = window.BuzuUtils.calcularCaminhada(ponto.lat, ponto.lng, lat, lng);
      if (!melhor || caminhada.distanciaPeMetros < melhor.distanciaPeMetros) {
        const props = feat.properties || {};
        melhor = {
          id: props.id,
          nome: props.nome || 'Parada',
          tipo: props.tipo || 'parada',
          dia_rotulo: props.dia_rotulo || 'Todos os dias',
          rotas: props.rotas || [],
          lat,
          lng,
          distanciaPeMetros: caminhada.distanciaPeMetros,
          tempoMinutos: caminhada.tempoMinutos
        };
      }
    }

    return melhor;
  }

  /**
   * Cria um ponto "virtual" sobre o traçado quando a base não possui parada oficial
   * naquele dia de operação, para não impedir o cálculo do trajeto.
   */
  function criarPontoSobreTracado(projecao, rotulo) {
    const distanciaPeMetros = Math.round(projecao.distanciaMetros * 1.3);
    return {
      id: null,
      nome: rotulo,
      tipo: 'ponto no traçado',
      lat: projecao.lat,
      lng: projecao.lng,
      distanciaPeMetros,
      tempoMinutos: Math.max(1, Math.round(distanciaPeMetros / 75)),
      sobreTracado: true
    };
  }

  /**
   * Distância percorrida sobre o traçado da linha entre duas posições acumuladas.
   * Como os traçados propostos são circuitos fechados, usa o menor arco entre os pontos.
   */
  function calcularTrechoEntrePosicoes(infoLinha, posicaoA, posicaoB) {
    const acumulado = infoLinha.comprimentoAcumulado;
    if (!acumulado || acumulado.length < 2) return null;

    const total = acumulado[acumulado.length - 1];
    const diferenca = Math.abs(posicaoA - posicaoB);
    return Math.round(Math.min(diferenca, total - diferenca));
  }

  /**
   * Projeta uma coordenada no traçado e devolve também a posição acumulada (metros).
   */
  function calcularPosicaoNaLinha(infoLinha, lat, lng) {
    if (!infoLinha.comprimentoAcumulado) {
      infoLinha.comprimentoAcumulado = window.BuzuUtils.calcularComprimentoAcumulado(infoLinha.coords);
    }

    const projecao = window.BuzuUtils.projetarPontoNaPolilinha(lat, lng, infoLinha.coords);
    if (!projecao) return null;

    return {
      projecao,
      posicao: window.BuzuUtils.posicaoNaPolilinha(infoLinha.comprimentoAcumulado, projecao)
    };
  }

  /**
   * Define o ponto de acesso (embarque/desembarque) a uma linha.
   * Usa a parada oficial mais próxima quando ela é competitiva; caso contrário,
   * projeta o endereço diretamente sobre o traçado da linha.
   */
  function calcularAcessoLinha(infoLinha, ponto, limiteCaminhadaMetros, rotuloVirtual) {
    const posicaoProjetada = calcularPosicaoNaLinha(infoLinha, ponto.lat, ponto.lng);
    if (!posicaoProjetada) return null;

    const acessoVirtual = {
      ...criarPontoSobreTracado(posicaoProjetada.projecao, rotuloVirtual),
      posicao: posicaoProjetada.posicao,
      posicaoVirtual: posicaoProjetada.posicao,
      projecaoVirtual: posicaoProjetada.projecao,
      sobreTracado: true
    };

    const paradaOficial = obterParadaMaisProximaDoPonto(ponto, infoLinha.paradas);
    let acesso = acessoVirtual;

    if (paradaOficial && paradaOficial.distanciaPeMetros <= limiteCaminhadaMetros) {
      const posicaoOficial = calcularPosicaoNaLinha(infoLinha, paradaOficial.lat, paradaOficial.lng);
      const totalTracado = infoLinha.comprimentoAcumulado[infoLinha.comprimentoAcumulado.length - 1];
      const diferencaPosicao = posicaoOficial
        ? Math.abs(posicaoOficial.posicao - posicaoProjetada.posicao)
        : Infinity;
      const distanciaCircular = Math.min(diferencaPosicao, totalTracado - diferencaPosicao);
      const pontoProximoDoTracado = acessoVirtual.distanciaPeMetros <= 600;
      const oficialNaMesmaRegiao = distanciaCircular <= 800;

      const acessoOficialVale =
        posicaoOficial &&
        !(acessoVirtual.distanciaPeMetros + 150 < paradaOficial.distanciaPeMetros) &&
        (!pontoProximoDoTracado || oficialNaMesmaRegiao);

      if (acessoOficialVale) {
        acesso = {
          ...paradaOficial,
          posicao: posicaoOficial.posicao,
          posicaoVirtual: posicaoProjetada.posicao,
          projecaoVirtual: posicaoProjetada.projecao,
          sobreTracado: false
        };
      }
    }

    if (acesso.distanciaPeMetros > limiteCaminhadaMetros) return null;
    return acesso;
  }

  // =========================================================================
  // MOTOR DE GRAFO DIJKSTRA + TABELA PIVOT `linha_paradas` + GATILHO DE RECÁLCULO
  // =========================================================================
  const LIMITE_CAMINHADA_PADRAO_METROS = 1200; // 1,2 km máximo de caminhada até a parada
  const VELOCIDADE_CAMINHADA_M_S = 1.2; // 1,2 m/s (~4,32 km/h = 72 m/min)
  const FATOR_DESCONFORTO_CAMINHADA = 1.3; // 300m custam ~5,4 min; 1,2 km custam ~21,6 min
  const PENALIDADE_BALDEACAO_MIN = 7.0; // Penalidade fixa de troca de ônibus (~6 a 8 min)
  const VELOCIDADE_ONIBUS_M_MIN = 333.3; // ~20 km/h em operação urbana
  const RAIO_RECALCULO_LINHA_METROS = 40; // Raio de vínculo automático parada <-> linha

  function custoCaminhadaMinutos(distanciaMetros) {
    const tempoRealMin = distanciaMetros / (VELOCIDADE_CAMINHADA_M_S * 60);
    return Number((tempoRealMin * FATOR_DESCONFORTO_CAMINHADA).toFixed(2));
  }

  function tempoRealCaminhadaMinutos(distanciaMetros) {
    return Math.max(1, Math.round(distanciaMetros / (VELOCIDADE_CAMINHADA_M_S * 60)));
  }

  /**
   * Constrói ou retorna do cache o grafo direcionado em memória para o dia da semana:
   * - Nós de parada física: `P:<parada_id>`
   * - Nós embarcados na linha/sentido: `L:<linha_id>:<sentido>:<parada_id>`
   * Arestas:
   * 1. Embarque: `P:<parada_id>` -> `L:<linha_id>:<sentido>:<parada_id>` (custo: 0 no primeiro embarque, +7 min se veio de outro ônibus)
   * 2. Viagem no ônibus: `L:<linha_id>:<sentido>:<p_i>` -> `L:<linha_id>:<sentido>:<p_{i+1}>` (custo: deltaDist / 333.3 min)
   * 3. Desembarque / Transbordo: `L:<linha_id>:<sentido>:<parada_id>` -> `P:<parada_id>` (custo: 0; a penalidade de 7 min fica na troca/reembarque)
   * 4. Caminhada curta de conexão entre paradas vizinhas (<= 90m): `P:<p1>` -> `P:<p2>` (custo caminhada com fator 1.3x)
   */
  function obterOuConstruirGrafoDijkstra(diaSemana = 'dias_uteis_sabados') {
    const chaveDia = diaSemana === 'todos' ? 'dias_uteis_sabados' : diaSemana;
    if (estado.grafoMemoria[chaveDia]) {
      return estado.grafoMemoria[chaveDia];
    }

    const paradasAtivas = new Map();
    for (const feat of estado.paradas?.features || []) {
      const p = feat.properties || {};
      if (p.ativo === false) continue;
      paradasAtivas.set(String(p.id), {
        id: String(p.id),
        nome: p.nome || 'Parada',
        tipo: p.tipo || 'parada',
        origem: p.origem || 'manual',
        sentidos_atendidos: (p.sentidos_atendidos || 'AMBOS').toUpperCase(),
        lat: feat.geometry.coordinates[1],
        lng: feat.geometry.coordinates[0]
      });
    }

    // Filtra vínculos linha_paradas do dia operacional
    const pivotesDia = (estado.linhaParadas || []).filter(
      lp =>
        paradasAtivas.has(String(lp.parada_id)) &&
        (!lp.dia_semana || lp.dia_semana === 'todos' || lp.dia_semana === chaveDia)
    );

    // Agrupa por chave `${linha_id}|${sentido}` ordenado por `ordem_sequencial`
    const sequenciasPorLinhaSentido = new Map();
    for (const item of pivotesDia) {
      const ch = `${item.linha_id}|${item.sentido}`;
      if (!sequenciasPorLinhaSentido.has(ch)) {
        sequenciasPorLinhaSentido.set(ch, []);
      }
      sequenciasPorLinhaSentido.get(ch).push(item);
    }

    const adjacencia = new Map(); // noId -> Array<{ destino, custoMin, distanciaMetros, tipoAresta, linhaId, sentido, paradaId }>
    const adicionarAresta = (origemNo, aresta) => {
      if (!adjacencia.has(origemNo)) adjacencia.set(origemNo, []);
      adjacencia.get(origemNo).push(aresta);
    };

    for (const [ch, lista] of sequenciasPorLinhaSentido.entries()) {
      lista.sort((a, b) => a.ordem_sequencial - b.ordem_sequencial);
      const [linhaId, sentido] = ch.split('|');

      for (let i = 0; i < lista.length; i++) {
        const atual = lista[i];
        const noParada = `P:${atual.parada_id}`;
        const noEmbarcado = `L:${linhaId}:${sentido}:${atual.parada_id}`;

        // Embarque na parada (a penalidade de baldeação de 7 min é aplicada quando já se utilizou um ônibus antes)
        adicionarAresta(noParada, {
          destino: noEmbarcado,
          custoMin: 0,
          distanciaMetros: 0,
          tipoAresta: 'embarque',
          linhaId,
          sentido,
          paradaId: String(atual.parada_id)
        });

        // Desembarque na parada (aplica penalidade de baldeação de 7 min caso o passageiro pegue outro ônibus em seguida)
        adicionarAresta(noEmbarcado, {
          destino: noParada,
          custoMin: PENALIDADE_BALDEACAO_MIN,
          distanciaMetros: 0,
          tipoAresta: 'baldeacao_desembarque',
          linhaId,
          sentido,
          paradaId: String(atual.parada_id)
        });

        // Deslocamento dentro do ônibus até a próxima parada da sequência
        if (i + 1 < lista.length) {
          const prox = lista[i + 1];
          const noProxEmbarcado = `L:${linhaId}:${sentido}:${prox.parada_id}`;
          const deltaMetros = Math.max(
            30,
            (prox.distancia_acumulada_metros || 0) - (atual.distancia_acumulada_metros || 0)
          );
          const tempoOnibusMin = Number((deltaMetros / VELOCIDADE_ONIBUS_M_MIN).toFixed(2));

          adicionarAresta(noEmbarcado, {
            destino: noProxEmbarcado,
            custoMin: tempoOnibusMin,
            distanciaMetros: deltaMetros,
            tipoAresta: 'onibus',
            linhaId,
            sentido,
            paradaId: String(prox.parada_id)
          });
        }
      }
    }

    // Conexão a pé curta (<= 85m) entre paradas vizinhas (ex: integração no mesmo cruzamento sem atravessar longe)
    const listaParadasArr = Array.from(paradasAtivas.values());
    for (let i = 0; i < listaParadasArr.length; i++) {
      const pA = listaParadasArr[i];
      for (let j = i + 1; j < listaParadasArr.length; j++) {
        const pB = listaParadasArr[j];
        if (Math.abs(pA.lat - pB.lat) > 0.0008 || Math.abs(pA.lng - pB.lng) > 0.0008) continue;
        const distGeo = window.BuzuUtils.calcularDistanciaGeodesica(pA.lat, pA.lng, pB.lat, pB.lng);
        if (distGeo <= 85) {
          const distPe = Math.round(distGeo * 1.3);
          const custoPe = custoCaminhadaMinutos(distPe);
          adicionarAresta(`P:${pA.id}`, {
            destino: `P:${pB.id}`,
            custoMin: custoPe,
            distanciaMetros: distPe,
            tipoAresta: 'caminhada_conexao',
            paradaId: pB.id
          });
          adicionarAresta(`P:${pB.id}`, {
            destino: `P:${pA.id}`,
            custoMin: custoPe,
            distanciaMetros: distPe,
            tipoAresta: 'caminhada_conexao',
            paradaId: pA.id
          });
        }
      }
    }

    const grafo = { parAtivas: paradasAtivas, adjacencia };
    estado.grafoMemoria[chaveDia] = grafo;
    return grafo;
  }

  /**
   * Executa o roteamento por Dijkstra sobre a tabela `paradas` + `linha_paradas`
   * respeitando estritamente:
   * - Limite máximo de caminhada até a parada: 1,2 km (1200 m)
   * - Peso da caminhada: 1,2 m/s + fator de desconforto 1.3x (300m = 5,4 min; 1,2 km = 21,6 min)
   * - Penalidade de baldeação: 7 min (~6 a 8 min)
   */
  function executarDijkstraViagem(
    origem,
    destino,
    diaSemana,
    limiteCaminhadaMetros = LIMITE_CAMINHADA_PADRAO_METROS,
    maxBaldeacoes = 3,
    linhaPermitida = () => true
  ) {
    const grafo = obterOuConstruirGrafoDijkstra(diaSemana);
    const { parAtivas, adjacencia } = grafo;
    if (parAtivas.size === 0 || adjacencia.size === 0) return [];

    // 1. Encontra paradas de embarque inicial num raio de até 1,2 km (1200m de caminhada)
    const paradasOrigem = [];
    const paradasDestino = new Map();

    for (const p of parAtivas.values()) {
      const camOrig = window.BuzuUtils.calcularCaminhada(origem.lat, origem.lng, p.lat, p.lng);
      if (camOrig.distanciaPeMetros <= limiteCaminhadaMetros) {
        paradasOrigem.push({
          parada: p,
          distanciaPeMetros: camOrig.distanciaPeMetros,
          tempoRealMin: tempoRealCaminhadaMinutos(camOrig.distanciaPeMetros),
          custoDijkstraMin: custoCaminhadaMinutos(camOrig.distanciaPeMetros)
        });
      }

      const camDest = window.BuzuUtils.calcularCaminhada(p.lat, p.lng, destino.lat, destino.lng);
      if (camDest.distanciaPeMetros <= limiteCaminhadaMetros) {
        paradasDestino.set(p.id, {
          parada: p,
          distanciaPeMetros: camDest.distanciaPeMetros,
          tempoRealMin: tempoRealCaminhadaMinutos(camDest.distanciaPeMetros),
          custoDijkstraMin: custoCaminhadaMinutos(camDest.distanciaPeMetros)
        });
      }
    }

    if (paradasOrigem.length === 0 || paradasDestino.size === 0) return [];

    // 2. Dijkstra multi-origem em camadas de baldeação (0..maxBaldeacoes)
    // Estado indexado por `${no}|B${baldeacoes}` para encontrar ótimos de 0, 1, 2 e 3 transferências!
    const dist = new Map();
    const prev = new Map();
    const heap = [];
    const pushHeap = item => {
      heap.push(item);
      let i = heap.length - 1;
      while (i > 0) {
        const pai = (i - 1) >> 1;
        if (heap[pai].custo <= heap[i].custo) break;
        [heap[pai], heap[i]] = [heap[i], heap[pai]];
        i = pai;
      }
    };
    const popHeap = () => {
      if (heap.length === 0) return null;
      const topo = heap[0];
      const ult = heap.pop();
      if (heap.length > 0) {
        heap[0] = ult;
        let i = 0;
        while (true) {
          let menor = i;
          const esq = 2 * i + 1;
          const dir = 2 * i + 2;
          if (esq < heap.length && heap[esq].custo < heap[menor].custo) menor = esq;
          if (dir < heap.length && heap[dir].custo < heap[menor].custo) menor = dir;
          if (menor === i) break;
          [heap[i], heap[menor]] = [heap[menor], heap[i]];
          i = menor;
        }
      }
      return topo;
    };

    for (const po of paradasOrigem) {
      const noInicial = `P:${po.parada.id}`;
      const chEstado = `${noInicial}|B0`;
      dist.set(chEstado, po.custoDijkstraMin);
      prev.set(chEstado, { anterior: null, aresta: null, acessoOrigem: po, no: noInicial });
      pushHeap({ chEstado, no: noInicial, custo: po.custoDijkstraMin, baldeacoes: 0 });
    }

    const solucoesPorAssinatura = new Map();

    while (heap.length > 0) {
      const atual = popHeap();
      if (!atual) break;
      const { chEstado, no, custo, baldeacoes } = atual;

      if (custo > (dist.get(chEstado) ?? Infinity)) continue;
      if (baldeacoes > maxBaldeacoes) continue;

      if (no.startsWith('L:')) {
        const partes = no.split(':');
        const paradaIdAtual = partes.slice(3).join(':');
        const infoDest = paradasDestino.get(paradaIdAtual);
        if (infoDest) {
          const custoTotal = custo + infoDest.custoDijkstraMin;
          reconstruirERegistrarSolucaoDijkstra(
            chEstado,
            infoDest,
            custoTotal,
            prev,
            parAtivas,
            diaSemana,
            solucoesPorAssinatura
          );
        }
      }

      const vizinhos = adjacencia.get(no) || [];
      for (const aresta of vizinhos) {
        // Não embarca em linhas fora de operação no horário da viagem (ex.: Corujão durante o dia)
        if (aresta.tipoAresta === 'embarque' && !linhaPermitida(aresta.linhaId)) continue;
        const novasBaldeacoes =
          aresta.tipoAresta === 'baldeacao_desembarque' ? baldeacoes + 1 : baldeacoes;
        if (novasBaldeacoes > maxBaldeacoes) continue;

        const proxChEstado = `${aresta.destino}|B${novasBaldeacoes}`;
        const novoCusto = custo + aresta.custoMin;
        if (novoCusto < (dist.get(proxChEstado) ?? Infinity)) {
          dist.set(proxChEstado, novoCusto);
          prev.set(proxChEstado, { anterior: chEstado, aresta, no: aresta.destino });
          pushHeap({
            chEstado: proxChEstado,
            no: aresta.destino,
            custo: novoCusto,
            baldeacoes: novasBaldeacoes
          });
        }
      }
    }

    return Array.from(solucoesPorAssinatura.values()).sort(
      (a, b) => a.custoDijkstraMin - b.custoDijkstraMin
    );
  }

  function reconstruirERegistrarSolucaoDijkstra(
    chEstadoFinal,
    infoDest,
    custoTotalMin,
    prev,
    parAtivas,
    diaSemana,
    solucoesPorAssinatura
  ) {
    const passosNos = [];
    let cursor = chEstadoFinal;
    let acessoOrigem = null;

    while (cursor) {
      const reg = prev.get(cursor);
      if (!reg) break;
      if (reg.acessoOrigem) {
        acessoOrigem = reg.acessoOrigem;
      }
      if (reg.aresta) {
        passosNos.push({ no: reg.no, aresta: reg.aresta });
      }
      cursor = reg.anterior;
    }

    if (!acessoOrigem || passosNos.length === 0) return;
    passosNos.reverse();

    // Agrupa os trechos de ônibus percorridos (1 a N ônibus)
    const trechosOnibus = [];
    let trechoAtual = null;

    for (const p of passosNos) {
      const a = p.aresta;
      if (a.tipoAresta === 'embarque') {
        const pEmb = parAtivas.get(a.paradaId);
        trechoAtual = {
          numero: a.linhaId,
          sentido: a.sentido,
          paradaEmbarqueId: a.paradaId,
          paradaEmbarqueNome: pEmb ? pEmb.nome : 'Parada de embarque',
          paradaDesembarqueId: a.paradaId,
          paradaDesembarqueNome: pEmb ? pEmb.nome : 'Parada de desembarque',
          embarqueCoord: pEmb ? { lat: pEmb.lat, lng: pEmb.lng } : null,
          desembarqueCoord: pEmb ? { lat: pEmb.lat, lng: pEmb.lng } : null,
          distanciaMetros: 0
        };
        trechosOnibus.push(trechoAtual);
      } else if (a.tipoAresta === 'onibus' && trechoAtual) {
        trechoAtual.distanciaMetros += a.distanciaMetros;
        trechoAtual.paradaDesembarqueId = a.paradaId;
        const pDes = parAtivas.get(a.paradaId);
        if (pDes) {
          trechoAtual.paradaDesembarqueNome = pDes.nome;
          trechoAtual.desembarqueCoord = { lat: pDes.lat, lng: pDes.lng };
        }
      }
    }

    // Filtra viagens degeneradas (trecho de ônibus < 200m ou embarcar na mesma linha mais de uma vez)
    if (trechosOnibus.length === 0) return;
    if (trechosOnibus.some(t => t.distanciaMetros < 200)) return;
    const linhasDistintas = new Set(trechosOnibus.map(t => t.numero));
    if (linhasDistintas.size !== trechosOnibus.length) return;

    const assinatura = trechosOnibus.map(t => `${t.numero}(${t.sentido})`).join('>');
    const existente = solucoesPorAssinatura.get(assinatura);
    if (existente && existente.custoDijkstraMin <= custoTotalMin) return;

    const paradaEmbarque = parAtivas.get(trechosOnibus[0].paradaEmbarqueId) || acessoOrigem.parada;
    const paradaDesembarque =
      parAtivas.get(trechosOnibus[trechosOnibus.length - 1].paradaDesembarqueId) || infoDest.parada;

    const linhasObjs = trechosOnibus.map(t => {
      const meta = obterLinhaPorId(t.numero, diaSemana) || {};
      return {
        numero: t.numero,
        sentido: t.sentido,
        nome: meta.nome || `Linha ${t.numero}`,
        cor: meta.cor || '#162652',
        lote: meta.lote || '1',
        categoria_edital: meta.categoria_edital || 'Convencional',
        dia_rotulo: meta.dia_ativo_rotulo || 'Dias úteis e sábados'
      };
    });

    const distanciaTrechoMetros = trechosOnibus.reduce((s, t) => s + t.distanciaMetros, 0);
    const totalMetros =
      acessoOrigem.distanciaPeMetros + distanciaTrechoMetros + infoDest.distanciaPeMetros;

    // Coleta TODOS os pontos de transferência (1, 2 ou 3 baldeações)
    const transferencias = [];
    for (let i = 0; i < trechosOnibus.length - 1; i++) {
      const pTrans = parAtivas.get(trechosOnibus[i].paradaDesembarqueId);
      if (pTrans) {
        transferencias.push({
          id: pTrans.id,
          nome: pTrans.nome,
          tipo: pTrans.tipo,
          lat: pTrans.lat,
          lng: pTrans.lng,
          ordem: i + 1
        });
      }
    }

    const numTransferencias = Math.max(0, trechosOnibus.length - 1);

    solucoesPorAssinatura.set(assinatura, {
      tipo: numTransferencias === 0 ? 'direta' : 'transferencia',
      numTransferencias,
      custoDijkstraMin: Number(custoTotalMin.toFixed(1)),
      totalMetros: Math.round(totalMetros),
      distanciaTrechoMetros: Math.round(distanciaTrechoMetros),
      acessoEmbarqueMetros: acessoOrigem.distanciaPeMetros,
      acessoDesembarqueMetros: infoDest.distanciaPeMetros,
      acessoMaximoMetros: Math.max(acessoOrigem.distanciaPeMetros, infoDest.distanciaPeMetros),
      embarque: {
        id: paradaEmbarque.id,
        nome: `${paradaEmbarque.nome} (${trechosOnibus[0].sentido})`,
        tipo: paradaEmbarque.tipo,
        lat: paradaEmbarque.lat,
        lng: paradaEmbarque.lng,
        distanciaPeMetros: acessoOrigem.distanciaPeMetros,
        tempoMinutos: acessoOrigem.tempoRealMin
      },
      transferencia: transferencias[0] || null,
      transferencias,
      desembarque: {
        id: paradaDesembarque.id,
        nome: paradaDesembarque.nome,
        tipo: paradaDesembarque.tipo,
        lat: paradaDesembarque.lat,
        lng: paradaDesembarque.lng,
        distanciaPeMetros: infoDest.distanciaPeMetros,
        tempoMinutos: infoDest.tempoRealMin
      },
      trechos: trechosOnibus,
      linhas: linhasObjs
    });
  }

  /**
   * Calcula as melhores linhas para um trajeto "De → Para".
   * Prioriza o Grafo Dijkstra com a tabela pivot `linha_paradas` (limite 1,2 km de caminhada,
   * velocidade 1,2 m/s + desconforto 1.3x, penalidade de baldeação de 7 min).
   */
  // ---------------------------------------------------------------------------
  // "Como chegar": recorta do traçado da linha só o trecho que o passageiro percorre
  // ---------------------------------------------------------------------------

  /** Distância (m) de um ponto a cada segmento da polilinha [lng, lat] */
  function distanciasAosSegmentos(coords, lat, lng) {
    const kx = 111320 * Math.cos((lat * Math.PI) / 180);
    const ky = 110540;
    const out = [];
    for (let i = 0; i < coords.length - 1; i++) {
      const ax = (coords[i][0] - lng) * kx, ay = (coords[i][1] - lat) * ky;
      const bx = (coords[i + 1][0] - lng) * kx, by = (coords[i + 1][1] - lat) * ky;
      const dx = bx - ax, dy = by - ay;
      const L2 = dx * dx + dy * dy || 1e-9;
      const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L2));
      out.push({
        i,
        t,
        d: Math.hypot(ax + t * dx, ay + t * dy),
        ponto: [coords[i][0] + (coords[i + 1][0] - coords[i][0]) * t, coords[i][1] + (coords[i + 1][1] - coords[i][1]) * t]
      });
    }
    return out;
  }

  /**
   * Trecho do traçado entre o embarque A e o desembarque B, NO SENTIDO DE CIRCULAÇÃO
   * (a ordem dos pontos do traçado é a ordem em que o ônibus passa; o traçado é um laço ida+volta).
   * Testa os pontos do traçado próximos de A e, para cada um, segue em frente até chegar perto de B;
   * fica com o menor percurso. Assim a ida e a volta nunca se misturam.
   */
  function recortarTrechoNoSentido(coords, a, b) {
    const n = coords.length;
    if (n < 2) return null;
    const segsA = distanciasAosSegmentos(coords, a.lat, a.lng);
    const segsB = distanciasAosSegmentos(coords, b.lat, b.lng);
    const LIMITE = 120; // metros entre a parada e o traçado
    const minA = Math.min(...segsA.map(s => s.d));
    const minB = Math.min(...segsB.map(s => s.d));
    const candidatosA = segsA.filter(s => s.d <= Math.max(LIMITE, minA + 15));
    const ehAlvoB = s => s.d <= Math.max(LIMITE, minB + 15);
    const fechado = Math.hypot(coords[0][0] - coords[n - 1][0], coords[0][1] - coords[n - 1][1]) < 0.0005;

    let melhor = null;
    for (const ca of candidatosA) {
      let comprimento = 0;
      // percorre para a frente a partir de A (dando a volta no laço, se o traçado for fechado)
      const limitePassos = fechado ? n - 1 : n - 1 - ca.i;
      for (let passo = 0; passo < limitePassos; passo++) {
        const idx = (ca.i + passo) % (n - 1);
        const sb = segsB[idx];
        const mesmoSegmento = passo === 0;
        if (ehAlvoB(sb) && (!mesmoSegmento || sb.t >= ca.t)) {
          // pontuação: percurso + penalidade por "encostar" longe das paradas (evita cortar caminho)
          const pontuacao = comprimento + 6 * (ca.d + sb.d);
          if (!melhor || pontuacao < melhor.pontuacao) melhor = { a: ca, b: sb, passos: passo, comprimento, pontuacao };
          break;
        }
        const p = coords[idx];
        const q = coords[idx + 1];
        comprimento += Math.hypot((q[0] - p[0]) * 111320, (q[1] - p[1]) * 110540);
        if (melhor && comprimento > melhor.pontuacao) break;
      }
    }
    if (!melhor) return null;

    const trecho = [melhor.a.ponto];
    for (let passo = 1; passo <= melhor.passos; passo++) {
      trecho.push(coords[(melhor.a.i + passo) % (n - 1)]);
    }
    trecho.push(melhor.b.ponto);
    return trecho;
  }

  /**
   * Paradas de um trecho de ônibus para o mapa do "Como chegar":
   *  - embarque e desembarque (destaque);
   *  - até 3 paradas antes/depois de cada um (onde também dá para embarcar ou descer);
   *  - as paradas no caminho entre eles;
   *  - "extensões": pedaço do traçado antes do embarque e depois do desembarque, para as
   *    paradas alternativas ficarem sobre a linha.
   */
  const VIZINHAS = 3;
  function paradasEmVoltaDoTrecho(trecho, coordsLinha, dia) {
    if (!trecho.paradaEmbarqueId || !trecho.paradaDesembarqueId || !trecho.sentido) return null;
    const seq = (estado.linhaParadas || [])
      .filter(
        lp =>
          String(lp.linha_id).toUpperCase() === String(trecho.numero).toUpperCase() &&
          lp.sentido === trecho.sentido &&
          (!lp.dia_semana || lp.dia_semana === dia || lp.dia_semana === 'todos')
      )
      .sort((a, b) => a.ordem_sequencial - b.ordem_sequencial);
    const iE = seq.findIndex(lp => String(lp.parada_id) === String(trecho.paradaEmbarqueId));
    const iD = seq.findIndex((lp, i) => i > iE && String(lp.parada_id) === String(trecho.paradaDesembarqueId));
    if (iE < 0 || iD < 0) return null;

    const ponto = (lp, papel) => {
      const f = obterParadaPorId(lp.parada_id);
      if (!f) return null;
      return {
        id: String(lp.parada_id),
        nome: f.properties?.nome || 'Parada',
        lng: f.geometry.coordinates[0],
        lat: f.geometry.coordinates[1],
        papel
      };
    };
    const paradas = [];
    const vistos = new Set();
    const add = (lp, papel) => {
      if (!lp || vistos.has(String(lp.parada_id))) return;
      const p = ponto(lp, papel);
      if (p) {
        paradas.push(p);
        vistos.add(p.id);
      }
    };
    add(seq[iE], 'embarque');
    add(seq[iD], 'desembarque');
    for (let k = Math.max(0, iE - VIZINHAS); k < iE; k++) add(seq[k], 'alternativa_embarque');
    for (let k = iE + 1; k <= Math.min(iD - 1, iE + VIZINHAS); k++) add(seq[k], 'alternativa_embarque');
    for (let k = Math.max(iE + 1, iD - VIZINHAS); k < iD; k++) add(seq[k], 'alternativa_desembarque');
    for (let k = iD + 1; k <= Math.min(seq.length - 1, iD + VIZINHAS); k++) add(seq[k], 'alternativa_desembarque');
    for (let k = iE + 1; k < iD; k++) add(seq[k], 'caminho');

    // Traçado antes do embarque (até a 3ª parada anterior) e depois do desembarque (até a 3ª posterior)
    const extensoes = [];
    const pEmb = ponto(seq[iE]);
    const pDes = ponto(seq[iD]);
    const pAntes = iE > 0 ? ponto(seq[Math.max(0, iE - VIZINHAS)]) : null;
    const pDepois = iD < seq.length - 1 ? ponto(seq[Math.min(seq.length - 1, iD + VIZINHAS)]) : null;
    if (pAntes && pEmb) {
      const ext = recortarTrechoNoSentido(coordsLinha, pAntes, pEmb);
      if (ext) extensoes.push(ext);
    }
    if (pDes && pDepois) {
      const ext = recortarTrechoNoSentido(coordsLinha, pDes, pDepois);
      if (ext) extensoes.push(ext);
    }
    return { paradas, extensoes };
  }

  /**
   * Monta as etapas desenháveis de um trajeto do "Como chegar":
   *  a pé (origem → embarque) • ônibus (só o trecho percorrido) • a pé na integração • … • a pé (desembarque → destino)
   */
  async function montarEtapasViagem(trajeto, origem, destino, diaSemana = 'dias_uteis_sabados') {
    if (!trajeto) return [];
    const dia = diaSemana === 'todos' ? null : diaSemana;
    const colecoes = await Promise.all(['1', '2'].map(id => carregarGeoJsonLote(id)));
    const tracadoDaLinha = numero => {
      const feats = colecoes
        .flatMap(fc => fc?.features || [])
        .filter(f => String(f.properties?.numero || f.properties?.linha_id).toUpperCase() === String(numero).toUpperCase());
      return (feats.find(f => !dia || f.properties?.dia_semana === dia) || feats[0])?.geometry?.coordinates || null;
    };

    // Trechos de ônibus: do roteador por paradas (Dijkstra) ou do cálculo simplificado pelo traçado
    let trechos = (trajeto.trechos || []).filter(t => t.embarqueCoord && t.desembarqueCoord);
    if (trechos.length === 0) {
      const linhas = trajeto.linhas || [];
      const trans = trajeto.transferencia;
      trechos =
        trajeto.tipo === 'transferencia' && trans && linhas.length >= 2
          ? [
              { numero: linhas[0].numero, embarqueCoord: trajeto.embarque, desembarqueCoord: trans, paradaDesembarqueNome: trans.nome },
              { numero: linhas[1].numero, embarqueCoord: trans, desembarqueCoord: trajeto.desembarque, paradaEmbarqueNome: trans.nome }
            ]
          : [{ numero: linhas[0]?.numero, embarqueCoord: trajeto.embarque, desembarqueCoord: trajeto.desembarque }];
    }

    const etapas = [];
    const pe = (de, ate, rotulo) => {
      if (!de || !ate) return;
      if (Math.abs(de.lat - ate.lat) < 1e-6 && Math.abs(de.lng - ate.lng) < 1e-6) return;
      etapas.push({ tipo: 'pe', rotulo, coords: [[de.lng, de.lat], [ate.lng, ate.lat]] });
    };

    pe(origem, trechos[0]?.embarqueCoord, 'Caminhe até o ponto de embarque');
    trechos.forEach((t, i) => {
      if (i > 0) pe(trechos[i - 1].desembarqueCoord, t.embarqueCoord, 'Caminhe até o ponto da próxima linha');
      const linhaMeta = (trajeto.linhas || [])[i] || obterLinhaPorId(t.numero, diaSemana) || {};
      const coords = tracadoDaLinha(t.numero);
      const recorte = coords ? recortarTrechoNoSentido(coords, t.embarqueCoord, t.desembarqueCoord) : null;
      const contexto = coords ? paradasEmVoltaDoTrecho(t, coords, dia || 'dias_uteis_sabados') : null;
      etapas.push({
        tipo: 'onibus',
        numero: t.numero,
        cor: linhaMeta.cor || '#162652',
        rotulo: `Linha ${t.numero}`,
        coords:
          recorte || [
            [t.embarqueCoord.lng, t.embarqueCoord.lat],
            [t.desembarqueCoord.lng, t.desembarqueCoord.lat]
          ],
        aproximado: !recorte,
        paradas: contexto?.paradas || [],
        extensoes: contexto?.extensoes || []
      });
    });
    pe(trechos[trechos.length - 1]?.desembarqueCoord, destino, 'Caminhe até o destino');
    return etapas;
  }

  /**
   * Busca alternativas variadas: o Dijkstra guarda só o melhor caminho por parada, então linhas que
   * compartilham paradas "escondem" umas às outras. Roda de novo proibindo a linha de embarque da melhor
   * opção encontrada (até 6 rodadas), junta tudo e filtra opções sem sentido.
   */
  function buscarAlternativasDijkstra(origem, destino, diaSemana, limiteCaminhadaMetros, maxBaldeacoes, linhaPermitida) {
    const todas = new Map();
    const proibidas = new Set();
    for (let rodada = 0; rodada < 6; rodada++) {
      const sols = executarDijkstraViagem(
        origem,
        destino,
        diaSemana,
        limiteCaminhadaMetros,
        maxBaldeacoes,
        numero => linhaPermitida(numero) && !proibidas.has(numero)
      );
      if (!sols.length) break;
      for (const s of sols) {
        const chave = s.trechos.map(t => `${t.numero}(${t.sentido})`).join('>');
        if (!todas.has(chave) || todas.get(chave).custoDijkstraMin > s.custoDijkstraMin) todas.set(chave, s);
      }
      proibidas.add(sols[0].trechos[0].numero);
    }
    const ordenadas = Array.from(todas.values()).sort((a, b) => a.custoDijkstraMin - b.custoDijkstraMin);

    // Opção sem sentido: embarcar numa linha que sozinha já leva ao destino e depois trocar sem ganhar tempo
    const custoDireto = new Map();
    for (const s of ordenadas) {
      if (s.trechos.length === 1 && !custoDireto.has(s.trechos[0].numero)) {
        custoDireto.set(s.trechos[0].numero, s.custoDijkstraMin);
      }
    }
    const uteis = ordenadas.filter(s => {
      if (s.trechos.length === 1) return true;
      const primeira = s.trechos[0].numero;
      return !(custoDireto.has(primeira) && custoDireto.get(primeira) <= s.custoDijkstraMin + 5);
    });

    // Variedade: no máximo 2 opções começando pela mesma linha
    const porPrimeiraLinha = new Map();
    return uteis
      .filter(s => {
        const primeira = s.trechos[0].numero;
        const qtd = porPrimeiraLinha.get(primeira) || 0;
        if (qtd >= 2) return false;
        porPrimeiraLinha.set(primeira, qtd + 1);
        return true;
      })
      .slice(0, 15);
  }

  /**
   * Horário oficial de Brasília (America/Sao_Paulo), independente do fuso do aparelho.
   */
  function obterHorarioBrasilia(data = new Date()) {
    const partes = new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23'
    }).formatToParts(data);
    const hora = Number(partes.find(p => p.type === 'hour')?.value || 0) % 24;
    const minuto = Number(partes.find(p => p.type === 'minute')?.value || 0);
    return { hora, minuto, texto: `${String(hora).padStart(2, '0')}:${String(minuto).padStart(2, '0')}` };
  }

  /**
   * Faixa "Madrugada" do edital (Anexo I.3, Tabela 13): 00:00 às 03:59.
   * Nela só circulam as linhas Corujão; das 04:00 às 23:59 circulam as linhas regulares.
   */
  const HORA_FIM_MADRUGADA = 4;
  function ehHorarioMadrugada(hora) {
    return Number(hora) >= 0 && Number(hora) < HORA_FIM_MADRUGADA;
  }

  function ehLinhaCorujao(numero) {
    const linha = (estado.indice?.linhas || []).find(
      l => String(l.numero).toUpperCase() === String(numero).toUpperCase()
    );
    if (linha) return linha.tipo === 'noturna';
    return /^C-?\d+$/i.test(String(numero));
  }

  async function calcularLinhasViagem(origem, destino, diaSemana = 'dias_uteis_sabados', opcoes = {}) {
    if (!origem || !destino) return [];

    const limiteCaminhadaMetros = opcoes.limiteCaminhadaMetros || LIMITE_CAMINHADA_PADRAO_METROS;
    const maxBaldeacoes = opcoes.maxBaldeacoes !== undefined ? Number(opcoes.maxBaldeacoes) : 3;

    // Horário da viagem (padrão: agora, em Brasília). Madrugada => só Corujão; demais horários => sem Corujão.
    const horaViagem = Number.isInteger(opcoes.hora) ? opcoes.hora : obterHorarioBrasilia().hora;
    const madrugada = ehHorarioMadrugada(horaViagem);
    const linhaPermitida = numero => ehLinhaCorujao(numero) === madrugada;

    // 1. Executa o roteador principal por Grafo Dijkstra sobre `paradas` + `linha_paradas`
    if (Array.isArray(estado.linhaParadas) && estado.linhaParadas.length > 0) {
      const resultadosDijkstra = buscarAlternativasDijkstra(
        origem,
        destino,
        diaSemana,
        limiteCaminhadaMetros,
        maxBaldeacoes,
        linhaPermitida
      );
      if (resultadosDijkstra.length > 0) {
        return resultadosDijkstra;
      }
    }

    const distanciaMinimaTrechoMetros = 250;
    const rotuloPontoVirtual = 'Ponto sobre o traçado da linha (confirme a parada no edital)';
    const idsLotes = (estado.indice?.lotes || []).map(l => String(l.id));
    if (idsLotes.length === 0) idsLotes.push('1', '2');

    const colecoes = await Promise.all(idsLotes.map(id => carregarGeoJsonLote(id)));
    const paradasDia = obterParadasPorDia(diaSemana);

    const infos = [];
    for (const fc of colecoes) {
      for (const feat of fc?.features || []) {
        const props = feat.properties || {};
        if (!feat.geometry || feat.geometry.type !== 'LineString') continue;
        if (
          diaSemana !== 'todos' &&
          props.dia_semana &&
          props.dia_semana !== 'todos' &&
          props.dia_semana !== diaSemana
        ) {
          continue;
        }
        const numero = String(props.numero || props.linha_id || '');
        if (!numero) continue;
        if (!linhaPermitida(numero)) continue;
        const coords = feat.geometry.coordinates;
        infos.push({
          numero,
          props,
          coords,
          comprimentoAcumulado: window.BuzuUtils.calcularComprimentoAcumulado(coords),
          paradas: paradasDia.filter(f => (f.properties?.rotas || []).map(String).includes(numero))
        });
      }
    }

    const acessosOrigem = [];
    const acessosDestino = [];

    for (const info of infos) {
      const acessoOrigem = calcularAcessoLinha(
        info,
        origem,
        limiteCaminhadaMetros,
        rotuloPontoVirtual
      );
      if (acessoOrigem) acessosOrigem.push({ info, acesso: acessoOrigem });

      const acessoDestino = calcularAcessoLinha(
        info,
        destino,
        limiteCaminhadaMetros,
        rotuloPontoVirtual
      );
      if (acessoDestino) acessosDestino.push({ info, acesso: acessoDestino });
    }

    const diretas = new Map();

    for (const { info, acesso: embarque } of acessosOrigem) {
      const opcaoDestino = acessosDestino.find(item => item.info.numero === info.numero);
      if (!opcaoDestino) continue;

      const desembarque = opcaoDestino.acesso;
      let embarqueEfetivo = embarque;
      let desembarqueEfetivo = desembarque;

      if (embarque.id && desembarque.id && embarque.id === desembarque.id) {
        const embarqueVirtual = {
          ...criarPontoSobreTracado(embarque.projecaoVirtual, rotuloPontoVirtual),
          posicao: embarque.posicaoVirtual,
          sobreTracado: true
        };
        const desembarqueVirtual = {
          ...criarPontoSobreTracado(desembarque.projecaoVirtual, rotuloPontoVirtual),
          posicao: desembarque.posicaoVirtual,
          sobreTracado: true
        };

        if (
          embarqueVirtual.distanciaPeMetros > limiteCaminhadaMetros ||
          desembarqueVirtual.distanciaPeMetros > limiteCaminhadaMetros
        ) {
          continue;
        }

        embarqueEfetivo = embarqueVirtual;
        desembarqueEfetivo = desembarqueVirtual;
      }

      const distanciaTrechoMetros = calcularTrechoEntrePosicoes(
        info,
        embarqueEfetivo.posicao,
        desembarqueEfetivo.posicao
      );
      if (distanciaTrechoMetros === null || distanciaTrechoMetros < distanciaMinimaTrechoMetros) {
        continue;
      }

      const totalMetros =
        embarqueEfetivo.distanciaPeMetros +
        distanciaTrechoMetros +
        desembarqueEfetivo.distanciaPeMetros;
      const chave = info.numero.toUpperCase();
      const candidato = {
        tipo: 'direta',
        totalMetros,
        distanciaTrechoMetros,
        acessoEmbarqueMetros: embarqueEfetivo.distanciaPeMetros,
        acessoDesembarqueMetros: desembarqueEfetivo.distanciaPeMetros,
        acessoMaximoMetros: Math.max(
          embarqueEfetivo.distanciaPeMetros,
          desembarqueEfetivo.distanciaPeMetros
        ),
        embarque: embarqueEfetivo,
        desembarque: desembarqueEfetivo,
        linhas: [
          {
            numero: info.numero,
            nome: info.props.nome,
            cor: info.props.cor,
            lote: info.props.lote,
            categoria_edital: info.props.categoria_edital,
            dia_rotulo: info.props.dia_rotulo
          }
        ]
      };

      if (!diretas.has(chave) || diretas.get(chave).totalMetros > totalMetros) {
        diretas.set(chave, candidato);
      }
    }

    const transferencias = new Map();

    for (const { info: infoOrigem, acesso: embarque } of acessosOrigem) {
      for (const { info: infoDestino, acesso: desembarque } of acessosDestino) {
        if (infoOrigem.numero === infoDestino.numero) continue;

        const pontosComuns = paradasDia.filter(feat => {
          const rotas = (feat.properties?.rotas || []).map(String);
          return rotas.includes(infoOrigem.numero) && rotas.includes(infoDestino.numero);
        });

        for (const featTrans of pontosComuns) {
          const [lng, lat] = featTrans.geometry.coordinates;
          const posicaoOrigem = calcularPosicaoNaLinha(infoOrigem, lat, lng);
          const posicaoDestino = calcularPosicaoNaLinha(infoDestino, lat, lng);
          if (!posicaoOrigem || !posicaoDestino) continue;

          const trechoA = calcularTrechoEntrePosicoes(
            infoOrigem,
            embarque.posicao,
            posicaoOrigem.posicao
          );
          const trechoB = calcularTrechoEntrePosicoes(
            infoDestino,
            posicaoDestino.posicao,
            desembarque.posicao
          );
          if (trechoA === null || trechoB === null) continue;
          if (trechoA < distanciaMinimaTrechoMetros || trechoB < distanciaMinimaTrechoMetros) {
            continue;
          }

          const trans = {
            id: featTrans.properties?.id,
            nome: featTrans.properties?.nome || 'Ponto de integração',
            tipo: featTrans.properties?.tipo || 'ponto de integração',
            lat,
            lng
          };

          const totalMetros =
            embarque.distanciaPeMetros + trechoA + trechoB + desembarque.distanciaPeMetros;
          const chave = `${infoOrigem.numero}>${infoDestino.numero}`;
          const candidato = {
            tipo: 'transferencia',
            totalMetros,
            distanciaTrechoMetros: trechoA + trechoB,
            acessoEmbarqueMetros: embarque.distanciaPeMetros,
            acessoDesembarqueMetros: desembarque.distanciaPeMetros,
            acessoMaximoMetros: Math.max(embarque.distanciaPeMetros, desembarque.distanciaPeMetros),
            embarque,
            transferencia: trans,
            desembarque,
            trechos: [
              { numero: infoOrigem.numero, distanciaMetros: trechoA },
              { numero: infoDestino.numero, distanciaMetros: trechoB }
            ],
            linhas: [
              {
                numero: infoOrigem.numero,
                nome: infoOrigem.props.nome,
                cor: infoOrigem.props.cor,
                lote: infoOrigem.props.lote,
                categoria_edital: infoOrigem.props.categoria_edital,
                dia_rotulo: infoOrigem.props.dia_rotulo
              },
              {
                numero: infoDestino.numero,
                nome: infoDestino.props.nome,
                cor: infoDestino.props.cor,
                lote: infoDestino.props.lote,
                categoria_edital: infoDestino.props.categoria_edital,
                dia_rotulo: infoDestino.props.dia_rotulo
              }
            ]
          };

          if (!transferencias.has(chave) || transferencias.get(chave).totalMetros > totalMetros) {
            transferencias.set(chave, candidato);
          }
        }
      }
    }

    const diretasOrdenadas = Array.from(diretas.values()).sort(
      (a, b) => a.totalMetros - b.totalMetros
    );
    const transferenciasOrdenadas = Array.from(transferencias.values()).sort(
      (a, b) => a.totalMetros - b.totalMetros
    );

    const chaveItem = item =>
      item.tipo === 'direta'
        ? `D:${item.linhas[0]?.numero}`
        : `T:${(item.linhas || []).map(linha => linha.numero).join('>')}`;

    if (diretasOrdenadas.length === 0) {
      const transferenciasProximas = transferenciasOrdenadas.filter(
        item => item.acessoMaximoMetros <= 500
      );

      const selecionadas = [];
      const vistos = new Set();

      for (const item of [...transferenciasOrdenadas.slice(0, 10), ...transferenciasProximas]) {
        const chave = chaveItem(item);
        if (vistos.has(chave)) continue;
        vistos.add(chave);
        selecionadas.push(item);
      }

      return selecionadas.sort((a, b) => a.totalMetros - b.totalMetros).slice(0, 24);
    }

    const melhorDireta = diretasOrdenadas[0].totalMetros;
    const limiteTransferenciaCompetitiva = melhorDireta * 1.6 + 1000;
    const limiteTransferenciaProximidade = melhorDireta * 2.5 + 5000;

    const transferenciasCompetitivas = transferenciasOrdenadas
      .filter(item => item.totalMetros <= limiteTransferenciaCompetitiva)
      .slice(0, 3);

    const transferenciasPorProximidade = [...transferenciasOrdenadas]
      .filter(
        item =>
          item.acessoMaximoMetros <= 500 && item.totalMetros <= limiteTransferenciaProximidade
      )
      .sort((a, b) => a.acessoMaximoMetros - b.acessoMaximoMetros)
      .slice(0, 3);

    const selecionadas = [...diretasOrdenadas];
    const vistos = new Set(diretasOrdenadas.map(chaveItem));

    for (const item of [...transferenciasCompetitivas, ...transferenciasPorProximidade]) {
      const chave = chaveItem(item);
      if (vistos.has(chave)) continue;
      vistos.add(chave);
      selecionadas.push(item);
    }

    const pontuacao = item =>
      item.totalMetros + (item.tipo === 'transferencia' ? 1000 : 0);

    return selecionadas.sort((a, b) => pontuacao(a) - pontuacao(b));
  }

  /**
   * Funções do ACESSO RESTRITO (Admin com JSON / KML)
   */
  function carregarOverrideAdmin() {
    try {
      const bruto = localStorage.getItem(CHAVE_STORAGE_ADMIN);
      return bruto ? JSON.parse(bruto) : null;
    } catch (_e) {
      return null;
    }
  }

  function exportarPacoteCompletoJson() {
    return {
      indice: estado.indice,
      paradas: estado.paradas,
      linhaParadas: estado.linhaParadas,
      lotesGeoJson: estado.cacheGeoJsonLotes
    };
  }

  /**
   * Projeta um ponto (lat, lng) em um intervalo de segmentos [idxInicio .. idxFim] de uma polilinha.
   */
  function projetarNoRamo(lat, lng, coords, acumulado, idxInicio, idxFim) {
    const rad = (lat * Math.PI) / 180;
    const mLat = 111132;
    const mLng = 111320 * Math.cos(rad);
    const px = lng * mLng;
    const py = lat * mLat;

    let melhor = null;
    for (let i = idxInicio; i < idxFim; i++) {
      const a = coords[i];
      const b = coords[i + 1];
      if (!a || !b) continue;
      const ax = a[0] * mLng, ay = a[1] * mLat;
      const bx = b[0] * mLng, by = b[1] * mLat;
      const dx = bx - ax, dy = by - ay;
      const comp2 = dx * dx + dy * dy;
      let t = comp2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / comp2 : 0;
      t = Math.max(0, Math.min(1, t));
      const cx = ax + t * dx, cy = ay + t * dy;
      const dist = Math.hypot(px - cx, py - cy);

      if (!melhor || dist < melhor.distanciaMetros) {
        const distAcum = acumulado[i] + t * (acumulado[i + 1] - acumulado[i]);
        melhor = {
          distanciaMetros: dist,
          distanciaAcumulada: Math.round(distAcum)
        };
      }
    }
    return melhor;
  }

  /**
   * GATILHO DE RECÁLCULO AUTOMÁTICO (`recalcularVinculosParadaEGrafo`):
   * Sempre que o Admin criar, mover (draggable), alterar sentido ou excluir uma parada no mapa,
   * recalcula os vínculos `linha_paradas` para todas as linhas que passam num raio de 40 metros,
   * detecta automaticamente o sentido ('IDA' | 'VOLTA' | 'AMBOS') caso solicitado ('AUTO'),
   * reordena a sequência (`ordem_sequencial`) e reconstrói o Grafo Dijkstra em memória!
   */
  async function recalcularVinculosParadaEGrafo(idParadaAlvo = null, autoDetectarSentido = false) {
    await Promise.all(['1', '2'].map(id => carregarGeoJsonLote(id)));

    const todasFeaturesLinhas = [
      ...(estado.cacheGeoJsonLotes['1']?.features || []),
      ...(estado.cacheGeoJsonLotes['2']?.features || [])
    ];

    const featParadaAlvo = idParadaAlvo ? obterParadaPorId(idParadaAlvo) : null;

    // Se há uma parada específica editada/movida, podemos atualizar apenas as linhas próximas a ela
    if (featParadaAlvo) {
      const pProps = featParadaAlvo.properties;
      const [pLng, pLat] = featParadaAlvo.geometry.coordinates;
      pProps.lat = pLat;
      pProps.lng = pLng;

      // Remove vínculos anteriores desta parada na tabela linha_paradas
      const linhasAfetadas = new Set(
        estado.linhaParadas
          .filter(lp => String(lp.parada_id) === String(pProps.id))
          .map(lp => `${lp.linha_id}|${lp.dia_semana}`)
      );
      estado.linhaParadas = estado.linhaParadas.filter(
        lp => String(lp.parada_id) !== String(pProps.id)
      );

      const rotasEncontradas = new Set();
      const sentidosDetectados = new Set();

      if (pProps.ativo !== false) {
        for (const featLinha of todasFeaturesLinhas) {
          const coords = featLinha.geometry?.coordinates || [];
          if (coords.length < 2) continue;

          // Filtro rápido por distância em graus
          const minGraus = Math.min(...coords.map(c => Math.hypot(c[0] - pLng, c[1] - pLat)));
          if (minGraus > 0.0008) continue;

          const acumulado = window.BuzuUtils.calcularComprimentoAcumulado(coords);
          const comprTotal = acumulado[acumulado.length - 1] || 0;
          let idxMeio = Math.floor(coords.length / 2);
          for (let i = 1; i < acumulado.length; i++) {
            if (acumulado[i] >= comprTotal / 2) {
              idxMeio = i;
              break;
            }
          }

          const projIda = projetarNoRamo(pLat, pLng, coords, acumulado, 0, idxMeio);
          const projVolta = projetarNoRamo(
            pLat,
            pLng,
            coords,
            acumulado,
            idxMeio,
            coords.length - 1
          );

          const dIda = projIda ? projIda.distanciaMetros : Infinity;
          const dVolta = projVolta ? projVolta.distanciaMetros : Infinity;

          if (dIda > RAIO_RECALCULO_LINHA_METROS && dVolta > RAIO_RECALCULO_LINHA_METROS) {
            continue;
          }

          const numero = featLinha.properties.numero;
          const dia = featLinha.properties.dia_semana || 'dias_uteis_sabados';
          linhasAfetadas.add(`${numero}|${dia}`);

          let sentidoAlvo = (pProps.sentidos_atendidos || 'AMBOS').toUpperCase();
          if (autoDetectarSentido || sentidoAlvo === 'AUTO') {
            if (dIda <= RAIO_RECALCULO_LINHA_METROS && dVolta <= RAIO_RECALCULO_LINHA_METROS && Math.abs(dIda - dVolta) < 12) {
              sentidoAlvo = 'AMBOS';
            } else if (dIda <= dVolta) {
              sentidoAlvo = 'IDA';
            } else {
              sentidoAlvo = 'VOLTA';
            }
            sentidosDetectados.add(sentidoAlvo);
          }

          if ((sentidoAlvo === 'IDA' || sentidoAlvo === 'AMBOS') && dIda <= RAIO_RECALCULO_LINHA_METROS) {
            estado.linhaParadas.push({
              linha_id: numero,
              dia_semana: dia,
              sentido: 'IDA',
              parada_id: pProps.id,
              ordem_sequencial: 0,
              distancia_acumulada_metros: projIda.distanciaAcumulada
            });
            rotasEncontradas.add(numero);
          }

          if ((sentidoAlvo === 'VOLTA' || sentidoAlvo === 'AMBOS') && dVolta <= RAIO_RECALCULO_LINHA_METROS) {
            estado.linhaParadas.push({
              linha_id: numero,
              dia_semana: dia,
              sentido: 'VOLTA',
              parada_id: pProps.id,
              ordem_sequencial: 0,
              distancia_acumulada_metros: Math.round(projVolta.distanciaAcumulada - acumulado[idxMeio])
            });
            rotasEncontradas.add(numero);
          }
        }

        if (autoDetectarSentido && sentidosDetectados.size > 0) {
          pProps.sentidos_atendidos =
            sentidosDetectados.has('AMBOS') ||
            (sentidosDetectados.has('IDA') && sentidosDetectados.has('VOLTA'))
              ? 'AMBOS'
              : sentidosDetectados.has('VOLTA')
              ? 'VOLTA'
              : 'IDA';
        }
      }

      pProps.rotas = Array.from(rotasEncontradas);

      // Reordena `ordem_sequencial` de todas as linhas afetadas
      for (const chLinhaDia of linhasAfetadas) {
        const [numL, diaL] = chLinhaDia.split('|');
        for (const sent of ['IDA', 'VOLTA']) {
          const subLista = estado.linhaParadas.filter(
            lp => lp.linha_id === numL && lp.dia_semana === diaL && lp.sentido === sent
          );
          subLista.sort((a, b) => a.distancia_acumulada_metros - b.distancia_acumulada_metros);
          subLista.forEach((item, idx) => {
            item.ordem_sequencial = idx + 1;
          });
        }
      }
    }

    // Limpa o cache do Grafo Dijkstra em memória para que a próxima consulta já use as novas arestas!
    estado.grafoMemoria = {};
    salvarOverrideAdmin();
  }

  /**
   * Adiciona ou edita uma parada no Editor Visual do Mapa e aciona o Gatilho de Recálculo
   */
  async function criarOuEditarParadaNoMapa(dadosParada) {
    const id = dadosParada.id || `MAN-${Date.now().toString().slice(-5)}`;
    const lat = Number(Number(dadosParada.lat).toFixed(6));
    const lng = Number(Number(dadosParada.lng).toFixed(6));
    const autoDetectar = dadosParada.sentidos_atendidos === 'AUTO';

    let feat = obterParadaPorId(id);
    if (!feat) {
      feat = {
        type: 'Feature',
        properties: {
          id,
          nome: dadosParada.nome || `Parada Manual ${id}`,
          lat,
          lng,
          tipo: dadosParada.tipo || 'parada',
          origem: dadosParada.origem || 'manual',
          ativo: dadosParada.ativo !== false,
          acessivel: 'sim',
          sentidos_atendidos: autoDetectar ? 'AMBOS' : (dadosParada.sentidos_atendidos || 'AMBOS').toUpperCase(),
          rotas: [],
          dias_semana: ['dias_uteis_sabados', 'domingos_feriados'],
          dia_rotulo: 'Dias úteis, sábados, domingos e feriados',
          integracoes_descricao: []
        },
        geometry: {
          type: 'Point',
          coordinates: [lng, lat]
        }
      };
      estado.paradas.features.push(feat);
    } else {
      feat.properties.nome = dadosParada.nome ?? feat.properties.nome;
      feat.properties.tipo = dadosParada.tipo ?? feat.properties.tipo;
      feat.properties.origem = dadosParada.origem || 'manual';
      feat.properties.ativo = dadosParada.ativo !== false;
      if (!autoDetectar && dadosParada.sentidos_atendidos) {
        feat.properties.sentidos_atendidos = dadosParada.sentidos_atendidos.toUpperCase();
      }
      feat.properties.lat = lat;
      feat.properties.lng = lng;
      feat.geometry.coordinates = [lng, lat];
    }

    await recalcularVinculosParadaEGrafo(id, autoDetectar);
    return feat;
  }

  /**
   * Move uma parada arrastada no mapa (draggable marker), marca origem='manual' e recalcula o grafo
   */
  async function moverParadaNoMapa(idParada, novoLat, novoLng, autoDetectarSentido = true) {
    const feat = obterParadaPorId(idParada);
    if (!feat) return null;

    const lat = Number(Number(novoLat).toFixed(6));
    const lng = Number(Number(novoLng).toFixed(6));
    feat.geometry.coordinates = [lng, lat];
    feat.properties.lat = lat;
    feat.properties.lng = lng;
    feat.properties.origem = 'manual'; // Revisada manualmente pelo Admin

    await recalcularVinculosParadaEGrafo(idParada, autoDetectarSentido);
    return feat;
  }

  /**
   * Exclui uma parada do mapa e recalcula os vínculos e o grafo
   */
  async function excluirParadaNoMapa(idParada) {
    const feat = obterParadaPorId(idParada);
    if (!feat) return;
    feat.properties.ativo = false;
    await recalcularVinculosParadaEGrafo(idParada, false);
    estado.paradas.features = estado.paradas.features.filter(
      f => String(f.properties?.id) !== String(idParada)
    );
    salvarOverrideAdmin();
  }

  /**
   * Obtém a Feature GeoJSON e as coordenadas [lng, lat] de uma linha para um dia específico
   */
  async function obterCoordenadasRota(numeroLinha, diaSemana = 'dias_uteis_sabados') {
    const numUpper = String(numeroLinha || '').toUpperCase().trim();
    const fc1 = await carregarGeoJsonLote('1');
    const fc2 = await carregarGeoJsonLote('2');

    const buscarEmLote = (fc, loteId) => {
      const feats = (fc?.features || []).filter(
        f => String(f.properties?.numero || f.properties?.linha_id || '').toUpperCase() === numUpper
      );
      if (feats.length === 0) return null;
      const exata = feats.find(f => f.properties?.dia_semana === diaSemana) || feats[0];
      return {
        feature: exata,
        loteId,
        diaReal: exata.properties?.dia_semana || diaSemana,
        coordenadas: (exata.geometry?.coordinates || []).map(c => [Number(c[0]), Number(c[1])])
      };
    };

    return buscarEmLote(fc1, '1') || buscarEmLote(fc2, '2');
  }

  /**
   * Atualiza visualmente o traçado e/ou metadados de uma linha, recalcula extensão/bbox/vínculos 40m
   * e persiste no localStorage e no servidor (/api/salvar-rotas).
   */
  async function atualizarRotaNoMapa(
    numeroLinha,
    diaSemana = 'dias_uteis_sabados',
    novasCoordenadas = [],
    novosMetadados = {}
  ) {
    const encontrado = await obterCoordenadasRota(numeroLinha, diaSemana);
    if (!encontrado) return null;

    const { feature, loteId: loteAntigo, diaReal } = encontrado;
    const coordsLimpas = (novasCoordenadas || [])
      .filter(c => Array.isArray(c) && c.length >= 2 && Number.isFinite(c[0]) && Number.isFinite(c[1]))
      .map(c => [Number(Number(c[0]).toFixed(6)), Number(Number(c[1]).toFixed(6))]);

    if (coordsLimpas.length < 2) {
      throw new Error('O traçado precisa ter pelo menos 2 vértices.');
    }

    const acum = window.BuzuUtils.calcularComprimentoAcumulado(coordsLimpas);
    const extensaoKm = Number(((acum[acum.length - 1] || 0) / 1000).toFixed(3));
    const bbox = window.BuzuUtils.calcularBbox(coordsLimpas);

    const novoLote = String(novosMetadados.lote || feature.properties.lote || loteAntigo);
    const novoNome = (novosMetadados.nome || feature.properties.nome || '').trim();
    const novaCor = novosMetadados.cor || feature.properties.cor || '#162652';
    const novaCat = novosMetadados.categoria_edital || feature.properties.categoria_edital || 'Linha de Bairro';

    feature.geometry.coordinates = coordsLimpas;
    feature.properties.nome = novoNome;
    feature.properties.lote = novoLote;
    if (novosMetadados.empresa !== undefined) {
      feature.properties.empresa = String(novosMetadados.empresa).trim() || null;
    }
    feature.properties.cor = novaCor;
    feature.properties.categoria_edital = novaCat;
    feature.properties.extensao_km = extensaoKm;

    // Se mudou de lote, move a feature entre lote-1 e lote-2
    if (novoLote !== loteAntigo) {
      const fcAntigo = estado.cacheGeoJsonLotes[loteAntigo];
      if (fcAntigo?.features) {
        fcAntigo.features = fcAntigo.features.filter(f => f !== feature);
      }
      if (!estado.cacheGeoJsonLotes[novoLote]) {
        estado.cacheGeoJsonLotes[novoLote] = { type: 'FeatureCollection', features: [] };
      }
      estado.cacheGeoJsonLotes[novoLote].features.push(feature);
    }

    // Atualiza índice da linha
    const numUpper = String(numeroLinha).toUpperCase().trim();
    const linhaIdx = (estado.indice?.linhas || []).find(
      l => String(l.numero).toUpperCase() === numUpper
    );
    if (linhaIdx) {
      if (novosMetadados.nome) linhaIdx.nome = novoNome;
      linhaIdx.lote = novoLote;
      linhaIdx.empresa =
        novosMetadados.empresa !== undefined
          ? String(novosMetadados.empresa).trim() || null
          : linhaIdx.empresa ?? null;
      linhaIdx.cor = novaCor;
      linhaIdx.categoria_edital = novaCat;
      if (novosMetadados.tarifa) linhaIdx.tarifa = novosMetadados.tarifa.trim();
      if (novosMetadados.horario_operacao) linhaIdx.horario_operacao = novosMetadados.horario_operacao.trim();
      linhaIdx.bbox = bbox;

      if (linhaIdx.variantes_dia && linhaIdx.variantes_dia[diaReal]) {
        linhaIdx.variantes_dia[diaReal].nome = novoNome;
        linhaIdx.variantes_dia[diaReal].cor = novaCor;
        linhaIdx.variantes_dia[diaReal].extensao_km = extensaoKm;
        linhaIdx.variantes_dia[diaReal].bbox = bbox;
      }
    }

    // Recalcula vínculos linha_paradas num raio de 40m para esta linha neste dia
    const meioIdx = Math.max(1, Math.floor(coordsLimpas.length / 2));
    const outrosVinculos = (estado.linhaParadas || []).filter(
      lp =>
        !(
          String(lp.linha_id).toUpperCase() === numUpper &&
          (lp.dia_semana === diaReal || lp.dia_semana === 'todos')
        )
    );

    const novosVinculosIda = [];
    const novosVinculosVolta = [];

    for (const featP of estado.paradas?.features || []) {
      const p = featP.properties || {};
      if (p.ativo === false) continue;
      const [lngP, latP] = featP.geometry?.coordinates || [];
      if (!Number.isFinite(latP) || !Number.isFinite(lngP)) continue;

      const projIda = projetarNoRamo(latP, lngP, coordsLimpas, acum, 0, meioIdx);
      const projVolta = projetarNoRamo(latP, lngP, coordsLimpas, acum, meioIdx, coordsLimpas.length - 1);

      const sAtend = String(p.sentidos_atendidos || 'AMBOS').toUpperCase();
      let ligou = false;

      if (projIda && projIda.distanciaMetros <= 40 && (sAtend === 'IDA' || sAtend === 'AMBOS')) {
        novosVinculosIda.push({
          linha_id: numUpper,
          dia_semana: diaReal,
          sentido: 'IDA',
          parada_id: p.id,
          distancia_acumulada_metros: projIda.distanciaAcumulada
        });
        ligou = true;
      }
      if (projVolta && projVolta.distanciaMetros <= 40 && (sAtend === 'VOLTA' || sAtend === 'AMBOS')) {
        novosVinculosVolta.push({
          linha_id: numUpper,
          dia_semana: diaReal,
          sentido: 'VOLTA',
          parada_id: p.id,
          distancia_acumulada_metros: projVolta.distanciaAcumulada
        });
        ligou = true;
      }

      const rotasSet = new Set((p.rotas || []).map(r => String(r).toUpperCase()));
      if (ligou) {
        rotasSet.add(numUpper);
      } else {
        rotasSet.delete(numUpper);
      }
      p.rotas = Array.from(rotasSet);
    }

    novosVinculosIda.sort((a, b) => a.distancia_acumulada_metros - b.distancia_acumulada_metros);
    novosVinculosVolta.sort((a, b) => a.distancia_acumulada_metros - b.distancia_acumulada_metros);

    novosVinculosIda.forEach((v, idx) => (v.ordem_sequencial = idx + 1));
    novosVinculosVolta.forEach((v, idx) => (v.ordem_sequencial = idx + 1));

    estado.linhaParadas = [...outrosVinculos, ...novosVinculosIda, ...novosVinculosVolta];
    estado.grafoMemoria = {};
    salvarOverrideAdmin();

    return {
      extensao_km: extensaoKm,
      vertices: coordsLimpas.length,
      paradasVinculadas: novosVinculosIda.length + novosVinculosVolta.length
    };
  }

  /**
   * Retorna os registros da tabela pivot `linha_paradas` vinculados a uma parada
   */
  function obterVinculosLinhaParadas(idParada) {
    return (estado.linhaParadas || []).filter(
      lp => String(lp.parada_id) === String(idParada)
    );
  }

  /**
   * Aplica um pacote JSON enviado pelo Administrador no Acesso Restrito.
   * Aceita tanto o pacote completo { indice, paradas, lotesGeoJson } quanto
   * um FeatureCollection GeoJSON ou objeto de nova linha individual.
   */
  function importarJsonAdmin(objetoJson, modoMesclagem = 'mesclar') {
    if (!objetoJson || typeof objetoJson !== 'object') {
      throw new Error('JSON inválido.');
    }

    // Caso 1: Pacote completo { indice, paradas, lotesGeoJson }
    if (objetoJson.indice && objetoJson.paradas) {
      if (modoMesclagem === 'substituir') {
        estado.indice = objetoJson.indice;
        estado.paradas = objetoJson.paradas;
        estado.cacheGeoJsonLotes = objetoJson.lotesGeoJson || {};
      } else {
        // Mescla linhas novas ou atualiza existentes pelo id/numero
        for (const novaLinha of objetoJson.indice.linhas || []) {
          const idx = estado.indice.linhas.findIndex(l => l.numero === novaLinha.numero);
          if (idx >= 0) {
            estado.indice.linhas[idx] = novaLinha;
          } else {
            estado.indice.linhas.push(novaLinha);
          }
        }
        // Mescla paradas
        for (const novaParada of objetoJson.paradas.features || []) {
          const idxP = estado.paradas.features.findIndex(
            f => f.properties?.id === novaParada.properties?.id
          );
          if (idxP >= 0) {
            estado.paradas.features[idxP] = novaParada;
          } else {
            estado.paradas.features.push(novaParada);
          }
        }
        // Mescla geometrias dos lotes
        for (const [idLote, fc] of Object.entries(objetoJson.lotesGeoJson || {})) {
          if (!estado.cacheGeoJsonLotes[idLote]) {
            estado.cacheGeoJsonLotes[idLote] = { type: 'FeatureCollection', features: [] };
          }
          for (const feat of fc.features || []) {
            const idxF = estado.cacheGeoJsonLotes[idLote].features.findIndex(
              f => f.properties?.id === feat.properties?.id
            );
            if (idxF >= 0) {
              estado.cacheGeoJsonLotes[idLote].features[idxF] = feat;
            } else {
              estado.cacheGeoJsonLotes[idLote].features.push(feat);
            }
          }
        }
      }
    } else if (objetoJson.type === 'FeatureCollection' && Array.isArray(objetoJson.features)) {
      // Caso 2: O Admin colou um GeoJSON FeatureCollection padrão (com LineStrings e Points)
      integrarFeatureCollectionPadrao(objetoJson);
    } else {
      throw new Error(
        'Formato JSON não reconhecido. Envie o pacote completo ({ indice, paradas, lotesGeoJson }) ou um GeoJSON FeatureCollection.'
      );
    }

    salvarOverrideAdmin();
    return exportarPacoteCompletoJson();
  }

  /**
   * Converte uma FeatureCollection GeoJSON genérica em registros de linhas e paradas
   * aplicando simplificação Douglas-Peucker (~0.00005)
   */
  function integrarFeatureCollectionPadrao(fc) {
    for (const feat of fc.features || []) {
      const props = feat.properties || {};
      const geom = feat.geometry;
      if (!geom) continue;

      if (geom.type === 'LineString') {
        const coordsSimplificadas = window.BuzuUtils.simplificarLineString(
          geom.coordinates.map(c => [Number(c[0].toFixed(5)), Number(c[1].toFixed(5))]),
          window.BuzuUtils.TOLERANCIA_PADRAO_GRAUS
        );
        const numero = props.numero || props.linha_id || props.id || 'NOVA';
        const nome = props.nome || props.name || `Linha ${numero}`;
        const lote = String(props.lote || '1');
        const dia = props.dia_semana || 'dias_uteis_sabados';
        const diaRotulo = dia === 'domingos_feriados' ? 'Domingos e feriados' : 'Dias úteis e sábados';
        const cor = props.cor || (dia === 'domingos_feriados' ? '#333CE7' : '#0057B8');
        const bbox = window.BuzuUtils.calcularBbox(coordsSimplificadas);

        const idFeature = `${numero}-${dia}`;
        const novaFeature = {
          type: 'Feature',
          properties: {
            id: idFeature,
            linha_id: numero,
            numero,
            nome,
            lote,
            tipo: props.tipo || 'convencional',
            categoria_edital: props.categoria_edital || 'Convencional',
            sentido: props.sentido || 'ambos',
            dia_semana: dia,
            dia_rotulo: diaRotulo,
            extensao_km: props.extensao_km || null,
            cor
          },
          geometry: {
            type: 'LineString',
            coordinates: coordsSimplificadas
          }
        };

        if (!estado.cacheGeoJsonLotes[lote]) {
          estado.cacheGeoJsonLotes[lote] = { type: 'FeatureCollection', features: [] };
        }
        const listaFeat = estado.cacheGeoJsonLotes[lote].features;
        const idxExist = listaFeat.findIndex(f => f.properties?.id === idFeature);
        if (idxExist >= 0) listaFeat[idxExist] = novaFeature;
        else listaFeat.push(novaFeature);

        // Atualiza índice linhas.json
        let regLinha = estado.indice.linhas.find(l => l.numero === numero);
        if (!regLinha) {
          regLinha = {
            id: numero,
            numero,
            nome,
            lote,
            empresa: props.empresa || null,
            tipo: props.tipo || 'convencional',
            categoria_edital: props.categoria_edital || 'Convencional',
            sentido: props.sentido || 'ambos',
            cor,
            acessivel: props.acessivel !== false,
            tarifa: props.tarifa || 'Tarifa Social / Sistema Natal',
            frequencia_pico: props.frequencia_pico || 'Consultar edital',
            frequencia_entre_pico: props.frequencia_entre_pico || 'Consultar edital',
            horario_operacao: props.horario_operacao || '05:00 às 23:00',
            ordem_confirmada_por_sentido: false,
            dias_disponiveis: [dia],
            variantes_dia: {},
            bbox
          };
          estado.indice.linhas.push(regLinha);
        }
        if (!regLinha.dias_disponiveis.includes(dia)) {
          regLinha.dias_disponiveis.push(dia);
        }
        regLinha.variantes_dia[dia] = {
          dia_semana: dia,
          dia_rotulo: diaRotulo,
          nome,
          extensao_km: props.extensao_km || null,
          cor,
          sentido: props.sentido || 'ambos',
          paradas_atendidas: props.paradas_atendidas || [],
          integracoes: props.integracoes || [],
          bbox
        };
      } else if (geom.type === 'Point') {
        const idP = props.id || `P-${Date.now().toString().slice(-4)}`;
        const novaParada = {
          type: 'Feature',
          properties: {
            id: idP,
            nome: props.nome || props.name || 'Parada',
            tipo: props.tipo || 'parada',
            acessivel: props.acessivel || 'sim',
            rotas: Array.isArray(props.rotas) ? props.rotas : [props.rotas || 'B1'],
            dias_semana: Array.isArray(props.dias_semana) ? props.dias_semana : ['dias_uteis_sabados'],
            dia_rotulo: props.dia_rotulo || 'Dias úteis e sábados',
            sentidos_atendidos: props.sentidos_atendidos || 'ambos',
            integracoes_descricao: props.integracoes_descricao || []
          },
          geometry: {
            type: 'Point',
            coordinates: [Number(geom.coordinates[0].toFixed(6)), Number(geom.coordinates[1].toFixed(6))]
          }
        };
        const idxP = estado.paradas.features.findIndex(f => f.properties?.id === idP);
        if (idxP >= 0) estado.paradas.features[idxP] = novaParada;
        else estado.paradas.features.push(novaParada);
      }
    }
  }

  /**
   * Converte conteúdo XML KML (como o doc.kml do Google My Maps) em GeoJSON FeatureCollection
   * diretamente no painel de Acesso Restrito para facilitar a adição de novas rotas pelo Admin
   */
  function converterKmlTextoParaGeoJson(kmlTexto, lotePadrao = '1') {
    const parser = new DOMParser();
    const xml = parser.parseFromString(kmlTexto, 'text/xml');
    const folders = Array.from(xml.getElementsByTagName('Folder'));
    const features = [];

    const processarPlacemarks = (placemarks, codigoDia, rotuloDia) => {
      let numeroLinhaPasta = 'NOVA';
      // Descobre primeiro o código da linha na pasta
      for (const pm of placemarks) {
        if (pm.getElementsByTagName('LineString').length > 0) {
          const nomePm = pm.getElementsByTagName('name')[0]?.textContent?.trim() || '';
          numeroLinhaPasta = (nomePm.split(/\s*-\s*/)[0] || 'NOVA').trim();
          break;
        }
      }

      for (const pm of placemarks) {
        const nomePm = pm.getElementsByTagName('name')[0]?.textContent?.trim() || 'Sem nome';
        const styleUrl = pm.getElementsByTagName('styleUrl')[0]?.textContent?.trim() || '';
        const desc = pm.getElementsByTagName('description')[0]?.textContent || '';

        const matchExt = desc.match(/EXTENSAO:\s*([0-9.,]+)/i);
        const extensaoKm = matchExt ? parseFloat(matchExt[1].replace(',', '.')) : null;

        const lineNode = pm.getElementsByTagName('LineString')[0];
        const pointNode = pm.getElementsByTagName('Point')[0];

        if (lineNode) {
          const coordText = lineNode.getElementsByTagName('coordinates')[0]?.textContent?.trim() || '';
          const rawCoords = coordText
            .split(/\s+/)
            .map(s => s.split(',').map(Number))
            .filter(p => p.length >= 2 && !isNaN(p[0]) && !isNaN(p[1]));

          const partes = nomePm.split(/\s*-\s*/);
          const numero = (partes[0] || numeroLinhaPasta).trim();
          const nome = partes.slice(1).join(' - ').trim() || nomePm;
          const matchCor = styleUrl.match(/line-([0-9A-Fa-f]{6})/);
          const cor = matchCor ? `#${matchCor[1].toUpperCase()}` : '#0057B8';

          features.push({
            type: 'Feature',
            properties: {
              id: `${numero}-${codigoDia}`,
              linha_id: numero,
              numero,
              nome,
              lote: lotePadrao,
              tipo: numero.toUpperCase().startsWith('B') ? 'alimentadora' : 'convencional',
              categoria_edital: numero.toUpperCase().startsWith('B') ? 'Linha de Bairro' : 'Convencional',
              sentido: 'ambos',
              dia_semana: codigoDia,
              dia_rotulo: rotuloDia,
              extensao_km: extensaoKm,
              cor
            },
            geometry: {
              type: 'LineString',
              coordinates: rawCoords
            }
          });
        } else if (pointNode) {
          const coordText = pointNode.getElementsByTagName('coordinates')[0]?.textContent?.trim() || '';
          const parts = coordText.split(',').map(Number);
          if (parts.length >= 2 && !isNaN(parts[0])) {
            const nLow = nomePm.toLowerCase();
            const tipoP = nLow.includes('terminal')
              ? 'terminal'
              : nLow.includes('integração') || nLow.includes('estação')
              ? 'ponto de integração'
              : 'parada';

            features.push({
              type: 'Feature',
              properties: {
                id: `P-${numeroLinhaPasta}-${features.length + 1}`,
                nome: nomePm,
                tipo: tipoP,
                acessivel: 'sim',
                rotas: [numeroLinhaPasta],
                dias_semana: [codigoDia],
                dia_rotulo: rotuloDia,
                sentidos_atendidos: nLow.includes('- ida') ? 'ida' : nLow.includes('- volta') ? 'volta' : 'ambos'
              },
              geometry: {
                type: 'Point',
                coordinates: [parts[0], parts[1]]
              }
            });
          }
        }
      }
    };

    if (folders.length > 0) {
      for (const folder of folders) {
        const nomeF = folder.getElementsByTagName('name')[0]?.textContent?.trim() || 'Dias úteis e sábados';
        const isDom = nomeF.toLowerCase().includes('domingo') || nomeF.toLowerCase().includes('feriado');
        const codigoDia = isDom ? 'domingos_feriados' : 'dias_uteis_sabados';
        const rotuloDia = isDom ? 'Domingos e feriados' : 'Dias úteis e sábados';
        const pms = Array.from(folder.getElementsByTagName('Placemark'));
        processarPlacemarks(pms, codigoDia, rotuloDia);
      }
    } else {
      const pms = Array.from(xml.getElementsByTagName('Placemark'));
      processarPlacemarks(pms, 'dias_uteis_sabados', 'Dias úteis e sábados');
    }

    return {
      type: 'FeatureCollection',
      features
    };
  }

  let tokenAdminMemoria = '';

  function definirTokenAdmin(token) {
    tokenAdminMemoria = token ? String(token) : '';
  }

  function salvarOverrideAdmin() {
    const pacote = exportarPacoteCompletoJson();
    try {
      localStorage.setItem(CHAVE_STORAGE_ADMIN, JSON.stringify(pacote));
    } catch (_e) {
      // Ignora erro de quota
    }

    // Se estiver rodando via servidor.js e autenticado, persiste os arquivos no disco do servidor
    if (window.location.protocol.startsWith('http')) {
      const headers = { 'Content-Type': 'application/json' };
      if (tokenAdminMemoria) {
        headers.Authorization = `Bearer ${tokenAdminMemoria}`;
      }
      fetch('/api/salvar-rotas', {
        method: 'POST',
        credentials: 'same-origin',
        headers,
        body: JSON.stringify(pacote)
      }).catch(() => {
        // Servidor estático ou sessão não autenticada
      });
    }
  }

  function restaurarDadosPadrao() {
    localStorage.removeItem(CHAVE_STORAGE_ADMIN);
    estado.cacheGeoJsonLotes = {};
  }

  return {
    inicializar,
    carregarGeoJsonLote,
    filtrarLinhas,
    obterLinhaPorId,
    obterDadosLinhaNoDia,
    obterParadasPorDia,
    obterParadaPorId,
    buscarParadasMaisProximas,
    buscarSugestoesEndereco,
    buscarSugestoesEnderecoLocal,
    calcularLinhasViagem,
    estaNaAreaDeAtendimento,
    montarEtapasViagem,
    obterHorarioBrasilia,
    ehHorarioMadrugada,
    ehLinhaCorujao,
    recalcularVinculosParadaEGrafo,
    criarOuEditarParadaNoMapa,
    moverParadaNoMapa,
    excluirParadaNoMapa,
    obterCoordenadasRota,
    atualizarRotaNoMapa,
    obterVinculosLinhaParadas,
    exportarPacoteCompletoJson,
    importarJsonAdmin,
    converterKmlTextoParaGeoJson,
    restaurarDadosPadrao,
    definirTokenAdmin,
    obterEstado: () => estado
  };
})();
