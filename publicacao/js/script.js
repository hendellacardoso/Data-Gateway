/* Data Gateway — página de apresentação. JavaScript puro, sem dependências. */
(() => {
  'use strict';
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));

  // ---------------------------------------------------------------- telas (galeria)
  // Para incluir uma tela: coloque o arquivo em img/telas/ e adicione uma linha aqui.
  const TELAS = [
    ['01-dashboard', 'Dashboard — visão geral do gateway'],
    ['02-bancos', 'Conexões com os bancos de dados'],
    ['03-conexao-teste', 'Cadastro e teste de conexão'],
    ['19-firebird-conexao', 'Firebird — conexão testada (dialeto e charset detectados)'],
    ['04-endpoints', 'Endpoints publicados'],
    ['05-wizard-campos', 'Assistente — campos da API'],
    ['20-firebird-campos', 'Firebird — campos detectados (generator, CHAR “S/N”)'],
    ['06-wizard-filtros', 'Assistente — consulta, paginação e filtros'],
    ['07-wizard-revisar', 'Assistente — revisão antes de publicar'],
    ['08-tokens', 'Tokens de acesso'],
    ['09-permissoes', 'Permissões por token, endpoint e operação'],
    ['17-consulta-diagrama', 'Consultas SQL — montador visual'],
    ['18-consulta-sql', 'Consultas SQL — editor, parâmetros e resultado'],
    ['21-firebird-consulta', 'Firebird — consulta SQL com JOIN'],
    ['10-testador', 'Testador de API'],
    ['22-firebird-testador', 'Firebird — JSON com acentos e datas corretas'],
    ['11-documentacao', 'Documentação da API'],
    ['16-swagger', 'Swagger UI gerado automaticamente'],
    ['12-logs', 'Logs de requisições'],
    ['13-auditoria', 'Auditoria'],
    ['14-configuracoes', 'Configurações do servidor da API'],
    ['15-sobre', 'Sobre'],
    ['00-login', 'Acesso ao painel']
  ];
  const src = (id) => `img/telas/${id}.webp`;
  const legendaDe = (id) => (TELAS.find((t) => t[0] === id) || [id, ''])[1];

  const galeria = $('#galeria');
  if (galeria) {
    galeria.innerHTML = TELAS.map(([id, leg]) => `
      <figure>
        <button type="button" data-zoom="${id}"><img loading="lazy" src="${src(id)}" alt="${leg}" width="1600" height="960"></button>
        <figcaption>${leg}</figcaption>
      </figure>`).join('');
  }

  // ---------------------------------------------------------------- topo, menu, progresso e seção ativa
  const topo = $('.topo');
  const barra = $('.progresso span');
  const linksMenu = $$('#menu a[href^="#"]:not(.btn)');
  const secoes = linksMenu.map((a) => $(a.getAttribute('href'))).filter(Boolean);
  const aoRolar = () => {
    const y = window.scrollY;
    topo.classList.toggle('rolou', y > 8);
    const total = document.documentElement.scrollHeight - window.innerHeight;
    if (barra) barra.style.width = (total > 0 ? (y / total) * 100 : 0) + '%';
    let atual = null;
    for (const s of secoes) if (s.getBoundingClientRect().top <= 120) atual = s.id;
    linksMenu.forEach((a) => a.classList.toggle('ativo', a.getAttribute('href') === '#' + atual));
  };
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

  // ---------------------------------------------------------------- guia "Como usar" (abas)
  const abasGuia = $$('.guia-nav [role="tab"]');
  const selecionarGuia = (btn, foco) => {
    abasGuia.forEach((b) => {
      const ativo = b === btn;
      b.setAttribute('aria-selected', String(ativo));
      b.tabIndex = ativo ? 0 : -1;
      const painel = document.getElementById(b.getAttribute('aria-controls'));
      painel.hidden = !ativo;
      painel.classList.toggle('ativo', ativo);
    });
    if (foco) btn.focus();
    // no celular, leva o leitor ao conteúdo da etapa
    if (window.innerWidth <= 1080) {
      const painel = document.getElementById(btn.getAttribute('aria-controls'));
      painel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };
  abasGuia.forEach((btn, i) => {
    btn.tabIndex = i === 0 ? 0 : -1;
    btn.addEventListener('click', () => selecionarGuia(btn));
    btn.addEventListener('keydown', (e) => {
      const passo = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
      if (!passo) return;
      e.preventDefault();
      selecionarGuia(abasGuia[(i + passo + abasGuia.length) % abasGuia.length], true);
    });
  });

  // ---------------------------------------------------------------- exemplos de código (abas)
  $$('.abas button').forEach((btn) => btn.addEventListener('click', () => {
    $$('.abas button').forEach((b) => b.setAttribute('aria-selected', String(b === btn)));
    $$('.aba').forEach((p) => p.classList.toggle('ativa', p.dataset.painel === btn.dataset.aba));
  }));

  // ---------------------------------------------------------------- ampliar telas (com navegação)
  const zoom = $('.zoom');
  const zoomImg = $('img', zoom);
  const zoomLeg = $('.zoom-legenda', zoom);
  const zoomCont = $('.zoom-contador', zoom);
  const ids = TELAS.map((t) => t[0]);
  let atual = 0;
  let origem = null;

  const mostrar = (i) => {
    atual = (i + ids.length) % ids.length;
    const id = ids[atual];
    zoomImg.src = src(id);
    zoomImg.alt = legendaDe(id);
    zoomLeg.textContent = legendaDe(id);
    zoomCont.textContent = `${atual + 1} / ${ids.length}`;
    [atual + 1, atual - 1].forEach((k) => { new Image().src = src(ids[(k + ids.length) % ids.length]); });
  };
  const abrir = (id, botao) => {
    origem = botao;
    const i = ids.indexOf(id);
    mostrar(i < 0 ? 0 : i);
    zoom.hidden = false;
    document.body.style.overflow = 'hidden';
    $('.zoom-prox').focus();
  };
  const fechar = () => {
    zoom.hidden = true;
    document.body.style.overflow = '';
    if (origem) origem.focus();
  };
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-zoom]');
    if (btn) abrir(btn.dataset.zoom, btn);
  });
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
  let toqueX = null;
  zoom.addEventListener('touchstart', (e) => { toqueX = e.touches[0].clientX; }, { passive: true });
  zoom.addEventListener('touchend', (e) => {
    if (toqueX === null) return;
    const dx = e.changedTouches[0].clientX - toqueX;
    toqueX = null;
    if (Math.abs(dx) > 50) mostrar(atual + (dx < 0 ? 1 : -1));
  });

  // ---------------------------------------------------------------- animação de entrada
  const alvos = $$('.passos li, .cartao, .recurso, .galeria figure, .faq details, .lista-check li, .requisitos div');
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
