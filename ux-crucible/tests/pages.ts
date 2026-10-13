/** Every published surface. Add new boards here as they ship (or let discover() find them). */
export const PAGES = {
  index: '/index.html',
  receipt: '/receipt/index.html',
  board001: '/boards/2026-08-29-001-kids-coloring-book/index.html',
  board003: '/boards/2026-08-29-003-a-learning-software-specifically-tailore/index.html',
  board005: '/boards/2026-08-30-005-milkplexity-itself-turn-this-app-into-a/index.html',
  board006: '/boards/2026-08-30-006-absorb-the-buildpad-teardown-rank-what-w/index.html',
  board007: '/boards/2026-08-30-007-round-two-resolve-the-four-forks-under-t/index.html',
  board011: '/boards/2026-08-31-011-reel-downloader-a-production-grade-publi/index.html',
  board012: '/boards/2026-08-31-012-multi-platform-media-extraction-api-for/index.html',
  board013: '/boards/2026-08-31-013-creator-and-agency-content-workflow-too/index.html',
  board015: '/boards/2026-08-31-015-round-two-the-two-boards-contradict-ea/index.html',
  board017: '/boards/2026-08-31-017-the-forge-council-judges-probes-verify/index.html',
};

/** Deterministic font loading so screenshots never race the Google Fonts swap. */
export async function settle(page: import('@playwright/test').Page) {
  await page.evaluate(() => (document as any).fonts.ready);
  await page.waitForTimeout(150);
}
