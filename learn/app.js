/* Milkplexity Learn · app.js
   Screens, routing and choreography. Every user action mutates the engine
   first, re-renders from its view, then hands rects to the spring engine:
   [tap] -> [engine action] -> [render from state] -> [springs retarget].

   Screens: home, round, checkpoint (also its complete and ended variants),
   library, card, add, tutor. The Progress sheet lives outside the screens
   and shows a peek strip during a round. */
"use strict";
(() => {
  const M = window.Motion, E = window.LearnEngine;
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
  const engine = new E.Engine(window.LearnDecks);
  /* crypto.randomUUID is absent on plain-http hosts other than localhost. */
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === "x" ? r : (r & 3 | 8)).toString(16); }));
  /* To run against the app's private ledger, make this fetch("/api/learn" + path). */
  const api = (path, body, method) => engine.api(path, body, method);

  const MASTERY = {NEW: "New", SEEN: "Seen", FAMILIAR: "Familiar", MASTERED: "Mastered"};
  const CAPTIONS = {easy: "Tap the answer. Builds Familiar.", recall: "Think, flip, rate yourself. Builds Familiar.", hard: "Typed unaided once a card is Familiar. The only way to Mastered."};
  const FORMATS = {multiple_choice: "Choose the answer", true_false: "Is this the match?", flashcard: "Think, then reveal", written: "Type what you remember"};
  const PILL = [{value: "easy", label: "Easy", hint: CAPTIONS.easy}, {value: "recall", label: "Recall", hint: CAPTIONS.recall}, {value: "hard", label: "Hard test", hint: CAPTIONS.hard}];
  const STOP = new Set(["the", "a", "an", "of", "in", "on", "to", "and", "or", "for", "is", "are", "what", "which", "how", "vs", "versus", "with", "by"]);
  const PREFS_KEY = "milkplexity-learn-prefs-v1";
  const TAB_SCREENS = ["home", "library", "tutor"];

  let view = null, current = null, plan = null, prefs = {}, queuedMode = null, rebuild = null, autoTimer = 0, busy = false, draftTimer = 0;
  let sheet = null, tutorState = null, libFilter = {query: "", kind: "all"};
  const scrolls = new Map(), flights = new Set();

  /* ---- small helpers ----------------------------------------------------- */
  const cardOf = id => view.cards.find(c => c.id === id);
  const session = () => view && view.session;
  const inRound = () => { const s = session(); return Boolean(s && ["question", "feedback"].includes(s.status)); };
  const config = () => ({...E.DEFAULTS, ...(view ? view.config : {}), ...prefs});
  function savePrefs(patch) { Object.assign(prefs, patch); try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch {} M.settings.haptics = config().haptics !== false; }
  function loadPrefs() { try { prefs = JSON.parse(localStorage.getItem(PREFS_KEY) || "{}") || {}; } catch { prefs = {}; } M.settings.haptics = config().haptics !== false; }
  function theme(value) {
    document.documentElement.dataset.theme = value;
    try { localStorage.setItem("milk-theme", value); } catch {}
    $("#theme-color")?.setAttribute("content", value === "paper" ? "#F7F6F2" : "#050709");
    for (const b of $$("[data-action=theme]")) b.setAttribute("aria-label", value === "paper" ? "Dark mode" : "Paper mode");
  }
  function toast(message) {
    const t = $("#toast"); t.textContent = message; t.hidden = false;
    M.animate(t, {y: 0, opacity: 1}, {from: {y: 12, opacity: 0}});
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => M.animate(t, {y: 8, opacity: 0}, {preset: "snappy", onRest: () => { t.hidden = true; }}), 3200);
  }
  const fmtDate = iso => new Date(iso).toLocaleString(undefined, {month: "short", day: "numeric", hour: "numeric", minute: "2-digit"});
  function monogram(front) {
    const words = front.split(/[^\p{L}\p{N}]+/u).filter(w => w && !STOP.has(w.toLowerCase()));
    const list = words.length ? words : front.split(/\s+/).filter(Boolean);
    if (!list.length) return "?";
    if (list.length === 1) return list[0].slice(0, 2).replace(/^./u, c => c.toUpperCase());
    return (list[0][0] + list[1][0]).toUpperCase();
  }
  function bubble(card, {size = 56, cls = "", state = "", tag = "span", attrs = ""} = {}) {
    const glyph = state === "correct" ? '<i class="badge ok" aria-hidden="true">✓</i>' : state === "miss" ? '<i class="badge miss" aria-hidden="true">↻</i>' : "";
    const deck = view && view.decks.find(d => d.id === card.deck);
    return `<${tag} class="bubble ${cls}" data-card="${esc(card.id)}" data-mastery="${esc(card.mastery || "NEW")}" data-state="${state}" style="--bubble:${size}px${deck ? `;--hue:${deck.hue}` : ""}" ${attrs}><span class="mono" aria-hidden="true">${esc(monogram(card.front))}</span>${glyph}</${tag}>`;
  }
  const themeButton = () => `<button type="button" class="icon-btn" data-action="theme" aria-label="${document.documentElement.dataset.theme === "paper" ? "Dark mode" : "Paper mode"}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg></button>`;
  function fly(m) { flights.add(m); const check = () => { if (m.done) flights.delete(m); else requestAnimationFrame(check); }; check(); return m; }
  function cancelFlights() { for (const m of flights) m.cancel(); flights.clear(); }
  function fadeText(el, text) { if (!el || el.textContent === text) return; M.animate(el, {opacity: 0}, {preset: "snappy", onRest: () => { el.textContent = text; M.animate(el, {opacity: 1}, {preset: "snappy"}); }}); }
  function sound(correct) {
    if (!config().sound) return;
    try { const Ctx = window.AudioContext || window.webkitAudioContext; if (!Ctx) return; const ctx = new Ctx(), osc = ctx.createOscillator(), gain = ctx.createGain(); osc.connect(gain); gain.connect(ctx.destination); osc.frequency.value = correct ? 660 : 330; gain.gain.setValueAtTime(.035, ctx.currentTime); gain.gain.exponentialRampToValueAtTime(.001, ctx.currentTime + .16); osc.start(); osc.stop(ctx.currentTime + .17); osc.onended = () => ctx.close(); } catch {}
  }

  /* ---- engine calls ------------------------------------------------------- */
  async function perform(action, extra = {}) {
    const s = session(); if (!s || busy) return false;
    busy = true; clearTimeout(autoTimer);
    try { view = await api("/drill/action", {session_id: s.id, revision: s.revision, question_id: s.question?.id, request_id: uuid(), action, ...extra}); return true; }
    catch (e) { toast(e.message); return false; }
    finally { busy = false; }
  }
  async function refresh() { view = await api("/drill"); }

  /* ---- rebuild: the tap-by-tap correction step ---------------------------- */
  function seededOrder(n, seed) {
    let h = 2166136261; for (const ch of seed) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
    const ids = [...Array(n).keys()];
    for (let i = n - 1; i > 0; i--) { h = (Math.imul(h, 1664525) + 1013904223) >>> 0; const j = h % (i + 1); [ids[i], ids[j]] = [ids[j], ids[i]]; }
    return ids;
  }
  function makeRebuild(answer, seed) {
    const words = answer.trim().split(/\s+/);
    const tiles = [];
    if (words.length >= 3) {
      const groups = Math.min(8, words.length), base = Math.floor(words.length / groups), extra = words.length % groups;
      let i = 0;
      for (let g = 0; g < groups; g++) { const n = base + (g < extra ? 1 : 0); tiles.push({text: words.slice(i, i + n).join(" "), space: g > 0}); i += n; }
    } else {
      const budget = Math.max(2, Math.floor(6 / words.length));
      words.forEach((w, wi) => {
        const groups = Math.min(budget, Math.max(1, Math.ceil(w.length / 2)));
        const size = Math.ceil(w.length / groups);
        for (let i = 0; i < w.length; i += size) tiles.push({text: w.slice(i, i + size), space: wi > 0 && i === 0});
      });
    }
    tiles.forEach((t, i) => { t.id = i; });
    let order = seededOrder(tiles.length, seed);
    if (tiles.length > 1 && order.every((id, i) => id === i)) order = order.reverse();
    return {question: seed, tiles, order, placed: []};
  }
  const rebuildText = () => rebuild ? rebuild.placed.map(id => rebuild.tiles[id]).map(t => (t.space ? " " : "") + t.text).join("").trim() : "";
  const rebuildDone = () => Boolean(rebuild && rebuild.placed.length === rebuild.tiles.length);
  function ensureRebuild() {
    const s = session(); if (!s || s.status !== "feedback" || s.feedback.correct) { rebuild = null; return; }
    if (!rebuild || rebuild.question !== s.question.id) rebuild = makeRebuild(s.question.answer, s.question.id);
  }
  const tileHTML = (t, cls) => `<button type="button" class="rtile ${cls}" data-action="rtile" data-tile="${t.id}">${esc(t.text)}</button>`;
  function moveTile(id) {
    const rb = rebuild; const el = $(`.rtile[data-tile="${id}"]`); if (!rb || !el) return;
    const all = $$(".rtile"); const before = new Map(all.map(e => [e, e.getBoundingClientRect()]));
    if (rb.placed.includes(id)) {
      rb.placed = rb.placed.filter(x => x !== id); el.classList.remove("placed");
      const tray = $("#tray"), ids = rb.order.filter(x => !rb.placed.includes(x)), idx = ids.indexOf(id);
      tray.insertBefore(el, tray.children[idx] || null);
    } else { rb.placed.push(id); el.classList.add("placed"); $("#answer-line").append(el); }
    for (const e of all) { const a = before.get(e), b = e.getBoundingClientRect(); const dx = a.left - b.left, dy = a.top - b.top; if (Math.abs(dx) > .5 || Math.abs(dy) > .5) M.shift(e, {x: dx, y: dy}); }
    M.haptic(6);
    checkRebuild();
  }
  /* The moment every tile is placed the line is checked here, so the learner
     never needs a failed Continue to learn the order is wrong. */
  function checkRebuild() {
    const btn = $("[data-action=continue]"), hint = $("#rebuild-hint"), line = $("#answer-line"), s = session();
    if (!btn || !s || !s.question) return;
    const full = rebuildDone(), match = full && E.normalize(rebuildText()) === E.normalize(s.question.answer);
    btn.disabled = !match; line?.classList.toggle("done", match);
    if (hint) hint.textContent = match ? "Rebuilt. Continue when you're ready." : full ? "Not quite that order. Tap a tile to move it." : "";
    if (match) M.animate(btn, {y: 0}, {preset: "snappy", from: {y: 4}});
    else if (full && line) { M.animate(line, {x: 0}, {preset: "snappy", velocity: {x: 500}}); M.haptic([10, 40, 10]); }
  }

  /* ---- home --------------------------------------------------------------- */
  function homeHTML() {
    const cfg = config(), s = session(), active = s && !["complete", "ended"].includes(s.status);
    const decks = [{id: "all", name: "All cards"}, ...view.decks];
    const preview = plan ? plan.card_ids.map(cardOf).filter(Boolean) : [];
    const counts = view.counts, total = view.total || 1;
    const bar = ["NEW", "SEEN", "FAMILIAR", "MASTERED"].map(k => `<span class="seg seg-${k.toLowerCase()}" style="flex:${counts[k]} ${counts[k]} 0"></span>`).join("");
    const legend = ["NEW", "SEEN", "FAMILIAR", "MASTERED"].map(k => `${counts[k]} ${MASTERY[k]}`).join(" · ");
    return `<header class="topbar"><div class="brand"><img src="../assets/favicon.png" alt=""><h1>Learn</h1></div>${themeButton()}</header>
<div class="content">
  <section class="block" data-stagger><p class="eyebrow">Studying</p><div class="chips" role="group" aria-label="Cards to study">${decks.map(d => `<button type="button" class="chip ${cfg.deck === d.id ? "on" : ""}" data-action="deck" data-deck="${d.id}" aria-pressed="${cfg.deck === d.id}">${esc(d.name)}${d.id !== "all" && d.due ? `<span class="chip-count">${d.due}</span>` : ""}</button>`).join("")}</div></section>
  <section class="block" data-stagger><p class="eyebrow">${active ? "In progress" : "Up next"}</p>
    ${preview.length ? `<div class="bubble-row" id="upnext" role="list" aria-label="Cards in the next round">${preview.map(c => bubble(c, {size: 56, tag: "button", attrs: `type="button" role="listitem" data-action="card" aria-label="${esc(c.front)}, ${MASTERY[c.mastery]}"`})).join("")}${plan.total > preview.length ? `<span class="bubble tail" style="--bubble:56px" aria-label="${plan.total - preview.length} more"><span class="mono">+${plan.total - preview.length}</span></span>` : ""}</div>` : `<p class="empty">Nothing is due right now. Study all cards from Options, or add new ones.</p>`}
  </section>
  <section class="card start-card" data-stagger>
    <p class="count-line">${active ? `Round ${s.round} · ${s.index} of ${s.queue.length} answered` : preview.length ? `${preview.length} card${preview.length === 1 ? "" : "s"} this round${plan.fresh ? ` · ${plan.fresh} new` : ""}` : "No cards this round"}</p>
    <div id="home-pill"></div>
    <p class="pill-caption" id="home-caption">${esc(CAPTIONS[cfg.mode])}</p>
    <p class="caption" id="home-format">${esc(formatLine(cfg.mode, preview, plan))}</p>
    <button type="button" class="primary" data-action="${active ? "resume" : "start"}" ${!active && !preview.length ? "disabled" : ""}>${active ? "Resume round" : "Start round"}</button>
  </section>
  <section class="block" data-stagger><h2 class="section-title">Mastery</h2><div class="mastery-bar" role="img" aria-label="${esc(legend)}">${view.total ? bar : ""}</div><p class="legend">${esc(legend)}</p><p class="caption">Mastered only through the Hard test.</p></section>
  <div class="row" data-stagger><span>Practiced today</span><strong>${view.daily} of ${cfg.daily_goal}</strong></div>
  <button type="button" class="row row-btn" data-action="tab" data-tab="tutor" data-stagger><span>Talk it through with Fable or Astra</span><span class="chev" aria-hidden="true">›</span></button>
  <button type="button" class="row row-btn" data-action="sheet-full" data-stagger><span>Options</span><span class="chev" aria-hidden="true">›</span></button>
  <p class="caption fine" data-stagger>Prototype: cards and progress stay in this browser. In the app they live in your private ledger.</p>
</div>`;
  }
  /* The format the set will actually get, so the pill never overpromises. */
  function formatLine(mode, preview, plan) {
    if (!plan || !plan.total) return "";
    if (mode === "hard") { const flips = preview.filter(c => !["FAMILIAR", "MASTERED"].includes(c.mastery)).length; return flips ? `${flips} of these ${flips === 1 ? "card flips" : "cards flip"} first; typing starts once a card is Familiar.` : "Every card in this round is typed."; }
    if (mode === "easy") return plan.total >= 4 ? "Four choices, one tap. No typing." : plan.total >= 2 ? "Small set: true or false until four different answers are in play." : "A set of one: reveal and rate.";
    return "Tap to reveal, then rate yourself. No typing.";
  }
  async function replan() { try { plan = await api("/drill/plan", {config: config()}); } catch (e) { plan = null; toast(e.message); } }
  async function showHome(opts) { await replan(); go("home", {}, opts); }
  function mountHome(el) {
    const cfg = config();
    new window.Pill({el: $("#home-pill", el), options: PILL, value: cfg.mode, label: "How demanding the questions are", onChange: v => { savePrefs({mode: v}); fadeText($("#home-caption", el), CAPTIONS[v]); fadeText($("#home-format", el), formatLine(v, plan ? plan.card_ids.map(cardOf).filter(Boolean) : [], plan)); }});
  }
  async function start() {
    if (busy) return; busy = true;
    try { view = await api("/drill/start", {config: config()}); }
    catch (e) { toast(e.message); busy = false; return; }
    busy = false;
    const s = session(); const first = s.question?.card_id;
    const from = first ? $(`#upnext .bubble[data-card="${first}"]`) : null;
    go("round", {}, {morph: from ? {from} : null});
  }
  function resume() { const s = session(); if (!s) return; if (["question", "feedback"].includes(s.status)) go("round"); else go("checkpoint"); }

  /* ---- round -------------------------------------------------------------- */
  function queueHTML(s) {
    return s.queue.map((id, i) => {
      const c = cardOf(id) || {id, front: "?", mastery: "NEW"};
      const state = i < s.index ? (s.round_results[i]?.correct ? "correct" : "miss") : i === s.index ? "current" : "upcoming";
      return bubble(c, {size: 28, cls: "qbubble", state});
    }).join("");
  }
  function roundHTML() {
    const s = session(), q = s.question, card = cardOf(q.card_id);
    return `<header class="topbar round-bar"><button type="button" class="text-btn" data-action="finish">Finish</button>
  <div class="queue" role="progressbar" aria-label="Questions completed in this round" aria-valuemin="0" aria-valuemax="${s.queue.length}" aria-valuenow="${s.index}">${queueHTML(s)}</div>
  <button type="button" class="chip mode-chip" data-action="sheet-half" aria-label="${esc(E.MODES[s.config.mode].label)} mode. Open progress and options">${esc(E.MODES[s.config.mode].label)}</button></header>
<div class="content">
  <div class="stage">${bubble(card, {size: 64, cls: "stage-avatar", attrs: "data-morph-target"})}<div class="stage-text"><p class="eyebrow" id="stage-count">Question ${s.index + 1} of ${s.queue.length}</p><p class="format" id="stage-format">${FORMATS[q.type]}</p></div></div>
  <div id="qarea" class="qarea">${questionHTML()}</div>
</div>`;
  }
  function questionHTML() {
    const s = session(), q = s.question, f = s.feedback, fb = s.status === "feedback";
    let html = "";
    if (q.type === "multiple_choice") {
      html += `<h2 class="prompt" id="prompt" tabindex="-1">${esc(q.prompt)}</h2><div class="tiles">${q.options.map((o, i) => {
        const st = fb ? (o === q.answer ? "correct" : (o === f.answer && !f.correct ? "wrong" : "dim")) : "";
        return `<button type="button" class="tile ${st}" data-action="choose" data-option="${i}" ${fb ? "disabled" : ""} aria-label="${"ABCD"[i]}. ${esc(o)}"><span class="slot" aria-hidden="true">${st === "correct" ? "✓" : st === "wrong" ? "✕" : "ABCD"[i]}</span><span class="label">${esc(o)}</span></button>`; }).join("")}</div>`;
    } else if (q.type === "true_false") {
      const right = String(q.candidate === q.answer);
      html += `<h2 class="prompt" id="prompt" tabindex="-1">${esc(q.prompt)}</h2><blockquote class="candidate">${esc(q.candidate)}</blockquote><div class="tiles two">${["true", "false"].map((v, i) => {
        const st = fb ? (v === right ? "correct" : (f.answer === v && !f.correct ? "wrong" : "dim")) : "";
        return `<button type="button" class="tile ${st}" data-action="tf" data-value="${v}" ${fb ? "disabled" : ""}><span class="slot" aria-hidden="true">${st === "correct" ? "✓" : st === "wrong" ? "✕" : "AB"[i]}</span><span class="label">${v === "true" ? "True" : "False"}</span></button>`; }).join("")}</div>`;
    } else if (q.type === "flashcard") {
      const revealed = q.revealed || fb;
      html += `<div class="flip ${revealed ? "revealed" : ""}" id="flip" role="button" tabindex="${revealed ? -1 : 0}" data-action="reveal" aria-label="${revealed ? "Answer shown" : "Reveal the answer"}"><div class="flip-inner"><div class="face front"><h2 class="prompt" id="prompt" tabindex="-1">${esc(q.prompt)}</h2><p class="face-hint">Think of the answer, then tap</p></div><div class="face back"><p class="caption">Answer</p><p class="answer-text" id="flip-answer">${esc(revealed ? q.answer : "")}</p></div></div></div>
        <div class="tiles two" id="rate">${revealed ? (fb ? "" : `<button type="button" class="tile" data-action="rate" data-value="again"><span class="slot" aria-hidden="true">↻</span><span class="label">Still learning</span></button><button type="button" class="tile" data-action="rate" data-value="got_it"><span class="slot" aria-hidden="true">✓</span><span class="label">Got it</span></button>`) : `<button type="button" class="primary wide" data-action="reveal">Reveal</button>`}</div>`;
    } else {
      html += `<h2 class="prompt" id="prompt" tabindex="-1">${esc(q.prompt)}</h2><form id="answer-form" class="answer-form"><label class="sr-only" for="answer">Your answer</label><textarea id="answer" rows="2" placeholder="Type what you remember" autocapitalize="off" autocomplete="off" spellcheck="false" enterkeyhint="go" ${fb ? "disabled" : ""}>${esc(fb ? f.answer : q.draft)}</textarea>${fb ? "" : `<button type="submit" class="primary">Check</button><p class="caption" id="draft-status" aria-live="polite">${q.draft ? "Your saved answer is restored." : "Enter to check · Shift + Enter for a new line"}</p>`}</form>`;
    }
    if (!fb) html += `<div class="q-actions"><button type="button" class="text-btn" data-action="unknown">Don't know</button><button type="button" class="chip" data-action="tutor">Ask the tutor · no mastery credit</button></div>`;
    else html += feedbackHTML(s, q, f);
    return html;
  }
  function feedbackHTML(s, q, f) {
    ensureRebuild();
    const title = f.correct ? (f.override ? "Marked correct." : "Got it.") : (f.dont_know ? "No problem. Let's learn it." : "Not quite. Let's rebuild it.");
    const showYours = !f.correct && !f.dont_know && (q.type === "written");
    let html = `<div class="result ${f.correct ? "ok" : "retry"}" role="status"><p class="result-title"><span class="glyph" aria-hidden="true">${f.correct ? "✓" : "↻"}</span>${title}</p>${showYours ? `<p class="caption">Your answer</p><p class="answer-text">${esc(f.answer)}</p>` : ""}<p class="caption">Reference answer</p><p class="answer-text ref">${esc(q.answer)}</p>${q.assisted ? `<p class="caption">You asked first, so this one is practice, not unaided credit.</p>` : ""}<p class="caption mastery-note">${MASTERY[f.before_mastery] || ""} → ${MASTERY[f.mastery]}</p></div>`;
    if (!f.correct) html += `<div class="rebuild" id="rebuild"><p class="caption">Rebuild the answer, tap by tap</p><div class="answer-line" id="answer-line" aria-label="Your rebuilt answer">${rebuild.placed.map(id => tileHTML(rebuild.tiles[id], "placed")).join("")}</div><div class="tray" id="tray">${rebuild.order.filter(id => !rebuild.placed.includes(id)).map(id => tileHTML(rebuild.tiles[id], "")).join("")}</div><p class="caption" id="rebuild-hint" aria-live="polite"></p></div>`;
    html += `<div class="continue-row" id="continue-row"><button type="button" class="primary" data-action="continue" ${!f.correct && !rebuildDone() ? "disabled" : ""}>Continue</button>${!f.correct && !f.dont_know && q.type === "written" ? `<button type="button" class="text-btn" data-action="override">I was correct</button>` : ""}<button type="button" class="chip" data-action="tutor">${f.correct ? "Ask the tutor" : "Ask why"}</button></div>`;
    return html;
  }
  function renderQuestion(enter) {
    const area = $("#qarea"); if (!area) return;
    clearTimeout(autoTimer);
    area.innerHTML = questionHTML();
    const s = session();
    if (enter) {
      const items = [...area.children].flatMap(el => el.classList.contains("tiles") ? [...el.children] : [el]);
      M.stagger(items, {from: {y: 16, opacity: 0}});
    }
    if (s.status === "feedback") {
      const f = s.feedback;
      const target = f.correct ? $("[data-action=continue]") : $("#answer-line");
      (target || $("#prompt"))?.focus({preventScroll: true});
      if (f.correct && config().auto_advance) autoTimer = setTimeout(() => { if (!document.hidden && inRound() && !sheet.modal) continueRound(); }, 1600);
    } else {
      const focus = s.question.type === "written" ? $("#answer") : $("#prompt");
      focus?.focus({preventScroll: true});
    }
  }
  function afterAnswer() {
    const s = session(), f = s.feedback;
    renderQuestion(false);
    const result = $(".result"), row = $("#continue-row"), tray = $("#rebuild");
    if (result) M.animate(result, {y: 0, opacity: 1}, {from: {y: 8, opacity: 0}});
    if (row) M.animate(row, {y: 0, opacity: 1}, {from: {y: 24, opacity: 0}});
    const correctTile = $(".tile.correct .slot"); if (correctTile) M.animate(correctTile, {scale: 1}, {preset: "snappy", from: {scale: .6}});
    const stage = $(".stage-avatar");
    if (stage) { stage.dataset.mastery = f.mastery; if (f.mastery === "MASTERED" && f.before_mastery !== "MASTERED") M.animate(stage, {scale: 1.22}, {preset: "snappy", onRest: el => M.animate(el, {scale: 1}, {preset: "standard"})}); }
    if (!f.correct) setTimeout(() => $("#rebuild")?.scrollIntoView({block: "nearest", behavior: M.reduced() ? "auto" : "smooth"}), 80);
    if (f.correct) M.haptic(12); else { const wrong = $(".tile.wrong"); if (wrong) M.animate(wrong, {x: 0}, {preset: "snappy", velocity: {x: 600}}); M.haptic([10, 40, 10]); }
    if (tray) { M.animate(tray, {y: 0, opacity: 1}, {from: {y: 32, opacity: 0}}); M.stagger($$("#tray .rtile"), {from: {y: 10, opacity: 0}, start: 60}); }
    sound(f.correct);
    updateSheet();
  }
  async function answer(extra) { if (busy) return; if (await perform("answer", extra)) afterAnswer(); }
  async function reveal() {
    const s = session(); if (!s || s.status !== "question" || s.question.revealed) return;
    if (!await perform("reveal")) return;
    const q = session().question;
    $("#flip-answer").textContent = q.answer;
    const flip = $("#flip"); flip.classList.add("revealed"); flip.setAttribute("aria-label", "Answer shown"); flip.tabIndex = -1;
    M.animate($(".flip-inner"), {rotateY: 180}, {from: {rotateY: 0}});
    M.haptic(8);
    const rate = $("#rate");
    rate.innerHTML = `<button type="button" class="tile" data-action="rate" data-value="again"><span class="slot" aria-hidden="true">↻</span><span class="label">Still learning</span></button><button type="button" class="tile" data-action="rate" data-value="got_it"><span class="slot" aria-hidden="true">✓</span><span class="label">Got it</span></button>`;
    M.stagger([...rate.children], {from: {y: 16, opacity: 0}, start: 120});
    rate.children[1].focus({preventScroll: true});
  }
  async function continueRound() {
    const s = session(); if (!s || s.status !== "feedback") return;
    const q = s.question, f = s.feedback;
    const correction = f.correct ? "" : rebuildText();
    const prevId = q.card_id, prevCorrect = f.correct;
    const stage = $(".stage-avatar"); const stageRect = stage?.getBoundingClientRect(); const oldGhost = stage?.cloneNode(true);
    if (!await perform("continue", {correction})) {
      const line = $("#answer-line"); if (line) { M.animate(line, {x: 0}, {preset: "snappy", velocity: {x: 500}}); const hint = $("#rebuild-hint"); if (hint) hint.textContent = "Not quite that order. Tap a tile to move it."; }
      return;
    }
    rebuild = null;
    const s2 = session();
    if (!s2.question) { go("checkpoint"); return; }
    const queue = $(".queue");
    if (queue) { queue.innerHTML = queueHTML(s2); queue.setAttribute("aria-valuenow", s2.index); }
    if (stage && stageRect && oldGhost) {
      const slot = $(`.qbubble[data-card="${prevId}"]`);
      oldGhost.dataset.state = prevCorrect ? "correct" : "miss";
      oldGhost.insertAdjacentHTML("beforeend", prevCorrect ? '<i class="badge ok" aria-hidden="true">✓</i>' : '<i class="badge miss" aria-hidden="true">↻</i>');
      if (slot) fly(M.morph({ghost: oldGhost, from: stageRect, to: slot, hide: [slot], reveal: [slot]}));
      const nextCard = cardOf(s2.question.card_id);
      stage.outerHTML = bubble(nextCard, {size: 64, cls: "stage-avatar", attrs: "data-morph-target"});
      const newStage = $(".stage-avatar"), nextSlot = $(`.qbubble[data-card="${nextCard.id}"]`);
      if (nextSlot && !M.reduced()) {
        newStage.style.visibility = "hidden";
        setTimeout(() => { if (!newStage.isConnected) return; fly(M.morph({ghost: newStage.cloneNode(true), from: nextSlot, to: newStage, reveal: [newStage]})); }, 40);
      }
    }
    const count = $("#stage-count"), format = $("#stage-format");
    if (count) count.textContent = `Question ${s2.index + 1} of ${s2.queue.length}`;
    if (format) fadeText(format, FORMATS[s2.question.type]);
    renderQuestion(true);
    updateSheet();
  }
  async function finish() {
    if (!session()) return;
    cancelFlights();
    if (await perform("end")) { rebuild = null; sheet.close(); go("checkpoint"); }
  }
  async function openTutor() {
    const s = session(); if (!s || !["question", "feedback"].includes(s.status)) return;
    const answered = s.status === "feedback";
    if (!await perform("tutor")) return;
    tutorState = {context: session().tutor_context, card: cardOf(s.question.card_id), answered, turns: []};
    const stage = $(".stage-avatar");
    go("tutor", {}, {morph: stage ? {from: stage} : null});
  }

  /* ---- checkpoint --------------------------------------------------------- */
  function checkpointHTML() {
    const s = session(), complete = s.status === "complete", ended = s.status === "ended";
    const all = s.counts.MASTERED === s.card_ids.length;
    const title = ended ? "Saved. Your cards keep their progress." : all ? "You recalled every card." : complete ? "A good place to pause." : "One round closer.";
    const acc = s.attempts ? Math.round(s.correct / s.attempts * 100) : 0;
    const rows = s.round_results.map(r => `<li data-stagger>${bubble(cardOf(r.card_id) || {id: r.card_id, front: r.front, mastery: r.mastery}, {size: 40, state: r.correct ? "correct" : "miss"})}<span class="front">${esc(r.front)}</span><span class="state">${r.correct ? "✓" : "↻"} ${MASTERY[r.mastery]}</span></li>`).join("");
    return `<header class="topbar"><span class="spacer"></span><p class="topbar-title">${ended ? "Session saved" : `Round ${s.round} done`}</p><span class="spacer"></span></header>
<div class="content">
  <h2 class="big-title" id="summary" tabindex="-1" data-stagger>${title}</h2>
  <div class="stat-line" data-stagger><div><strong>${acc}%</strong><span>accuracy</span></div><div><strong>${s.best_streak}</strong><span>best unaided streak</span></div><div><strong>${view.daily}</strong><span>practiced today</span></div></div>
  ${rows ? `<ul class="result-list big">${rows}</ul>` : `<p class="caption" data-stagger>${ended ? "No answers this round." : ""}</p>`}
  ${sinceStart(s)}
  ${!ended && !complete ? `<section class="card" data-stagger><p class="eyebrow">Next round</p><div id="cp-pill"></div><p class="pill-caption" id="cp-caption">${esc(CAPTIONS[s.config.mode])}</p><p class="caption">${s.remaining} card${s.remaining === 1 ? "" : "s"} still to practice.${s.config.mode !== "hard" && s.counts.FAMILIAR ? ` ${s.counts.FAMILIAR} ${s.counts.FAMILIAR === 1 ? "card is" : "cards are"} Familiar; only the Hard test can make ${s.counts.FAMILIAR === 1 ? "it" : "them"} Mastered.` : ""}</p></section>` : ""}
  ${s.next_due && (complete || ended) ? `<p class="caption" data-stagger>Next review: ${esc(fmtDate(s.next_due))}</p>` : ""}
  <div class="button-stack" data-stagger>${ended ? `<button type="button" class="primary" data-action="home">Back to Home</button>` : complete ? `<button type="button" class="primary" data-action="done">Done</button>` : `<button type="button" class="primary" data-action="next_round">Keep going</button>`}${!ended && s.misses.length ? `<button type="button" class="secondary" data-action="review_misses">Review misses · ${s.misses.length}</button>` : ""}${!ended && !complete ? `<button type="button" class="text-btn" data-action="finish">Finish for now</button>` : ""}</div>
</div>`;
  }
  function sinceStart(s) {
    const a = s.counts_start, b = s.counts; if (!a) return "";
    const familiar = Math.max(0, (b.FAMILIAR + b.MASTERED) - (a.FAMILIAR + a.MASTERED)), mastered = Math.max(0, b.MASTERED - a.MASTERED);
    if (!familiar && !mastered) return "";
    const parts = []; if (familiar) parts.push(`${familiar} reached Familiar`); if (mastered) parts.push(`${mastered} reached Mastered`);
    return `<p class="since" data-stagger>Since you started: ${esc(parts.join(", "))}.</p>`;
  }
  function mountCheckpoint(el) {
    const s = session();
    const pillEl = $("#cp-pill", el);
    if (pillEl) new window.Pill({el: pillEl, options: PILL, value: queuedMode || s.config.mode, label: "How demanding the next round is", onChange: async v => {
      savePrefs({mode: v}); fadeText($("#cp-caption", el), CAPTIONS[v]);
      if (await perform("settings", {config: {mode: v, grading: config().grading}})) { queuedMode = null; updateSheet(); }
    }});
    $("#summary", el)?.focus({preventScroll: true});
  }
  async function nextRound(action) {
    const pending = {}; if (queuedMode && queuedMode !== session().config.mode) pending.mode = queuedMode; if (config().grading !== session().config.grading) pending.grading = config().grading;
    if (Object.keys(pending).length) { queuedMode = null; if (pending.mode) savePrefs({mode: pending.mode}); if (!await perform("settings", {config: pending})) return; }
    if (await perform(action)) { rebuild = null; if (session().question) go("round"); else go("checkpoint"); }
  }

  /* ---- library, card detail, add ------------------------------------------ */
  function libraryHTML() {
    const q = libFilter.query.trim().toLowerCase(), kind = libFilter.kind;
    const cards = view.cards.filter(c => (!q || c.front.toLowerCase().includes(q) || c.back.toLowerCase().includes(q))
      && (kind === "all" || (kind === "due" && (c.due <= new Date().toISOString() || c.mastery === "NEW")) || (kind === "starred" && c.starred) || (kind === "mastered" && c.mastery === "MASTERED")));
    const rows = cards.map(c => `<li data-stagger><button type="button" class="row-btn lib-row" data-action="card" data-card="${c.id}">${bubble(c, {size: 40})}<span class="texts"><span class="front">${esc(c.front)}</span><span class="back">${esc(c.back)}</span></span><span class="state">${MASTERY[c.mastery]}</span></button><button type="button" class="icon-btn star" data-action="star" data-card="${c.id}" aria-pressed="${c.starred}" aria-label="${c.starred ? "Unstar" : "Star"} ${esc(c.front)}">${c.starred ? "★" : "☆"}</button></li>`).join("");
    return `<header class="topbar"><h1 class="topbar-title left">Cards</h1><span class="spacer"></span><button type="button" class="secondary small" data-action="add">Add cards</button></header>
<div class="content">
  <input type="search" id="lib-search" class="search" placeholder="Find a card" value="${esc(libFilter.query)}" aria-label="Find a card" data-stagger>
  <div class="chips" role="group" aria-label="Show" data-stagger>${[["all", "All"], ["due", "Due"], ["starred", "Starred"], ["mastered", "Mastered"]].map(([v, l]) => `<button type="button" class="chip ${kind === v ? "on" : ""}" data-action="lib-filter" data-kind="${v}" aria-pressed="${kind === v}">${l}</button>`).join("")}</div>
  ${rows ? `<ul class="lib-list" id="lib-list">${rows}</ul>` : `<p class="empty" data-stagger>${view.cards.length ? "No cards match." : "No cards yet. Add a few to begin."}</p>`}
</div>`;
  }
  function cardHTML(id) {
    const c = cardOf(id); if (!c) return `<header class="topbar"><button type="button" class="icon-btn" data-action="back" aria-label="Back">‹</button></header><div class="content"><p class="empty">That card is gone.</p></div>`;
    const aliases = (c.aliases?.[view.config.answer_with] || []).join("\n");
    return `<header class="topbar"><button type="button" class="icon-btn" data-action="back" aria-label="Back">‹</button><span class="spacer"></span><button type="button" class="icon-btn star" data-action="star" data-card="${c.id}" aria-pressed="${c.starred}" aria-label="${c.starred ? "Unstar" : "Star"} this card">${c.starred ? "★" : "☆"}</button></header>
<div class="content">
  <div class="stage">${bubble(c, {size: 64, cls: "stage-avatar", attrs: "data-morph-target"})}<h2 class="prompt tight">${esc(c.front)}</h2></div>
  <section class="card" data-stagger><button type="button" class="secondary" id="reveal-card" data-action="reveal-card">Reveal answer</button><p class="answer-text ref" id="card-answer" hidden>${esc(c.back)}</p></section>
  <section class="block" data-stagger><h3 class="section-title">Mastery</h3><div class="row"><span>Answering with the ${view.config.answer_with === "back" ? "answer" : "term"}</span><strong>${MASTERY[c.mastery]}</strong></div><p class="caption">Next review ${esc(fmtDate(c.due))}. Mastered only through the Hard test.</p></section>
  <section class="block" data-stagger><h3 class="section-title">Notes</h3><form id="note-form" data-card="${c.id}"><label>Note<textarea id="note" rows="2" maxlength="3000">${esc(c.note)}</textarea></label><label>Mnemonic<textarea id="mnemonic" rows="2" maxlength="3000">${esc(c.mnemonic)}</textarea></label><label>Accepted answers, one per line<textarea id="aliases" rows="2">${esc(aliases)}</textarea></label><button type="submit" class="secondary">Save notes</button></form></section>
  <button type="button" class="text-btn danger" data-action="delete-card" data-card="${c.id}" data-stagger>Delete card</button>
</div>`;
  }
  function addHTML() {
    return `<header class="topbar"><button type="button" class="icon-btn" data-action="back" aria-label="Back">‹</button><h1 class="topbar-title">Add cards</h1><span class="spacer"></span></header>
<div class="content">
  <form id="add-form" data-stagger><label>Set<select id="add-deck">${view.decks.map(d => `<option value="${d.id}">${esc(d.name)}</option>`).join("")}</select></label>
  <label>One card per line: the term, a tab, then the answer<textarea id="add-tsv" rows="6" placeholder="Recall&#9;Of the actual positive cases, the fraction that were found." required></textarea></label>
  <button type="submit" class="primary">Add cards</button></form>
  <p class="caption" data-stagger>Paste an export from Quizlet as is. New cards join the next round.</p>
</div>`;
  }

  /* ---- tutor preview ------------------------------------------------------ */
  function tutorHTML() {
    const t = tutorState, ctx = t?.context;
    return `<header class="topbar"><button type="button" class="text-btn" data-action="back">Done</button><p class="topbar-title">Tutor</p><span class="spacer"></span></header>
<div class="content">
  <div class="stage">${ctx ? bubble(t.card, {size: 64, cls: "stage-avatar", attrs: "data-morph-target"}) : ""}<div class="stage-text"><h2 class="section-title">Talk it through.</h2><div id="tutor-mode"></div></div></div>
  <div class="notice" data-stagger><strong>Preview only.</strong> In the app, your tutor answers from your own Claude or Codex subscription, with this card as its context.</div>
  ${ctx ? `<section class="card" data-stagger><p class="caption">Card context shared with your tutor</p><p class="answer-text">${esc(ctx.prompt)}</p>${ctx.your_answer ? `<p class="caption">Your answer</p><p>${esc(ctx.your_answer)}</p>` : ""}${t.answered ? `<p class="caption">Reference answer</p><p>${esc(ctx.reference_answer)}</p>` : `<p class="caption">The reference answer is shared with the tutor. Asking before you answer marks this question as practice.</p>`}</section>` : `<p class="empty" data-stagger>Open the tutor from a question to share that card's context.</p>`}
  <div class="chips wrap" data-stagger>${["Explain this", "Why was I wrong?", "Give me a mnemonic", "Quiz me on this"].map(l => `<button type="button" class="chip" data-action="tutor-chip" data-chip="${esc(l)}" ${ctx ? "" : "disabled"}>${l}</button>`).join("")}</div>
  <div id="tutor-turns" class="turns" role="log" aria-live="polite">${t ? t.turns.map(turnHTML).join("") : ""}</div>
  ${ctx ? `<details class="prompt-preview" data-stagger><summary>Preview the prompt the app would send</summary><pre id="prompt-text">${esc(promptText())}</pre><button type="button" class="secondary" data-action="copy-prompt">Copy prompt</button><p class="caption" id="copy-status" aria-live="polite"></p></details>` : ""}
</div>`;
  }
  function promptText() {
    const t = tutorState, ctx = t.context;
    const lines = ["You are Milkplexity's study tutor, inside a Learn round.", `Style: ${(prefs.tutor_mode || "direct") === "direct" ? "direct, concise answers" : "one guiding question at a time"}.`, "Stay grounded in this card. Say when you are not certain.", "", "CARD CONTEXT", JSON.stringify({prompt: ctx.prompt, your_answer: ctx.your_answer || "", reference_answer: t.answered ? ctx.reference_answer : "(shared with the tutor)", question_type: ctx.question_type, mastery: ctx.mastery, note: ctx.note || "", mnemonic: ctx.mnemonic || ""}, null, 2)];
    return lines.join("\n");
  }
  const turnHTML = t => `<article class="turn ${t.role}"><strong>${t.role === "user" ? "You" : "Preview"}</strong><div>${t.html}</div></article>`;
  function tutorReply(chip) {
    const t = tutorState, c = t.card, ctx = t.context;
    let html;
    if (chip === "Explain this") html = `<p><strong>${esc(c.front)}</strong>: ${esc(c.back)}</p>${c.note ? `<p class="caption">Your note: ${esc(c.note)}</p>` : ""}`;
    else if (chip === "Why was I wrong?") {
      if (!ctx.your_answer || ctx.your_answer === "again" || ctx.your_answer === "got_it") html = `<p>There is no typed answer to compare yet. The reference answer is: ${esc(c.back)}.</p>`;
      else { const ref = new Set(c.back.toLowerCase().split(/\W+/)); const yours = ctx.your_answer.split(/(\s+)/).map(w => /\w/.test(w) && !ref.has(w.toLowerCase()) ? `<u>${esc(w)}</u>` : esc(w)).join(""); html = `<p class="caption">You said</p><p>${yours}</p><p class="caption">Reference</p><p>${esc(c.back)}</p><p class="caption">Underlined words are not in the reference answer.</p>`; }
    } else if (chip === "Give me a mnemonic") html = c.mnemonic ? `<p>${esc(c.mnemonic)}</p>` : `<p>No mnemonic saved for this card yet. In the app you can ask for one and save it to the card.</p>`;
    else html = `<p>In the app, your tutor asks a fresh question about this card. For now: <strong>${esc(c.front)}</strong>?</p>`;
    t.turns.push({role: "user", html: `<p>${esc(chip)}</p>`}, {role: "tutor", html});
    const log = $("#tutor-turns"); if (!log) return;
    const frag = document.createElement("div"); frag.innerHTML = turnHTML(t.turns[t.turns.length - 2]) + turnHTML(t.turns[t.turns.length - 1]);
    const nodes = [...frag.children]; log.append(...nodes); M.stagger(nodes, {from: {y: 12, opacity: 0}});
    nodes[nodes.length - 1].scrollIntoView({block: "nearest", behavior: M.reduced() ? "auto" : "smooth"});
  }
  function mountTutor(el) {
    new window.Pill({el: $("#tutor-mode", el), options: [{value: "direct", label: "Direct answers"}, {value: "socratic", label: "Guide my thinking"}], value: prefs.tutor_mode || "direct", label: "How the tutor helps", onChange: v => savePrefs({tutor_mode: v})});
  }

  /* ---- progress sheet ----------------------------------------------------- */
  function sheetHTML() {
    const s = session(), live = inRound(), atCheckpoint = Boolean(s && ["checkpoint", "complete"].includes(s.status)), cfg = config();
    const mode = queuedMode || (s && s.status !== "ended" ? s.config.mode : cfg.mode);
    const strip = live ? `<span class="strip-title">Round ${s.round} · ${s.index} of ${s.queue.length}</span><span class="muted">${s.counts.FAMILIAR} Familiar · ${s.counts.MASTERED} Mastered${s.misses.length ? ` · ${s.misses.length} miss${s.misses.length === 1 ? "" : "es"}` : ""}</span>` : `<span class="strip-title">Progress and options</span><span class="muted">${view.counts.MASTERED} of ${view.total} mastered</span>`;
    const results = s && s.round_results?.length ? `<h3 class="section-title">This round</h3><ul class="result-list">${s.round_results.map(r => `<li>${bubble(cardOf(r.card_id) || {id: r.card_id, front: r.front, mastery: r.mastery}, {size: 40, state: r.correct ? "correct" : "miss"})}<span class="front">${esc(r.front)}</span><span class="state">${r.correct ? "✓" : "↻"} ${MASTERY[r.mastery]}</span></li>`).join("")}</ul>` : "";
    const locked = Boolean(s && !["complete", "ended"].includes(s.status));
    return `<div class="sheet-handle" data-sheet-handle><span></span></div>
<div class="sheet-strip" data-sheet-header>${strip}<button type="button" class="icon-btn small" data-sheet-expand aria-label="Expand or collapse">⤢</button></div>
<div class="sheet-body">
  <h3 class="section-title first">Mode</h3><div id="sheet-pill"></div><p class="caption" id="sheet-caption">${live ? "Changes apply at the next checkpoint." : esc(CAPTIONS[mode])}</p>
  ${atCheckpoint && s.misses.length ? `<button type="button" class="row row-btn" data-action="review_misses"><span>Review misses · ${s.misses.length}</span><span class="chev" aria-hidden="true">›</span></button>` : ""}
  ${results}
  <h3 class="section-title">Study options</h3>
  <div class="option-rows">
    <label class="row"><span>Answer with</span><select id="opt-side" ${locked ? "disabled" : ""}><option value="back" ${cfg.answer_with === "back" ? "selected" : ""}>The answer</option><option value="front" ${cfg.answer_with === "front" ? "selected" : ""}>The term</option></select></label>
    <label class="row"><span>Cards</span><select id="opt-scope" ${locked ? "disabled" : ""}><option value="due" ${cfg.scope === "due" ? "selected" : ""}>New and due</option><option value="all" ${cfg.scope === "all" ? "selected" : ""}>All cards</option></select></label>
    <label class="row"><span>Starred only</span><input type="checkbox" id="opt-starred" ${cfg.starred ? "checked" : ""} ${locked ? "disabled" : ""}></label>
    ${mode === "hard" ? `<label class="row"><span>Grading in the Hard test</span><select id="opt-grading"><option value="smart" ${cfg.grading === "smart" ? "selected" : ""}>Smart · small typos</option><option value="exact" ${cfg.grading === "exact" ? "selected" : ""}>Exact · case and symbols</option></select></label>` : ""}
    <label class="row"><span>Advance after correct answers</span><input type="checkbox" id="opt-auto_advance" ${cfg.auto_advance ? "checked" : ""}></label>
    <label class="row"><span>Gentle sounds</span><input type="checkbox" id="opt-sound" ${cfg.sound ? "checked" : ""}></label>
    <label class="row"><span>Touch feedback</span><input type="checkbox" id="opt-haptics" ${cfg.haptics !== false ? "checked" : ""}></label>
    <label class="row"><span>Paper mode</span><input type="checkbox" id="opt-paper" ${document.documentElement.dataset.theme === "paper" ? "checked" : ""}></label>
  </div>
  ${locked ? `<p class="caption">Start a new session to change the cards or the answer side.</p>` : ""}
  ${locked ? `<button type="button" class="secondary" data-action="finish">Finish for now</button>` : ""}
  ${!live ? `<button type="button" class="row row-btn" data-action="tab" data-tab="library"><span>Card library</span><span class="chev" aria-hidden="true">›</span></button>` : ""}
  <button type="button" class="text-btn danger" data-action="reset">Reset the sample cards</button>
</div>`;
  }
  function renderSheet() {
    if (!sheet || sheet.drag) return;
    sheet.el.innerHTML = sheetHTML();
    const s = session(), live = inRound();
    new window.Pill({el: $("#sheet-pill"), options: PILL, value: queuedMode || (s && s.status !== "ended" ? s.config.mode : config().mode), label: "How demanding the questions are", onChange: async v => {
      savePrefs({mode: v});
      if (live) { queuedMode = v; fadeText($("#sheet-caption"), "Changes apply at the next checkpoint."); }
      else if (s && ["checkpoint", "complete"].includes(s.status)) { if (await perform("settings", {config: {mode: v}})) { queuedMode = null; fadeText($("#sheet-caption"), CAPTIONS[v]); if (current?.id === "checkpoint") go("checkpoint", {}, {quiet: true}); } }
      else { fadeText($("#sheet-caption"), CAPTIONS[v]); const hp = $("#home-pill"); if (hp) { $("#home-pill .pill-option[data-value='" + v + "']")?.click(); } }
    }});
    if (live) $("#sheet-pill").classList.add("queued");
    sheet.refresh();
  }
  function updateSheet() {
    if (!sheet) return;
    const s = session(); const peek = current && ["round", "checkpoint"].includes(current.id) && s && s.status !== "ended" ? 64 : 0;
    renderSheet();
    sheet.setPeek(peek);
  }
  async function optionChange(input) {
    const id = input.id.replace("opt-", "");
    if (id === "paper") { theme(input.checked ? "paper" : "dark"); return; }
    const value = input.type === "checkbox" ? input.checked : input.value;
    savePrefs({[id]: value});
    if (["side", "scope", "starred"].includes(id)) { if (id === "side") savePrefs({answer_with: value}); if (!session() || ["complete", "ended"].includes(session().status)) { await replan(); if (current?.id === "home") go("home", {}, {quiet: true}); } }
  }

  /* ---- router ------------------------------------------------------------- */
  function render(id, params) {
    switch (id) {
      case "home": return homeHTML();
      case "round": return roundHTML();
      case "checkpoint": return checkpointHTML();
      case "library": return libraryHTML();
      case "card": return cardHTML(params.id);
      case "add": return addHTML();
      case "tutor": return tutorHTML();
    }
    return "";
  }
  function mount(id, el) {
    if (id === "home") mountHome(el);
    if (id === "checkpoint") mountCheckpoint(el);
    if (id === "tutor") mountTutor(el);
    if (id === "round") { ensureRebuild(); const s = session(); const focus = s.status === "feedback" ? (s.feedback.correct ? $("[data-action=continue]", el) : $("#answer-line", el)) : (s.question.type === "written" ? $("#answer", el) : $("#prompt", el)); focus?.focus({preventScroll: true}); }
    if (id === "library") $("#lib-search", el)?.addEventListener("input", e => { libFilter.query = e.target.value; const list = $("#lib-list") || $(".content .empty", el); const fresh = document.createElement("div"); fresh.innerHTML = libraryHTML(); const next = $("#lib-list", fresh) || $(".empty", fresh); if (list && next) list.replaceWith(next); });
    if (id === "add") $("#add-tsv", el)?.focus({preventScroll: true});
  }
  function go(id, params = {}, {morph = null, quiet = false} = {}) {
    cancelFlights(); clearTimeout(autoTimer);
    const app = $("#app"), old = current;
    if (old) { scrolls.set(old.id, old.el.scrollTop); old.el.inert = true; }
    const el = document.createElement("section"); el.className = "screen"; el.dataset.screen = id; el.innerHTML = render(id, params);
    app.append(el);
    current = {id, el, params};
    document.body.dataset.screen = id;
    mount(id, el);
    if (old) { const oldEl = old.el; if (quiet) oldEl.remove(); else M.animate(oldEl, {opacity: 0}, {preset: "snappy", onRest: () => oldEl.remove()}); }
    el.scrollTop = TAB_SCREENS.includes(id) ? (scrolls.get(id) || 0) : 0;
    if (!quiet) {
      const bar = $(".topbar", el); if (bar) M.animate(bar, {y: 0, opacity: 1}, {from: {y: -24, opacity: 0}});
      M.stagger($$("[data-stagger]", el).slice(0, 16), {from: {y: 16, opacity: 0}, start: 40});
      if (id === "round") { const items = [...$("#qarea", el).children].flatMap(x => x.classList.contains("tiles") ? [...x.children] : [x]); M.stagger(items, {from: {y: 16, opacity: 0}, start: 120}); }
    }
    if (morph && morph.from) {
      const target = $("[data-morph-target]", el);
      if (target) { const ghost = target.cloneNode(true); ghost.removeAttribute("data-morph-target"); fly(M.morph({ghost, from: morph.from, to: target, hide: [morph.from], reveal: [target]})); }
    }
    updateTabbar(); updateSheet();
  }
  function back() {
    const from = current?.id, origin = current?.params?.from;
    if (from === "card" && origin === "home") showHome();
    else if (from === "card" || from === "add") go("library");
    else if (from === "tutor") { if (inRound()) go("round"); else showHome(); }
    else showHome();
  }
  function updateTabbar() {
    const bar = $("#tabbar"); const show = TAB_SCREENS.includes(current?.id); bar.hidden = !show;
    if (!show) return;
    let active = null;
    for (const t of $$(".tab", bar)) { const on = t.dataset.tab === current.id; if (on) { t.setAttribute("aria-current", "page"); active = t; } else t.removeAttribute("aria-current"); }
    if (active) requestAnimationFrame(() => { const x = active.offsetLeft + active.offsetWidth * .3, width = active.offsetWidth * .4; M.animate($(".tab-indicator", bar), {x, width}, {preset: "snappy", from: {x, width}}); });
  }
  function goTab(tab) {
    if (tab === "home") showHome();
    else if (tab === "library") go("library");
    else if (tab === "tutor") { tutorState = tutorState && inRound() ? tutorState : null; go("tutor"); }
  }

  /* ---- events ------------------------------------------------------------- */
  document.addEventListener("click", async e => {
    const b = e.target.closest("[data-action]"); if (!b || b.disabled) return;
    const a = b.dataset.action, s = session();
    if (a === "theme") theme(document.documentElement.dataset.theme === "paper" ? "dark" : "paper");
    else if (a === "tab") goTab(b.dataset.tab);
    else if (a === "deck") { savePrefs({deck: b.dataset.deck}); await replan(); go("home", {}, {quiet: true}); }
    else if (a === "start") start();
    else if (a === "resume") resume();
    else if (a === "card") { const src = b.classList.contains("bubble") ? b : $(".bubble", b); go("card", {id: b.dataset.card, from: current?.id || "library"}, {morph: src ? {from: src} : null}); }
    else if (a === "back") back();
    else if (a === "home") { sheet.close(); showHome(); }
    else if (a === "done") { if (await perform("end")) { sheet.close(); showHome(); } }
    else if (a === "finish") finish();
    else if (a === "choose") answer({answer: s.question.options[Number(b.dataset.option)]});
    else if (a === "tf") answer({answer: b.dataset.value});
    else if (a === "rate") answer({answer: b.dataset.value});
    else if (a === "reveal") reveal();
    else if (a === "unknown") answer({dont_know: true});
    else if (a === "continue") continueRound();
    else if (a === "override") { if (await perform("override")) afterAnswer(); }
    else if (a === "rtile") moveTile(Number(b.dataset.tile));
    else if (a === "tutor") openTutor();
    else if (a === "tutor-chip") tutorReply(b.dataset.chip);
    else if (a === "copy-prompt") { const st = $("#copy-status"); try { await navigator.clipboard.writeText($("#prompt-text").textContent); st.textContent = "Copied."; } catch { st.textContent = "Copy is blocked here. Select the text above instead."; } }
    else if (a === "next_round" || a === "review_misses") { sheet.close(); nextRound(a); }
    else if (a === "sheet-half") sheet.open("half");
    else if (a === "sheet-full") sheet.open("full");
    else if (a === "add") go("add");
    else if (a === "lib-filter") { libFilter.kind = b.dataset.kind; go("library", {}, {quiet: true}); }
    else if (a === "star") { const c = cardOf(b.dataset.card); if (!c) return; try { await api(`/cards/${c.id}/edit`, {starred: !c.starred}); await refresh(); for (const x of $$(`[data-action=star][data-card="${c.id}"]`)) { x.setAttribute("aria-pressed", String(!c.starred)); x.textContent = !c.starred ? "★" : "☆"; } M.animate(b, {scale: 1}, {preset: "snappy", from: {scale: 1.3}}); } catch (err) { toast(err.message); } }
    else if (a === "reveal-card") { const p = $("#card-answer"); p.hidden = false; b.hidden = true; M.animate(p, {y: 0, opacity: 1}, {from: {y: 8, opacity: 0}}); }
    else if (a === "delete-card") { if (b.dataset.confirm !== "1") { b.dataset.confirm = "1"; b.textContent = "Tap again to delete this card"; return; } try { await api(`/cards/${b.dataset.card}`, null, "DELETE"); await refresh(); toast("Card deleted."); go("library"); } catch (err) { toast(err.message); } }
    else if (a === "reset") { if (b.dataset.confirm !== "1") { b.dataset.confirm = "1"; b.textContent = "Tap again to reset every card and its progress"; return; } view = await api("/reset"); queuedMode = null; rebuild = null; sheet.close(); toast("Sample cards restored."); showHome(); }
  });
  document.addEventListener("submit", async e => {
    const form = e.target; e.preventDefault();
    if (form.id === "answer-form") { clearTimeout(draftTimer); answer({answer: $("#answer").value}); }
    else if (form.id === "note-form") { try { const aliases = $("#aliases").value.split(/\r?\n/).map(x => x.trim()).filter(Boolean); await api(`/cards/${form.dataset.card}/edit`, {note: $("#note").value, mnemonic: $("#mnemonic").value, aliases, side: view.config.answer_with}); await refresh(); toast("Saved to this card."); } catch (err) { toast(err.message); } }
    else if (form.id === "add-form") { try { const r = await api("/cards", {tsv: $("#add-tsv").value, deck: $("#add-deck").value}); await refresh(); toast(`${r.added} card${r.added === 1 ? "" : "s"} added.`); go("library"); } catch (err) { toast(err.message); } }
  });
  document.addEventListener("input", e => {
    if (e.target.id !== "answer" || !inRound()) return;
    clearTimeout(draftTimer);
    const value = e.target.value;
    draftTimer = setTimeout(async () => { if (!inRound() || session().status !== "question") return; if (await perform("draft", {text: value})) { const st = $("#draft-status"); if (st) st.textContent = "Draft saved privately."; } }, 700);
  });
  document.addEventListener("change", e => { if (e.target.id?.startsWith("opt-")) optionChange(e.target); });
  document.addEventListener("focusin", e => { if (e.target.id === "answer") { sheet.suspend(); setTimeout(() => e.target.scrollIntoView({block: "center", behavior: "smooth"}), 120); } });
  document.addEventListener("focusout", e => { if (e.target.id === "answer") setTimeout(() => { if (document.activeElement?.id !== "answer") sheet.resume(); }, 80); });
  document.addEventListener("keydown", e => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.isComposing) return;
    if (e.key === "Enter" && !e.shiftKey && e.target.id === "answer") { e.preventDefault(); clearTimeout(draftTimer); answer({answer: e.target.value}); return; }
    if (e.key === "Enter" && e.target.id === "add-tsv") return;
    if (e.target.matches("input, textarea, select, [contenteditable=true]")) return;
    if (e.key === "Escape" && sheet.modal) { e.preventDefault(); sheet.close(); return; }
    if (!inRound() || sheet.modal || current?.id !== "round") return;
    const s = session(), q = s.question;
    if (e.key === "?") { e.preventDefault(); openTutor(); return; }
    if (s.status === "feedback") { if (e.key === "Enter" && (s.feedback.correct || rebuildDone())) { e.preventDefault(); continueRound(); } return; }
    if (e.key === "Enter" && q.type === "flashcard") { e.preventDefault(); if (q.revealed) answer({answer: "got_it"}); else reveal(); return; }
    const i = "1234".includes(e.key) ? "1234".indexOf(e.key) : "abcd".indexOf(e.key.toLowerCase());
    if (i < 0) return;
    if (q.type === "multiple_choice" && q.options[i] !== undefined) { e.preventDefault(); answer({answer: q.options[i]}); }
    else if (q.type === "true_false" && i < 2) { e.preventDefault(); answer({answer: i === 0 ? "true" : "false"}); }
    else if (q.type === "flashcard" && q.revealed && i < 2) { e.preventDefault(); answer({answer: i === 0 ? "again" : "got_it"}); }
  });
  document.addEventListener("visibilitychange", () => { if (document.hidden) clearTimeout(autoTimer); });
  window.addEventListener("beforeunload", e => { if ($("#answer")?.value.trim() && session()?.status === "question") { e.preventDefault(); e.returnValue = ""; } });

  /* ---- boot --------------------------------------------------------------- */
  async function init() {
    theme(document.documentElement.dataset.theme);
    M.pressable(document, ".primary, .secondary, .tile, .chip, .bubble-row .bubble, .rtile, .tab, .row-btn, .icon-btn, .text-btn, .flip");
    view = await api("/drill");
    loadPrefs();
    sheet = new window.Sheet({el: "#sheet-progress", scrim: "#scrim", main: "#app", half: .54, peek: 0, label: "Progress and options"});
    const s = session();
    if (s && ["question", "feedback"].includes(s.status)) go("round");
    else if (s && ["checkpoint", "complete"].includes(s.status)) go("checkpoint");
    else await showHome();
    $("#app").removeAttribute("aria-busy");
  }
  window.Learn = {get view() { return view; }, get engine() { return engine; }, get sheet() { return sheet; }, go, perform, api, makeRebuild};
  init().catch(e => { console.error(e); const el = $("#screen") || $("#app"); el.innerHTML = `<div class="content"><p class="empty">Learn could not open. ${esc(e.message)}</p><button type="button" class="primary" onclick="location.reload()">Try again</button></div>`; });
})();
