// Full interaction check for the Learn prototype in headless Chromium.
const {chromium} = require("playwright"); const serve = require("./serve"); const path = require("path"), fs = require("fs");
const SHOTS = process.env.SHOTS || path.join(__dirname, "..", "..", ".checks", "learn"); fs.mkdirSync(SHOTS, {recursive: true});
const fails = []; const assert = (c, m) => { if (!c) fails.push(m); };
const REDUCED = process.argv.includes("--reduced");
(async () => {
  const {server, base} = await serve();
  const browser = await chromium.launch();
  const ctx = await browser.newContext({viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true, deviceScaleFactor: 2, reducedMotion: REDUCED ? "reduce" : "no-preference"});
  const page = await ctx.newPage(); page.setDefaultTimeout(8000);
  const errors = [];
  page.on("pageerror", e => errors.push("pageerror: " + e.message));
  page.on("console", m => { if (m.type() === "error") errors.push("console: " + m.text()); });
  const shot = async name => page.screenshot({path: path.join(SHOTS, `${REDUCED ? "rm-" : ""}${name}.png`)});
  const smallTargets = async label => {
    const small = await page.evaluate(() => [...document.querySelectorAll("button:not([hidden]), [role=button], a[href]")].filter(b => { const r = b.getBoundingClientRect(); const cs = getComputedStyle(b); return r.width && r.height && cs.visibility !== "hidden" && (r.width < 44 || r.height < 44); }).map(b => (b.textContent || b.getAttribute("aria-label") || "").trim().slice(0, 30) + ` ${Math.round(b.getBoundingClientRect().width)}x${Math.round(b.getBoundingClientRect().height)}`));
    assert(!small.length, `${label}: small targets ${JSON.stringify(small)}`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1 || [...document.querySelectorAll(".screen")].some(s => s.scrollWidth > s.clientWidth + 1));
    assert(!overflow, `${label}: horizontal overflow`);
  };
  const view = () => page.evaluate(() => window.Learn.view);
  const settle = (ms = 900) => page.waitForTimeout(REDUCED ? 60 : ms);
  await page.goto(base + "/learn/", {waitUntil: "networkidle"});
  await page.evaluate(() => { localStorage.clear(); }); await page.reload({waitUntil: "networkidle"}); await settle(700);
  await smallTargets("home");
  const roundTrip = await page.evaluate(() => { const E = window.LearnEngine; const bad = []; for (const c of window.Learn.view.cards) for (const side of ["front", "back"]) { const rb = window.Learn.makeRebuild(c[side], c.id + side); const joined = rb.tiles.map(t => (t.space ? " " : "") + t.text).join("").trim(); if (!E.grade(joined, c[side], "exact") || rb.tiles.length > 8 || rb.tiles.length < 2) bad.push([c[side], joined, rb.tiles.length]); } return bad; });
  assert(!roundTrip.length, "rebuild tiles round-trip exact grading for every card: " + JSON.stringify(roundTrip.slice(0, 3)));

  // ---- Easy round with the morph, a miss, the rebuild tray, and continue flights
  const firstId = await page.evaluate(() => document.querySelector("#upnext .bubble").dataset.card);
  await page.click("[data-action=start]");
  await page.waitForTimeout(REDUCED ? 30 : 120);
  const ghost = await page.evaluate(() => document.body.lastElementChild?.classList.contains("bubble") && document.body.lastElementChild.style.position === "fixed");
  assert(REDUCED || ghost, "start: a fixed ghost bubble is in flight");
  await settle(1000);
  assert(await page.evaluate(() => document.body.dataset.screen) === "round", "round screen shown");
  assert(await page.evaluate(() => !document.querySelector("body > .bubble")), "ghost removed after landing");
  assert(await page.evaluate(() => getComputedStyle(document.querySelector(".stage-avatar")).visibility === "visible"), "stage avatar revealed");
  let v = await view();
  assert(v.session.question.card_id === firstId, "first question is the first Home bubble");
  assert(v.session.question.type === "multiple_choice" && (await page.locator(".tile").count()) === 4, "easy shows four tiles");
  assert(await page.evaluate(() => document.getElementById("sheet-progress").dataset.state === "peek"), "sheet peeks during the round: " + await page.evaluate(() => document.getElementById("sheet-progress").dataset.state));
  await shot("round-easy-question"); await smallTargets("round question");
  // wrong answer
  const answerText = await page.evaluate(() => { const v = window.Learn.view; const c = v.cards.find(c => c.id === v.session.question.card_id); return c.back; });
  const wrongIndex = await page.evaluate(a => window.Learn.view.session.question.options.findIndex(o => o !== a), answerText);
  await page.click(`.tile[data-option="${wrongIndex}"]`); await settle(700);
  v = await view();
  assert(v.session.status === "feedback" && v.session.feedback.correct === false, "wrong tile gives a miss");
  assert(await page.locator(".tile.wrong").count() === 1 && await page.locator(".tile.correct").count() === 1, "tiles marked wrong and correct");
  assert(await page.locator("#tray .rtile").count() >= 2, "rebuild tray has tiles");
  assert(await page.locator("[data-action=continue]").isDisabled(), "continue disabled until rebuilt");
  await shot("round-easy-miss"); await smallTargets("round miss");
  // rebuild in the wrong order first, then the right order
  const tileIds = await page.evaluate(() => [...document.querySelectorAll("#tray .rtile")].map(t => Number(t.dataset.tile)));
  const reversed = [...tileIds].sort((a, b) => b - a);
  for (const id of reversed) { await page.click(`.rtile[data-tile="${id}"]`); await page.waitForTimeout(REDUCED ? 20 : 80); }
  await settle(500);
  assert(await page.locator("#answer-line .rtile").count() === tileIds.length, "all tiles placed");
  if (tileIds.length > 1) {
    assert(await page.locator("[data-action=continue]").isDisabled(), "wrong order keeps continue disabled");
    assert((await page.locator("#rebuild-hint").textContent()).includes("Not quite that order"), "wrong-order hint shown live");
    v = await view(); assert(v.session.status === "feedback", "still on feedback");
  }
  // fix: move every tile back, then place in order
  for (const id of reversed) { await page.click(`#answer-line .rtile[data-tile="${id}"]`); await page.waitForTimeout(REDUCED ? 20 : 60); }
  for (const id of [...tileIds].sort((a, b) => a - b)) { await page.click(`#tray .rtile[data-tile="${id}"]`); await page.waitForTimeout(REDUCED ? 20 : 60); }
  await settle(400);
  assert(!await page.locator("[data-action=continue]").isDisabled(), "continue enabled once the rebuilt line matches");
  assert((await page.locator("#rebuild-hint").textContent()).includes("Rebuilt"), "rebuilt hint shown");
  assert(await page.evaluate(() => document.getElementById("answer-line").classList.contains("done")), "answer line marked done");
  await page.click("[data-action=continue]"); await page.waitForTimeout(REDUCED ? 30 : 100);
  assert(REDUCED || await page.evaluate(() => document.querySelectorAll("body > .bubble").length >= 1), "continue: result bubble flies to its slot");
  await settle(1000);
  v = await view();
  assert(v.session.index === 1 && v.session.status === "question", "advanced to question 2: " + v.session.index + " " + v.session.status);
  assert(await page.evaluate(() => document.querySelector(".qbubble[data-state=miss]") !== null), "queue shows the miss");
  assert(await page.evaluate(() => !document.querySelector("body > .bubble") && getComputedStyle(document.querySelector(".stage-avatar")).visibility === "visible"), "stage avatar visible after flights");
  // keyboard: answer the rest correctly with number keys
  let guard = 0;
  while ((await view()).session.status === "question" && guard++ < 10) {
    const vv = await view(); const q = vv.session.question; const card = vv.cards.find(c => c.id === q.card_id);
    if (q.type === "multiple_choice") { const i = q.options.indexOf(card.back); await page.keyboard.press(String(i + 1)); }
    else if (q.type === "true_false") await page.click(`.tile[data-value="${String(q.candidate === card.back)}"]`);
    await settle(500);
    assert((await view()).session.feedback.correct === true, "correct answer accepted (" + q.type + ")");
    await page.keyboard.press("Enter"); await settle(900);
  }
  v = await view();
  assert(v.session.status === "checkpoint", "checkpoint after the round: " + v.session.status);
  assert(await page.evaluate(() => document.body.dataset.screen) === "checkpoint", "checkpoint screen shown");
  await shot("checkpoint"); await smallTargets("checkpoint");
  assert(await page.locator("[data-action=review_misses]").first().isVisible(), "review misses offered");
  assert(await page.evaluate(() => document.getElementById("sheet-progress").dataset.state === "peek"), "sheet still peeks at checkpoint");

  // ---- sheet: open half by the handle, drag to full, flick down to peek, rubber band
  await page.click("[data-sheet-handle]"); await settle(800);
  assert(await page.evaluate(() => document.getElementById("sheet-progress").dataset.state) === "half", "sheet opens to half");
  assert(await page.evaluate(() => document.getElementById("app").inert === true), "main view inert under the sheet");
  assert(await page.evaluate(() => { const t = document.getElementById("app").style.transform; return t.includes("scale(0.9"); }), "main view scales under the sheet");
  await shot("sheet-half");
  const handle = await page.locator("[data-sheet-handle]").boundingBox();
  const drag = async (fromY, toY, steps = 12) => { const x = handle.x + handle.width / 2; await page.mouse.move(x, fromY); await page.mouse.down(); for (let i = 1; i <= steps; i++) await page.mouse.move(x, fromY + (toY - fromY) * i / steps); await page.mouse.up(); };
  await drag(handle.y + 4, handle.y - 420, 14); await settle(900);
  assert(await page.evaluate(() => document.getElementById("sheet-progress").dataset.state) === "full", "drag up reaches full");
  await shot("sheet-full");
  const full = await page.locator("[data-sheet-handle]").boundingBox();
  await drag(full.y + 4, full.y - 160, 6); await settle(900); // pull past the top: rubber band, then settle back
  assert(await page.evaluate(() => document.getElementById("sheet-progress").dataset.state) === "full", "rubber band returns to full");
  await drag(full.y + 4, full.y + 700, 4); await settle(1000);
  assert(await page.evaluate(() => document.getElementById("sheet-progress").dataset.state) === "peek", "flick down returns to peek: " + await page.evaluate(() => document.getElementById("sheet-progress").dataset.state));
  assert(await page.evaluate(() => document.getElementById("app").inert === false), "main view interactive again");
  // mode chip in the sheet at a checkpoint changes the next round live
  await page.click("[data-sheet-handle]"); await settle(700);
  await page.click("#sheet-pill .pill-option[data-value=recall]"); await settle(600);
  v = await view(); assert(v.session.config.mode === "recall", "checkpoint sheet pill applies settings live: " + v.session.config.mode);
  await page.keyboard.press("Escape"); await settle(700);
  assert(await page.evaluate(() => document.getElementById("sheet-progress").dataset.state) === "peek", "escape returns to peek");

  // ---- Recall round: flip, rate
  await page.click(".button-stack [data-action=next_round]"); await settle(900);
  v = await view(); assert(v.session.status === "question" && ["flashcard", "true_false"].includes(v.session.question.type), "recall round asks flip or true/false: " + v.session.question.type);
  guard = 0;
  while ((await view()).session.status === "question" && guard++ < 12) {
    const vv = await view(); const q = vv.session.question; const card = vv.cards.find(c => c.id === q.card_id);
    if (q.type === "flashcard") {
      await page.click("[data-action=reveal]"); await settle(600);
      assert((await page.locator("#flip-answer").textContent()) === card.back, "reveal shows the answer");
      assert(await page.locator("[data-action=rate]").count() === 2, "rating buttons appear");
      if (guard === 1) await shot("round-recall-revealed");
      await page.click("[data-action=rate][data-value=got_it]");
    } else await page.click(`.tile[data-value="${String(q.candidate === card.back)}"]`);
    await settle(500); await page.click("[data-action=continue]"); await settle(900);
  }
  v = await view(); assert(["checkpoint", "complete"].includes(v.session.status), "recall round reaches a checkpoint: " + v.session.status);
  assert(v.session.counts.MASTERED === 0, "recall never masters");

  // ---- Hard test: typed answer, a miss with override, Ask why marks assisted, keyboard suspends the sheet
  if (v.session.status === "checkpoint") { await page.click("#cp-pill .pill-option[data-value=hard]"); await settle(500); await page.click(".button-stack [data-action=next_round]"); }
  else { await page.click("[data-action=done]"); await settle(800); await page.click("#home-pill .pill-option[data-value=hard]"); await page.click("[data-action=start]"); }
  await settle(900);
  v = await view(); assert(v.session.question.type === "written", "hard test asks a typed answer: " + v.session.question.type);
  await page.focus("#answer"); await settle(400);
  assert(await page.evaluate(() => document.getElementById("sheet-progress").dataset.state) !== "peek", "sheet drops away while typing: " + await page.evaluate(() => document.getElementById("sheet-progress").dataset.state));
  await page.fill("#answer", "definitely not it"); await page.keyboard.press("Enter"); await settle(600);
  v = await view(); assert(v.session.status === "feedback" && !v.session.feedback.correct, "typed miss");
  await shot("round-hard-miss");
  assert(await page.locator("[data-action=override]").isVisible(), "override offered on a typed miss");
  await page.click("[data-action=override]"); await settle(500);
  v = await view(); assert(v.session.feedback.correct === true && v.session.feedback.override === true, "override marks correct");
  assert(["FAMILIAR", "MASTERED"].includes(v.session.feedback.mastery), "override credits mastery: " + v.session.feedback.mastery);
  await page.click("[data-action=continue]"); await settle(900);
  // tutor from a question
  await page.click(".q-actions [data-action=tutor]"); await settle(900);
  assert(await page.evaluate(() => document.body.dataset.screen) === "tutor", "tutor screen opens");
  v = await view(); assert(v.session.question.assisted === true, "asking marks the question assisted");
  await page.click("[data-chip='Explain this']"); await settle(500);
  assert((await page.locator(".turn.tutor").count()) === 1, "preview reply rendered");
  await shot("tutor"); await smallTargets("tutor");
  await page.click("[data-action=back]"); await settle(900);
  assert(await page.evaluate(() => document.body.dataset.screen) === "round", "back to the round");
  const card = v.cards.find(c => c.id === v.session.question.card_id);
  await page.fill("#answer", card.back); await page.click("#answer-form .primary"); await settle(600);
  v = await view(); assert(v.session.feedback.correct && v.session.feedback.credited === false, "assisted answer earns no credit");
  await page.click("[data-action=finish]"); await settle(900);
  v = await view(); assert(v.session.status === "ended", "finish ends the session");
  assert(await page.evaluate(() => document.body.dataset.screen) === "checkpoint", "ended summary shown");
  await shot("ended");
  await page.click("[data-action=home]"); await settle(900);
  assert(await page.evaluate(() => document.body.dataset.screen) === "home", "back home");
  v = await view(); assert(v.daily > 0, "practiced today counts");

  // ---- interruption: start then finish immediately during the morph
  await page.click("#home-pill .pill-option[data-value=easy]"); await settle(300);
  await page.click("[data-action=start]"); await page.waitForTimeout(REDUCED ? 10 : 90);
  await page.click("[data-action=finish]"); await settle(1100);
  assert(await page.evaluate(() => !document.querySelector("body > .bubble")), "no ghost left after interrupting the morph");
  assert(await page.evaluate(() => document.body.dataset.screen) === "checkpoint", "interrupted start ends cleanly");
  await page.click("[data-action=home]"); await settle(800);

  // ---- library, card detail morph, star, add cards, search
  await page.click("#tabbar [data-tab=library]"); await settle(800);
  assert(await page.evaluate(() => document.body.dataset.screen) === "library", "library tab");
  await smallTargets("library"); await shot("library");
  await page.fill("#lib-search", "recall"); await settle(300);
  assert((await page.locator(".lib-row").count()) === 1, "search filters rows");
  await page.click(".lib-list .star"); await settle(300);
  assert(await page.evaluate(() => document.querySelector(".lib-list .star").getAttribute("aria-pressed") === "true"), "star toggles");
  await page.click(".lib-row"); await settle(1000);
  assert(await page.evaluate(() => document.body.dataset.screen === "card" && !document.querySelector("body > .bubble")), "card detail with morph landed");
  await page.click("[data-action=reveal-card]"); await settle(300);
  assert(await page.locator("#card-answer").isVisible(), "card answer revealed");
  await page.fill("#mnemonic", "Recall = how many of the real ones you caught"); await page.click("#note-form .secondary"); await settle(300);
  v = await view(); assert(v.cards.find(c => c.front === "Recall").mnemonic.startsWith("Recall ="), "mnemonic saved");
  await shot("card-detail");
  await page.click("[data-action=back]"); await settle(800);
  await page.click("[data-action=add]"); await settle(600);
  await page.fill("#add-tsv", "Overfitting\tFitting noise in the training data so new examples are predicted worse.");
  await page.click("#add-form .primary"); await settle(800);
  v = await view(); assert(v.total === 25, "card added: " + v.total);

  // ---- paper theme, options sheet from home, reset
  await page.click("#tabbar [data-tab=home]"); await settle(800);
  await page.click("[data-action=theme]"); await settle(300);
  assert(await page.evaluate(() => document.documentElement.dataset.theme === "paper" && localStorage.getItem("milk-theme") === "paper"), "paper theme persists");
  await shot("home-paper"); await smallTargets("home paper");
  await page.click("[data-action=sheet-full]"); await settle(800);
  assert(await page.evaluate(() => document.getElementById("sheet-progress").dataset.state) === "full", "options sheet opens full from home");
  await shot("options-paper");
  await page.selectOption("#opt-scope", "all"); await settle(400);
  await page.click("#scrim", {position: {x: 20, y: 20}}); await settle(800);
  assert(await page.evaluate(() => document.getElementById("sheet-progress").hidden === true), "sheet hidden after closing on home");
  const count = await page.locator(".count-line").textContent();
  assert(count.includes("7 cards"), "scope change replans the round: " + count);
  // contrast sanity on paper: pill option text on the thumb and on the track
  const contrast = await page.evaluate(() => {
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = 1; const ctx = canvas.getContext("2d");
    const rgb = c => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = c; ctx.fillRect(0, 0, 1, 1); return [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3).map(v => v / 255); };
    const lum = c => rgb(c).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((a, x, i) => a + x * [.2126, .7152, .0722][i], 0);
    const ratio = (a, b) => (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
    const bg = lum(getComputedStyle(document.body).backgroundColor);
    return [".caption", ".legend", ".eyebrow", ".count-line", ".pill-option:not([aria-checked=true])"].map(sel => { const el = document.querySelector(sel); const surf = el.closest(".card, .pill") ? lum(getComputedStyle(el.closest(".card, .pill")).backgroundColor) : bg; return [sel, Math.round(ratio(lum(getComputedStyle(el).color), surf) * 100) / 100]; });
  });
  for (const [sel, r] of contrast) assert(r >= 4.5, `paper contrast ${sel} = ${r}`);
  await page.click("[data-action=theme]"); await settle(200);

  // ---- desktop layout
  await page.setViewportSize({width: 1440, height: 900}); await settle(500);
  await shot("home-1440");
  assert(await page.evaluate(() => { const tb = document.getElementById("tabbar").getBoundingClientRect(); return tb.width < 100 && tb.height > 500; }), "tab bar becomes a left rail at 1440");
  await smallTargets("home 1440");

  console.log("errors:", errors);
  console.log(fails.length ? "FLOW FAILURES:\n- " + fails.join("\n- ") : "flow check passed" + (REDUCED ? " (reduced motion)" : ""));
  await browser.close(); server.close();
  if (fails.length || errors.length) process.exit(1);
})().catch(e => { console.error("CRASH", e.message.split("\n").slice(0, 4).join(" / "), e.stack.split("\n").find(l => l.includes("flow.js"))); console.log("fails so far:", fails); process.exit(1); });
