/**
 * scripts/aplicar-rede-transicao-2026.js
 *
 * Alinha dados/linhas.json (e as propriedades dos traçados em dados/lote-*.geojson)
 * com a Rede de Transição do edital da Concorrência Pública nº 11.001/2026
 * (Anexo I.3, Tabela 14 — "Denominação das linhas que compõem a Rede de Transição",
 * e Tabela 17 — lote de cada linha).
 *
 * O que ele faz:
 *  - Linhas que estão na Tabela 14: recebem o nome oficial e, da Tabela 17, o lote, os dias de
 *    operação e os dados operacionais (intervalos, frota, veículo, extensão, viagens/mês).
 *  - Linhas do site que NÃO estão na Tabela 14 (projeto de 2021 / Rede Meta) são REMOVIDAS
 *    (linhas, traçados, vínculos de paradas). Paradas que só atendiam essas linhas ficam inativas.
 *  - Linhas da Tabela 14 que o site não tem (ex.: B23 e as linhas atuais N-02, O-21...):
 *    são incluídas sem traçado, com situacao_rota = "indefinida".
 *  - Linhas cujo itinerário mudou no edital em relação ao traçado de 2021:
 *    situacao_rota = "alterada" (o site avisa que o traçado pode estar desatualizado).
 *
 * Pode ser rodado de novo sem problema (é idempotente):
 *   node scripts/aplicar-rede-transicao-2026.js
 * Depois, regenere as páginas por linha:
 *   node scripts/gerar-paginas-seo.js
 *
 * ATENÇÃO: scripts/converter-kmz.js recria dados/linhas.json a partir dos KMZ e apaga
 * estas marcações. Se ele rodar, rode este script de novo em seguida.
 */

const fs = require('fs');
const path = require('path');

const DADOS = path.join(__dirname, '..', 'dados');
const ARQ_LINHAS = path.join(DADOS, 'linhas.json');

// [numero, nome oficial, lote ('1' Norte | '2' Sul/Leste/Oeste | null = não informado na Tabela 17)]
const REDE_TRANSICAO = [
  ["B4", "Nova Natal/Terminal Soledade, via Av. Cidade Praia", '1'],
  ["B5", "José Sarney/Terminal Soledade, via Soledade II", '1'],
  ["B6A", "Terminal Soledade/Nova Jerusalém/Nordelândia, via Nova Natal", '1'],
  ["B6B", "Terminal Soledade/Nordelândia/Nova Jerusalém, via Nova Natal", '1'],
  ["B9", "Amarante/Igapó", '1'],
  ["B15", "Terminal Cidade da Esperança/Felipe Camarão, via Rua Padre Cícero", '2'],
  ["B16", "Terminal Cidade da Esperança/Felipe Camarão, via Cidade Nova", '2'],
  ["B17", "Terminal Cidade da Esperança/Jardim América", '2'],
  ["B18", "Guarapes/Terminal Cidade da Esperança, via KM-06", '2'],
  ["B19", "Terminal Cidade da Esperança/Nova Cidade", '2'],
  ["B21A", "UFRN", '2'],
  ["B21B", "UFRN - Expresso Reitoria", '2'],
  ["B21C", "UFRN - Expresso C&T", '2'],
  ["B23", "África/Viaduto da Redinha", '1'],
  ["E3", "Terminal Soledade/Cidade Alta, via Ponte Newton Navarro", '1'],
  ["E4", "Terminal Soledade/Mirassol, via Ponte Newton Navarro", '1'],
  ["E5", "Terminal Soledade/Candelária, via Ponte Newton Navarro/Av. Prudente de Morais", '1'],
  ["E6", "Terminal Soledade/Ponta Negra, via Ponte de Igapó", '2'],
  ["E7", "Terminal Soledade/Ribeira, via Ponte de Igapó", '1'],
  ["E14A", "Terminal Cidade da Esperança/Petrópolis (ida Av. Prudente de Morais/volta Av. Sen. Salgado Filho)", '2'],
  ["E14B", "Terminal Cidade da Esperança/Petrópolis (ida Av. Sen. Salgado Filho/volta Av. Prudente de Morais)", '2'],
  ["E15", "Terminal Cidade da Esperança/Mirassol", '2'],
  ["R1", "Parque das Dunas/Panatis, via Rua Castelo Branco/Av. Pompéia", '1'],
  ["R2", "Santa Cecília/Panatis, via Rua Norte Brasil/Av. Pompéia", '1'],
  ["R5", "Nova Natal/Santa Catarina, via Rua Bela Vista", '1'],
  ["R7", "Vale Dourado/Santa Catarina, via Av. Santarém", '1'],
  ["R8", "Parque dos Coqueiros/Santa Catarina, via Vila Paraíso", '1'],
  ["R9", "Terminal Soledade/Residencial Redinha, via Soledade II/Mar del Plata", '1'],
  ["R10", "Redinha/Santa Catarina", '1'],
  ["R12", "Terminal Cidade Satélite/Candelária, via San Valle", '2'],
  ["R13A", "Praia do Meio/Mãe Luíza/Ribeira, via Santos Reis", '2'],
  ["R13B", "Santos Reis/Ribeira/Mãe Luíza, via Praia do Meio/Brasília Teimosa", '2'],
  ["R14", "Praia do Meio/Mãe Luíza/Alecrim", '2'],
  ["R15", "Terminal Mirassol/Nova Descoberta/Lagoa Nova", '2'],
  ["R17", "Serrambi/Terminal Mirassol, via Av. das Alagoas", '2'],
  ["R18", "Terminal Mirassol/Capim Macio", '2'],
  ["R19A", "Terminal Mirassol/Ponta Negra (ida conj./volta vila)", '2'],
  ["R19B", "Terminal Mirassol/Ponta Negra (ida vila/volta conj.)", '2'],
  ["D2", "Bom Pastor/Alecrim, via KM-06", '2'],
  ["D3", "Bom Pastor/Nova Descoberta, via Lagoa Nova (ida Av. Amintas Barros/volta Av. Miguel Castro)", '2'],
  ["D4", "Bom Pastor/Morro Branco, via Lagoa Nova (ida Av. Antônio Basílio/volta Av. Nascimento de Castro)", '2'],
  ["D5", "Terminal Cidade da Esperança/Candelária, via Nova Cidade", '2'],
  ["D6A", "Terminal Cidade da Esperança/Pajuçara (ida Av. das Fronteiras/volta Av. Dr. João Medeiros Filho)", '1'],
  ["D6B", "Terminal Cidade da Esperança/Pajuçara (ida Av. Dr. João Medeiros Filho/volta Av. das Fronteiras)", '1'],
  ["D7", "Bairro Nordeste/Alecrim", '2'],
  ["D8", "Rocas/Lagoa Nova, via Av. Alm. Alexandrino de Alencar", '2'],
  ["D9", "Rocas/Ponta Negra, via Via Costeira", '2'],
  ["N-02", "Gramoré/CRI, via Midway Mall", '1'],
  ["N-05", "Vale Dourado/Ribeira, via Petrópolis", '1'],
  ["N-07", "Alvorada IV/Mirassol, via Av. Nevaldo Rocha", '1'],
  ["N-15", "Pajuçara/Ribeira, via Petrópolis", '1'],
  ["N-27", "Alvorada IV/Ribeira, via Av. Deodoro da Fonseca", '1'],
  ["O-41A", "Leningrado/Ribeira, via Av. Prudente de Morais", '2'],
  ["L-52", "Rocas/Pirangi, via Alecrim", '2'],
  ["O-59", "Guarapes/Praia do Meio, via Bom Pastor", '2'],
  ["N-60", "Pajuçara/Mirassol, via Av. Nevaldo Rocha", '1'],
  ["N-70", "Parque dos Coqueiros/Ribeira, via Petrópolis", '1'],
  ["N-72", "Vale Dourado/Mirassol, via Av. Nevaldo Rocha", '1'],
  ["N-77", "Parque dos Coqueiros/Mirassol, via Av. Nevaldo Rocha", '1'],
  ["N-84", "Soledade/Petrópolis, Via Av. Moema Tinoco da Cunha Lima", '1'],
  ["585", "Encanto Verde/Village de Prata, via Planalto", '2'],
  ["587", "Guarapes/Village de Prata, via Planalto", '2'],
  ["O-21", "Felipe Camarão/Petrópolis, via Alecrim", '2'],
  ["O-24", "Planalto/Cidade Alta, via Rua Jaguarari", '2'],
  ["O-33", "Planalto/Petrópolis, via BR-101/Av. Prudente de Morais", '2'],
  ["O-33A", "Planalto/Petrópolis, via Av. Prudente de Morais/Av. Sen. Salgado Filho", '2'],
  ["L-37", "Rocas/Cidade Satélite, via Praça", '2'],
  ["O-38", "Planalto/Ribeira, via Av. 6", '2'],
  ["L-46", "Rocas/Ponta Negra, via Praça", '2'],
  ["L-51", "Rocas/Pirangi, via Praça", '2'],
  ["L-54", "Rocas/Ponta Negra, via Alecrim", '2'],
  ["O-63", "Felipe Camarão/Morro Branco, via Av. Nevaldo Rocha", '1'],
  ["N-75", "Parque das Dunas/Alecrim", '1'],
  ["N-79", "Parque das Dunas/Mirassol, via Av. Hermes da Fonseca", '1'],
  ["O-83", "Felipe Camarão/Ponta Negra, via Cidade Satélite", '2'],
  ["C1", "Ribeira/Cidade Alta/Petrópolis/Alecrim/Redinha/Brasil Novo/P. Dunas/Vila Verde/Pajuçara/Gramoré/Nova Natal, via Av. Pompéia", null],
  ["C2", "Ribeira/Cidade Alta/Petrópolis/Alecrim/P. Coqueiros/Vale Dourado/Panatis/Soledade/Santarém/Petrópolis/Praia do Meio, via Av. Itapetinga", null],
  ["C3", "Ribeira/Cidade Alta/Petrópolis/Areia Preta/Via Costeira/Ponta Negra, via Praia Shopping", null],
  ["C4", "Ribeira/Cidade Alta/Petrópolis/Alecrim/Quintas/Bom Pastor/Felipe Camarão", null],
  ["C5", "Ribeira/Cidade Alta/Petrópolis/Candelária/Cidade Satélite/Planalto/Guarapes, via Av. Prudente de Morais", null],
  ["C6", "Ribeira/Cidade Alta/Alecrim/Morro Branco/Nova Descoberta/Lagoa Nova, via Av. Pres. Bandeira", null],
  ["C7", "Ponta Negra/Morro Branco/Santarém/Soledade/Panatis/Alvorada IV/Vale Dourado/P. Coqueiros, via Ponte de Igapó/Av. Itapetinga", null],
  ["C8", "Ponta Negra/Praia do Meio/Redinha/Pq. Dunas/Vila Verde/Pajuçara/Gramoré/Nova Natal, via Ponte Newton Navarro/Av. Pompéia", null],
  ["C9", "Ponta Negra/Morro Branco/Dix-Sept Rosado/Nazaré/Cidade da Esperança/Cidade Nova/Felipe Camarão, via Av. Nevaldo Rocha", null],
  ["C10", "Ponta Negra/Pirangi/Serrambi, via Natal Shopping", null],
];


// Indicadores por linha da Tabela 17 do edital (lote, intervalos, frota, veículo, extensão...)
const TABELA17 = lerJson(path.join(__dirname, 'dados-edital-2026', 'tabela17-indicadores-por-linha.json'));

// Linhas cujo traçado de 2021 (o que está no mapa) não corresponde mais ao itinerário do edital 2026
const ROTA_ALTERADA = {
  B9: 'O edital de 2026 mudou o destino desta linha para Igapó (antes: Santa Catarina).',
  B18: 'O edital de 2026 estendeu esta linha até Guarapes.',
  C5: 'O edital de 2026 estendeu esta linha até Guarapes.',
  C9: 'O edital de 2026 mudou o eixo desta linha para a Av. Nevaldo Rocha (antes: Av. Bernardo Vieira).',
  E7: 'O edital de 2026 mudou o destino desta linha para a Ribeira (antes: Praia do Meio).'
};

// Observações para linhas ainda sem traçado
const AVISO_SEM_ROTA = {
  'N-79': 'A N-79 terá alterações em relação ao trajeto atual que ainda não foram descritas em mapa.'
};

function categoriaPorCodigo(numero) {
  const n = String(numero).toUpperCase();
  if (/^[NSLO]-|^\d+$/.test(n)) return { tipo: 'atual', categoria_edital: 'Linha Atual (mantida)' };
  if (n.startsWith('B')) return { tipo: 'alimentadora', categoria_edital: 'Linha de Bairro' };
  if (n.startsWith('E')) return { tipo: 'expressa', categoria_edital: 'Linha Estrutural' };
  if (n.startsWith('R')) return { tipo: 'convencional', categoria_edital: 'Linha Regional' };
  if (n.startsWith('D')) return { tipo: 'expressa', categoria_edital: 'Linha Direta' };
  if (n.startsWith('C')) return { tipo: 'noturna', categoria_edital: 'Linha Corujão (Noturna)' };
  return { tipo: 'convencional', categoria_edital: 'Convencional' };
}

function lerJson(arq) {
  return JSON.parse(fs.readFileSync(arq, 'utf8').replace(/^﻿/, ''));
}

function salvarJson(arq, obj) {
  const texto = JSON.stringify(obj, null, 2);
  // No Windows o arquivo pode estar momentaneamente travado (servidor lendo, antivírus): tenta de novo
  for (let tentativa = 1; ; tentativa++) {
    try {
      fs.writeFileSync(arq, texto, 'utf8');
      return;
    } catch (err) {
      if (tentativa >= 8) throw err;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250 * tentativa);
    }
  }
}

/** Dias de operação a partir dos intervalos do edital (0 = não opera; null = Corujão, todas as noites) */
function diasPelaTabela17(t) {
  if (!t) return ['dias_uteis_sabados', 'domingos_feriados'];
  const opera = v => v === null || v > 0;
  const dias = [];
  if (opera(t.intervalo_du) || opera(t.intervalo_sab)) dias.push('dias_uteis_sabados');
  if (opera(t.intervalo_dom)) dias.push('domingos_feriados');
  return dias;
}

function textoIntervalo(min) {
  if (min === null || min === undefined) return 'Madrugada (Corujão)';
  return min > 0 ? `A cada ${Math.round(min)} min` : 'Não opera';
}

const ROTULO_DIA = { dias_uteis_sabados: 'Dias úteis e sábados', domingos_feriados: 'Domingos e feriados' };

const indice = lerJson(ARQ_LINHAS);
const oficiais = new Map(REDE_TRANSICAO.map(([numero, nome]) => [numero.toUpperCase(), { numero, nome }]));
const relatorio = { renomeadas: [], loteAlterado: [], incluidasSemRota: [], removidas: [], alteradas: [], domingoCopiado: [] };

// 1) Remove as linhas que não fazem parte da Rede de Transição (projeto de 2021 / Rede Meta)
indice.linhas = indice.linhas.filter(linha => {
  const fica = oficiais.has(String(linha.numero).toUpperCase());
  if (!fica) relatorio.removidas.push(linha.numero);
  return fica;
});
const removidas = new Set(relatorio.removidas.map(n => String(n).toUpperCase()));
// Também considera removidas as linhas que já tinham saído em execuções anteriores
const REDE_META_2021 = ['B1', 'B2', 'B3', 'B7', 'B8A', 'B8B', 'B10', 'B11', 'B12', 'B13', 'B14', 'B20', 'B22', 'E1', 'E2', 'E8', 'E9', 'E10A', 'E10B', 'E11', 'E12', 'E13', 'E16', 'R3', 'R4', 'R6A', 'R6B', 'R11', 'R16A', 'R16B', 'D1'];
for (const n of REDE_META_2021) removidas.add(n);
const citaRemovida = texto => removidas.has(String(texto).split(' - ')[0].trim().toUpperCase());

const porNumero = new Map(indice.linhas.map(l => [String(l.numero).toUpperCase(), l]));

// 2) Inclui as linhas oficiais que o site ainda não tem (sem traçado)
for (const { numero, nome } of oficiais.values()) {
  if (porNumero.has(numero.toUpperCase())) continue;
  const linha = {
    id: numero,
    numero,
    nome,
    lote: '2',
    ...categoriaPorCodigo(numero),
    sentido: 'ambos',
    cor: '#64748B',
    acessivel: true,
    tarifa: 'Tarifa Social / Sistema Natal (conforme edital)',
    ordem_confirmada_por_sentido: false,
    dias_disponiveis: [],
    variantes_dia: {},
    bbox: null
  };
  indice.linhas.push(linha);
  porNumero.set(numero.toUpperCase(), linha);
  relatorio.incluidasSemRota.push(numero);
}

// 2b) Linhas atuais mantidas: traçado gerado a partir do itinerário oficial (OSO da STTU)
//     Arquivo produzido por scripts/rotas-oso/ (ver README lá). Cada feature traz ida e volta.
const ARQ_ROTAS_OSO = path.join(DADOS, 'rotas-oso-sttu.geojson');
const rotasOso = fs.existsSync(ARQ_ROTAS_OSO) ? lerJson(ARQ_ROTAS_OSO).features : [];
const linhasOso = new Set(rotasOso.map(f => String(f.properties.numero).toUpperCase()));
const paradas = lerJson(path.join(DADOS, 'paradas.json'));
const linhaParadas = lerJson(path.join(DADOS, 'linha_paradas.json')).filter(
  lp => !removidas.has(String(lp.linha_id).toUpperCase()) && !linhasOso.has(String(lp.linha_id).toUpperCase())
);
const featuresOso = [];
const CORES_LINHAS_ATUAIS = ['#0F766E', '#B45309', '#7C3AED', '#BE123C', '#0369A1', '#4D7C0F', '#C2410C', '#6D28D9', '#047857', '#9D174D', '#1D4ED8', '#A16207', '#155E75', '#86198F', '#3F6212', '#9F1239', '#1E40AF', '#92400E'];

function distM(a, b) {
  const dx = (a[0] - b[0]) * 111320 * Math.cos((a[1] * Math.PI) / 180);
  return Math.hypot(dx, (a[1] - b[1]) * 110540);
}

/** Distância de um ponto a uma polilinha e posição (índice do segmento) mais próxima */
function projetar(p, coords) {
  let melhor = { d: Infinity, i: 0 };
  for (let i = 1; i < coords.length; i++) {
    const a = coords[i - 1];
    const b = coords[i];
    const kx = 111320 * Math.cos((p[1] * Math.PI) / 180);
    const ax = (a[0] - p[0]) * kx, ay = (a[1] - p[1]) * 110540;
    const bx = (b[0] - p[0]) * kx, by = (b[1] - p[1]) * 110540;
    const dx = bx - ax, dy = by - ay;
    const L2 = dx * dx + dy * dy || 1e-9;
    const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L2));
    const d = Math.hypot(ax + t * dx, ay + t * dy);
    if (d < melhor.d) melhor = { d, i: i - 1 + t };
  }
  return melhor;
}

function caixa(coords) {
  const xs = coords.map(c => c[0]);
  const ys = coords.map(c => c[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)].map(v => Number(v.toFixed(6)));
}

const nomeSimples = s =>
  String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/\bAV\.?\b/g, 'AVENIDA')
    .replace(/[^A-Z0-9]/g, '');

// linhas que tinham traçado de OSO numa execução anterior, mas não estão mais no arquivo: volta a "sem traçado"
for (const linha of indice.linhas) {
  const chave = String(linha.numero).toUpperCase();
  if (linha.fonte_rota && !linhasOso.has(chave)) {
    linha.variantes_dia = {};
    linha.bbox = null;
    delete linha.fonte_rota;
    linhasOso.add(chave); // para também limpar paradas e vínculos dela
  }
}
for (let i = linhaParadas.length - 1; i >= 0; i--) {
  if (linhasOso.has(String(linhaParadas[i].linha_id).toUpperCase())) linhaParadas.splice(i, 1);
}

// limpa vínculos antigos destas linhas nas paradas (o script pode ser rodado de novo)
for (const feat of paradas.features) {
  feat.properties.rotas = (feat.properties.rotas || []).filter(r => !linhasOso.has(String(r).toUpperCase()));
}

rotasOso.forEach((rota, idx) => {
  const po = rota.properties;
  const linha = porNumero.get(String(po.numero).toUpperCase());
  if (!linha) return;
  const ida = rota.geometry.coordinates[0];
  const volta = rota.geometry.coordinates[1] || [];
  const todos = [...ida, ...volta];
  const t = TABELA17[linha.numero];
  // A OSO publicada é a programação de DOMINGOS E FERIADOS (tarifa gratuita, itinerários de integração).
  // Por isso o traçado só vale para esse dia — e só se o edital prevê a linha operando aos domingos.
  linha.variantes_dia = {};
  delete linha.fonte_rota;
  if (!diasPelaTabela17(t).includes('domingos_feriados')) {
    relatorio.osoSemDomingo = (relatorio.osoSemDomingo || []).concat(linha.numero);
    return;
  }
  const dias = ['domingos_feriados'];
  linha.cor = CORES_LINHAS_ATUAIS[idx % CORES_LINHAS_ATUAIS.length];
  linha.fonte_rota = {
    tipo: 'OSO STTU',
    oso: po.oso,
    vigencia: po.vigencia,
    nome_oso: po.nome_oso,
    dia: 'Domingos e feriados',
    extensao_oso_km: po.extensao_oso_km,
    metodo: 'Traçado gerado a partir da sequência oficial de ruas da OSO sobre o mapa viário do OpenStreetMap'
  };

  // Paradas a até 25 m do trajeto, na ordem em que o ônibus passa
  const caixaRota = caixa(todos);
  const margem = 0.0004;
  const vinculos = { IDA: [], VOLTA: [] };
  for (const feat of paradas.features) {
    // paradas "virtuais" (pontos sintéticos a cada ~200 m do projeto de 2021) não entram
    if (feat.properties.origem === 'virtual') continue;
    const [lng, lat] = feat.geometry.coordinates;
    if (lng < caixaRota[0] - margem || lng > caixaRota[2] + margem || lat < caixaRota[1] - margem || lat > caixaRota[3] + margem) continue;
    const pi = projetar([lng, lat], ida);
    const pv = volta.length > 1 ? projetar([lng, lat], volta) : { d: Infinity };
    if (Math.min(pi.d, pv.d) > 25) continue;
    const p = feat.properties;
    if (!p.rotas.includes(linha.numero)) p.rotas.push(linha.numero);
    if (p.ativo === false) p.ativo = true;
    p.dias_semana = Array.from(new Set([...(p.dias_semana || []), ...dias]));
    if (pi.d <= 25) vinculos.IDA.push({ id: p.id, pos: pi.i });
    if (pv.d <= 25) vinculos.VOLTA.push({ id: p.id, pos: pv.i });
  }
  for (const s of ['IDA', 'VOLTA']) vinculos[s].sort((a, b) => a.pos - b.pos);
  const paradasAtendidas = Array.from(new Set([...vinculos.IDA, ...vinculos.VOLTA].map(v => v.id)));

  let km = 0;
  for (let i = 1; i < todos.length; i++) km += distM(todos[i - 1], todos[i]);
  const extensaoKm = Number((km / 1000).toFixed(3));
  const ruasCom = lista => lista.map((r, i) => ({ ordem: i + 1, logradouro: r.logradouro, bairro: 'Natal', lat: r.lat, lng: r.lng }));

  for (const dia of dias) {
    linha.variantes_dia[dia] = {
      dia_semana: dia,
      dia_rotulo: ROTULO_DIA[dia],
      nome: linha.nome,
      extensao_km: extensaoKm,
      cor: linha.cor,
      sentido: 'ambos',
      paradas_atendidas: paradasAtendidas,
      integracoes: [],
      itinerario_ruas: { ida: ruasCom(po.ruas_ida || []), volta: ruasCom(po.ruas_volta || []) },
      bbox: caixaRota
    };
    for (const s of ['IDA', 'VOLTA']) {
      let acumulado = 0;
      vinculos[s].forEach((v, ordem) => {
        linhaParadas.push({
          linha_id: linha.numero,
          dia_semana: dia,
          sentido: s,
          parada_id: v.id,
          ordem_sequencial: ordem + 1,
          distancia_acumulada_metros: Math.round(acumulado)
        });
        acumulado += 1; // posição relativa (o traçado não traz distância por parada)
      });
    }
    featuresOso.push({
      type: 'Feature',
      properties: {
        id: `${linha.numero}-${dia}`,
        linha_id: linha.numero,
        numero: linha.numero,
        nome: linha.nome,
        lote: String(linha.lote),
        tipo: linha.tipo,
        categoria_edital: linha.categoria_edital,
        sentido: 'ambos',
        dia_semana: dia,
        dia_rotulo: ROTULO_DIA[dia],
        extensao_km: extensaoKm,
        cor: linha.cor,
        fonte: 'OSO STTU',
        indice_retorno: ida.length - 1 // ponto em que a ida termina e a volta começa
      },
      geometry: { type: 'LineString', coordinates: todos }
    });
  }
  linha.bbox = caixaRota;

  relatorio.rotasOso = (relatorio.rotasOso || []).concat(`${linha.numero} (${paradasAtendidas.length} paradas)`);
});

// 3) Nome, lote, dias, operação e situação do traçado de cada linha
for (const linha of indice.linhas) {
  const chave = String(linha.numero).toUpperCase();
  const oficial = oficiais.get(chave);
  const t = TABELA17[linha.numero] || TABELA17[chave];
  linha.rede = 'transicao';

  if (linha.nome !== oficial.nome) {
    relatorio.renomeadas.push(`${linha.numero}: "${linha.nome}" -> "${oficial.nome}"`);
    linha.nome = oficial.nome;
  }
  if (t && String(linha.lote) !== t.lote) {
    relatorio.loteAlterado.push(`${linha.numero}: ${linha.lote} -> ${t.lote}`);
    linha.lote = t.lote;
  }

  if (t) {
    linha.operacao = {
      veiculo: t.veiculo,
      extensao_ida_volta_km: t.extensao_ida_volta_km,
      tempo_ciclo_min: t.tempo_ciclo_min,
      intervalo_du: t.intervalo_du,
      intervalo_sab: t.intervalo_sab,
      intervalo_dom: t.intervalo_dom,
      frota_du: t.frota_du,
      frota_sab: t.frota_sab,
      frota_dom: t.frota_dom,
      viagens_mes: t.viagens_mes,
      fonte: 'Edital CP 11.001/2026 — Anexo I.3, Tabela 17'
    };
    linha.frequencia_pico = `${textoIntervalo(t.intervalo_du)} (pico, dias úteis)`;
    linha.frequencia_entre_pico = `Sábado: ${textoIntervalo(t.intervalo_sab)} • Domingo: ${textoIntervalo(t.intervalo_dom)}`;
  }
  linha.dias_disponiveis = diasPelaTabela17(t);
  if (linha.tipo === 'noturna') linha.horario_operacao = 'Madrugada (Corujão)';
  else delete linha.horario_operacao;

  // Opera aos domingos pelo edital, mas o projeto de 2021 só tinha o traçado de dias úteis: reaproveita
  const variantes = linha.variantes_dia || {};
  if (
    linha.dias_disponiveis.includes('domingos_feriados') &&
    !variantes.domingos_feriados &&
    variantes.dias_uteis_sabados
  ) {
    variantes.domingos_feriados = {
      ...JSON.parse(JSON.stringify(variantes.dias_uteis_sabados)),
      dia_semana: 'domingos_feriados',
      dia_rotulo: ROTULO_DIA.domingos_feriados
    };
    for (const lp of linhaParadas.filter(x => x.linha_id === linha.numero && x.dia_semana === 'dias_uteis_sabados')) {
      linhaParadas.push({ ...lp, dia_semana: 'domingos_feriados' });
    }
    relatorio.domingoCopiado.push(linha.numero);
  }

  for (const variante of Object.values(variantes)) {
    variante.nome = oficial.nome;
    if (Array.isArray(variante.integracoes)) variante.integracoes = variante.integracoes.filter(i => !citaRemovida(i));
  }

  const temTracado = Object.keys(variantes).length > 0;
  if (!temTracado) {
    linha.situacao_rota = 'indefinida';
    if (AVISO_SEM_ROTA[chave]) linha.aviso_rota = AVISO_SEM_ROTA[chave];
    else delete linha.aviso_rota;
  } else if (linha.fonte_rota) {
    linha.situacao_rota = 'parcial';
    linha.aviso_rota =
      `Conforme a OSO nº ${linha.fonte_rota.oso} da STTU (vigência ${linha.fonte_rota.vigencia}): ` +
      `${linha.fonte_rota.nome_oso}. Aos domingos a tarifa é gratuita e o itinerário pode ser diferente do de dias úteis. ` +
      'A rota de dias úteis e sábados na Rede de Transição ainda não foi divulgada.';
  } else if (ROTA_ALTERADA[chave]) {
    linha.situacao_rota = 'alterada';
    linha.aviso_rota = ROTA_ALTERADA[chave];
    relatorio.alteradas.push(linha.numero);
  } else {
    linha.situacao_rota = 'disponivel';
    delete linha.aviso_rota;
  }
}

indice.versao = '2026.11001-natal';
indice.atualizado_em = new Date().toISOString();
salvarJson(ARQ_LINHAS, indice);
salvarJson(path.join(DADOS, 'linha_paradas.json'), linhaParadas);

// 4) Traçados: remove os da rede futura, atualiza nome/lote, cria o de domingo quando reaproveitado
const lotes = { 1: lerJson(path.join(DADOS, 'lote-1.geojson')), 2: lerJson(path.join(DADOS, 'lote-2.geojson')) };
const novas = { 1: [], 2: [] };
const todasFeatures = [...lotes[1].features, ...lotes[2].features];
for (const feat of [...todasFeatures.filter(f => f.properties?.fonte !== 'OSO STTU'), ...featuresOso]) {
  const p = feat.properties || {};
  const linha = porNumero.get(String(p.numero || p.linha_id).toUpperCase());
  if (!linha) continue; // linha removida
  Object.assign(p, { nome: linha.nome, lote: String(linha.lote), rede: 'transicao', situacao_rota: linha.situacao_rota });
  novas[p.lote === '1' ? 1 : 2].push(feat);
}
for (const numero of relatorio.domingoCopiado) {
  const linha = porNumero.get(numero.toUpperCase());
  const base = todasFeatures.find(f => f.properties.numero === numero && f.properties.dia_semana === 'dias_uteis_sabados');
  const jaTem = todasFeatures.some(f => f.properties.numero === numero && f.properties.dia_semana === 'domingos_feriados');
  if (!base || jaTem) continue;
  const copia = JSON.parse(JSON.stringify(base));
  Object.assign(copia.properties, {
    id: `${numero}-domingos_feriados`,
    dia_semana: 'domingos_feriados',
    dia_rotulo: ROTULO_DIA.domingos_feriados
  });
  novas[String(linha.lote) === '1' ? 1 : 2].push(copia);
}
lotes[1].features = novas[1];
lotes[2].features = novas[2];
salvarJson(path.join(DADOS, 'lote-1.geojson'), lotes[1]);
salvarJson(path.join(DADOS, 'lote-2.geojson'), lotes[2]);

// 5) Paradas: tira as linhas removidas; parada que só atendia linhas removidas fica inativa
let paradasDesativadas = 0;
for (const feat of paradas.features) {
  const p = feat.properties;
  const antes = (p.rotas || []).length;
  p.rotas = (p.rotas || []).filter(r => !removidas.has(String(r).toUpperCase()));
  if (Array.isArray(p.integracoes_descricao)) p.integracoes_descricao = p.integracoes_descricao.filter(i => !citaRemovida(i));
  if (antes > 0 && p.rotas.length === 0 && p.ativo !== false) {
    p.ativo = false;
    paradasDesativadas++;
  }
}
salvarJson(path.join(DADOS, 'paradas.json'), paradas);

const l1 = indice.linhas.filter(l => l.lote === '1').length;
console.log(`Rede de Transição: ${indice.linhas.length} linhas (Lote 1: ${l1}, Lote 2: ${indice.linhas.length - l1})`);
console.log(`Removidas (rede futura / projeto 2021): ${relatorio.removidas.length} -> ${relatorio.removidas.join(' ') || '-'}`);
console.log(`Incluídas sem traçado nesta execução: ${relatorio.incluidasSemRota.join(' ') || '-'}`);
console.log(`Sem traçado: ${indice.linhas.filter(l => l.situacao_rota === 'indefinida').map(l => l.numero).join(' ')}`);
console.log(`Traçado desatualizado (itinerário mudou): ${relatorio.alteradas.join(' ')}`);
console.log(`Traçado de domingo reaproveitado do de dias úteis: ${relatorio.domingoCopiado.join(' ') || '-'}`);
console.log(`Lote corrigido: ${relatorio.loteAlterado.join('; ') || '-'}`);
console.log(`Paradas desativadas (só atendiam linhas removidas): ${paradasDesativadas}`);
console.log(`Nomes atualizados: ${relatorio.renomeadas.length}`);
console.log(`Traçados das linhas atuais (OSO STTU, só domingos e feriados): ${(relatorio.rotasOso || []).join(', ') || '-'}`);
console.log(`OSO ignorada porque o edital não prevê a linha aos domingos: ${(relatorio.osoSemDomingo || []).join(' ') || '-'}`);
