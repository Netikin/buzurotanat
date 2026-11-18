const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const RAIZ = path.join(__dirname, '..');
const lote1 = JSON.parse(fs.readFileSync(path.join(RAIZ, 'dados', 'lote-1.geojson'), 'utf8'));
const paradas = JSON.parse(fs.readFileSync(path.join(RAIZ, 'dados', 'paradas.json'), 'utf8'));
const feat =
  lote1.features.find(f => f.properties?.id === 'N-02-dias_uteis_sabados') ||
  lote1.features.find(f => f.properties?.numero === 'N-02');
if (!feat) throw new Error('Linha N-02 não encontrada');

const coords = feat.geometry.coordinates;
const corte =
  typeof feat.properties.indice_retorno === 'number'
    ? feat.properties.indice_retorno
    : Math.floor(coords.length / 2);
const ida = coords.slice(0, corte + 1);
const volta = coords.slice(corte);

const esc = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const fmtCoords = arr => arr.map(c => `${c[0]},${c[1]},0`).join(' ');

const paradasN02 = (paradas.features || []).filter(p => (p.properties?.rotas || []).includes('N-02'));
const placemarksParadas = paradasN02
  .map(p => {
    const [lng, lat] = p.geometry.coordinates;
    return [
      '      <Placemark>',
      `        <name>${esc(p.properties.nome)}</name>`,
      `        <description>${esc((p.properties.origem || '') + ' | Sentido: ' + (p.properties.sentidos_atendidos || 'AMBOS'))}</description>`,
      `        <Point><coordinates>${lng},${lat},0</coordinates></Point>`,
      '      </Placemark>'
    ].join('\n');
  })
  .join('\n');

const kml = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<kml xmlns="http://www.opengis.net/kml/2.2">',
  '  <Document>',
  `    <name>Linha N-02 - ${esc(feat.properties.nome)}</name>`,
  '    <Style id="estiloIda"><LineStyle><color>ff0953b4</color><width>5</width></LineStyle></Style>',
  '    <Style id="estiloVolta"><LineStyle><color>ffeb8731</color><width>5</width></LineStyle></Style>',
  '    <Folder>',
  '      <name>Tracado N-02</name>',
  '      <Placemark>',
  '        <name>N-02 - Sentido IDA</name>',
  '        <styleUrl>#estiloIda</styleUrl>',
  `        <LineString><tessellate>1</tessellate><coordinates>${fmtCoords(ida)}</coordinates></LineString>`,
  '      </Placemark>',
  '      <Placemark>',
  '        <name>N-02 - Sentido VOLTA</name>',
  '        <styleUrl>#estiloVolta</styleUrl>',
  `        <LineString><tessellate>1</tessellate><coordinates>${fmtCoords(volta)}</coordinates></LineString>`,
  '      </Placemark>',
  '    </Folder>',
  '    <Folder>',
  `      <name>Paradas N-02 (${paradasN02.length})</name>`,
  placemarksParadas,
  '    </Folder>',
  '  </Document>',
  '</kml>'
].join('\n');

const tmpDir = path.join(RAIZ, '.tmp-kmz');
const kmlPath = path.join(tmpDir, 'doc.kml');
const zipPath = path.join(RAIZ, 'N-02.zip');
const kmzPath = path.join(RAIZ, 'N-02.kmz');

fs.mkdirSync(tmpDir, { recursive: true });
fs.writeFileSync(kmlPath, kml, 'utf8');
if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
if (fs.existsSync(kmzPath)) fs.unlinkSync(kmzPath);

execFileSync('powershell', [
  '-NoProfile',
  '-Command',
  `Compress-Archive -Path '${kmlPath}' -DestinationPath '${zipPath}' -Force; Move-Item '${zipPath}' '${kmzPath}' -Force`
]);
fs.rmSync(tmpDir, { recursive: true, force: true });

console.log(
  `Gerado N-02.kmz (${fs.statSync(kmzPath).size} bytes) | IDA: ${ida.length} pts | VOLTA: ${volta.length} pts | Paradas: ${paradasN02.length}`
);
