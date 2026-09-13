/**
 * UX Crucible — Chaos Blueprint for Milkplexity
 * Paste into the DevTools console on any page of the site (index, /receipt/, /boards/...).
 *
 * Targets this site's real DOM:
 *   a.card           — the board cards on the index (block-level anchors)
 *   a.word           — the site logo/home link
 *   nav.crumb a      — "All boards" breadcrumb
 *   .cta / .cta.soon — the "$49 - Forge my idea" span (currently a dead-click surface)
 *   .tablewrap       — horizontally scrolling evidence tables on /receipt/
 *
 * Because every card is a real <a href>, a naive horde navigates away on the first click.
 * NAV_MODE controls that:
 *   'trap'  (default) — clicks are intercepted; the horde stays on the page and hammers state,
 *                       scroll, focus, and the dead CTA. Measures freezes, errors, DOM growth.
 *   'storm'           — clicks are allowed to navigate; the script re-arms itself after each
 *                       navigation via sessionStorage. Measures back/forward + font reflow churn.
 */
(function () {
  const NAV_MODE = window.__CRUCIBLE_NAV_MODE || 'trap';
  const NB = 3000, DELAY = 20;

  function loadGremlins(cb) {
    if (window.gremlins) return cb();
    const s = document.createElement('script');
    s.src = 'https://unpkg.com/gremlins.js@2.2.0/dist/gremlins.min.js';
    s.onload = cb;
    s.onerror = () => console.error('UX Crucible: could not load gremlins.js (offline or CSP).');
    document.head.appendChild(s);
  }

  function armTrap() {
    // Stop navigation but let every other handler run — dead-click detection stays honest.
    document.addEventListener('click', e => { if (e.target.closest('a[href]')) e.preventDefault(); }, true);
  }

  function baseline() {
    return {
      nodes: document.getElementsByTagName('*').length,
      heapKB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1024) : null,
      scrollW: document.documentElement.scrollWidth,
      t: performance.now(),
    };
  }

  function run() {
    const errors = [];
    window.addEventListener('error', e => errors.push(e.message));
    window.addEventListener('unhandledrejection', e => errors.push('rejection: ' + e.reason));

    // Long-task watchdog: any frame > 100ms under a 20ms cadence is a freeze.
    let longTasks = 0;
    try { new PerformanceObserver(l => { longTasks += l.getEntries().filter(e => e.duration > 100).length; }).observe({ type: 'longtask' }); } catch (_) {}

    // Dead-click counter on the CTA span — the site's only monetization surface.
    let ctaHits = 0;
    document.querySelectorAll('.cta').forEach(el => el.addEventListener('click', () => ctaHits++));

    if (NAV_MODE === 'trap') armTrap();
    const before = baseline();

    const g = window.gremlins;
    const isTarget = el => !!el.closest('a.card, a.word, nav.crumb a, .cta, .tablewrap, article, footer');

    const horde = g.createHorde()
      .gremlin(g.species.clicker()
        .clickTypes(['click', 'click', 'dblclick', 'mousedown', 'mouseup'])   // weight plain clicks
        .canClick(isTarget)
        .showAction((x, y) => { /* keep the console readable */ }))
      .gremlin(g.species.toucher().touchTypes(['tap', 'doubletap', 'gesture']).canTouch(isTarget))
      .gremlin(g.species.scroller())          // exercises .tablewrap overflow + page scroll
      .gremlin(g.species.typer())             // keyboard noise on a page with no inputs: should be inert
      .mogwai(g.mogwais.alert())              // any alert() is a failure
      .mogwai(g.mogwais.fps().delay(200))     // logs FPS drops
      .strategy(g.strategies.distribution()
        .distribution([0.45, 0.2, 0.25, 0.10])
        .delay(DELAY).nb(NB));

    horde.after(() => {
      const after = baseline();
      const report = {
        mode: NAV_MODE,
        page: location.pathname,
        events: NB,
        durationMs: Math.round(after.t - before.t),
        unhandledErrors: errors,
        longTasksOver100ms: longTasks,
        domNodeDelta: after.nodes - before.nodes,          // must be 0 on a static page
        heapDeltaKB: after.heapKB != null ? after.heapKB - before.heapKB : 'n/a',
        horizontalOverflowIntroduced: after.scrollW > before.scrollW,
        ctaDeadClicksAbsorbed: ctaHits,                    // >0 proves users can click it and nothing happens
        focusLeftOn: document.activeElement.tagName + (document.activeElement.className ? '.' + document.activeElement.className : ''),
      };
      const pass = errors.length === 0 && longTasks === 0 && report.domNodeDelta === 0 && !report.horizontalOverflowIntroduced;
      console.log('%c🛡️ UX Crucible: chaos complete — ' + (pass ? 'STABLE' : 'FAILURES FOUND'), 'font-weight:bold;color:' + (pass ? '#22B8CF' : '#e5484d'));
      console.table(report);
      if (NAV_MODE === 'storm') sessionStorage.removeItem('__crucible_storm');
    });

    horde.unleash();
  }

  if (NAV_MODE === 'storm') {
    // Re-arm on every landing page until NB is exhausted across navigations.
    const left = +(sessionStorage.getItem('__crucible_storm') || NB);
    if (left <= 0) return console.log('UX Crucible: storm finished.');
    sessionStorage.setItem('__crucible_storm', String(left - 150));
    // In storm mode the trap is off; a click on a.card navigates and this IIFE must be re-injected
    // by a userscript / DevTools snippet with "run on navigation". Playwright covers this path in
    // tests/chaos.spec.ts, which is the recommended way to run storm mode.
  }

  loadGremlins(run);
})();
