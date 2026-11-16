/**
 * Script utilitário (Zero Dependências NPM) para converter arquivos .KMZ / .KML
 * da pasta ./rotas/ em arquivos GeoJSON simplificados na pasta ./dados/
 *
 * Suporta tanto:
 * - Arquivos completos por dia operacional (ex: "Sistema Estrutural uteis e sabado.kmz" e "Sistem Estrutural domingo.kmz"),
 *   onde as pastas internas são categorias ("Terminais Estruturais", "Terminais Comuns", "Estruturais", "Bairro", "Regional", "Diretas", "Corujões")
 * - Quanto arquivos individuais por linha (ex: "Mapa da linha B1.kmz"), onde as pastas internas são os dias da semana!
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROTAS_DIR = path.join(__dirname, '..', 'rotas');
const DADOS_DIR = path.join(__dirname, '..', 'dados');
const TOLERANCIA_RDP = 0.00005; // ~5.5m no equador / Natal-RN

if (!fs.existsSync(DADOS_DIR)) {
  fs.mkdirSync(DADOS_DIR, { recursive: true });
}

function distanciaPontoSegmento(p, a, b) {
  let x = a[0], y = a[1];
  let dx = b[0] - x, dy = b[1] - y;
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

function simplificarGeometria(coords, tolerancia = TOLERANCIA_RDP) {
  if (!Array.isArray(coords) || coords.length <= 2) {
    return coords.map(c => [Number(c[0].toFixed(5)), Number(c[1].toFixed(5))]);
  }

  let dmax = 0;
  let index = 0;
  const fim = coords.length - 1;

  for (let i = 1; i < fim; i++) {
    const d = distanciaPontoSegmento(coords[i], coords[0], coords[fim]);
    if (d > dmax) {
      index = i;
      dmax = d;
    }
  }

  if (dmax > tolerancia) {
    const rec1 = simplificarGeometria(coords.slice(0, index + 1), tolerancia);
    const rec2 = simplificarGeometria(coords.slice(index), tolerancia);
    return rec1.slice(0, rec1.length - 1).concat(rec2);
  } else {
    return [
      [Number(coords[0][0].toFixed(5)), Number(coords[0][1].toFixed(5))],
      [Number(coords[fim][0].toFixed(5)), Number(coords[fim][1].toFixed(5))]
    ];
  }
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

/**
 * Identifica o dia da semana combinando o nome da pasta (<Folder>) e o nome do arquivo (.kmz).
 * - Se a pasta especifica o dia ("Dias úteis e sábados", "Domingos e feriados"), usa a pasta.
 * - Se a pasta é uma categoria ("Bairro", "Estruturais", "Regional", "Diretas", "Corujões", "Terminais"),
 *   identifica o dia pelo nome do arquivo ("uteis e sabado" vs "domingo").
 */
function normalizarDiaSemana(nomePasta, nomeArquivo) {
  const p = (nomePasta || '').toLowerCase();
  const a = (nomeArquivo || '').toLowerCase();

  const pUtil = p.includes('úteis') || p.includes('uteis') || p.includes('sábado') || p.includes('sabado');
  const pDom = p.includes('domingo') || p.includes('feriado');

  if (pUtil && pDom) {
    return {
      codigo: 'todos',
      codigosLista: ['dias_uteis_sabados', 'domingos_feriados'],
      rotulo: 'Dias úteis, sábados, domingos e feriados'
    };
  }
  if (pDom) {
    return {
      codigo: 'domingos_feriados',
      codigosLista: ['domingos_feriados'],
      rotulo: 'Domingos e feriados'
    };
  }
  if (pUtil) {
    return {
      codigo: 'dias_uteis_sabados',
      codigosLista: ['dias_uteis_sabados'],
      rotulo: 'Dias úteis e sábados'
    };
  }

  // Caso a pasta seja o tipo de linha ("Bairro", "Estruturais", etc.), olha para o nome do arquivo
  const aUtil = a.includes('úteis') || a.includes('uteis') || a.includes('sábado') || a.includes('sabado');
  const aDom = a.includes('domingo') || a.includes('feriado');

  if (aUtil && aDom) {
    return {
      codigo: 'todos',
      codigosLista: ['dias_uteis_sabados', 'domingos_feriados'],
      rotulo: 'Dias úteis, sábados, domingos e feriados'
    };
  }
  if (aDom) {
    return {
      codigo: 'domingos_feriados',
      codigosLista: ['domingos_feriados'],
      rotulo: 'Domingos e feriados'
    };
  }
  if (aUtil) {
    return {
      codigo: 'dias_uteis_sabados',
      codigosLista: ['dias_uteis_sabados'],
      rotulo: 'Dias úteis e sábados'
    };
  }

  return {
    codigo: 'dias_uteis_sabados',
    codigosLista: ['dias_uteis_sabados'],
    rotulo: 'Dias úteis e sábados'
  };
}

function inferirTipoLinha(numero, nomePasta = '') {
  const cod = (numero || '').toUpperCase().trim();
  const pastaLow = (nomePasta || '').toLowerCase();

  if (cod.startsWith('B') || pastaLow.includes('bairro')) {
    return { tipo: 'alimentadora', categoria_edital: 'Linha de Bairro' };
  }
  if (cod.startsWith('E') || pastaLow.includes('estrutur')) {
    return { tipo: 'expressa', categoria_edital: 'Linha Estrutural' };
  }
  if (cod.startsWith('D') || pastaLow.includes('direta')) {
    return { tipo: 'expressa', categoria_edital: 'Linha Direta' };
  }
  if (cod.startsWith('R') || pastaLow.includes('region')) {
    return { tipo: 'convencional', categoria_edital: 'Linha Regional' };
  }
  if (cod.startsWith('C') || pastaLow.includes('coruj')) {
    return { tipo: 'noturna', categoria_edital: 'Linha Corujão (Noturna)' };
  }
  return { tipo: 'convencional', categoria_edital: 'Convencional' };
}

function extrairCorEstilo(styleUrl, padrao = '#0057B8') {
  if (!styleUrl) return padrao;
  const m = styleUrl.match(/line-([0-9A-Fa-f]{6})/);
  if (m) return `#${m[1].toUpperCase()}`;
  return padrao;
}

function analisarDescricao(descRaw) {
  const texto = (descRaw || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .trim();

  let extensaoKm = null;
  const matchExt = texto.match(/EXTENSAO:\s*([0-9.,]+)/i);
  if (matchExt && matchExt[1]) {
    extensaoKm = parseFloat(matchExt[1].replace(',', '.'));
  }

  const integracoes = [];
  const codigosCitados = new Set();
  const linhasTexto = texto.split('\n').map(l => l.trim()).filter(Boolean);
  let grupoAtual = '';

  for (const linha of linhasTexto) {
    if (linha.startsWith('>>')) {
      grupoAtual = linha.replace(/^>>\s*/, '').replace(/:$/, '').trim();
    } else if (linha.startsWith('>')) {
      const item = linha.replace(/^>\s*/, '').trim();
      if (item) {
        integracoes.push(grupoAtual ? `${item} (${grupoAtual})` : item);
        const codMatch = item.match(/^([A-Z0-9]+)\s*-/i);
        if (codMatch) {
          codigosCitados.add(codMatch[1].toUpperCase());
        }
      }
    }
  }

  return { extensaoKm, integracoes, codigosCitados: Array.from(codigosCitados), textoLimpo: texto };
}

function limparCdata(str) {
  return String(str || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .trim();
}

function parsearKml(conteudoKml) {
  const pastas = [];
  const regexFolder = /<Folder>([\s\S]*?)<\/Folder>/gi;
  let matchFolder;

  while ((matchFolder = regexFolder.exec(conteudoKml)) !== null) {
    const blocoFolder = matchFolder[1];
    const matchNomeFolder = blocoFolder.match(/<name>([\s\S]*?)<\/name>/i);
    const nomeFolder = matchNomeFolder ? limparCdata(matchNomeFolder[1]) : 'Geral';

    const placemarks = [];
    const regexPlacemark = /<Placemark>([\s\S]*?)<\/Placemark>/gi;
    let matchPm;

    while ((matchPm = regexPlacemark.exec(blocoFolder)) !== null) {
      const blocoPm = matchPm[1];
      const nomePm = limparCdata(blocoPm.match(/<name>([\s\S]*?)<\/name>/i)?.[1] || '');
      const styleUrl = (blocoPm.match(/<styleUrl>([\s\S]*?)<\/styleUrl>/i)?.[1] || '').trim();
      const descRaw = (blocoPm.match(/<description>([\s\S]*?)<\/description>/i)?.[1] || '').trim();

      const matchPoint = blocoPm.match(/<Point>[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>[\s\S]*?<\/Point>/i);
      const matchLine = blocoPm.match(/<LineString>[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>[\s\S]*?<\/LineString>/i);

      if (matchPoint) {
        const parts = matchPoint[1].trim().split(',').map(Number);
        if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
          placemarks.push({
            tipoGeometria: 'Point',
            nome: nomePm,
             pastaOrigem: nomeFolder,
            styleUrl,
            descricao: descRaw,
            coordenadas: [Number(parts[0].toFixed(6)), Number(parts[1].toFixed(6))]
          });
        }
      } else if (matchLine) {
        const rawCoords = matchLine[1]
          .trim()
          .split(/\s+/)
          .map(par => par.split(',').map(Number))
          .filter(par => par.length >= 2 && !isNaN(par[0]) && !isNaN(par[1]));

        placemarks.push({
          tipoGeometria: 'LineString',
          nome: nomePm,
          pastaOrigem: nomeFolder,
          styleUrl,
          descricao: descRaw,
          coordenadasBrutas: rawCoords
        });
      }
    }

    pastas.push({ nomeFolder, placemarks });
  }

  return pastas;
}

function lerKmlDeArquivo(caminhoArquivo) {
  const ext = path.extname(caminhoArquivo).toLowerCase();
  if (ext === '.kml') {
    return fs.readFileSync(caminhoArquivo, 'utf8');
  }
  if (ext === '.kmz') {
    const cmd = `
      Add-Type -AssemblyName System.IO.Compression.FileSystem;
      [Console]::OutputEncoding = [System.Text.Encoding]::UTF8;
      $zip = [System.IO.Compression.ZipFile]::OpenRead('${caminhoArquivo.replace(/'/g, "''")}');
      $entry = $zip.Entries | Where-Object { $_.FullName -like '*.kml' } | Select-Object -First 1;
      $reader = New-Object System.IO.StreamReader($entry.Open(), [System.Text.Encoding]::UTF8);
      Write-Output $reader.ReadToEnd();
      $reader.Close();
      $zip.Dispose();
    `;
    return execFileSync('powershell.exe', ['-NoProfile', '-Command', cmd], { encoding: 'utf8' });
  }
  return null;
}

/**
 * Registra ou consolida todos os pontos (Terminais Estruturais, Terminais Comuns e Pontos de Integração)
 */
function registrarPontoConsolidado(featuresParadas, pmPonto, infoDia, contadorRef) {
  const infoPonto = analisarDescricao(pmPonto.descricao);
  const nomeP = pmPonto.nome;
  const nomeLower = nomeP.toLowerCase();
  const [lng, lat] = pmPonto.coordenadas;

  let sentidosAtendidos = 'ambos';
  if (nomeLower.includes('- ida') || nomeLower.endsWith(' ida')) {
    sentidosAtendidos = 'ida';
  } else if (nomeLower.includes('- volta') || nomeLower.endsWith(' volta')) {
    sentidosAtendidos = 'volta';
  }

  let existente = featuresParadas.find(f => {
    const [fLng, fLat] = f.geometry.coordinates;
    const distGraus = Math.hypot(fLng - lng, fLat - lat);
    return distGraus < 0.00055 && f.properties.sentidos_atendidos === sentidosAtendidos;
  });

  if (!existente) {
    let tipoParada = 'parada';
    if (nomeLower.includes('terminal')) {
      tipoParada = 'terminal';
    } else if (
      nomeLower.includes('integração') ||
      nomeLower.includes('integracao') ||
      nomeLower.includes('estação') ||
      nomeLower.includes('estacao')
    ) {
      tipoParada = 'ponto de integração';
    }

    const idParada = `P-${String(contadorRef.valor++).padStart(3, '0')}`;
    existente = {
      type: 'Feature',
      properties: {
        id: idParada,
        nome: nomeP,
        tipo: tipoParada,
        acessivel: 'sim',
        rotas: [],
        dias_semana: [],
        dia_rotulo: infoDia.rotulo,
        sentidos_atendidos: sentidosAtendidos,
        integracoes_descricao: [],
        _codigosCitados: []
      },
      geometry: {
        type: 'Point',
        coordinates: pmPonto.coordenadas
      }
    };
    featuresParadas.push(existente);
  }

  for (const codDia of infoDia.codigosLista) {
    if (!existente.properties.dias_semana.includes(codDia)) {
      existente.properties.dias_semana.push(codDia);
    }
  }
  if (
    existente.properties.dias_semana.includes('dias_uteis_sabados') &&
    existente.properties.dias_semana.includes('domingos_feriados')
  ) {
    existente.properties.dia_rotulo = 'Dias úteis, sábados, domingos e feriados';
  }

  for (const intg of infoPonto.integracoes) {
    if (!existente.properties.integracoes_descricao.includes(intg)) {
      existente.properties.integracoes_descricao.push(intg);
    }
  }
  for (const cod of infoPonto.codigosCitados) {
    if (!existente.properties._codigosCitados.includes(cod)) {
      existente.properties._codigosCitados.push(cod);
    }
  }

  return existente;
}

/**
 * Verifica se uma linha passa próximo a um terminal/ponto (distância mínima ponto-segmento < ~180m)
 */
function linhaPassaPertoDoPonto(coordsLinha, coordPonto, limiteGraus = 0.0017) {
  for (let i = 0; i < coordsLinha.length - 1; i++) {
    const d = distanciaPontoSegmento(coordPonto, coordsLinha[i], coordsLinha[i + 1]);
    if (d <= limiteGraus) return true;
  }
  return false;
}

function executarConversao() {
  const arquivos = fs.existsSync(ROTAS_DIR)
    ? fs
        .readdirSync(ROTAS_DIR)
        .filter(f => /\.(kmz|kml)$/i.test(f))
        .sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true }))
    : [];

  console.log(`Encontrados ${arquivos.length} arquivo(s) em ./rotas/`);

  const mapaLinhas = new Map();
  const featuresLote1 = [];
  const featuresLote2 = [];
  const featuresParadas = [];
  const contadorRef = { valor: 1 };

  for (const arquivo of arquivos) {
    const caminho = path.join(ROTAS_DIR, arquivo);
    console.log(`Processando: ${arquivo}...`);
    const kml = lerKmlDeArquivo(caminho);
    if (!kml) continue;

    const pastas = parsearKml(kml);

    // 1ª Passada no arquivo: registra todos os Terminais e Pontos de Integração do arquivo
    const pontosDoArquivo = [];
    for (const pasta of pastas) {
      const infoDia = normalizarDiaSemana(pasta.nomeFolder, arquivo);
      for (const pm of pasta.placemarks) {
        if (pm.tipoGeometria === 'Point') {
          const featPonto = registrarPontoConsolidado(featuresParadas, pm, infoDia, contadorRef);
          pontosDoArquivo.push(featPonto);
        }
      }
    }

    // 2ª Passada no arquivo: processa todas as Linhas (Estruturais, Bairro, Regional, Diretas, Corujões)
    for (const pasta of pastas) {
      const infoDia = normalizarDiaSemana(pasta.nomeFolder, arquivo);
      const linhasDaPasta = pasta.placemarks.filter(p => p.tipoGeometria === 'LineString');

      for (const pmLinha of linhasDaPasta) {
        const partesNome = pmLinha.nome.split(/\s*-\s*/);
        const numeroLinha = (partesNome[0] || 'S/N').trim();
        const nomeLinha = partesNome.slice(1).join(' - ').trim() || pmLinha.nome;
        const { tipo, categoria_edital } = inferirTipoLinha(numeroLinha, pasta.nomeFolder);
        const { extensaoKm } = analisarDescricao(pmLinha.descricao);
        const cor = extrairCorEstilo(pmLinha.styleUrl, '#0057B8');

        const coordsSimplificadas = simplificarGeometria(pmLinha.coordenadasBrutas, TOLERANCIA_RDP);
        const bbox = calcularBbox(coordsSimplificadas);

        // Classificação oficial de Lote:
        // Lote 1 = Norte (linhas com origem ou operação predominante na Zona Norte, lat > -5.772)
        // Lote 2 = Sul / Leste / Oeste
        const latInicial = coordsSimplificadas[0] ? coordsSimplificadas[0][1] : -5.74;
        const latFinal = coordsSimplificadas[coordsSimplificadas.length - 1]
          ? coordsSimplificadas[coordsSimplificadas.length - 1][1]
          : -5.74;
        const loteInferido = latInicial > -5.772 || (numeroLinha.startsWith('B') && latFinal > -5.772) ? '1' : '2';
        const lote = mapaLinhas.has(numeroLinha) ? mapaLinhas.get(numeroLinha).lote : loteInferido;

        const idsParadasVariante = [];
        const integracoesVariante = new Set();

        // Vincula os terminais/estações deste arquivo que atendem esta linha:
        // Critério 1: o terminal cita explicitamente o código da linha na descrição; OU
        // Critério 2: o traçado da linha passa a menos de ~180m do terminal!
        for (const featPonto of pontosDoArquivo) {
          const codUpper = numeroLinha.toUpperCase();
          const citadoNaDesc = (featPonto.properties._codigosCitados || []).includes(codUpper);
          const passaPerto = linhaPassaPertoDoPonto(coordsSimplificadas, featPonto.geometry.coordinates, 0.0017);

          if (citadoNaDesc || passaPerto) {
            if (!featPonto.properties.rotas.includes(numeroLinha)) {
              featPonto.properties.rotas.push(numeroLinha);
            }
            if (!idsParadasVariante.includes(featPonto.properties.id)) {
              idsParadasVariante.push(featPonto.properties.id);
            }
            for (const intg of featPonto.properties.integracoes_descricao || []) {
              if (!intg.toUpperCase().startsWith(`${codUpper} -`)) {
                integracoesVariante.add(intg);
              }
            }
          }
        }

        for (const codDia of infoDia.codigosLista) {
          const rotuloDia = codDia === 'domingos_feriados' ? 'Domingos e feriados' : 'Dias úteis e sábados';
          const idVariante = `${numeroLinha}-${codDia}`;

          const featureLinha = {
            type: 'Feature',
            properties: {
              id: idVariante,
              linha_id: numeroLinha,
              numero: numeroLinha,
              nome: nomeLinha,
              lote,
              tipo,
              categoria_edital,
              sentido: 'ambos',
              dia_semana: codDia,
              dia_rotulo: rotuloDia,
              extensao_km: extensaoKm,
              cor
            },
            geometry: {
              type: 'LineString',
              coordinates: coordsSimplificadas
            }
          };

          const listaAlvo = lote === '1' ? featuresLote1 : featuresLote2;
          const idxExistente = listaAlvo.findIndex(f => f.properties.id === idVariante);
          if (idxExistente >= 0) {
            listaAlvo[idxExistente] = featureLinha;
          } else {
            listaAlvo.push(featureLinha);
          }

          if (!mapaLinhas.has(numeroLinha)) {
            mapaLinhas.set(numeroLinha, {
              id: numeroLinha,
              numero: numeroLinha,
              nome: nomeLinha,
              lote,
              tipo,
              categoria_edital,
              sentido: 'ambos',
              cor,
              acessivel: true,
              tarifa: 'Tarifa Social / Sistema Natal (conforme edital)',
              frequencia_pico: 'Consultar quadro de horários do edital',
              frequencia_entre_pico: 'Consultar quadro de horários do edital',
              horario_operacao: codDia && tipo === 'noturna' ? '23:00 às 04:40 (Corujão)' : '05:00 às 23:00',
              ordem_confirmada_por_sentido: false,
              dias_disponiveis: [],
              variantes_dia: {},
              bbox
            });
          }

          const registroLinha = mapaLinhas.get(numeroLinha);
          if (!registroLinha.dias_disponiveis.includes(codDia)) {
            registroLinha.dias_disponiveis.push(codDia);
          }
          registroLinha.variantes_dia[codDia] = {
            dia_semana: codDia,
            dia_rotulo: rotuloDia,
            nome: nomeLinha,
            extensao_km: extensaoKm,
            cor,
            sentido: 'ambos',
            paradas_atendidas: idsParadasVariante,
            integracoes: Array.from(integracoesVariante),
            bbox
          };

          registroLinha.bbox = [
            Math.min(registroLinha.bbox[0], bbox[0]),
            Math.min(registroLinha.bbox[1], bbox[1]),
            Math.max(registroLinha.bbox[2], bbox[2]),
            Math.max(registroLinha.bbox[3], bbox[3])
          ];
        }
      }
    }
  }

  // Remove propriedade temporária _codigosCitados das paradas
  for (const fp of featuresParadas) {
    delete fp.properties._codigosCitados;
  }

  // Ordena as linhas de forma natural (B1, B2.. E1, E2.. R1.. D1.. C1..)
  const ordemCategorias = { B: 1, E: 2, R: 3, D: 4, C: 5 };
  const linhasOrdenadas = Array.from(mapaLinhas.values()).sort((a, b) => {
    const catA = ordemCategorias[a.numero[0]?.toUpperCase()] || 9;
    const catB = ordemCategorias[b.numero[0]?.toUpperCase()] || 9;
    if (catA !== catB) return catA - catB;
    return a.numero.localeCompare(b.numero, 'pt-BR', { numeric: true });
  });

  const indiceLinhas = {
    versao: '2023.021-natal',
    atualizado_em: new Date().toISOString(),
    aviso_sentido_padrao:
      'A ida e a volta utilizam o mesmo traçado no mapa. A ordem das paradas por sentido deve ser confirmada no edital.',
    lotes: [
      {
        id: '1',
        nome: 'Lote 1 (Norte)',
        cor: '#0057B8',
        arquivo: 'dados/lote-1.geojson'
      },
      {
        id: '2',
        nome: 'Lote 2 (Sul / Leste / Oeste)',
        cor: '#D9531E',
        arquivo: 'dados/lote-2.geojson'
      }
    ],
    dias_operacionais: [
      { codigo: 'dias_uteis_sabados', rotulo: 'Dias úteis e sábados' },
      { codigo: 'domingos_feriados', rotulo: 'Domingos e feriados' }
    ],
    linhas: linhasOrdenadas
  };

  fs.writeFileSync(path.join(DADOS_DIR, 'linhas.json'), JSON.stringify(indiceLinhas, null, 2), 'utf8');
  fs.writeFileSync(
    path.join(DADOS_DIR, 'lote-1.geojson'),
    JSON.stringify({ type: 'FeatureCollection', features: featuresLote1 }, null, 2),
    'utf8'
  );
  fs.writeFileSync(
    path.join(DADOS_DIR, 'lote-2.geojson'),
    JSON.stringify({ type: 'FeatureCollection', features: featuresLote2 }, null, 2),
    'utf8'
  );
  fs.writeFileSync(
    path.join(DADOS_DIR, 'paradas.json'),
    JSON.stringify({ type: 'FeatureCollection', features: featuresParadas }, null, 2),
    'utf8'
  );

  console.log('\nConversão concluída com sucesso!');
  console.log(`- Total de linhas consolidadas: ${indiceLinhas.linhas.length}`);
  console.log(`- Traçados no Lote 1 (Norte): ${featuresLote1.length}`);
  console.log(`- Traçados no Lote 2 (Sul/Leste/Oeste): ${featuresLote2.length}`);
  console.log(`- Terminais/Estações consolidados: ${featuresParadas.length}`);
}

executarConversao();
