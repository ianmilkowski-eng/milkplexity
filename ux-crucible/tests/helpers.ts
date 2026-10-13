import type { Page } from '@playwright/test';

/** Install a layout-shift observer before any script runs. */
export async function installCLS(page: Page) {
  await page.addInitScript(() => {
    (window as any).__cls = 0; (window as any).__shifts = [];
    try {
      new PerformanceObserver(l => {
        for (const e of l.getEntries() as any[]) if (!e.hadRecentInput) {
          (window as any).__cls += e.value;
          (window as any).__shifts.push({ v: +e.value.toFixed(4), t: Math.round(e.startTime) });
        }
      }).observe({ type: 'layout-shift', buffered: true });
    } catch {}
  });
}

/** WCAG contrast of an element's computed color against its effective (alpha-composited) background. */
export const contrastScript = (selector: string) => `(() => {
  const lum = ([r,g,b]) => { const f = c => { c/=255; return c<=0.03928? c/12.92 : Math.pow((c+0.055)/1.055,2.4); }; return 0.2126*f(r)+0.7152*f(g)+0.0722*f(b); };
  const parse = s => { const m = s.match(/rgba?\\(([^)]+)\\)/); if (!m) return null; const p = m[1].split(',').map(Number); return { rgb: p.slice(0,3), a: p.length>3? p[3] : 1 }; };
  const effBg = el => { let acc = null, node = el;
    while (node && node.nodeType === 1) { const c = parse(getComputedStyle(node).backgroundColor);
      if (c && c.a > 0) { if (!acc) acc = { rgb: c.rgb, a: c.a }; else if (acc.a < 1) acc = { rgb: acc.rgb.map((v,i)=> v*acc.a + c.rgb[i]*(1-acc.a)*c.a), a: acc.a + c.a*(1-acc.a) }; if (acc.a >= 0.999) break; }
      node = node.parentElement; }
    if (!acc) return [255,255,255]; return acc.a < 1 ? acc.rgb.map(v => v*acc.a + 255*(1-acc.a)) : acc.rgb; };
  const out = [];
  for (const el of document.querySelectorAll(${JSON.stringify(selector)})) {
    const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue;
    const cs = getComputedStyle(el); const fg = parse(cs.color); if (!fg) continue;
    const a = lum(fg.rgb), b = lum(effBg(el)); const ratio = (Math.max(a,b)+0.05)/(Math.min(a,b)+0.05);
    const size = parseFloat(cs.fontSize); const bold = parseInt(cs.fontWeight) >= 700;
    const need = (size >= 24 || (size >= 18.66 && bold)) ? 3 : 4.5;
    out.push({ ratio: +ratio.toFixed(2), need, size, text: (el.textContent||'').trim().slice(0,40) });
  }
  return out;
})()`;
