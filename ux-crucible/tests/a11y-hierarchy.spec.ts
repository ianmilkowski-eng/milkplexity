import { test, expect } from '@playwright/test';
import { PAGES, settle } from './pages';
import { contrastScript } from './helpers';

/** Information hierarchy, contrast, and interaction-affordance gates. Viewport/scheme-agnostic checks run once per project anyway — cheap. */
for (const [name, path] of Object.entries(PAGES)) {
  test.describe(`Hierarchy & affordance: ${name}`, () => {
    test('exactly one <h1> and no heading-level skips', async ({ page }) => {
      await page.goto(path);
      const hs = await page.evaluate(() => [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].map(h => ({ tag: h.tagName, text: (h.textContent||'').trim().slice(0,50) })));
      expect(hs.filter(h => h.tag === 'H1'), 'multiple H1s: ' + JSON.stringify(hs.filter(h => h.tag === 'H1'))).toHaveLength(1);
      let prev = 0; const skips: string[] = [];
      for (const h of hs) { const n = +h.tag[1]; if (prev && n > prev + 1) skips.push(`${h.tag} "${h.text}" after H${prev}`); prev = n; }
      expect(skips).toEqual([]);
    });

    test('body copy, meta, excerpts, footer and CTA meet WCAG AA contrast in this color scheme', async ({ page }) => {
      await page.goto(path); await settle(page);
      const sels = ['p.tagline', '.meta', 'nav.crumb a', '.card p', 'footer', '.cta', 'article p', 'article blockquote p', 'th', 'td', 'article code', 'a.word'];
      const failures: string[] = [];
      for (const sel of sels) {
        const rows: { ratio: number; need: number; size: number; text: string }[] = await page.evaluate(contrastScript(sel));
        const worst = rows.sort((a, b) => a.ratio - b.ratio)[0];
        if (worst && worst.ratio < worst.need) failures.push(`${sel} ${worst.ratio}:1 (need ${worst.need}:1 @${worst.size}px) "${worst.text}"`);
      }
      expect(failures, 'WCAG AA contrast failures').toEqual([]);
    });

    test('every interactive target is at least 24×24 CSS px (WCAG 2.5.8)', async ({ page }) => {
      await page.goto(path); await settle(page);
      const small = await page.evaluate(() => [...document.querySelectorAll('a[href], button, [role=button]')]
        .map(el => { const r = el.getBoundingClientRect(); return { text: (el.textContent||'').trim().slice(0,30), w: Math.round(r.width), h: Math.round(r.height) }; })
        .filter(t => t.w > 0 && (t.w < 24 || t.h < 24)));
      expect(small, 'undersized tap targets').toEqual([]);
    });

    test('nothing styled as a button is a dead-click surface', async ({ page }) => {
      await page.goto(path);
      const dead = await page.evaluate(() => [...document.querySelectorAll('.cta, [class*=btn], [class*=button]')]
        .filter(el => !(el instanceof HTMLAnchorElement && el.href) && !(el instanceof HTMLButtonElement))
        .map(el => `${el.tagName}.${el.className} "${(el.textContent||'').trim().slice(0,50)}"`));
      expect(dead, 'button-styled elements that do nothing when clicked').toEqual([]);
    });

    test('keyboard focus is visible on the first three tab stops', async ({ page }) => {
      await page.goto(path); await settle(page);
      const stops = Math.min(3, await page.locator('a[href], button').count());
      for (let i = 0; i < stops; i++) {
        await page.keyboard.press('Tab');
        const f = await page.evaluate(() => { const a = document.activeElement as HTMLElement; const cs = getComputedStyle(a);
          return { tag: a.tagName, outline: cs.outlineStyle, width: parseFloat(cs.outlineWidth), shadow: cs.boxShadow }; });
        expect(f.tag, 'focus fell off the page').not.toBe('BODY');
        expect(f.outline !== 'none' && f.width > 0 || f.shadow !== 'none', `no visible focus ring on ${f.tag}`).toBeTruthy();
      }
    });

    test('index excerpts are not cut mid-sentence and meta lines do not repeat the date', async ({ page }) => {
      test.skip(name !== 'index', 'index only');
      await page.goto(path);
      const truncated = await page.evaluate(() => [...document.querySelectorAll('.card p')].map(p => p.textContent!.trim()).filter(t => /(\.\.\.|…|:)$/.test(t)));
      const dupDates = await page.evaluate(() => [...document.querySelectorAll('.card .meta')].map(m => m.textContent!.trim())
        .filter(t => { const d = t.match(/\d{4}-\d{2}-\d{2}/g) || []; return new Set(d).size < d.length; }));
      expect(truncated, 'excerpts ending mid-thought').toEqual([]);
      expect(dupDates, 'meta lines with the date twice').toEqual([]);
    });

    test('the receipt page is reachable from the index (primary narrative object is not orphaned)', async ({ page }) => {
      test.skip(name !== 'index', 'index only');
      await page.goto(path);
      const links = await page.evaluate(() => [...document.querySelectorAll('a[href]')].map(a => (a as HTMLAnchorElement).getAttribute('href')!));
      expect(links.some(h => /receipt/.test(h)), 'no link from index to /receipt/').toBeTruthy();
    });
  });
}
