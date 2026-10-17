(() => {
  'use strict';
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));

  // ---------------------------------------------------------------- topo e menu
  const topo = $('.topo');
  const aoRolar = () => topo.classList.toggle('rolou', window.scrollY > 8);
  window.addEventListener('scroll', aoRolar, { passive: true });
  aoRolar();

  const menuBtn = $('.menu-btn');
  const menu = $('#menu');
  menuBtn.addEventListener('click', () => {
    const aberto = menu.classList.toggle('aberto');
    menuBtn.setAttribute('aria-expanded', String(aberto));
  });
  $$('#menu a').forEach((a) => a.addEventListener('click', () => {
    menu.classList.remove('aberto');
    menuBtn.setAttribute('aria-expanded', 'false');
  }));

  // ---------------------------------------------------------------- versão e arquivos
  const formatarTamanho = (b) => (b >= 1048576 ? (b / 1048576).toFixed(1).replace('.', ',') + ' MB' : Math.ceil(b / 1024) + ' KB');

  fetch('/api/versao', { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : null))
    .then((info) => {
      if (!info) return;
      if (info.versao) $$('[data-versao]').forEach((el) => { el.textContent = 'v' + info.versao; });
      for (const card of $$('.dl')) {
        const arq = (info.arquivos || []).find((a) => a.tipo === card.dataset.tipo);
        if (!arq) {
          card.classList.add('indisponivel');
          const b = $('.btn', card);
          if (b) b.lastChild.textContent = ' Em breve';
          continue;
        }
        $('[data-campo="nome"]', card).textContent = arq.nome;
        $('[data-campo="tamanho"]', card).textContent = formatarTamanho(arq.tamanho);
        $('[data-campo="sha256"]', card).textContent = arq.sha256 || '—';
      }
    })
    .catch(() => {});

  // ---------------------------------------------------------------- abas de exemplo
  $$('.abas button').forEach((btn) => btn.addEventListener('click', () => {
    $$('.abas button').forEach((b) => b.setAttribute('aria-selected', String(b === btn)));
    $$('.aba').forEach((p) => p.classList.toggle('ativa', p.dataset.painel === btn.dataset.aba));
  }));

  // ---------------------------------------------------------------- zoom das telas
  const zoom = $('.zoom');
  const zoomImg = $('img', zoom);
  const zoomLeg = $('.zoom-legenda', zoom);
  const fechar = () => { zoom.hidden = true; document.body.style.overflow = ''; };
  $$('[data-zoom]').forEach((btn) => btn.addEventListener('click', () => {
    const img = $('img', btn);
    zoomImg.src = img.src;
    zoomImg.alt = img.alt;
    zoomLeg.textContent = btn.parentElement.querySelector('figcaption')?.textContent || '';
    zoom.hidden = false;
    document.body.style.overflow = 'hidden';
    $('.zoom-fechar').focus();
  }));
  zoom.addEventListener('click', (e) => { if (e.target !== zoomImg) fechar(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !zoom.hidden) fechar(); });

  // ---------------------------------------------------------------- animação de entrada
  const alvos = $$('.passos li, .cartao, .recurso, .galeria figure, .dl, .faq details, .lista-check li');
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entradas) => {
      for (const en of entradas) {
        if (en.isIntersecting) {
          en.target.classList.add('visivel');
          io.unobserve(en.target);
        }
      }
    }, { rootMargin: '0px 0px -40px 0px' });
    alvos.forEach((el) => { el.classList.add('revelar'); io.observe(el); });
  }

  const ano = $('[data-ano]');
  if (ano) ano.textContent = String(new Date().getFullYear());
})();
