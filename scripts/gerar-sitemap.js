#!/usr/bin/env node
/**
 * scripts/gerar-sitemap.js
 * Gera o sitemap.xml (lista de páginas para o Google) com a página inicial, a página "Sobre" e as
 * páginas de cada linha em linhas/. Rode de novo sempre que linhas forem criadas ou removidas:
 *     npm run sitemap
 */
'use strict';

const fs = require('fs');
const path = require('path');

const DOMINIO = 'https://rotasnatal.com.br';
const RAIZ = path.join(__dirname, '..');
const hoje = new Date().toISOString().slice(0, 10);

const paginas = [
  { loc: `${DOMINIO}/`, prioridade: '1.0', freq: 'weekly' },
  { loc: `${DOMINIO}/sobre.html`, prioridade: '0.7', freq: 'monthly' }
];

const pastaLinhas = path.join(RAIZ, 'linhas');
if (fs.existsSync(pastaLinhas)) {
  fs.readdirSync(pastaLinhas)
    .filter(n => n.endsWith('.html'))
    .sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true }))
    .forEach(n => paginas.push({ loc: `${DOMINIO}/linhas/${encodeURIComponent(n)}`, prioridade: '0.6', freq: 'monthly' }));
}

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${paginas
  .map(p => `  <url><loc>${p.loc}</loc><lastmod>${hoje}</lastmod><changefreq>${p.freq}</changefreq><priority>${p.prioridade}</priority></url>`)
  .join('\n')}
</urlset>
`;

fs.writeFileSync(path.join(RAIZ, 'sitemap.xml'), xml, 'utf8');
console.log(`sitemap.xml gerado com ${paginas.length} páginas.`);
