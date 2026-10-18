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

  // ---------------------------------------------------------------- contador de downloads
  const fmt = new Intl.NumberFormat('pt-BR');
  function mostrarDownloads(total) {
    $$('[data-contador]').forEach((el) => { el.hidden = false; });
    const els = $$('[data-downloads]');
    const reduzir = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduzir) { els.forEach((el) => { el.textContent = fmt.format(total); }); return; }
    const inicio = performance.now();
    const dur = 1200;
    const de = Math.max(0, Math.floor(total * 0.6));
    const passo = (t) => {
      const p = Math.min(1, (t - inicio) / dur);
      const v = Math.round(de + (total - de) * (1 - Math.pow(1 - p, 3)));
      els.forEach((el) => { el.textContent = fmt.format(v); });
      if (p < 1) requestAnimationFrame(passo);
    };
    requestAnimationFrame(passo);
  }
  // atualiza o número logo depois que o visitante clica em baixar
  $$('a[href^="/download/"]').forEach((a) => a.addEventListener('click', () => {
    setTimeout(() => fetch('/api/versao', { cache: 'no-store' }).then((r) => r.json()).then((i) => {
      if (Number.isFinite(i.downloads)) $$('[data-downloads]').forEach((el) => { el.textContent = fmt.format(i.downloads); });
    }).catch(() => {}), 3000);
  }));

  // ---------------------------------------------------------------- versão e arquivos
  const formatarTamanho = (b) => (b >= 1048576 ? (b / 1048576).toFixed(1).replace('.', ',') + ' MB' : Math.ceil(b / 1024) + ' KB');

  fetch('/api/versao', { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : null))
    .then((info) => {
      if (!info) return;
      if (info.versao) $$('[data-versao]').forEach((el) => { el.textContent = 'v' + info.versao; });
      if (Number.isFinite(info.downloads)) mostrarDownloads(info.downloads);
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

  // ---------------------------------------------------------------- zoom das telas (com navegação)
  const zoom = $('.zoom');
  const zoomImg = $('img', zoom);
  const zoomLeg = $('.zoom-legenda', zoom);
  const zoomCont = $('.zoom-contador', zoom);
  // Lista de telas na ordem da página, sem repetir a mesma imagem
  const telas = [];
  // a galeria vem primeiro (numeração e legendas); depois as demais imagens ampliáveis da página
  [...$$('.galeria [data-zoom]'), ...$$('[data-zoom]').filter((b) => !b.closest('.galeria'))].forEach((btn) => {
    const img = $('img', btn);
    const src = img.getAttribute('src');
    let i = telas.findIndex((t) => t.src === src);
    if (i < 0) {
      const leg = btn.parentElement.querySelector('figcaption');
      telas.push({ src, alt: img.alt, legenda: leg ? leg.textContent : img.alt });
      i = telas.length - 1;
    }
    btn.addEventListener('click', () => abrir(i));
  });
  let atual = 0;
  const mostrar = (i) => {
    atual = (i + telas.length) % telas.length;
    const t = telas[atual];
    zoomImg.src = t.src;
    zoomImg.alt = t.alt;
    zoomLeg.textContent = t.legenda;
    zoomCont.textContent = `${atual + 1} / ${telas.length}`;
    // pré-carrega as vizinhas para a troca ficar instantânea
    [atual + 1, atual - 1].forEach((k) => { const v = telas[(k + telas.length) % telas.length]; if (v) new Image().src = v.src; });
  };
  const abrir = (i) => {
    mostrar(i);
    zoom.hidden = false;
    document.body.style.overflow = 'hidden';
    $('.zoom-prox').focus();
  };
  const fechar = () => { zoom.hidden = true; document.body.style.overflow = ''; };
  $('.zoom-ant').addEventListener('click', (e) => { e.stopPropagation(); mostrar(atual - 1); });
  $('.zoom-prox').addEventListener('click', (e) => { e.stopPropagation(); mostrar(atual + 1); });
  zoomImg.addEventListener('click', (e) => { e.stopPropagation(); mostrar(atual + 1); });
  zoom.addEventListener('click', (e) => { if (e.target === zoom || e.target.classList.contains('zoom-fechar')) fechar(); });
  document.addEventListener('keydown', (e) => {
    if (zoom.hidden) return;
    if (e.key === 'Escape') fechar();
    else if (e.key === 'ArrowRight') { e.preventDefault(); mostrar(atual + 1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); mostrar(atual - 1); }
  });
  // deslizar o dedo no celular
  let toqueX = null;
  zoom.addEventListener('touchstart', (e) => { toqueX = e.touches[0].clientX; }, { passive: true });
  zoom.addEventListener('touchend', (e) => {
    if (toqueX === null) return;
    const dx = e.changedTouches[0].clientX - toqueX;
    toqueX = null;
    if (Math.abs(dx) > 50) mostrar(atual + (dx < 0 ? 1 : -1));
  });

  // ---------------------------------------------------------------- animação de entrada
  const alvos = $$('.passos li, .cartao, .recurso, .galeria figure, .dl, .faq details, .lista-check li, .lista-fb li');
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
