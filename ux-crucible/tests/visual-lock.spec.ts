import { test, expect } from '@playwright/test';
import { PAGES, settle } from './pages';
import { installCLS } from './helpers';

/**
 * INTEGRATED REGRESSION MATRIX — geometry lock.
 * Runs across 5 viewport × color-scheme projects (see playwright.config.ts).
 * First run: `npm run test:update-baselines` to record the golden screenshots, commit them.
 */
for (const [name, path] of Object.entries(PAGES)) {
  test.describe(`Visual Hierarchy Lock: ${name}`, () => {
    test.beforeEach(async ({ page }) => { await installCLS(page); });

    test('full-page geometry matches baseline', async ({ page }) => {
      await page.goto(path, { waitUntil: 'load' });
      await settle(page);
      await expect(page).toHaveScreenshot(`${name}.png`, { fullPage: true });
    });

    test('cumulative layout shift ≤ 0.10 (Google "good") including font swap', async ({ page }) => {
      await page.goto(path, { waitUntil: 'load' });
      await page.evaluate(() => (document as any).fonts.ready);
      await page.waitForTimeout(800);
      const cls = await page.evaluate(() => (window as any).__cls as number);
      const shifts = await page.evaluate(() => (window as any).__shifts);
      expect(cls, `layout shifts: ${JSON.stringify(shifts)}`).toBeLessThanOrEqual(0.10);
    });

    test('no horizontal page overflow at any viewport', async ({ page }) => {
      await page.goto(path); await settle(page);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, 'document wider than viewport').toBe(0);
    });

    test('no clipped text: no block element scrolls horizontally except .tablewrap', async ({ page }) => {
      await page.goto(path); await settle(page);
      const clipped = await page.evaluate(() =>
        [...document.querySelectorAll('p,li,td,th,code,h1,h2,h3,blockquote,.meta,.card')]
          .filter(el => (el as HTMLElement).scrollWidth > (el as HTMLElement).clientWidth + 1 && !el.closest('.tablewrap'))
          .map(el => `${el.tagName}.${el.className}: "${(el.textContent||'').trim().slice(0,40)}"`));
      expect(clipped).toEqual([]);
    });

    test('tables that overflow live inside a scroll container', async ({ page }) => {
      await page.goto(path); await settle(page);
      const bad = await page.evaluate(() => [...document.querySelectorAll('table')]
        .filter(t => t.scrollWidth > t.parentElement!.clientWidth && getComputedStyle(t.parentElement!).overflowX !== 'auto').length);
      expect(bad).toBe(0);
    });
  });
}
