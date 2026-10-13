/**
 * UX Crucible — Behavioral Firewall for Milkplexity
 * Zero-dependency friction telemetry for a static site (no framework, no build).
 *
 * Include on every page just before </main> closes:
 *   <script src="/ux-crucible/telemetry/friction-beacon.js" defer data-endpoint="https://YOUR-COLLECTOR/beacon"></script>
 *
 * With no data-endpoint set, events are logged to the console and stored in
 * sessionStorage['crucible_events'] so you can inspect them in DevTools.
 *
 * Detects (FullStory-equivalent signals, mapped to this DOM):
 *   rage_click  — 3+ clicks on the same element within 1000ms
 *   dead_click  — click on something that looks interactive but goes nowhere
 *                 (.cta.soon span, .meta lines, card excerpt text on non-link surfaces, tables)
 *   cta_exposed / cta_click — the "$49 - Forge my idea" surface entered the viewport / was clicked
 *   card_exposed / card_click — ContentSquare-style zone attribution per board card
 *   table_scroll — the user horizontally scrolled a .tablewrap (proves the overflow was discovered)
 *   scroll_depth — 25/50/75/100% milestones per page
 *   font_swap_shift — cumulative layout shift attributable to web-font swap
 *   js_error — any uncaught error (there should be none on a static site)
 */
(function () {
  'use strict';
  var script = document.currentScript;
  var ENDPOINT = script && script.getAttribute('data-endpoint');
  var page = location.pathname;
  var zone = page === '/' || /index\.html$/.test(page) && !/boards|receipt/.test(page) ? 'index'
           : /\/receipt\//.test(page) ? 'receipt'
           : /\/boards\//.test(page) ? 'board' : 'other';
  var boardId = (page.match(/boards\/\d{4}-\d{2}-\d{2}-(\d{3})/) || [])[1] || null;
  var sid = (function () { try { return sessionStorage.getItem('crucible_sid') || sessionStorage.setItem('crucible_sid', String(Date.now()) + Math.random().toString(36).slice(2, 8)) || sessionStorage.getItem('crucible_sid'); } catch (e) { return 'nosess'; } })();

  function send(type, data) {
    var ev = { t: Date.now(), sid: sid, type: type, zone: zone, board: boardId, page: page, vw: innerWidth, vh: innerHeight, scheme: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light', data: data || {} };
    if (ENDPOINT && navigator.sendBeacon) { navigator.sendBeacon(ENDPOINT, JSON.stringify(ev)); }
    else {
      try { var q = JSON.parse(sessionStorage.getItem('crucible_events') || '[]'); q.push(ev); sessionStorage.setItem('crucible_events', JSON.stringify(q.slice(-200))); } catch (e) {}
      if (console && console.debug) console.debug('[crucible]', type, ev);
    }
  }

  function label(el) {
    if (!el || el.nodeType !== 1) return 'text';
    var a = el.closest('a.card'); if (a) return 'card:' + ((a.getAttribute('href') || '').match(/(\d{3})-/) || [])[1];
    if (el.closest('.cta')) return 'cta';
    if (el.closest('a.word')) return 'logo';
    if (el.closest('nav.crumb')) return 'crumb';
    if (el.closest('.tablewrap')) return 'table';
    if (el.closest('.meta')) return 'meta';
    if (el.closest('footer')) return 'footer';
    return el.tagName.toLowerCase() + (el.className ? '.' + String(el.className).split(' ')[0] : '');
  }

  // --- rage + dead clicks -------------------------------------------------
  var clicks = [];
  document.addEventListener('click', function (e) {
    var el = e.target, now = Date.now(), lb = label(el);
    clicks = clicks.filter(function (c) { return now - c.t < 1000; });
    clicks.push({ t: now, el: el });
    var same = clicks.filter(function (c) { return c.el === el; }).length;
    if (same >= 3) { send('rage_click', { on: lb, count: same }); clicks = []; }

    var interactive = el.closest('a[href], button, [role=button], input, select, textarea, summary, label');
    if (!interactive) {
      // Looks clickable to a human? The CTA span, card-like panels, tables, meta lines, bold spans.
      var looksClickable = el.closest('.cta, .card, .tablewrap, .meta, strong, code, h1, h2') || getComputedStyle(el).cursor === 'pointer';
      if (looksClickable) send('dead_click', { on: lb, text: (el.textContent || '').trim().slice(0, 40) });
    }
    if (el.closest('.cta')) send('cta_click', { enabled: !!el.closest('a[href]'), text: (el.textContent || '').trim().slice(0, 40) });
    var card = el.closest('a.card'); if (card) send('card_click', { card: lb, index: Array.prototype.indexOf.call(document.querySelectorAll('a.card'), card) });
  }, true);

  // --- zone exposure (ContentSquare attribution) --------------------------
  if ('IntersectionObserver' in window) {
    var seen = {};
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        var lb = label(en.target); if (seen[lb]) return; seen[lb] = 1;
        send(en.target.matches('.cta') ? 'cta_exposed' : 'card_exposed', { on: lb, atMs: Math.round(performance.now()), scrollY: Math.round(scrollY) });
      });
    }, { threshold: 0.5 });
    document.querySelectorAll('a.card, .cta').forEach(function (el) { io.observe(el); });
  }

  // --- horizontal table discovery ------------------------------------------
  document.querySelectorAll('.tablewrap').forEach(function (w, i) {
    var overflow = w.scrollWidth > w.clientWidth, fired = false;
    if (overflow) send('table_overflow', { index: i, hiddenPx: w.scrollWidth - w.clientWidth });
    w.addEventListener('scroll', function () { if (!fired) { fired = true; send('table_scroll', { index: i }); } }, { passive: true });
  });

  // --- scroll depth ----------------------------------------------------------
  var marks = [25, 50, 75, 100], hit = {};
  function depth() {
    var h = document.documentElement.scrollHeight - innerHeight; if (h <= 0) return;
    var pct = Math.round(100 * scrollY / h);
    marks.forEach(function (m) { if (pct >= m && !hit[m]) { hit[m] = 1; send('scroll_depth', { pct: m, atMs: Math.round(performance.now()) }); } });
  }
  addEventListener('scroll', depth, { passive: true }); addEventListener('load', depth);

  // --- layout shift from font swap --------------------------------------------
  try {
    var cls = 0, fontCls = 0, fontsReady = false;
    document.fonts.ready.then(function () { fontsReady = true; });
    new PerformanceObserver(function (l) { l.getEntries().forEach(function (e) { if (!e.hadRecentInput) { cls += e.value; if (!fontsReady) fontCls += e.value; } }); }).observe({ type: 'layout-shift', buffered: true });
    addEventListener('pagehide', function () { send('layout_shift', { cls: +cls.toFixed(4), beforeFontsReady: +fontCls.toFixed(4) }); });
  } catch (e) {}

  // --- errors ------------------------------------------------------------------
  addEventListener('error', function (e) { send('js_error', { msg: String(e.message).slice(0, 200), src: e.filename }); });
  addEventListener('unhandledrejection', function (e) { send('js_error', { msg: 'rejection: ' + String(e.reason).slice(0, 200) }); });

  send('pageview', { referrer: document.referrer, cards: document.querySelectorAll('a.card').length, hasCta: !!document.querySelector('.cta') });
})();
