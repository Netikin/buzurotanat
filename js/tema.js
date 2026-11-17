/**
 * js/tema.js
 * Modo claro / escuro. Carregado no <head> (antes do CSS ser aplicado) para não "piscar" a tela.
 * - Primeira visita: segue a preferência do sistema (prefers-color-scheme).
 * - Depois que a pessoa clica no botão, a escolha fica salva neste navegador.
 * - Avisa o resto do site com o evento "buzu:tema" (o mapa troca o fundo claro/escuro).
 */
(function () {
  'use strict';

  const CHAVE = 'buzu_tema';
  const raiz = document.documentElement;

  function lerSalvo() {
    try {
      return localStorage.getItem(CHAVE);
    } catch (_e) {
      return null;
    }
  }

  function salvar(tema) {
    try {
      localStorage.setItem(CHAVE, tema);
    } catch (_e) {
      /* navegação privada: apenas não salva */
    }
  }

  const prefereEscuro = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)');
  const temaInicial = lerSalvo() || (prefereEscuro && prefereEscuro.matches ? 'escuro' : 'claro');

  function aplicar(tema) {
    raiz.setAttribute('data-tema', tema);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', tema === 'escuro' ? '#0f1626' : '#162652');
    const btn = document.getElementById('btn-tema');
    if (btn) {
      const escuro = tema === 'escuro';
      btn.setAttribute('aria-pressed', String(escuro));
      btn.title = escuro ? 'Mudar para o modo claro' : 'Mudar para o modo escuro';
      const rotulo = btn.querySelector('.rotulo-tema');
      if (rotulo) rotulo.textContent = escuro ? 'Claro' : 'Escuro';
    }
    document.dispatchEvent(new CustomEvent('buzu:tema', { detail: { tema } }));
  }

  aplicar(temaInicial);

  // Se a pessoa nunca escolheu, acompanha a troca de tema do sistema
  if (prefereEscuro && typeof prefereEscuro.addEventListener === 'function') {
    prefereEscuro.addEventListener('change', e => {
      if (!lerSalvo()) aplicar(e.matches ? 'escuro' : 'claro');
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    aplicar(raiz.getAttribute('data-tema') || 'claro');
    const btn = document.getElementById('btn-tema');
    if (!btn) return;
    btn.addEventListener('click', () => {
      const novo = raiz.getAttribute('data-tema') === 'escuro' ? 'claro' : 'escuro';
      salvar(novo);
      aplicar(novo);
    });
  });

  window.BuzuTema = {
    atual: () => raiz.getAttribute('data-tema') || 'claro'
  };
})();
