// Browser integration with a mock Learn API, never the private application.
// The mock ledger is a separate Node VM; no browser Engine owns its state.
const assert = require("assert/strict");
const fs = require("fs"), path = require("path"), vm = require("vm");
const {chromium} = require("playwright");
const serve = require("./serve");

const LEARN = path.join(__dirname, "..");
const DEMO_STATE = "milkplexity-learn-prototype-v1";
const DEMO_PREFS = "milkplexity-learn-prefs-v1";
const BACKEND_PREFS = "milkplexity-learn-backend-prefs-v1";
const demoState = JSON.stringify({backendMustLeaveThisAlone: true});
const demoPrefs = JSON.stringify({mode: "hard", deck: "numbers", scope: "all", haptics: true});
const storage = {};
const mock = {window: {}, crypto: require("crypto"), console,
  localStorage: {getItem: key => storage[key] ?? null, setItem: (key, value) => { storage[key] = value; }}};
mock.window.crypto = mock.crypto;
vm.createContext(mock);
for (const file of ["decks.js", "engine.js"]) vm.runInContext(fs.readFileSync(path.join(LEARN, file), "utf8"), mock, {filename: file});
const {Engine, MODES} = mock.window.LearnEngine;
const ledger = new Engine(mock.window.LearnDecks);
// Eight cards provide both a second round and distinct multiple-choice answers.
ledger.s.cards = ledger.s.cards.slice(0, 8);
ledger.s.drill_config = {...ledger.s.drill_config, shuffle: false, scope: "all", round_size: 4};
const requests = [], errors = [], routeErrors = [], rejectedMutations = [];
let omitCardMetadata = false, omitCardBack = false, omitNoteExtras = false, omitCurrentSideAliases = false, truncateNextAnswer = false;
let delayNextDraft = 0, delayNextCreation = false;
let failNextRead = false, readFailures = 0;

function engineConfig(config) {
  const out = {...config};
  if (config.goal !== undefined || config.types !== undefined) {
    const mode = Object.keys(MODES).find(name => config.goal === MODES[name].goal &&
      Array.isArray(config.types) && config.types.length === MODES[name].types.length &&
      MODES[name].types.every(type => config.types.includes(type)));
    assert.ok(mode, "the request goal/types must describe one documented UI preset");
    out.mode = mode;
  }
  delete out.goal; delete out.types;
  return out;
}
function wireConfig(config) {
  const out = {...config, goal: MODES[config.mode].goal, types: [...MODES[config.mode].types]};
  delete out.mode; delete out.haptics; delete out.deck;
  return out;
}
function wireView(view) {
  const out = JSON.parse(JSON.stringify(view));
  out.config = wireConfig(out.config);
  delete out.decks; delete out.modes;
  for (const card of out.cards) {
    delete card.deck;
    // Explicit empty arrays advertise support for editing either answer side.
    card.aliases = {front: [], back: [], ...card.aliases};
    if (omitCurrentSideAliases) delete card.aliases[out.config.answer_with];
    if (omitCardMetadata) { delete card.mastery; delete card.due; }
    if (omitCardBack) delete card.back;
    if (omitNoteExtras) { delete card.mnemonic; delete card.aliases; }
  }
  if (out.session) {
    out.session.config = wireConfig(out.session.config);
    delete out.session.deck; delete out.session.counts_start;
    if (out.session.feedback) delete out.session.feedback.before_mastery;
  }
  return out;
}
function serverAction(action, extra = {}) {
  const s = ledger.get().session;
  return ledger.action({session_id: s.id, revision: s.revision, question_id: s.question?.id,
    request_id: "external-" + require("crypto").randomUUID(), action, ...extra});
}

(async () => {
  let server, browser;
  try {
    const hosted = await serve(); server = hosted.server;
    browser = await chromium.launch(process.env.CHROMIUM ? {executablePath: process.env.CHROMIUM} : {});
    const context = await browser.newContext({viewport: {width: 390, height: 844}, isMobile: true,
      hasTouch: true, reducedMotion: "no-preference"});
    await context.addInitScript(({stateKey, prefsKey, state, prefs}) => {
      if (localStorage.getItem(stateKey) === null) localStorage.setItem(stateKey, state);
      if (localStorage.getItem(prefsKey) === null) localStorage.setItem(prefsKey, prefs);
      window.__demoEngineConstructions = 0;
      let exports;
      Object.defineProperty(window, "LearnEngine", {configurable: true, get: () => exports, set(value) {
        const Original = value.Engine;
        exports = {...value, Engine: class extends Original {
          constructor(...args) { window.__demoEngineConstructions += 1; super(...args); }
        }};
      }});
    }, {stateKey: DEMO_STATE, prefsKey: DEMO_PREFS, state: demoState, prefs: demoPrefs});
    await context.route(/fonts\.(googleapis|gstatic)\.com/, route => route.abort());
    await context.route("**/api/learn/**", async route => {
      const request = route.request();
      const endpoint = new URL(request.url()).pathname.slice("/api/learn".length);
      let body;
      try {
        body = request.postData() ? JSON.parse(request.postData()) : null;
        requests.push({endpoint, method: request.method(), body});
        const expected = endpoint === "/drill" ? "GET" : /^\/cards\/[^/]+$/.test(endpoint) ? "DELETE" : "POST";
        assert.equal(request.method(), expected, `${endpoint}: HTTP method`);
        if (endpoint === "/drill" && failNextRead) {
          failNextRead = false; readFailures += 1;
          await route.fulfill({status: 503, contentType: "application/json", body: JSON.stringify({error: "Mock read temporarily unavailable"})});
          return;
        }
        if (body?.config) {
          assert.ok(!("mode" in body.config), "UI mode must not leak into a backend request");
          assert.ok(!("deck" in body.config), "set selection must not be invented for the backend");
          assert.ok(!("side" in body.config), "UI side preference must not leak into a backend config");
          body = {...body, config: engineConfig(body.config)};
        }
        if (endpoint === "/cards") assert.ok(!("deck" in body), "card creation omits unsupported sets");
        if (endpoint === "/drill/action" && body.action === "draft" && delayNextDraft) {
          const delay = delayNextDraft; delayNextDraft = 0;
          await new Promise(resolve => setTimeout(resolve, delay));
        }
        if (endpoint === "/cards" && delayNextCreation) {
          const delay = typeof delayNextCreation === "number" ? delayNextCreation : 400;
          delayNextCreation = false;
          await new Promise(resolve => setTimeout(resolve, delay));
        }
        // /drill/plan is deliberately unavailable; backend mode must use counts.
        if (endpoint === "/drill/plan") {
          await route.fulfill({status: 404, contentType: "application/json", body: JSON.stringify({error: "No plan endpoint"})});
          return;
        }
        let result;
        try { result = await ledger.api(endpoint, body, request.method()); }
        catch (error) {
          rejectedMutations.push({endpoint, body, message: error.message});
          await route.fulfill({status: 409, contentType: "application/json", body: JSON.stringify({error: error.message})});
          return;
        }
        if (["/drill", "/drill/start", "/drill/action"].includes(endpoint)) result = wireView(result);
        if (endpoint === "/drill/action" && body.action === "answer" && truncateNextAnswer) {
          truncateNextAnswer = false;
          // The mutation committed, but its reply was truncated in transit.
          await route.fulfill({status: 200, contentType: "application/json", body: '{"lost_reply":'});
        } else await route.fulfill({status: 200, contentType: "application/json", body: JSON.stringify(result)});
      } catch (error) {
        routeErrors.push(error.stack || error.message);
        await route.fulfill({status: 500, contentType: "application/json", body: JSON.stringify({error: "Mock contract failure"})});
      }
    });
    const page = await context.newPage(); page.setDefaultTimeout(8000);
    page.on("pageerror", error => errors.push("pageerror: " + error.message));
    page.on("console", message => {
      const url = message.location()?.url || "";
      const expectedConflict = /api\/learn\/drill\/action/.test(url) && /409/.test(message.text());
      const expectedReadFailure = /api\/learn\/drill$/.test(url) && /503/.test(message.text()) && readFailures === 1;
      if (message.type() === "error" && !/fonts\.(googleapis|gstatic)/.test(message.location()?.url || "") &&
          !expectedConflict && !expectedReadFailure) errors.push("console: " + message.text());
    });
    const view = () => page.evaluate(() => window.Learn.view);
    const settle = screen => page.waitForFunction(screen => (!screen || document.body.dataset.screen === screen) &&
      document.querySelectorAll("#app > .screen:not([data-screen=loading])").length === 1 && !document.querySelector("body > .bubble"), screen);
    const state = status => page.waitForFunction(status => window.Learn.view.session?.status === status, status);
    const countRequests = (endpoint, action) => requests.filter(r => r.endpoint === endpoint && (!action || r.body?.action === action)).length;
    const correctAnswer = async () => {
      const v = await view(), q = v.session.question, card = ledger.get().cards.find(c => c.id === q.card_id);
      if (q.type === "multiple_choice") await page.click(`.tile[data-option="${q.options.indexOf(card.back)}"]`);
      else if (q.type === "true_false") await page.click(`.tile[data-value="${String(q.candidate === card.back)}"]`);
      else if (q.type === "flashcard") {
        await page.click("[data-action=reveal]");
        await page.waitForFunction(() => window.Learn.view.session.question.revealed);
        assert.equal(await page.locator("#flip-answer").textContent(), card.back, "Recall shows the server's revealed answer");
        await page.click("[data-action=rate][data-value=got_it]");
      } else {
        await page.fill("#answer", card.back); await page.click("#answer-form .primary");
      }
      await state("feedback");
      assert.equal((await view()).session.feedback.correct, true, "server accepted the correct answer");
    };
    const continueCorrect = async () => {
      const revision = (await view()).session.revision;
      await page.click("[data-action=continue]");
      await page.waitForFunction(revision => window.Learn.view.session.revision > revision, revision);
      await settle();
    };
    const finishRound = async () => {
      let guard = 0;
      while ((await view()).session.status === "question" && guard++ < 12) { await correctAnswer(); await continueCorrect(); }
      assert.ok(["checkpoint", "complete"].includes((await view()).session.status), "round reaches a saved checkpoint");
    };

    await page.goto(hosted.base + "/learn/?api=backend", {waitUntil: "load"});
    await page.waitForFunction(() => window.Learn?.view && !document.querySelector("#app[aria-busy=true]"));
    await settle();
    assert.equal((await view()).config.mode, "easy", "goal/types normalize to Easy without a server mode field");
    assert.equal(await page.evaluate(() => window.Learn.engine), null, "browser has no demo Engine instance");
    assert.equal(await page.evaluate(() => window.__demoEngineConstructions), 0, "backend startup never constructs the local Engine");
    assert.equal(await page.evaluate(key => localStorage.getItem(key), DEMO_STATE), demoState, "backend startup leaves local demo progress untouched");
    assert.equal(await page.evaluate(key => localStorage.getItem(key), DEMO_PREFS), demoPrefs, "backend ignores the demo's Hard preference");
    assert.equal(await page.evaluate(() => window.Motion.settings.haptics), false, "omitted haptics default to off");
    assert.equal(countRequests("/drill/plan"), 0, "default backend mode does not assume a plan endpoint");
    assert.equal(await page.locator("#upnext").count(), 0, "no fabricated round preview without a plan");
    assert.match(await page.locator(".count-line").textContent(), /8 cards/, "no-plan Home displays authoritative availability counts");
    assert.equal(await page.locator("[data-action=start]").isDisabled(), false, "counts enable start without a plan");
    assert.equal(await page.locator("[data-action=deck]").count(), 0, "unsupported sets are hidden");
    assert.equal(await page.locator("[data-action=reset]").count(), 0, "sample reset is hidden");
    assert.equal(await page.locator("#tabbar [data-tab=tutor]").isVisible(), false, "tutor preview is hidden in backend mode");
    assert.equal(await page.locator("#opt-haptics").isChecked(), false, "Touch feedback reflects the safe backend default");

    // The start button provides the shared-element source when no preview exists.
    await page.click("[data-action=start]");
    await page.waitForFunction(() => document.querySelector("body > .bubble")?.style.position === "fixed");
    await settle(); await state("question");
    assert.equal(await page.evaluate(() => document.body.dataset.screen), "round", "button morph lands in the round");
    assert.equal((await view()).session.question.type, "multiple_choice", "Easy still uses four choices");
    assert.equal(await page.locator(".tile").count(), 4, "four Easy choices rendered");
    assert.equal(await page.locator("[data-action=tutor]").first().isVisible(), false, "question tutor actions are hidden");

    const q = (await view()).session.question;
    const answer = ledger.get().cards.find(card => card.id === q.card_id).back;
    await page.click(`.tile[data-option="${q.options.findIndex(option => option !== answer)}"]`);
    await state("feedback");
    assert.equal((await view()).session.feedback.correct, false, "Easy miss is graded by the mock ledger");
    assert.equal(await page.locator("[data-action=continue]").isDisabled(), true, "a miss requires rebuilding the answer");
    const ids = await page.locator("#tray .rtile").evaluateAll(tiles => tiles.map(tile => Number(tile.dataset.tile)).sort((a, b) => a - b));
    assert.ok(ids.length >= 2, "miss creates a rebuild tray");
    for (const id of ids) await page.click(`#tray .rtile[data-tile="${id}"]`);
    assert.equal(await page.locator("[data-action=continue]").isDisabled(), false, "matching rebuild enables Continue");
    await continueCorrect();
    assert.equal((await view()).session.index, 1, "Continue advances the server session");
    const continued = requests.filter(r => r.body?.action === "continue").at(-1);
    assert.equal(continued.body.correction, answer, "exact reconstruction reaches the correction endpoint");

    const saved = (await view()).session;
    await page.reload({waitUntil: "load"}); await state("question"); await settle();
    assert.equal((await view()).session.id, saved.id, "reload resumes the authoritative server session");
    assert.equal((await view()).session.index, saved.index, "reload preserves its position without local progress");
    assert.equal(countRequests("/drill/start"), 1, "resume does not create a second server session");
    await finishRound();
    assert.equal(await page.locator(".since").count(), 0, "missing counts_start hides the session comparison");

    await page.click("#cp-pill .pill-option[data-value=recall]");
    await page.waitForFunction(() => window.Learn.view.session.config.mode === "recall");
    await page.click(".button-stack [data-action=next_round]"); await state("question"); await settle();
    if ((await view()).session.question.type === "true_false") { await correctAnswer(); await continueCorrect(); }
    assert.equal((await view()).session.question.type, "flashcard", "Recall includes reveal/rate after reviewing the Easy miss");
    await correctAnswer();
    assert.ok(["SEEN", "FAMILIAR"].includes((await view()).session.feedback.mastery), "Recall never grants Mastered");
    await continueCorrect(); await finishRound();
    assert.equal((await view()).session.counts.MASTERED, 0, "Easy and Recall retain the non-mastery rule");

    // Recall may complete its understanding goal; select Hard from a new Home.
    if ((await view()).session.status === "complete") {
      await page.click("[data-action=done]"); await settle();
      await page.click("#home-pill .pill-option[data-value=hard]"); await page.click("[data-action=start]");
    } else {
      await page.click("#cp-pill .pill-option[data-value=hard]");
      await page.waitForFunction(() => window.Learn.view.session.config.mode === "hard");
      await page.click(".button-stack [data-action=next_round]");
    }
    await state("question"); await settle();
    assert.equal((await view()).session.question.type, "written", "Hard asks a typed answer");
    await correctAnswer();
    assert.equal((await view()).session.feedback.mastery, ledger.get().session.feedback.mastery, "Hard mastery comes from the ledger");
    assert.equal(await page.locator(".mastery-note").textContent(), (await view()).session.feedback.mastery === "MASTERED" ? "Mastered" : "Familiar", "missing before_mastery does not invent a before/after comparison");
    await continueCorrect();
    await page.fill("#answer", "a deliberate miss"); await page.click("#answer-form .primary"); await state("feedback");
    await page.click("[data-action=override]");
    await page.waitForFunction(() => window.Learn.view.session.feedback?.override === true);
    assert.equal((await view()).session.feedback.correct, true, "typed override is acknowledged by the ledger");
    assert.equal((await view()).session.feedback.mastery, ledger.get().session.feedback.mastery, "override uses authoritative mastery");
    await continueCorrect();

    // B and C timers fire while A is pending. Only the latest C may save after
    // A; an obsolete waiting timer must not overwrite or drop that latest text.
    const draftAnswer = ledger.get().cards.find(card => card.id === (ledger.get().session.question.card_id)).back;
    const draftsBeforeQueue = countRequests("/drill/action", "draft");
    delayNextDraft = 2000;
    const firstDraftRequest = page.waitForRequest(request => request.url().endsWith("/api/learn/drill/action") &&
      request.postDataJSON()?.action === "draft" && request.postDataJSON()?.text === "Earlier draft A");
    await page.fill("#answer", "Earlier draft A"); await firstDraftRequest;
    const latestDraftRequest = page.waitForRequest(request => request.url().endsWith("/api/learn/drill/action") &&
      request.postDataJSON()?.action === "draft" && request.postDataJSON()?.text === draftAnswer);
    await page.fill("#answer", "Intermediate draft B"); await page.waitForTimeout(750);
    await page.fill("#answer", draftAnswer); await latestDraftRequest;
    await page.waitForFunction(text => window.Learn.view.session.question?.draft === text, draftAnswer);
    assert.equal(countRequests("/drill/action", "draft"), draftsBeforeQueue + 2, "obsolete B timer is discarded; only A and latest C reach the API");
    assert.equal(ledger.get().session.question.draft, draftAnswer, "latest C saves after a slower earlier draft");
    await page.reload({waitUntil: "load"}); await state("question"); await settle();
    assert.equal(await page.locator("#answer").inputValue(), draftAnswer, "reload restores latest C from the authoritative API");

    // Check during another in-flight draft waits for its saved revision, then submits.
    delayNextDraft = 400;
    const draftRequest = page.waitForRequest(request => request.url().endsWith("/api/learn/drill/action") && request.postDataJSON()?.action === "draft");
    await page.fill("#answer", "Transient text before Check");
    await page.fill("#answer", draftAnswer); await draftRequest;
    const answersBeforeDraft = countRequests("/drill/action", "answer");
    await page.click("#answer-form .primary"); await state("feedback");
    assert.equal((await view()).session.feedback.correct, true, "Check during a slow draft submits the typed answer");
    assert.equal(countRequests("/drill/action", "answer"), answersBeforeDraft + 1, "slow draft never loses or duplicates Check");
    assert.equal((await view()).session.revision, ledger.get().session.revision, "Check follows the authoritative draft revision");
    await continueCorrect();

    // A concurrent write rejects the stale answer; recovery reads, never replays.
    serverAction("draft", {text: "Saved on another page"});
    let answers = countRequests("/drill/action", "answer"), reads = countRequests("/drill");
    await page.fill("#answer", "answer from a stale page"); await page.click("#answer-form .primary");
    await page.waitForFunction(revision => window.Learn.view.session.revision === revision, ledger.get().session.revision);
    await settle();
    assert.equal((await view()).session.status, "question", "409 refresh keeps the current server question");
    assert.equal(countRequests("/drill/action", "answer"), answers + 1, "a stale mutation is sent exactly once");
    assert.equal(countRequests("/drill"), reads + 1, "409 triggers one authoritative refresh");
    assert.equal(await page.locator("#answer").inputValue(), "Saved on another page", "refresh renders the concurrent draft");

    answers = countRequests("/drill/action", "answer"); reads = countRequests("/drill");
    const attempts = ledger.get().session.attempts;
    truncateNextAnswer = true;
    await correctAnswer(); await settle();
    assert.equal(countRequests("/drill/action", "answer"), answers + 1, "a lost mutation reply is not replayed");
    assert.equal(countRequests("/drill"), reads + 1, "ambiguous committed reply triggers an authoritative refresh");
    assert.equal(ledger.get().session.attempts, attempts + 1, "lost reply credits the attempt once");
    assert.equal((await view()).session.revision, ledger.get().session.revision, "recovery renders the committed revision");
    await page.click("[data-action=finish]"); await state("ended"); await settle();
    await page.click("[data-action=home]"); await settle("home");

    // Card operations retain the documented POST /edit and DELETE routes.
    await page.click("#tabbar [data-tab=library]"); await settle();
    await page.click("[data-action=add]"); await settle();
    assert.equal(await page.locator("#add-deck").count(), 0, "creation offers no unsupported card set");
    await page.fill("#add-tsv", "Backend fixture\tAn answer saved only in the mock ledger.");
    const creations = countRequests("/cards"); delayNextCreation = 1800;
    const creationRequest = page.waitForRequest(request => request.url().endsWith("/api/learn/cards"));
    await page.locator("#add-form").evaluate(form => { form.requestSubmit(); form.requestSubmit(); });
    await creationRequest;
    await page.click("[data-action=back]"); await settle("library");
    await page.click("[data-action=add]"); await settle("add");
    assert.equal(await page.locator("#add-form .primary").isDisabled(), true, "recreated Add form remains locked while creation is pending");
    await page.fill("#add-tsv", "Backend fixture\tAn answer saved only in the mock ledger.");
    await page.locator("#add-form").evaluate(form => form.requestSubmit());
    assert.equal(countRequests("/cards"), creations + 1, "navigation cannot send a second pending creation");
    await page.waitForFunction(() => window.Learn.view.total === 9);
    await page.waitForFunction(() => !document.querySelector("#add-form .primary")?.disabled); await settle("add");
    assert.equal(await page.locator("#add-tsv").inputValue(), "Backend fixture\tAn answer saved only in the mock ledger.", "an older creation does not redirect or replace a new form");
    await page.click("[data-action=back]"); await settle("library");
    assert.equal(countRequests("/cards"), creations + 1, "rapid double-submit creates only one card while a request is pending");
    const newCard = (await view()).cards.find(card => card.front === "Backend fixture");
    assert.ok(newCard, "card creation refreshes the library from the server");
    await page.click(`.lib-row[data-card="${newCard.id}"]`); await settle();
    await page.fill("#note", "A saved mock note"); await page.fill("#mnemonic", "Mock mnemonic");
    await page.fill("#aliases", "Accepted mock answer"); await page.click("#note-form .secondary");
    await page.waitForFunction(id => window.Learn.view.cards.find(card => card.id === id)?.note === "A saved mock note", newCard.id);
    const edit = requests.filter(r => r.endpoint === `/cards/${newCard.id}/edit`).at(-1);
    assert.equal(edit.method, "POST", "card edit uses POST");
    assert.equal(edit.body.side, "back", "accepted answers retain the explicit answer side");
    await page.click("[data-action=delete-card]"); await page.click("[data-action=delete-card]");
    await page.waitForFunction(() => window.Learn.view.total === 8); await settle();
    assert.ok(requests.some(r => r.endpoint === `/cards/${newCard.id}` && r.method === "DELETE"), "card delete uses DELETE");

    // Acknowledged creation plus a failed refresh must not invite a duplicate.
    await page.click("[data-action=add]"); await settle("add");
    await page.fill("#add-tsv", "Saved before refresh failure\tA committed card with a lost read.");
    const creationsBeforeFailedRead = countRequests("/cards"); failNextRead = true;
    await page.locator("#add-form").evaluate(form => form.requestSubmit());
    await page.waitForFunction(() => document.querySelector("#add-form button[type=submit]")?.textContent.startsWith("Reload"));
    assert.equal(await page.locator("#add-form .primary").isDisabled(), true, "a committed create blocks retry when refresh fails");
    assert.match(await page.locator("#toast").textContent(), /1 card added.*Reload/, "failed refresh reports the acknowledged save");
    await page.locator("#add-form").evaluate(form => form.requestSubmit());
    assert.equal(countRequests("/cards"), creationsBeforeFailedRead + 1, "retrying the blocked form never sends a second creation");
    await page.click("[data-action=back]"); await settle("library");
    await page.click("[data-action=add]"); await settle("add");
    assert.equal(await page.locator("#add-form .primary").isDisabled(), true, "creation retry remains locked after Back and Add when refresh failed");
    await page.fill("#add-tsv", "Saved before refresh failure\tA committed card with a lost read.");
    await page.locator("#add-form").evaluate(form => form.requestSubmit());
    assert.equal(countRequests("/cards"), creationsBeforeFailedRead + 1, "a recreated Add form cannot duplicate an acknowledged creation");
    await page.reload({waitUntil: "load"}); await settle("home");
    assert.equal((await view()).cards.filter(card => card.front === "Saved before refresh failure").length, 1, "reload finds the committed card exactly once");

    // Omitted current-side aliases are unknown, even if the other side is given.
    const aliasCard = ledger.s.cards[0];
    aliasCard.aliases = {back: ["Private current-side alias"], front: ["Visible opposite-side alias"]};
    omitCurrentSideAliases = true;
    await page.reload({waitUntil: "load"}); await settle("home");
    await page.click("#tabbar [data-tab=library]"); await settle("library");
    await page.click(`.lib-row[data-card="${aliasCard.id}"]`); await settle("card");
    assert.equal(await page.locator("#aliases").count(), 0, "an omitted alias side is not offered as a blank editor");
    await page.fill("#note", "Preserve aliases on both answer sides"); await page.click("#note-form .secondary");
    await page.waitForFunction(id => window.Learn.view.cards.find(card => card.id === id)?.note === "Preserve aliases on both answer sides", aliasCard.id);
    const aliasEdit = requests.filter(r => r.endpoint === `/cards/${aliasCard.id}/edit`).at(-1);
    assert.ok(!("aliases" in aliasEdit.body) && !("side" in aliasEdit.body), "saving a note does not submit unknown current-side aliases");
    assert.deepEqual(JSON.parse(JSON.stringify(ledger.s.cards.find(card => card.id === aliasCard.id).aliases)), {back: ["Private current-side alias"], front: ["Visible opposite-side alias"]}, "the private aliases are preserved");
    omitCurrentSideAliases = false;

    // Due times are instants; timezone-offset strings cannot be compared lexically.
    const offsetCard = ledger.s.cards[0];
    offsetCard.learning.back.mastery = "FAMILIAR";
    offsetCard.due = new Date(Date.now() + 30 * 60 * 1000 - 12 * 60 * 60 * 1000).toISOString().replace("Z", "-12:00");
    assert.ok(Date.parse(offsetCard.due) > Date.now(), "offset fixture is in the future");
    assert.ok(offsetCard.due < new Date().toISOString(), "lexical date comparison would misclassify this fixture");
    await page.reload({waitUntil: "load"}); await settle("home");
    await page.click("#tabbar [data-tab=library]"); await settle("library");
    await page.click("[data-action=lib-filter][data-kind=due]"); await settle("library");
    assert.equal(await page.locator(`.lib-row[data-card="${offsetCard.id}"]`).count(), 0, "future offset timestamp is excluded from Due");

    // Optional per-card metadata controls claims and filters, never fake defaults.
    omitCardMetadata = true; omitNoteExtras = true;
    await page.reload({waitUntil: "load"}); await settle();
    await page.click("#tabbar [data-tab=library]"); await settle();
    assert.equal(await page.locator("[data-kind=due]").count(), 0, "missing due/mastery hides Due filter");
    assert.equal(await page.locator("[data-kind=mastered]").count(), 0, "missing mastery hides Mastered filter");
    assert.equal(await page.locator(".lib-row .state").first().textContent(), "", "missing mastery renders no invented card state");
    await page.locator(".lib-row").first().click(); await settle();
    assert.equal(await page.getByText("Mastered only through the Hard test.", {exact: true}).count(), 0, "card detail hides mastery claims when metadata is absent");
    assert.equal(await page.getByText("Unavailable", {exact: true}).count(), 0, "card detail hides the unavailable mastery block");
    assert.equal(await page.locator("#aliases").count(), 0, "missing aliases are not offered as an empty editor");
    assert.equal(await page.locator("#mnemonic").count(), 0, "missing mnemonic is not offered as an empty editor");
    const metadataCard = (await view()).cards[0];
    await page.fill("#note", "Only this supported field changes"); await page.click("#note-form .secondary");
    await page.waitForFunction(id => window.Learn.view.cards.find(card => card.id === id)?.note === "Only this supported field changes", metadataCard.id);
    const supportedEdit = requests.filter(r => r.endpoint === `/cards/${metadataCard.id}/edit`).at(-1);
    assert.deepEqual(Object.keys(supportedEdit.body), ["note"], "editing a note never clears omitted backend aliases or mnemonic");
    omitCardBack = true;
    await page.reload({waitUntil: "load"}); await settle();
    assert.equal(await page.locator("#tabbar [data-tab=library]").isVisible(), false, "missing card backs disable the full library");
    assert.equal(await page.locator("#sheet-progress [data-action=tab][data-tab=library]").count(), 0, "options hide the unavailable library entry");
    assert.equal(await page.evaluate(key => localStorage.getItem(key), DEMO_STATE), demoState, "all backend study and CRUD leave demo progress untouched");
    assert.equal(await page.evaluate(key => localStorage.getItem(key), DEMO_PREFS), demoPrefs, "backend preferences never overwrite demo preferences");
    assert.equal(await page.evaluate(key => JSON.parse(localStorage.getItem(key)).mode, BACKEND_PREFS), "hard", "backend mode preferences persist in their own key");
    assert.equal(await page.evaluate(() => window.__demoEngineConstructions), 0, "backend reload still never constructs a demo Engine");
    assert.equal(rejectedMutations.length, 1, "the deliberate stale answer is the only rejected mock mutation");
    assert.match(rejectedMutations[0].message, /session changed/, "the expected conflict comes from the stale revision");
    assert.equal(readFailures, 1, "the deliberate failed refresh is the only failed mock read");
    assert.deepEqual(routeErrors, [], "mock request handler errors");
    assert.deepEqual(errors, [], "unexpected browser errors");
    console.log("backend browser flow passed (mock API only; private compatibility unverified)");
  } finally {
    if (browser) await browser.close();
    if (server) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
})().catch(error => { console.error(error.stack || error); if (routeErrors.length) console.error(routeErrors); process.exitCode = 1; });
