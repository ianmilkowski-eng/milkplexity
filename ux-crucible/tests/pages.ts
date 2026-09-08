/** Every published surface. Add new boards here as they ship (or let discover() find them). */
export const PAGES = {
  index: '/index.html',
  receipt: '/receipt/index.html',
  board017: '/boards/2026-08-31-017-the-forge-council-judges-probes-verify/index.html',
  board001: '/boards/2026-08-29-001-kids-coloring-book/index.html',
};

/** Deterministic font loading so screenshots never race the Google Fonts swap. */
export async function settle(page: import('@playwright/test').Page) {
  await page.evaluate(() => (document as any).fonts.ready);
  await page.waitForTimeout(150);
}
