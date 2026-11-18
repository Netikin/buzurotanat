/**
 * Migração única: separa o traçado combinado (ida + volta) dos GeoJSON dos lotes
 * em `coordenadas_ida` / `coordenadas_volta` e cria os `pontos_guia_*` iniciais.
 *
 * Uso: node scripts/migrar-tracados-ida-volta.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const RAIZ = path.resolve(__dirname, '..');
const ARQUIVOS = ['dados/lote-1.geojson', 'dados/lote-2.geojson'];

function calcularAcumulado(coords) {
  const acum = [0];
  for (let i = 1; i < coords.length; i++) {
    const [x1, y1] = coords[i - 1];
    const [x2, y2] = coords[i];
    const rad = (y1 * Math.PI) / 180;
    const dx = (x2 - x1) * 111320 * Math.cos(rad);
    const dy = (y2 - y1) * 111132;
    acum.push(acum[i - 1] + Math.hypot(dx, dy));
  }
  return acum;
}

/** Mesma heurística de js/mapa.js: ponto de retorno entre 40% e 60% do percurso. */
function indiceRetorno(coords, props) {
  const informado = Number(props.indice_retorno);
  if (Number.isInteger(informado) && informado > 0 && informado < coords.length - 1) {
    return informado;
  }
  const acum = calcularAcumulado(coords);
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

function copiarCoords(coords) {
  return coords.map(c => [Number(c[0]), Number(c[1])]);
}

let total = 0;
let migrados = 0;

for (const relativo of ARQUIVOS) {
  const caminho = path.join(RAIZ, relativo);
  const bruto = fs.readFileSync(caminho, 'utf8');
  const geojson = JSON.parse(bruto);

  for (const feature of geojson.features || []) {
    total++;
    const props = feature.properties || {};
    const coords = feature.geometry?.coordinates || [];
    if (coords.length < 2) continue;

    const corte = indiceRetorno(coords, props);
    const ida = copiarCoords(coords.slice(0, corte + 1));
    const volta = copiarCoords(coords.slice(corte));
    if (ida.length < 2 || volta.length < 2) continue;

    props.indice_retorno = corte;
    props.coordenadas_ida = ida;
    props.coordenadas_volta = volta;
    props.pontos_guia_ida = copiarCoords(ida);
    props.pontos_guia_volta = copiarCoords(volta);

    migrados++;
  }

  fs.writeFileSync(caminho, JSON.stringify(geojson, null, 2), 'utf8');
  console.log(`${relativo}: ${geojson.features.length} features atualizadas`);
}

console.log(`Migração concluída: ${migrados}/${total} traçados separados em ida/volta.`);
