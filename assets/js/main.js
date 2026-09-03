/* =========================================================
   CARX SERVICE — вся интерактивность.
   Нативный JavaScript, без зависимостей и сборки.

   Модули:
     01 Утилиты                08 Табы прайса
     02 Прелоадер и тема       09 Фильтр работ + лайтбокс
     03 Скролл (шапка и др.)   10 Слайдер отзывов
     04 Появление и счётчики   11 Форма записи
     05 Мобильное меню         12 Карта по клику
     06 Ротатор в герое        13 Фолбэк картинок
     07 Параллакс и наведение
   ========================================================= */
(() => {
'use strict';

/* ============ 01. УТИЛИТЫ ============ */
const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const FINE_POINTER = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

/** Выполняет колбэк не чаще одного кадра. */
function rafThrottle(fn) {
  let ticking = false;
  return (...args) => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => { ticking = false; fn(...args); });
  };
}

function debounce(fn, ms = 180) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

const clamp = (v, min, max) => Math.min(Math.max(v, min), max);

/**
 * Включает CSS-переход у только что показанного элемента.
 * Синхронный reflow вместо requestAnimationFrame: в фоновой вкладке
 * rAF не вызывается, и оверлей навсегда остался бы прозрачным.
 */
function enterTransition(el, cls = 'is-open') {
  void el.offsetWidth;
  el.classList.add(cls);
}

const escapeHTML = (s) => s.replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

/* ============ 02. ПРЕЛОАДЕР И ТЕМА ============ */
const preloader = $('#preloader');
const preloaderBar = $('.preloader__bar i');

(function runPreloader() {
  if (!preloader) return;
  let p = 0;
  let done = false;

  const tick = setInterval(() => {
    p = Math.min(p + Math.random() * 22, 92);
    if (preloaderBar) preloaderBar.style.width = p + '%';
  }, 120);

  const finish = () => {
    if (done) return;
    done = true;
    clearInterval(tick);
    if (preloaderBar) preloaderBar.style.width = '100%';
    setTimeout(() => {
      preloader.classList.add('is-done');
      document.body.classList.add('is-loaded');
      // Первый экран показываем сразу после прелоадера, не дожидаясь скролла.
      revealAll($$('.hero [data-reveal], .hero [data-split]'));
    }, 260);
  };

  if (document.readyState === 'complete') finish();
  else window.addEventListener('load', finish, { once: true });
  // Страховка: не держим пользователя дольше 2.5 с даже при медленных картинках.
  setTimeout(finish, 2500);
})();

const THEME_KEY = 'alatau-theme';
const themeToggle = $('#themeToggle');
const themeMeta = $('meta[name="theme-color"]');

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  if (themeMeta) themeMeta.content = theme === 'light' ? '#f4f6f8' : '#0a0b0d';
  try { localStorage.setItem(THEME_KEY, theme); } catch (_) { /* приватный режим */ }
}

(function initTheme() {
  // По умолчанию всегда тёмная тема — фирменный вид сервиса.
  // Системную светлую не подхватываем: только явный выбор пользователя.
  let saved = null;
  try { saved = localStorage.getItem(THEME_KEY); } catch (_) { /* нет доступа */ }
  if (saved === 'light' || saved === 'dark') applyTheme(saved);
  themeToggle?.addEventListener('click', () => {
    applyTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light');
  });
})();

/* ============ 03. СКРОЛЛ: ШАПКА, ПРОГРЕСС, НАВИГАЦИЯ ============ */
const header = $('#header');
const progress = $('#scrollProgress');
const toTop = $('#toTop');
let lastY = window.scrollY;

const onScroll = rafThrottle(() => {
  const y = window.scrollY;
  const max = document.documentElement.scrollHeight - window.innerHeight;

  if (progress) progress.style.transform = `scaleX(${max > 0 ? clamp(y / max, 0, 1) : 0})`;

  if (header) {
    header.classList.toggle('is-stuck', y > 20);
    // Прячем шапку при движении вниз, возвращаем при движении вверх.
    const goingDown = y > lastY && y > 420;
    if (!document.body.classList.contains('is-locked')) {
      header.classList.toggle('is-hidden', goingDown);
    }
  }

  toTop?.classList.toggle('is-show', y > 700);
  lastY = y;
});

window.addEventListener('scroll', onScroll, { passive: true });
onScroll();

toTop?.addEventListener('click', () => {
  window.scrollTo({ top: 0, behavior: REDUCED ? 'auto' : 'smooth' });
});

// Плавный переход по якорям (с закрытием мобильного меню).
$$('a[data-scroll], .nav__link').forEach((link) => {
  link.addEventListener('click', (e) => {
    const id = link.getAttribute('href');
    if (!id || !id.startsWith('#') || id === '#') return;
    const target = document.querySelector(id);
    if (!target) return;
    e.preventDefault();
    // closeMenu синхронно снимает блокировку прокрутки, поэтому скроллим сразу:
    // requestAnimationFrame здесь ненадёжен (не срабатывает в фоновой вкладке).
    closeMenu();
    target.scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth', block: 'start' });
    history.replaceState(null, '', id);
  });
});

// Подсветка активного пункта меню.
(function initNavSpy() {
  const links = $$('.nav__link');
  if (!links.length) return;
  const map = new Map();
  links.forEach((l) => {
    const sec = document.querySelector(l.getAttribute('href'));
    if (sec) map.set(sec, l);
  });
  const spy = new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      if (!en.isIntersecting) return;
      links.forEach((l) => l.classList.remove('is-active'));
      map.get(en.target)?.classList.add('is-active');
    });
  }, { rootMargin: '-45% 0px -50% 0px', threshold: 0 });
  map.forEach((_, sec) => spy.observe(sec));
})();

/* ============ 04. ПОЯВЛЕНИЕ, ЗАГОЛОВКИ, СЧЁТЧИКИ ============ */

/** Разбивает заголовок на строки для эффекта «выезда» снизу. */
function splitTitle(el) {
  if (el.dataset.splitDone === '1') return;
  // Схлопываем только обычные пробелы: неразрывный (&nbsp;) должен уцелеть,
  // иначе развалятся связки вроде «на ТО».
  const text = (el.textContent || '').trim().replace(/[\t\n\r ]+/g, ' ');
  if (!text) return;
  el.dataset.splitSource = text;

  // Если элемент ещё не отрисован (нулевая ширина — скрытый контейнер,
  // неактивная вкладка), перенос строк посчитается неверно: каждое слово
  // окажется на своей строке. Оставляем обычный текст — resize пересоберёт.
  if (!el.offsetWidth) return;

  const words = text.split(' ');
  el.textContent = '';
  const frag = document.createDocumentFragment();
  const nodes = words.map((w, i) => {
    const s = document.createElement('span');
    s.textContent = w;
    s.style.display = 'inline-block';
    frag.appendChild(s);
    if (i < words.length - 1) frag.appendChild(document.createTextNode(' '));
    return s;
  });
  el.appendChild(frag);

  // Слова с одинаковым offsetTop образуют одну визуальную строку.
  const lines = [];
  let top = null;
  nodes.forEach((n) => {
    const t = n.offsetTop;
    if (top === null || Math.abs(t - top) > 3) { top = t; lines.push([]); }
    lines[lines.length - 1].push(n.textContent);
  });

  // join(' ') между строками: .line — блочный, пробел не отрисуется,
  // зато textContent заголовка не склеит слова («Алматы,куда») —
  // это важно и для копирования текста, и для разбора страницы роботами.
  el.innerHTML = lines
    .map((ws, i) => `<span class="line"><span style="--l:${i}">${escapeHTML(ws.join(' '))}</span></span>`)
    .join(' ');
  el.dataset.splitDone = '1';
}

if (!REDUCED) $$('[data-split]').forEach(splitTitle);

// Пересобираем строки, если ширина окна заметно изменилась.
let lastW = window.innerWidth;
window.addEventListener('resize', debounce(() => {
  if (REDUCED || Math.abs(window.innerWidth - lastW) < 60) return;
  lastW = window.innerWidth;
  $$('[data-split]').forEach((el) => {
    if (!el.dataset.splitSource) return;
    const wasIn = el.classList.contains('is-in');
    el.textContent = el.dataset.splitSource;
    el.dataset.splitDone = '0';
    splitTitle(el);
    if (wasIn) el.classList.add('is-in');
  });
}, 250));

/** Анимация числа от 0 до целевого значения. */
function animateCount(el) {
  if (el.dataset.counted === '1') return;
  el.dataset.counted = '1';

  const target = parseFloat(el.dataset.count || '0');
  const decimals = parseInt(el.dataset.decimals || '0', 10);
  const suffix = el.dataset.suffix || '';
  const fmt = (v) => v.toLocaleString('ru-RU', {
    minimumFractionDigits: decimals, maximumFractionDigits: decimals,
  }) + suffix;

  if (REDUCED) { el.textContent = fmt(target); return; }

  const dur = 1500;
  const start = performance.now();
  const step = (now) => {
    const t = clamp((now - start) / dur, 0, 1);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = fmt(target * eased);
    if (t < 1) requestAnimationFrame(step);
    else el.textContent = fmt(target);
  };
  requestAnimationFrame(step);
}

function revealAll(nodes) {
  nodes.forEach((el) => {
    const delay = el.dataset.delay;
    if (delay) el.style.setProperty('--rd', delay + 'ms');
    el.classList.add('is-in');
    if (el.matches('[data-count]')) animateCount(el);
    $$('[data-count]', el).forEach(animateCount);
  });
}

(function initReveal() {
  const items = $$('[data-reveal], [data-split]');
  if (!('IntersectionObserver' in window)) { revealAll(items); return; }

  const io = new IntersectionObserver((entries, obs) => {
    entries.forEach((en) => {
      if (!en.isIntersecting) return;
      revealAll([en.target]);
      obs.unobserve(en.target);
    });
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.12 });

  items.forEach((el) => io.observe(el));
})();

/* ============ 05. МОБИЛЬНОЕ МЕНЮ ============ */
const burger = $('#burger');
const mobileMenu = $('#mobileMenu');

function openMenu() {
  if (!mobileMenu) return;
  mobileMenu.hidden = false;
  enterTransition(mobileMenu);
  burger?.classList.add('is-open');
  burger?.setAttribute('aria-expanded', 'true');
  document.body.classList.add('is-locked');
}

function closeMenu() {
  if (!mobileMenu || mobileMenu.hidden) return;
  mobileMenu.classList.remove('is-open');
  burger?.classList.remove('is-open');
  burger?.setAttribute('aria-expanded', 'false');
  document.body.classList.remove('is-locked');
  setTimeout(() => { mobileMenu.hidden = true; }, 350);
}

burger?.addEventListener('click', () => {
  if (mobileMenu?.hidden) openMenu(); else closeMenu();
});

/* ============ 06. РОТАТОР В ГЕРОЕ ============ */
(function initRotator() {
  const items = $$('#rotator .rotator__item');
  if (items.length < 2 || REDUCED) return;
  let i = 0;
  setInterval(() => {
    const prev = items[i];
    prev.classList.remove('is-active');
    prev.classList.add('is-out');
    setTimeout(() => prev.classList.remove('is-out'), 520);
    i = (i + 1) % items.length;
    items[i].classList.add('is-active');
  }, 2600);
})();

/* ============ 07. ПАРАЛЛАКС И НАВЕДЕНИЕ ============ */
const heroImg = $('#heroImg');
const ctaBg = $('.cta-band__bg');
const parallaxEls = $$('.parallax-el');

if (!REDUCED) {
  const onParallax = rafThrottle(() => {
    const y = window.scrollY;
    const vh = window.innerHeight;

    if (heroImg && y < vh * 1.3) {
      heroImg.style.transform = `translate3d(0, ${y * 0.22}px, 0) scale(1.06)`;
    }
    if (ctaBg && ctaBg.parentElement) {
      const r = ctaBg.parentElement.getBoundingClientRect();
      if (r.top < vh && r.bottom > 0) {
        const t = (r.top - vh / 2) / vh;
        ctaBg.style.transform = `translate3d(0, ${t * -60}px, 0)`;
      }
    }
    parallaxEls.forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.top > vh || r.bottom < 0) return;
      const speed = parseFloat(el.dataset.speed || '0.05');
      const t = r.top + r.height / 2 - vh / 2;
      el.style.transform = `translate3d(0, ${t * speed}px, 0)`;
    });
  });
  window.addEventListener('scroll', onParallax, { passive: true });
  onParallax();
}

// Свечение за курсором, наклон карточек и «магнитные» кнопки — только для мыши.
if (FINE_POINTER && !REDUCED) {
  document.body.classList.add('has-pointer');
  const glow = $('#cursorGlow');
  const moveGlow = rafThrottle((x, y) => {
    if (glow) glow.style.transform = `translate3d(${x}px, ${y}px, 0)`;
  });
  window.addEventListener('pointermove', (e) => moveGlow(e.clientX, e.clientY), { passive: true });

  $$('.tilt').forEach((card) => {
    card.addEventListener('pointermove', (e) => {
      const r = card.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width;
      const py = (e.clientY - r.top) / r.height;
      card.style.setProperty('--mx', px * 100 + '%');
      card.style.setProperty('--my', py * 100 + '%');
      card.style.transform =
        `perspective(900px) rotateX(${(0.5 - py) * 5}deg) rotateY(${(px - 0.5) * 5}deg) translateY(-6px)`;
    });
    card.addEventListener('pointerleave', () => { card.style.transform = ''; });
  });

  $$('.btn').forEach((btn) => {
    btn.addEventListener('pointermove', (e) => {
      const r = btn.getBoundingClientRect();
      btn.style.setProperty('--mx', ((e.clientX - r.left) / r.width) * 100 + '%');
      btn.style.setProperty('--my', ((e.clientY - r.top) / r.height) * 100 + '%');
      if (!btn.classList.contains('magnetic')) return;
      const dx = e.clientX - (r.left + r.width / 2);
      const dy = e.clientY - (r.top + r.height / 2);
      btn.style.transform = `translate(${dx * 0.14}px, ${dy * 0.2 - 2}px)`;
    });
    btn.addEventListener('pointerleave', () => { btn.style.transform = ''; });
  });
}

/* ============ 08. ТАБЫ ПРАЙСА ============ */
(function initTabs() {
  const btns = $$('.tabs__btn');
  if (!btns.length) return;

  const activate = (btn) => {
    btns.forEach((b) => {
      const on = b === btn;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-selected', String(on));
      const panel = document.getElementById(b.getAttribute('aria-controls'));
      if (!panel) return;
      panel.classList.toggle('is-active', on);
      panel.hidden = !on;
    });
  };

  btns.forEach((btn, i) => {
    btn.addEventListener('click', () => activate(btn));
    btn.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      e.preventDefault();
      const next = btns[(i + (e.key === 'ArrowRight' ? 1 : -1) + btns.length) % btns.length];
      next.focus();
      activate(next);
    });
  });
})();

/* ============ 09. ФИЛЬТР РАБОТ + ЛАЙТБОКС ============ */
const shots = $$('.shot');

(function initFilters() {
  const chips = $$('.chip');
  if (!chips.length) return;
  chips.forEach((chip) => {
    chip.addEventListener('click', () => {
      chips.forEach((c) => c.classList.remove('is-active'));
      chip.classList.add('is-active');
      const f = chip.dataset.filter;
      shots.forEach((shot) => {
        shot.classList.toggle('is-hidden', !(f === 'all' || shot.dataset.cat === f));
      });
    });
  });
})();

(function initLightbox() {
  const box = $('#lightbox');
  if (!box || !shots.length) return;
  const img = $('#lbImg');
  const cap = $('#lbCap');
  let visible = [];
  let idx = 0;

  const render = () => {
    const shot = visible[idx];
    if (!shot) return;
    const src = shot.querySelector('img');
    img.src = src.dataset.full || src.src;
    img.alt = src.alt || '';
    const b = shot.querySelector('figcaption b')?.textContent || '';
    const s = shot.querySelector('figcaption span')?.textContent || '';
    cap.textContent = [b, s].filter(Boolean).join(' — ');
  };

  const open = (shot) => {
    visible = shots.filter((s) => !s.classList.contains('is-hidden'));
    idx = Math.max(visible.indexOf(shot), 0);
    render();
    box.hidden = false;
    enterTransition(box);
    document.body.classList.add('is-locked');
    $('#lbClose')?.focus();
  };

  const close = () => {
    box.classList.remove('is-open');
    document.body.classList.remove('is-locked');
    // removeAttribute, а не src = '': пустой src считается ошибкой загрузки
    // и подменил бы картинку заглушкой.
    setTimeout(() => { box.hidden = true; img.removeAttribute('src'); }, 320);
  };

  const move = (d) => {
    if (!visible.length) return;
    idx = (idx + d + visible.length) % visible.length;
    render();
  };

  shots.forEach((shot) => {
    shot.tabIndex = 0;
    shot.setAttribute('role', 'button');
    shot.addEventListener('click', () => open(shot));
    shot.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(shot); }
    });
  });

  $('#lbClose')?.addEventListener('click', close);
  $('#lbPrev')?.addEventListener('click', () => move(-1));
  $('#lbNext')?.addEventListener('click', () => move(1));
  box.addEventListener('click', (e) => { if (e.target === box) close(); });

  document.addEventListener('keydown', (e) => {
    if (box.hidden) return;
    if (e.key === 'Escape') close();
    if (e.key === 'ArrowLeft') move(-1);
    if (e.key === 'ArrowRight') move(1);
  });

  let sx = 0;
  box.addEventListener('touchstart', (e) => { sx = e.touches[0].clientX; }, { passive: true });
  box.addEventListener('touchend', (e) => {
    const dx = e.changedTouches[0].clientX - sx;
    if (Math.abs(dx) > 55) move(dx < 0 ? 1 : -1);
  }, { passive: true });
})();

/* ============ 10. СЛАЙДЕР ОТЗЫВОВ ============ */
(function initSlider() {
  const viewport = $('#reviewsViewport');
  const track = $('#reviewsTrack');
  const dotsBox = $('#revDots');
  const prevBtn = $('#revPrev');
  const nextBtn = $('#revNext');
  if (!viewport || !track) return;

  const slides = Array.from(track.children);
  if (!slides.length) return;
  let index = 0;
  let timer = null;

  const perView = () => (window.innerWidth <= 640 ? 1 : window.innerWidth <= 1024 ? 2 : 3);
  const maxIndex = () => Math.max(slides.length - perView(), 0);

  const build = () => {
    if (!dotsBox) return;
    dotsBox.innerHTML = '';
    for (let i = 0; i <= maxIndex(); i++) {
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('aria-label', `Отзыв ${i + 1}`);
      b.addEventListener('click', () => { go(i); restart(); });
      dotsBox.appendChild(b);
    }
  };

  const go = (i) => {
    index = clamp(i, 0, maxIndex());
    const step = slides[0].getBoundingClientRect().width
      + parseFloat(getComputedStyle(track).columnGap || getComputedStyle(track).gap || '0');
    track.style.transform = `translate3d(${-index * step}px, 0, 0)`;
    if (dotsBox) {
      Array.from(dotsBox.children).forEach((d, n) => d.classList.toggle('is-active', n === index));
    }
    if (prevBtn) prevBtn.disabled = index === 0;
    if (nextBtn) nextBtn.disabled = index === maxIndex();
  };

  const restart = () => {
    if (REDUCED) return;
    clearInterval(timer);
    timer = setInterval(() => go(index >= maxIndex() ? 0 : index + 1), 6000);
  };

  prevBtn?.addEventListener('click', () => { go(index - 1); restart(); });
  nextBtn?.addEventListener('click', () => { go(index + 1); restart(); });

  viewport.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft')  { e.preventDefault(); go(index - 1); restart(); }
    if (e.key === 'ArrowRight') { e.preventDefault(); go(index + 1); restart(); }
  });

  viewport.addEventListener('mouseenter', () => clearInterval(timer));
  viewport.addEventListener('mouseleave', restart);

  // Перетаскивание мышью и пальцем.
  let down = false, startX = 0, moved = 0;
  viewport.addEventListener('pointerdown', (e) => {
    down = true; startX = e.clientX; moved = 0;
    viewport.classList.add('is-dragging');
    clearInterval(timer);
  });
  viewport.addEventListener('pointermove', (e) => { if (down) moved = e.clientX - startX; });
  const endDrag = () => {
    if (!down) return;
    down = false;
    viewport.classList.remove('is-dragging');
    if (Math.abs(moved) > 60) go(index + (moved < 0 ? 1 : -1)); else go(index);
    restart();
  };
  viewport.addEventListener('pointerup', endDrag);
  viewport.addEventListener('pointercancel', endDrag);
  viewport.addEventListener('pointerleave', endDrag);
  viewport.addEventListener('dragstart', (e) => e.preventDefault());

  window.addEventListener('resize', debounce(() => { build(); go(Math.min(index, maxIndex())); }, 200));

  build();
  go(0);
  restart();

  // Ширину карточки надёжно можно измерить только когда секция реально отрисована,
  // поэтому пересчитываем позицию при первом появлении слайдера в зоне видимости.
  if ('IntersectionObserver' in window) {
    const relayout = new IntersectionObserver((entries, obs) => {
      entries.forEach((en) => {
        if (!en.isIntersecting) return;
        build();
        go(index);
        obs.disconnect();
      });
    }, { threshold: 0.05 });
    relayout.observe(viewport);
  }
})();

/* ============ 11. ФОРМА ЗАПИСИ ============ */
const toastEl = $('#toast');
let toastTimer = null;

function toast(message, isError = false) {
  if (!toastEl) return;
  toastEl.textContent = message;
  toastEl.classList.toggle('is-error', isError);
  toastEl.hidden = false;
  enterTransition(toastEl, 'is-show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastEl.classList.remove('is-show');
    setTimeout(() => { toastEl.hidden = true; }, 420);
  }, 4200);
}

(function initPhoneMask() {
  const input = $('#f-phone');
  if (!input) return;

  const format = (raw) => {
    let d = raw.replace(/\D/g, '');
    if (d.startsWith('8')) d = '7' + d.slice(1);
    if (!d.startsWith('7')) d = '7' + d;
    d = d.slice(0, 11);
    const p = d.slice(1);
    let out = '+7';
    if (p.length) out += ' (' + p.slice(0, 3);
    if (p.length >= 3) out += ')';
    if (p.length > 3) out += ' ' + p.slice(3, 6);
    if (p.length > 6) out += '-' + p.slice(6, 8);
    if (p.length > 8) out += '-' + p.slice(8, 10);
    return out;
  };

  input.addEventListener('input', () => {
    const atEnd = input.selectionStart === input.value.length;
    input.value = format(input.value);
    if (atEnd) input.setSelectionRange(input.value.length, input.value.length);
  });
  input.addEventListener('focus', () => { if (!input.value) input.value = '+7 ('; });
  input.addEventListener('blur', () => { if (input.value.replace(/\D/g, '').length <= 1) input.value = ''; });
})();

(function initForm() {
  const form = $('#bookingForm');
  if (!form) return;

  const setError = (field, msg) => {
    const wrap = field.closest('.field');
    const box = wrap?.querySelector('[data-err]');
    wrap?.classList.toggle('has-error', Boolean(msg));
    if (box) box.textContent = msg || '';
  };

  const validate = () => {
    let ok = true;

    const name = $('#f-name');
    if (name.value.trim().length < 2) { setError(name, 'Укажите имя — как к вам обращаться'); ok = false; }
    else setError(name, '');

    const phone = $('#f-phone');
    if (phone.value.replace(/\D/g, '').length !== 11) {
      setError(phone, 'Введите номер полностью: +7 (7XX) XXX-XX-XX'); ok = false;
    } else setError(phone, '');

    const service = $('#f-service');
    if (!service.value) { setError(service, 'Выберите услугу или «нужна консультация»'); ok = false; }
    else setError(service, '');

    const agree = $('#f-agree');
    const agreeErr = $('[data-err-agree]');
    if (!agree.checked) {
      if (agreeErr) agreeErr.textContent = 'Без согласия мы не сможем вам перезвонить';
      ok = false;
    } else if (agreeErr) agreeErr.textContent = '';

    return ok;
  };

  ['#f-name', '#f-phone', '#f-service'].forEach((sel) => {
    $(sel)?.addEventListener('input', () => {
      if ($(sel).closest('.field')?.classList.contains('has-error')) validate();
    });
  });
  $('#f-agree')?.addEventListener('change', () => {
    const agreeErr = $('[data-err-agree]');
    if (agreeErr && $('#f-agree').checked) agreeErr.textContent = '';
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!validate()) {
      toast('Проверьте выделенные поля', true);
      form.querySelector('.has-error input, .has-error select')?.focus();
      return;
    }

    const btn = $('#submitBtn');
    btn.classList.add('is-loading');

    // Отправка на send.php, который лежит рядом с index.html.
    fetch('send.php', { method: 'POST', body: new FormData(form) })
      .then((r) => r.json().catch(() => {
        // Пришёл не JSON — почти всегда это HTML-страница с ошибкой PHP или 404.
        throw new Error('Сервер вернул неожиданный ответ');
      }))
      .then((res) => {
        if (!res.ok) throw new Error(res.error || 'Не удалось отправить заявку');
        form.reset();
        $$('.field').forEach((f) => f.classList.remove('has-error'));
        $$('[data-err], [data-err-agree]').forEach((s) => { s.textContent = ''; });
        // Конверсия Google Ads «Запрос цены». Срабатывает ТОЛЬКО здесь —
        // после подтверждения от сервера, что заявка принята. Если поставить
        // этот код в <head>, как в письме Google, конверсия засчитывалась бы
        // каждому посетителю при открытии страницы.
        if (typeof gtag === 'function') {
          gtag('event', 'conversion', { send_to: 'AW-18353857986/z6pZCJjb6NccEMLL5q9E' });
        }
        toast('Заявка принята. Перезвоним в течение 15 минут!');
      })
      .catch((err) => {
        toast(err.message + '. Позвоните нам: +7 (776) 219-34-02', true);
      })
      .finally(() => btn.classList.remove('is-loading'));
  });

  // Минимальная дата записи — сегодня.
  const dateInput = $('#f-date');
  if (dateInput) {
    const d = new Date();
    dateInput.min = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
})();

/* ============ 12. КАРТА ПО КЛИКУ ============ */
$('#mapLoad')?.addEventListener('click', () => {
  const map = $('#map');
  if (!map) return;
  // Координаты точки из карточки 2ГИС — точнее, чем поиск по строке адреса.
  const coords = '43.199883,76.834588';
  map.innerHTML =
    `<iframe title="Карта проезда к CARX SERVICE — Алматы, ул. Хрищатого, 4"
       loading="lazy" referrerpolicy="no-referrer-when-downgrade"
       src="https://maps.google.com/maps?q=${coords}&hl=ru&z=17&output=embed"></iframe>
     <a class="map__2gis" href="https://go.2gis.com/qRdEK" target="_blank" rel="noopener">Открыть в 2ГИС</a>`;
});

/* ============ 13. ФОЛБЭК КАРТИНОК ============ */
// Если фото не загрузилось (нет сети / заблокирован CDN) — показываем локальную заглушку.
const PLACEHOLDER = 'assets/img/placeholder.svg';
$$('img').forEach((img) => {
  img.addEventListener('error', () => {
    const src = img.getAttribute('src');
    // Пустой src и сама заглушка ошибкой не считаются — иначе получим цикл.
    if (!src || src === PLACEHOLDER) return;
    img.dataset.fallbackDone = '1';
    img.src = PLACEHOLDER;
  });
});

/* ============ 14. КОНВЕРСИИ: ЗВОНОК И WHATSAPP ============ */
// Действие-конверсия «Контакт» в Google Ads. Ловит вторую половину обращений,
// которую форма не видит: клик по номеру телефона и по кнопке WhatsApp.
// Событие шлём один раз за посещение — человек может нажать номер в шапке,
// потом в подвале, но обращение при этом одно.
(function initContactConversions() {
  const LABEL = 'AW-18353857986/2NitCLPptNgcEMLL5q9E';
  let fired = false;

  $$('a[href^="tel:"], a[href*="wa.me"]').forEach((link) => {
    link.addEventListener('click', () => {
      if (fired || typeof gtag !== 'function') return;
      fired = true;
      gtag('event', 'conversion', { send_to: LABEL });
    });
  });
})();

// Закрытие мобильного меню по Escape.
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeMenu();
});

})();
