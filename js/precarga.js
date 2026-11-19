/**
 * js/precarga.js
 * Carregado no <head>: começa a baixar os dados das linhas logo no início da página, em paralelo com
 * as bibliotecas do mapa, em vez de esperar todos os scripts do fim do <body>.
 * O dados.js pega essas respostas com BuzuPrecarga.obter(url); cada resposta é entregue uma só vez.
 *
 * O servidor coloca na página <meta name="buzu-versoes"> com a versão de cada arquivo de dados.
 * Com ela o endereço fica "dados/x.json?v=<versão>", que o navegador guarda e reaproveita no F5 sem
 * consultar o servidor; quando o arquivo muda, a versão muda e ele é baixado de novo.
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

  let versoes = {};
  let temVersoes = false;
  try {
    const meta = document.querySelector('meta[name="buzu-versoes"]');
    if (meta) {
      versoes = JSON.parse(meta.getAttribute('content') || '{}') || {};
      temVersoes = true;
    }
  } catch (_e) {
    versoes = {};
  }

  /** false só quando o servidor informou as versões e o arquivo não está entre elas (não existe) */
  function podeExistir(url) {
    return !temVersoes || Boolean(versoes[url]);
  }

  function buscar(url) {
    const v = versoes[url];
    // sem versão conhecida: "no-cache" usa a cópia guardada se o servidor confirmar que não mudou (304)
    return v ? fetch(`${url}?v=${encodeURIComponent(v)}`) : fetch(url, { cache: 'no-cache' });
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
    // Depois da primeira carga (ex.: o admin recarregando dados), sempre confere com o servidor
    return fetch(url, { cache: 'no-cache' });
  }

  return { obter, podeExistir };
})();
