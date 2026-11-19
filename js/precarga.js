/**
 * js/precarga.js
 * Carregado no <head>: começa a baixar os dados das linhas logo no início da página, em paralelo com
 * as bibliotecas do mapa, em vez de esperar todos os scripts do fim do <body>.
 * O dados.js pega essas respostas com BuzuPrecarga.obter(url); cada resposta é entregue uma só vez.
 */
window.BuzuPrecarga = (function () {
  'use strict';

  const ARQUIVOS = [
    'dados/linhas.json',
    'dados/paradas.json',
    'dados/linha_paradas.json',
    'dados/lote-1.geojson',
    'dados/lote-2.geojson',
    'dados/locais-natal.json'
  ];
  const pendentes = new Map();

  // "no-cache": usa a cópia guardada pelo navegador quando o servidor confirma que não mudou (304)
  function buscar(url) {
    return fetch(url, { cache: 'no-cache' });
  }

  if (typeof fetch === 'function') {
    for (const url of ARQUIVOS) {
      const p = buscar(url);
      p.catch(() => {}); // evita aviso de promessa rejeitada sem tratamento
      pendentes.set(url, p);
    }
  }

  function obter(url) {
    const p = pendentes.get(url);
    if (p) {
      pendentes.delete(url);
      return p;
    }
    return buscar(url);
  }

  return { obter };
})();
