import { test, expect } from '@playwright/test';
import { PAGES } from './pages';
import { installCLS } from './helpers';

/** Third-party font hosts are covered by the "fonts blocked" test; a network failure reaching them is not a chaos failure. */
const isFontHostNoise = (msg: string) => /fonts\.(googleapis|gstatic)\.com/.test(msg) || /Failed to load resource/.test(msg);

/**
 * CHAOS BLUEPRINT (automated). Two attacks:
 *  1. Trap horde: 3000 synthetic events at machine speed with navigation suppressed. Static page must not
 *     grow its DOM, throw, freeze, or shift layout.
 *  2. Navigation storm: 40 real card clicks (single/double/triple) + back. Must land on the right board every
 *     time, with zero errors and zero failed requests.
 */
test.describe('Chaos', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  for (const [name, path] of Object.entries(PAGES)) {
    test(`trap horde survives on ${name}`, async ({ page }) => {
      await installCLS(page);
      const errors: string[] = [];
      page.on('pageerror', e => errors.push(e.message));
      page.on('console', m => { if (m.type() === 'error' && !isFontHostNoise(m.text())) errors.push(m.text()); });
      page.on('dialog', d => { errors.push('dialog: ' + d.message()); d.dismiss(); });
      await page.goto(path); await page.evaluate(() => (document as any).fonts.ready);
      const r = await page.evaluate(async () => {
        const stop = (e: Event) => e.preventDefault(); document.addEventListener('click', stop, true);
        const nodes0 = document.getElementsByTagName('*').length; const cls0 = (window as any).__cls;
        const els = [...document.querySelectorAll('a, .cta, .card, h1, h2, p, li, td, th, img, body')] as HTMLElement[];
        const types = ['click', 'dblclick', 'mousedown', 'mouseup', 'pointerdown', 'contextmenu'];
        let longest = 0, last = performance.now(); const t0 = last;
        for (let i = 0; i < 3000; i++) {
          const el = els[(Math.random() * els.length) | 0]; const b = el.getBoundingClientRect();
          el.dispatchEvent(new MouseEvent(types[(Math.random() * types.length) | 0], { bubbles: true, cancelable: true, clientX: b.left + Math.random() * b.width, clientY: b.top + Math.random() * b.height }));
          if (i % 7 === 0) window.scrollTo(0, Math.random() * document.documentElement.scrollHeight);
          if (i % 13 === 0) el.focus?.();
          if (i % 50 === 0) { await new Promise(r => setTimeout(r, 0)); const n = performance.now(); longest = Math.max(longest, n - last); last = n; }
        }
        document.removeEventListener('click', stop, true);
        return { ms: Math.round(performance.now() - t0), longestBatchMs: Math.round(longest), domDelta: document.getElementsByTagName('*').length - nodes0, cls: +((window as any).__cls - cls0).toFixed(4) };
      });
      expect(errors).toEqual([]);
      expect(r.domDelta, 'DOM grew under chaos').toBe(0);
      expect(r.cls, 'layout shifted under chaos').toBeLessThanOrEqual(0.05);
      expect(r.longestBatchMs, '50 events took >250ms: main thread freeze').toBeLessThan(250);
    });
  }

  test('navigation storm: rapid card clicks + back land correctly with zero errors', async ({ page }) => {
    const errors: string[] = []; const failed: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    // A second click on the same card supersedes the in-flight navigation (net::ERR_ABORTED). That is the user's own doing, not a defect.
    page.on('requestfailed', r => { const why = r.failure()?.errorText || ''; if (!isFontHostNoise(r.url()) && !/ERR_ABORTED/.test(why)) failed.push(`${r.url()} ${why}`); });
    page.on('response', r => { if (r.status() >= 400 && !isFontHostNoise(r.url())) failed.push(`${r.url()} ${r.status()}`); });
    await page.goto(PAGES.index);
    let wrong = 0;
    const rounds = +(process.env.STORM_ROUNDS || 40);
    for (let i = 0; i < rounds; i++) {
      const cards = page.locator('a.card'); const idx = (Math.random() * await cards.count()) | 0;
      const href = (await cards.nth(idx).getAttribute('href'))!;
      await Promise.all([page.waitForURL(u => u.pathname.endsWith(href), { waitUntil: 'domcontentloaded' }), cards.nth(idx).click({ clickCount: 1 + ((Math.random() * 3) | 0) })]).catch(() => { wrong++; });
      await page.goBack({ waitUntil: 'domcontentloaded' });
    }
    expect(wrong, 'clicks that did not land on the expected board').toBe(0);
    expect(errors).toEqual([]);
    expect(failed).toEqual([]);
  });

  test('fonts blocked: page is readable immediately (no invisible text, no shift storm)', async ({ page }) => {
    await installCLS(page);
    await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
    await page.goto(PAGES.index); await page.waitForTimeout(1500);
    const h1 = page.locator('h1').first();
    await expect(h1).toBeVisible();
    expect(await page.evaluate(() => (window as any).__cls)).toBeLessThanOrEqual(0.10);
  });
});
