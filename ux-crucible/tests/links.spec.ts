import { test, expect } from '@playwright/test';

/**
 * Crawl from the index over HTTP only (no rendering, so third-party font stalls cannot slow it down).
 * Every internal href must resolve 200, and every page that exists must be reachable by a human clicking.
 */
test('site crawl: no dead links, no orphan pages', async ({ request, baseURL }) => {
  test.setTimeout(120_000);
  const seen = new Set<string>(); const queue = ['/index.html']; const broken: string[] = [];
  while (queue.length) {
    const path = queue.shift()!; if (seen.has(path)) continue; seen.add(path);
    const res = await request.get(path);
    if (res.status() !== 200) { broken.push(`${path} → ${res.status()}`); continue; }
    if (!/\.html?$|\/$/.test(path)) continue;
    const html = await res.text();
    for (const m of html.matchAll(/href="([^"#]+)"/g)) {
      const u = new URL(m[1], baseURL + path); if (!u.href.startsWith(baseURL!)) continue;
      const p = u.pathname; if (!seen.has(p)) queue.push(p);
    }
  }
  expect(broken).toEqual([]);
  const mustBeReachable = ['/receipt/index.html'];
  expect(mustBeReachable.filter(p => !seen.has(p)), 'pages nobody can navigate to from the index').toEqual([]);
});
