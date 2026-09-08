# Milkplexity — UX Reliability Crucible

Audit date: 2026-09-08. Target: the published static site in this repo (index, 10 boards, `/receipt/`).
Method: every finding below was measured in headless Chromium (Playwright 1.56) across 5 viewports × 2 color schemes,
not eyeballed. Every number can be reproduced with the suite in `tests/`.

**Site objective, as read from the pages:** a founder publishes AI-council "boards" that pressure-test business ideas,
wants strangers to value the judgment (visits, saves, "board my idea" asks), and has one monetization surface: the
"$49 — Forge my idea" reservation on the receipt page. Board 017's own kill criteria say this exactly.

## Verdict in one paragraph

The engineering is solid: 3,000 machine-speed events per page, 80 rapid navigations, hung font CDN — nothing throws,
nothing leaks, nothing freezes. The **information architecture is what fails**. The receipt page, which board 017 calls
"the only thing anyone shares", has zero inbound links. The only CTA on the site is a `<span>` with `cursor:default`
that absorbs clicks and does nothing, sits 3.5 screens down on desktop and 5.1 on mobile, and renders at 2.78:1
contrast in light mode. The index gives the primary action 23.8% of above-fold attention weight (benchmark: 25%),
spread across ten visually identical cards, so the eye has no landing point. Six of twelve pages have two `<h1>`s.
Every card repeats its date, four excerpts end mid-thought or on a colon, and internal jargon ("rebuilt from cached
takes") is exposed to visitors on 5 of 10 cards.

## Findings, ranked by cost to the site's stated objective

| # | Severity | Finding | Measured evidence | Where |
|---|---|---|---|---|
| 1 | Critical | The receipt page is an orphan. No page links to it. | Crawl from index reaches 11 pages; `/receipt/` is not one of them. | `index.html` |
| 2 | Critical | The only CTA is a dead-click surface. | `span.cta.soon`, `cursor:default`, no `href`. Chaos horde delivered clicks to it; nothing happened, nothing was recorded. | `receipt/index.html` |
| 3 | High | CTA is buried and low-contrast. | Top of CTA at 2810px of 3047px doc height (92% scroll depth). 3.5 screens down at 1280×800, 5.1 at 390×844. Contrast 3.59:1 dark, 2.78:1 light (need 4.5:1). | `receipt/index.html` |
| 4 | High | Index has no primary action and no explanation of what a board is. | Above-fold attention weight at 1280×800: first card 23.8%, other cards 53.8%, h1 "The boards" 13.9%. Nothing above the fold is a call to action. | `index.html` |
| 5 | High | Duplicate `<h1>` breaks reading order and the visual hierarchy. | Two H1s on: receipt, boards 001, 005, 006, 007, 011. On the receipt the second H1 ("Keyword reality check") is larger than the section H2s, so the reader thinks a new article started. | 6 pages |
| 6 | High | Horizontal overflow on 320px phones. | Receipt: document 63px wider than viewport; the inline `<code>` URL overflows its paragraph by 85px (15px at 390). Board 017: 7px doc overflow from an unbreakable `codex(distribution):` token. | `receipt/`, `boards/…017` |
| 7 | Medium | Font-swap layout shift crosses Google's "good" line on the longest board. | Real-fonts CLS: board 017 @1280 = **0.1025** (limit 0.10), receipt @390 = 0.081, board 017 @390 = 0.018, index = 0. Shift source: `Public Sans` body text reflowing against system fallback metrics. | all pages |
| 8 | Medium | Google Fonts stylesheet is render-blocking with no timeout. | With the CSS request hung, Chromium produced **no frame for 5+ seconds** (blank page). With a 4s stall, first frame between 0.5–1.5s. | all pages (`<link rel=stylesheet>` in head) |
| 9 | Medium | WCAG AA contrast failures on secondary text. | Dark: `.meta` 3.3:1, footer/`th` 3.59:1. Light: `.meta`/footer/`th`/CTA 2.78:1. All need 4.5:1 at these sizes (12–15px). | all pages |
| 10 | Medium | Evidence table clips silently on phones. | `table{min-width:420px}` inside a 276px (320) / 346px (390) container. It scrolls, but there is no visual affordance; "control, market is alive" is cut to "control, market i". | `receipt/index.html` |
| 11 | Medium | Tap targets below WCAG 2.5.8 minimum (24px). | `a.word` logo 90×22; breadcrumb "All boards" 78×**15**. | every page |
| 12 | Low | Meta line repeats the date on every card and every board header. | 10/10 index cards: `2026-08-31 · Board 017 · 2026-08-31 · …`; board pages: `2026-08-31 · 2026-08-31 · 7 seats spoke`. | `index.html`, boards |
| 13 | Low | Card excerpts truncate mid-thought or end on a colon. | 4/10: "…Seven seats...", "…reusable capital;...", 2× "Drop this idea if any of the following is observed:" | `index.html` |
| 14 | Low | Internal jargon leaks. | "rebuilt from cached takes" on 5/10 cards; "Theory synthesis FAILED; raw lens takes are cached in the run directory" in board 017 body. | `index.html`, boards |
| 15 | Low | No `<nav>` landmark on the index; focus ring is square on 12px-radius cards. | Chrome's default `outline:auto` is visible in both schemes (passes), but corners do not follow the card. | `index.html` |

What **passed** (and is worth keeping): zero JS, 8–15 KB HTML per page, no console errors from the site itself,
zero DOM growth / zero heap growth / zero layout shift under 3,000 chaos events, 80/80 navigations landed on the
right board with single/double/triple clicks, keyboard focus reaches every link and is visible, tables are wrapped
in an `overflow-x:auto` container, `lang="en"` and `<main>` present, no dead internal links.

---

## Stage 1 — The Cognitive Critique

### Index (the landing page)

**Where the eye goes:** the largest, highest-contrast object above the fold is the H1 "The boards" (34px serif, 13.9%
of attention weight). It is a label, not a promise. The tagline above it, which actually explains the product, is
rendered in `--ink-soft` at 16px and gets 2.5% of weight. The first card, which is the primary action, gets 23.8% and
is visually indistinguishable from the nine below it: same surface, same border, same 21px title, same grey excerpt.
The eye scans a list of equals and stalls. There is nothing to do except pick a card, and nothing tells a stranger
which one or why.

**What is missing above the fold:** a one-line statement of what a board is, and one action. Board 017's own next
action #2 says "add a $49 refundable reservation CTA", and its kill criterion counts "board my idea asks". Neither
exists on the page where 100% of visitors land.

**Card anatomy:** the meta line is the first thing in each card and the least useful. `2026-08-31 · Board 017 ·
2026-08-31 · 7 seats spoke · 30 takes` in 12.5px mono at 3.3:1 contrast, wrapping to 2–3 lines on a phone. It states
the date twice, leaks "rebuilt from cached takes", and pushes the title down. The excerpt then cuts off at an arbitrary
character count ("Seven seats..."), which is the classic dynamic-text truncation failure: the preview promises a
sentence it does not deliver.

**Affordance:** cards are block anchors with no arrow, no link color, no "read the board" label. On hover the border
turns cyan, which is the only signal they are links. On touch devices there is no hover. The telemetry in Stage 4 is
placed to measure exactly this: high card exposure with low click-through would confirm the affordance is too weak.

### Receipt page (the page that is supposed to be shared)

**Hierarchy failure:** the nested probe report starts with its own `<h1>` ("Keyword reality check — 016's distribution
thesis") at 34px, larger than the section H2s (23px) that frame it. A reader arriving at "The evidence" sees a bigger
title than the page title and assumes a new document began. Demote it to `<h2>` and its children to `<h3>`.

**CTA placement:** the only revenue surface is the last element before the footer, at 92% of document height. On a
390px phone that is 5.1 screens of scrolling. Then it is grey text on a hairline border with `cursor:default`, reading
"reservations open shortly". A user who reaches it, clicks it, and gets nothing is a Dead Click by definition, and this
page has no way to capture their intent (no email field, no link, no mailto). The site's one conversion event is
structurally impossible.

**Mobile table:** `min-width:420px` forces a horizontal scroll inside a 346px container with no scroll shadow, no
"scroll →" hint, and the last cell of the control row truncated mid-word. The control row ("8 suggestions — market is
alive") is the single most important row because it proves the asymmetry the verdict rests on, and it is the one that
is clipped.

**Overflow:** the inline `<code>suggestqueries.google.com/complete/search</code>` has no break opportunity. At 320px it
pushes the document 63px wider than the viewport, so the whole page can be dragged sideways.

### Board pages

Typographically the strongest pages. Two problems: the meta line duplicates the date, and five boards (001, 005, 006,
007, 011) carry the machine-generated `<h1>Board synthesis — …</h1>` inside the article, below the editorial H1. Board
017 also ships "Theory synthesis FAILED; raw lens takes are cached in the run directory" as visitor-facing prose.

### Typography and rendering

`display=swap` is the right choice for readability, but the fallback stacks do not match the metrics of the web fonts,
so the swap moves text. On board 017 at desktop the measured shift is 0.1025, over the "good" threshold. The fix is
`size-adjust`/`ascent-override` fallback faces (see the fix pack), or self-hosting with `<link rel=preload>`.
Separately, the Google Fonts `<link rel=stylesheet>` is render-blocking: when that origin is slow or unreachable, the
page paints nothing. Load it with `media="print" onload="this.media='all'"` or inline the `@font-face` rules.

---

## Stage 2 — The Chaos Blueprint

`chaos/gremlins-milkplexity.js` is a copy-paste DevTools horde built for this DOM: it targets `a.card`, `a.word`,
`nav.crumb a`, `.cta`, `.tablewrap`, weights plain clicks, adds touch gestures and scrolling, counts dead clicks
absorbed by the CTA span, watches for long tasks over 100ms, and reports DOM/heap deltas. It defaults to "trap" mode
(navigation suppressed so the horde stays on the page); `window.__CRUCIBLE_NAV_MODE='storm'` allows navigation.

The automated equivalent lives in `tests/chaos.spec.ts` and already ran against this repo:

| Attack | Result |
|---|---|
| 3,000 synthetic events @ machine speed, per page (index, receipt, board 017) | 253–256 ms total, longest 50-event batch 8–10 ms, DOM nodes Δ0, heap Δ0 KB, CLS 0, errors 0 |
| 80 real navigations (40 random card clicks with 1–3 clicks each, then back) | 0 wrong landings, 0 site errors |
| Google Fonts blocked outright | Text visible immediately in fallback fonts, CLS 0 |
| Google Fonts CSS hung | **No frame painted for 5+ s** (finding 8) |

Static HTML with no JavaScript is, unsurprisingly, unbreakable at the state-management level. The chaos value here is
the dead-click counter on `.cta` and the storm's proof that double- and triple-clicks on cards never mis-navigate.

---

## Stage 3 — The Integrated Regression Matrix

`tests/` is a drop-in Playwright suite. It was executed in this session; its failures are findings 1–13 above.

```bash
cd ux-crucible
npm install                     # @playwright/test + http-server
npx playwright install chromium
npm run test:update-baselines   # first run: records golden screenshots for 5 viewport×scheme projects
npm test                        # every later run: geometry lock + gates below
STAGING_URL=https://<your-pages-host> npm test   # same suite against production
```

Projects: 320×568 dark, iPhone 13 light, 768×1024 dark, 1280×800 dark, 1440×900 light.

| Spec | Gate | Current state |
|---|---|---|
| `visual-lock.spec.ts` | Full-page screenshot within 0.2% pixel diff of baseline | needs baselines recorded |
| | CLS ≤ 0.10 including font swap | **fails** on board 017 @1280 (0.1025) |
| | Document never wider than viewport | **fails** receipt @320, board 017 @320 |
| | No clipped block text outside `.tablewrap` | **fails** receipt (inline code URL) |
| | Overflowing tables sit in a scroll container | passes |
| `a11y-hierarchy.spec.ts` | Exactly one H1, no level skips | **fails** receipt, board 001 (and 005/006/007/011 if added to `pages.ts`) |
| | WCAG AA contrast on tagline/meta/crumb/excerpt/footer/CTA/body/quote/th/td/code/logo | **fails** `.meta`, footer, `th`, `.cta` in both schemes |
| | Every link ≥ 24×24 px | **fails** logo (22px), breadcrumb (15px) |
| | Nothing button-styled is a dead-click | **fails** `span.cta.soon` |
| | Visible focus ring on first tab stops | passes |
| | Excerpts not cut mid-thought; meta has date once | **fails** 4 excerpts, 10 meta lines |
| | Receipt reachable from index | **fails** |
| `links.spec.ts` | HTTP crawl: no 4xx, no orphan pages | **fails** (receipt orphan) |
| `chaos.spec.ts` | Trap horde: 0 errors, DOM Δ0, CLS ≤ 0.05, no batch > 250 ms | passes |
| | Navigation storm: 0 wrong landings, 0 site errors | passes |
| | Fonts blocked: text visible, CLS ≤ 0.10 | passes |

Add every board to `tests/pages.ts` as it ships; the suite is data-driven off that map.

---

## Stage 4 — The Behavioral Firewall

`telemetry/friction-beacon.js` is a 7 KB dependency-free script for a static site. Include it once per page:

```html
<script src="/ux-crucible/telemetry/friction-beacon.js" defer data-endpoint="https://YOUR-COLLECTOR/beacon"></script>
```

Without `data-endpoint` it logs to the console and `sessionStorage.crucible_events`, so you can verify it locally
before wiring a collector (a Cloudflare Worker, a Supabase edge function, or Plausible custom events all work with
`navigator.sendBeacon`).

Hook placement, mapped to this DOM and to board 017's own kill criteria:

| Element | Events | Why it matters |
|---|---|---|
| `a.card` (index) | `card_exposed` (50% visible), `card_click` with position index | ContentSquare-style zone attribution. Exposure high + clicks low = the affordance problem in Stage 1. Position index tells you whether anyone scrolls past card 3. |
| `.cta` (receipt) | `cta_exposed`, `cta_click {enabled:false}`, `dead_click` | Today every click here is a dead click. This is the "$49 pre-order gets 0 orders in 30 days" kill criterion, instrumented. Until the CTA is real, `cta_exposed` alone tells you how many people ever see it (predict: single digits, given 92% scroll depth). |
| any element | `rage_click` (3+ clicks on the same node inside 1 s) | Fires on cards double-clicked in frustration when the hover-only affordance fails on touch. |
| non-link elements that look clickable (`.cta`, `.meta`, `strong`, headings, tables) | `dead_click` | FullStory's Dead Click, restricted to surfaces that plausibly look interactive so it is not noise. |
| `.tablewrap` (receipt) | `table_overflow {hiddenPx}`, `table_scroll` | Proves whether phone users ever discover the clipped control row. Overflow without scroll = they did not. |
| page | `scroll_depth` 25/50/75/100 | Board 017's kill criterion needs "qualified visitors". Depth ≥ 75% on a 3,000px board is your qualification signal. |
| page | `layout_shift {cls, beforeFontsReady}` on `pagehide` | Field CLS, split by whether the shift happened during the font swap. Confirms or clears finding 7 on real devices. |
| window | `js_error` | Should be permanently zero on this site. Any non-zero value means a browser extension or a future script regression. |

Every event carries session id, zone (`index` / `board` / `receipt`), board number, viewport, and color scheme, so the
light-mode contrast problem (finding 9) can be correlated with light-mode scroll depth directly.

---

## Fix pack (smallest changes that clear the gates)

Apply in this order; each line clears the finding in brackets.

```html
<!-- index.html: give the fold an objective [1, 4] -->
<p class="tagline">A council of AI models that pressure-tests business ideas - and publishes its boards, dissent included.</p>
<a class="cta" href="receipt/index.html">See how a $0 probe killed a $400 spend →</a>
<p class="meta" style="margin-top:6px">the receipt · one full cycle, evidence included</p>

<!-- receipt/index.html: a CTA that can do something [2, 3] -->
<a class="cta" href="mailto:hello@example.com?subject=Forge%20my%20idea%20%2449">$49 - Forge my idea · reserve a slot</a>
<!-- or a form post / Stripe payment link. Keep .cta.soon only if the element is also removed from the tab order and reads as a status, not a button. -->
<!-- and repeat the same CTA directly under "The decision", 1 screen earlier -->

<!-- receipt + boards 001/005/006/007/011: one H1 per page [5] -->
<h2>Keyword reality check — 016's distribution thesis</h2>   <!-- was h1; demote its h2 children to h3 -->
```

```css
/* contrast [9]: raise the dim tokens to 4.5:1 on both surfaces */
:root{--ink-dim:#8B9298}                                   /* dark: 5.65:1 on #16181A (was 3.59:1) */
@media (prefers-color-scheme: light){:root{--ink-dim:#6B675F}}  /* light: 5.25:1 on #F8F7F4 (was 2.78:1) */
@media (prefers-color-scheme: light){.cta{color:#fff}}          /* #0B0D0E on the light accent is only 3.97:1; white is 4.91:1 */
.meta{font-size:13px}

/* overflow [6] */
article code{overflow-wrap:anywhere}
article p,article li{overflow-wrap:break-word}

/* tap targets [11] */
header.site a.word{padding:4px 0;min-height:24px;display:inline-flex;align-items:center}
nav.crumb a{display:inline-block;padding:6px 0}

/* table affordance [10] */
.tablewrap{position:relative;-webkit-overflow-scrolling:touch}
.tablewrap::after{content:"";position:absolute;top:0;right:0;bottom:0;width:28px;pointer-events:none;
  background:linear-gradient(90deg,transparent,var(--bg))}
table{min-width:0}                       /* let it fit at 390; keep min-width only if columns genuinely need it */

/* font swap CLS [7]: metric-compatible fallbacks */
@font-face{font-family:"Public Sans Fallback";src:local("Arial");size-adjust:104%;ascent-override:93%;descent-override:24%;line-gap-override:0%}
@font-face{font-family:"Newsreader Fallback";src:local("Georgia");size-adjust:96%;ascent-override:90%;descent-override:22%;line-gap-override:0%}
:root{--sans:'Public Sans','Public Sans Fallback',-apple-system,system-ui,sans-serif;
      --serif:'Newsreader','Newsreader Fallback',Georgia,serif}

/* dead-click semantics [2]: if the reservation truly isn't open, don't dress it as a button */
.cta.soon{background:transparent;border:1px dashed var(--hair);color:var(--ink-soft);padding:8px 0;border-radius:0}

/* focus ring follows the card [15] */
.card:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
```

```html
<!-- render-blocking fonts [8]: non-blocking stylesheet with a no-JS fallback -->
<link rel="preload" as="style" href="https://fonts.googleapis.com/css2?…&display=swap">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?…&display=swap" media="print" onload="this.media='all'">
<noscript><link rel="stylesheet" href="https://fonts.googleapis.com/css2?…&display=swap"></noscript>
```

Generator-level fixes (these pages are clearly emitted by a script): print the date once in the meta line, drop
"rebuilt from cached takes" and "Theory synthesis FAILED…" from public output, and cut excerpts at a sentence boundary
with a hard cap rather than at a character count.

## Re-run this audit

```bash
python3 -m http.server 4173 --bind 127.0.0.1 &      # from the repo root
cd ux-crucible && npm install && npx playwright install chromium && npm test
```

The suite's failing gates are the open findings; when they all pass, the site clears the Crucible.
