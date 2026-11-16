/**
 * scripts/gerar-paginas-seo.js
 * Gerador estático opcional (executado apenas uma vez fora do deploy, sem pipeline de build).
 *
 * Por que este script existe?
 * No MVP sem build, usamos roteamento por hash (ex.: index.html#/linha/B1).
 * Mecanismos de busca (Google/Bing) e pré-visualizações de WhatsApp ignoram a parte após o "#".
 * Caso a Prefeitura deseje que cada uma das 85 linhas tenha sua própria URL indexável
 * (ex.: /linhas/B1.html), basta rodar:
 *
 *   node scripts/gerar-paginas-seo.js
 *
 * Ele lê ./dados/linhas.json e gera páginas HTML estáticas leves em ./linhas/ com todas as
 * meta tags OpenGraph, dados estruturados e botão direto para abrir a linha no mapa interativo.
 */

const fs = require('fs');
const path = require('path');

const DADOS_LINHAS = path.join(__dirname, '..', 'dados', 'linhas.json');
const SAIDA_DIR = path.join(__dirname, '..', 'linhas');

if (!fs.existsSync(DADOS_LINHAS)) {
  console.error('Arquivo dados/linhas.json não encontrado. Rode antes: node scripts/converter-kmz.js');
  process.exit(1);
}

if (!fs.existsSync(SAIDA_DIR)) {
  fs.mkdirSync(SAIDA_DIR, { recursive: true });
}

const indice = JSON.parse(fs.readFileSync(DADOS_LINHAS, 'utf8'));

for (const linha of indice.linhas || []) {
  const varUteis = linha.variantes_dia?.dias_uteis_sabados;
  const varDom = linha.variantes_dia?.domingos_feriados;

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Linha ${linha.numero} - ${linha.nome} | Consulta Pública Transporte de Natal (Licitação 021/2023)</title>
  <meta name="description" content="Consulte o traçado, paradas e integrações da Linha ${linha.numero} (${linha.nome}) na Consulta Pública da Licitação nº 021/2023 da Prefeitura do Natal.">
  <meta property="og:title" content="Linha ${linha.numero} - ${linha.nome} (Licitação 021/2023 - Natal)">
  <meta property="og:description" content="Veja o itinerário de dias úteis/sábados e domingos/feriados, paradas e conexões no mapa interativo.">
  <link rel="stylesheet" href="../css/estilos.css">
</head>
<body>
  <main style="max-width:780px;margin:24px auto;padding:0 16px;">
    <div class="bloco-secao" style="background:var(--cor-superficie);padding:20px;">
      <p><a href="../index.html#/linha/${encodeURIComponent(linha.numero)}">← Abrir Linha ${linha.numero} no Mapa Interativo</a></p>
      <h1>Linha ${linha.numero} — ${linha.nome}</h1>
      <p><strong>Categoria:</strong> ${linha.categoria_edital || linha.tipo} | <strong>Lote:</strong> ${linha.lote}</p>
      <div class="alerta-edital">
        <strong>Aviso:</strong> ${indice.aviso_sentido_padrao}
      </div>
      ${
        varUteis
          ? `<h2>📅 Dias úteis e sábados: ${varUteis.nome} (${varUteis.extensao_km || '-'} km)</h2>
             <ul>${(varUteis.integracoes || []).map(i => `<li>${i}</li>`).join('')}</ul>`
          : ''
      }
      ${
        varDom
          ? `<h2>📅 Domingos e feriados: ${varDom.nome} (${varDom.extensao_km || '-'} km)</h2>
             <ul>${(varDom.integracoes || []).map(i => `<li>${i}</li>`).join('')}</ul>`
          : ''
      }
      <p style="margin-top:20px;">
        <a href="../index.html#/linha/${encodeURIComponent(linha.numero)}" class="btn-primario" style="text-decoration:none;display:inline-block;">
          🗺️ Visualizar Traçado e Paradas no Mapa
        </a>
      </p>
    </div>
  </main>
</body>
</html>`;

  const arqSaida = path.join(SAIDA_DIR, `${linha.numero}.html`);
  fs.writeFileSync(arqSaida, html, 'utf8');
  console.log(`Página estática SEO gerada: linhas/${linha.numero}.html`);
}
