// Mock-backed contract checks for the public adapter. These fixtures come from
// LearnEngine; they do not prove compatibility with the private application's
// backend, database, receipt handling, grading, scheduler, or tutor service.
const fs = require("fs"), vm = require("vm"), path = require("path");
const assert = require("node:assert/strict");
const LEARN = path.join(__dirname, "..");
const plain = value => JSON.parse(JSON.stringify(value));
const tests = [];
const test = (name, run) => tests.push({name, run});

function load() {
  const store = {}, storageCalls = [];
  const location = {href: "http://localhost/learn/", origin: "http://localhost", protocol: "http:"};
  const ctx = {window: {location}, location, crypto: require("crypto"), console,
    AbortController, setTimeout, clearTimeout, URL, Headers,
    localStorage: {
      getItem(key) { storageCalls.push(["get", key]); return store[key] ?? null; },
      setItem(key, value) { storageCalls.push(["set", key]); store[key] = value; }
    }};
  ctx.window.crypto = ctx.crypto;
  vm.createContext(ctx);
  for (const file of ["decks.js", "engine.js", "api.js"])
    vm.runInContext(fs.readFileSync(path.join(LEARN, file), "utf8"), ctx, {filename: file});
  return {ctx, E: ctx.window.LearnEngine, API: ctx.window.LearnAPI, storageCalls};
}

function fixtures(env) {
  const engine = new env.E.Engine(env.ctx.window.LearnDecks);
  const idle = plain(engine.reset());
  const question = plain(engine.start({config: {mode: "easy", deck: "numbers", shuffle: false}}));
  const s = question.session, card = question.cards.find(c => c.id === s.question.card_id);
  const feedback = plain(engine.action({session_id: s.id, revision: s.revision,
    question_id: s.question.id, action: "answer", answer: card.back}));
  return {engine, idle, question, feedback};
}

// Remove prototype-only set fields and translate to the documented server
// config vocabulary. Unchanged session/question/feedback data remain visible.
function serverView(env, value, {sets = false} = {}) {
  const result = plain(value);
  for (const cfg of [result.config, result.session?.config].filter(Boolean)) {
    const mode = env.E.MODES[cfg.mode];
    cfg.goal = mode.goal; cfg.types = plain(mode.types);
    delete cfg.mode;
    if (!sets) delete cfg.deck;
  }
  if (!sets) {
    delete result.decks;
    for (const card of result.cards) delete card.deck;
    if (result.session) delete result.session.deck;
  }
  return result;
}

function reply(value, status = 200) {
  return new Response(status === 204 ? null : JSON.stringify(value),
    {status, headers: {"Content-Type": "application/json"}});
}

function mockFetch(responses) {
  const calls = [];
  const fetch = async (url, options) => {
    calls.push({url, options});
    assert.ok(responses.length, `unexpected fetch ${url}`);
    const next = responses.shift();
    if (typeof next === "function") return next(url, options);
    if (next instanceof Error) throw next;
    return next;
  };
  return {fetch, calls};
}

function backend(env, responses, options = {}) {
  const mock = mockFetch(responses);
  const adapter = env.API.create({mode: "backend", fetch: mock.fetch, ...options});
  return {adapter, ...mock};
}

async function failure(env, operation, {status, uncertain} = {}) {
  let error;
  try { await operation(); } catch (e) { error = e; }
  assert.ok(error instanceof env.API.ApiError, `expected ApiError, got ${error}`);
  assert.ok(typeof error.code === "string" && error.code.length, "failure includes a stable code");
  assert.ok(typeof error.message === "string" && error.message.length, "failure has a useful message");
  if (status !== undefined) assert.equal(error.status, status);
  if (uncertain !== undefined) assert.equal(Boolean(error.uncertain), uncertain);
  return error;
}

test("standalone defaults retain the real engine and local endpoint behavior", async () => {
  const env = load();
  const adapter = env.API.create();
  assert.equal(adapter.kind, "demo");
  assert.ok(adapter.engine instanceof env.E.Engine);
  assert.deepEqual(plain(adapter.defaults), plain(env.E.DEFAULTS));
  assert.deepEqual(plain(adapter.capabilities), {plan: true, sets: true, reset: true});
  const view = await adapter.api("/drill");
  assert.equal(view.total, 24);
  const plan = await adapter.api("/drill/plan", {config: {mode: "easy", deck: "numbers", shuffle: false}});
  const started = await adapter.api("/drill/start", {config: {mode: "easy", deck: "numbers", shuffle: false}});
  assert.deepEqual(plain(started.session.queue), plain(plan.card_ids));
  assert.equal((await adapter.api("/reset")).total, 24);
  const injected = {api: async (...args) => args};
  const custom = env.API.create({engine: injected});
  assert.equal(custom.engine, injected);
  assert.deepEqual(await custom.api("/cards", {tsv: "a\tb"}, "POST"), ["/cards", {tsv: "a\tb"}, "POST"]);
});

test("backend GET uses the documented path and never touches demo storage", async () => {
  const env = load(), f = fixtures(env), expected = serverView(env, f.idle);
  const callsBefore = env.storageCalls.length;
  env.E.Engine = class { constructor() { throw new Error("backend instantiated the demo engine"); } };
  const {adapter, calls} = backend(env, [reply(expected)], {headers: {"X-Learn-Test": "contract"}});
  assert.equal(adapter.kind, "backend");
  assert.equal(adapter.engine, null);
  assert.equal(adapter.defaults.haptics, false);
  assert.equal(adapter.capabilities.plan, false);
  assert.equal(adapter.capabilities.sets, false);
  const view = await adapter.api("/drill");
  assert.equal(calls.length, 1);
  const call = calls[0];
  assert.equal(call.url, "/api/learn/drill");
  assert.equal(call.options.method, "GET");
  assert.equal(call.options.credentials, "same-origin");
  assert.equal(call.options.cache, "no-store");
  assert.equal(call.options.body, undefined);
  assert.equal(new Headers(call.options.headers).get("X-Learn-Test"), "contract");
  assert.ok(call.options.signal instanceof AbortSignal);
  assert.equal(view.config.mode, "easy");
  assert.equal(view.total, expected.total);
  assert.deepEqual(plain(view.counts), expected.counts);
  assert.equal(view.features.sets, false);
  assert.equal(env.storageCalls.length, callsBefore, "backend must not read or write prototype localStorage");
});

test("all three start modes translate to goal/types without changing caller data", async () => {
  for (const mode of ["easy", "recall", "hard"]) {
    const env = load(), f = fixtures(env);
    f.engine.reset();
    const started = f.engine.start({config: {mode, deck: "numbers", shuffle: false}});
    assert.ok(env.E.MODES[mode].types.includes(started.session.question.type), `engine fixture belongs to ${mode}`);
    const view = serverView(env, started);
    const {adapter, calls} = backend(env, [reply(view)]);
    const body = {config: {mode, deck: "numbers", shuffle: false, haptics: false}};
    const before = plain(body);
    const result = await adapter.api("/drill/start", body);
    assert.equal(calls[0].url, "/api/learn/drill/start");
    assert.equal(calls[0].options.method, "POST");
    assert.equal(new Headers(calls[0].options.headers).get("Content-Type"), "application/json");
    const sent = JSON.parse(calls[0].options.body);
    assert.equal(sent.config.goal, env.E.MODES[mode].goal);
    assert.deepEqual(sent.config.types, plain(env.E.MODES[mode].types));
    assert.ok(!("mode" in sent.config) && !("deck" in sent.config));
    assert.equal(sent.config.shuffle, false);
    assert.deepEqual(body, before);
    assert.equal(result.config.mode, mode);
    assert.equal(result.session.config.mode, mode);
    assert.equal(result.session.question.type, started.session.question.type);
  }
});

test("question types must respect the advertised study mode", async () => {
  for (const [mode, wrongType] of [["easy", "written"], ["recall", "multiple_choice"], ["hard", "flashcard"]]) {
    const env = load(), f = fixtures(env);
    f.engine.reset();
    const started = f.engine.start({config: {mode, deck: "numbers", shuffle: false}});
    const view = serverView(env, started);
    view.session.question.type = wrongType;
    if (wrongType === "multiple_choice") view.session.question.options = ["one", "two", "three", "four"];
    const {adapter, calls} = backend(env, [reply(view)]);
    await failure(env, () => adapter.api("/drill"));
    assert.equal(calls.length, 1);
  }
});

test("action envelopes, feedback, and partial settings survive translation", async () => {
  const env = load(), f = fixtures(env), view = serverView(env, f.feedback);
  const {adapter, calls} = backend(env, [reply(view), reply(view)]);
  const body = {session_id: f.question.session.id, revision: f.question.session.revision,
    question_id: f.question.session.question.id, request_id: "contract-answer-1", action: "answer",
    answer: "literal answer", dont_know: false};
  const result = await adapter.api("/drill/action", body);
  assert.equal(calls[0].url, "/api/learn/drill/action");
  assert.equal(calls[0].options.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].options.body), body);
  assert.deepEqual(plain(result.session.question), view.session.question);
  assert.deepEqual(plain(result.session.feedback), view.session.feedback);
  assert.deepEqual(plain(result.session.round_results), view.session.round_results);
  const settings = {...body, request_id: "contract-settings-2", action: "settings",
    config: {sound: true, goal: "mastery", types: ["written"]}};
  await adapter.api("/drill/action", settings);
  assert.deepEqual(JSON.parse(calls[1].options.body), settings,
    "partial settings must not silently reapply the Easy preset");
});

test("card operations use documented verbs and preserve ids and bodies", async () => {
  const env = load();
  const {adapter, calls} = backend(env, [reply({added: 2}), reply(null, 204), reply(null, 204)]);
  const add = {tsv: "one\t1\ntwo\t2", deck: "numbers"};
  assert.equal((await adapter.api("/cards", add)).added, 2);
  assert.equal(calls[0].url, "/api/learn/cards");
  assert.equal(calls[0].options.method, "POST");
  const sentAdd = JSON.parse(calls[0].options.body);
  assert.equal(sentAdd.tsv, add.tsv);
  assert.ok(!("deck" in sentAdd));
  const edit = {starred: true, aliases: ["one"], side: "back", note: "kept", mnemonic: "kept too"};
  assert.deepEqual(plain(await adapter.api("/cards/card-1/edit", edit)), {ok: true});
  assert.equal(calls[1].url, "/api/learn/cards/card-1/edit");
  assert.equal(calls[1].options.method, "POST");
  assert.deepEqual(JSON.parse(calls[1].options.body), edit);
  assert.deepEqual(plain(await adapter.api("/cards/card-1", null, "DELETE")), {ok: true});
  assert.equal(calls[2].url, "/api/learn/cards/card-1");
  assert.equal(calls[2].options.method, "DELETE");
});

test("sets are opt-in and keep deck selection only when enabled", async () => {
  const env = load(), f = fixtures(env), view = serverView(env, f.question, {sets: true});
  const {adapter, calls} = backend(env, [reply(view), reply({added: 1})], {capabilities: {sets: true}});
  const result = await adapter.api("/drill/start", {config: {mode: "easy", deck: "numbers"}});
  assert.equal(JSON.parse(calls[0].options.body).config.deck, "numbers");
  assert.equal(result.features.sets, true);
  await adapter.api("/cards", {deck: "numbers", tsv: "term\tanswer"});
  assert.equal(JSON.parse(calls[1].options.body).deck, "numbers");
});

test("missing optional metadata hides features without inventing card progress", async () => {
  const env = load(), f = fixtures(env), view = serverView(env, f.feedback);
  delete view.session.counts_start;
  delete view.session.feedback.before_mastery;
  for (const card of view.cards) { delete card.back; delete card.mastery; delete card.due; }
  const {adapter} = backend(env, [reply(view)]);
  const result = await adapter.api("/drill");
  assert.equal(result.features.library, false);
  assert.equal(result.features.cardMastery, false);
  assert.equal(result.features.cardDue, false);
  assert.equal(result.features.sets, false);
  assert.ok(!("counts_start" in result.session));
  assert.ok(!("before_mastery" in result.session.feedback));
  for (const card of result.cards)
    for (const key of ["back", "mastery", "due"]) assert.ok(!(key in card), `no guessed ${key}`);
});

test("question views tolerate unused engine internals and default absent haptics off", async () => {
  const env = load(), f = fixtures(env), view = serverView(env, f.question);
  delete view.session.streak;
  delete view.session.feedback;
  delete view.config.haptics;
  delete view.session.config.haptics;
  const {adapter} = backend(env, [reply(view)]);
  const result = await adapter.api("/drill");
  assert.equal(result.config.haptics, false);
  assert.equal(result.session.config.haptics, false);
  assert.equal(result.session.status, "question");
});

test("one card missing metadata disables its dependent feature", async () => {
  for (const [field, feature] of [["back", "library"], ["mastery", "cardMastery"], ["due", "cardDue"]]) {
    const env = load(), f = fixtures(env), view = serverView(env, f.idle);
    delete view.cards[0][field];
    const {adapter} = backend(env, [reply(view)]);
    const result = await adapter.api("/drill");
    assert.equal(result.features[feature], false);
    assert.ok(!(field in result.cards[0]));
  }
});

test("round plans stay disabled unless declared and degrade on unsupported endpoints", async () => {
  const env = load();
  const disabled = backend(env, []);
  assert.equal(await disabled.adapter.api("/drill/plan", {config: {mode: "easy"}}), null);
  assert.equal(disabled.calls.length, 0);
  for (const status of [404, 405, 501]) {
    const {adapter, calls} = backend(env, [reply({error: "not implemented"}, status)], {capabilities: {plan: true}});
    assert.equal(await adapter.api("/drill/plan", {config: {mode: "recall", deck: "numbers"}}), null);
    assert.equal(adapter.capabilities.plan, false);
    assert.equal(calls[0].url, "/api/learn/drill/plan");
    assert.equal(calls[0].options.method, "POST");
    const sent = JSON.parse(calls[0].options.body);
    assert.equal(sent.config.goal, "understanding");
    assert.deepEqual(sent.config.types, ["flashcard", "true_false"]);
    assert.ok(!("mode" in sent.config) && !("deck" in sent.config));
    assert.equal(await adapter.api("/drill/plan", {config: {mode: "easy"}}), null);
    assert.equal(calls.length, 1);
  }
  const plan = {card_ids: ["card-1", "card-2"], total: 8, fresh: 2};
  const enabled = backend(env, [reply(plan)], {capabilities: {plan: true}});
  assert.deepEqual(plain(await enabled.adapter.api("/drill/plan", {config: {mode: "hard"}})), plan);
  const failed = backend(env, [reply({error: "database unavailable"}, 500)], {capabilities: {plan: true}});
  await failure(env, () => failed.adapter.api("/drill/plan", {config: {mode: "easy"}}), {status: 500});
  assert.equal(failed.adapter.capabilities.plan, true);
  assert.equal(failed.calls.length, 1);
});

test("malformed required view/card/session data fail clearly", async () => {
  const env = load(), f = fixtures(env), idle = serverView(env, f.idle), question = serverView(env, f.question);
  const invalid = [["null view", null], ["array view", []], ["wrapped view", {data: idle}]];
  for (const field of ["config", "counts", "total", "due", "daily", "cards", "session"]) {
    const view = plain(idle); delete view[field]; invalid.push([`missing view.${field}`, view]);
  }
  for (const field of ["id", "front"]) {
    const view = plain(idle); delete view.cards[0][field]; invalid.push([`missing card.${field}`, view]);
  }
  const badMode = plain(idle); badMode.config.goal = "future-goal"; badMode.config.types = ["unrecognized"];
  invalid.push(["unrecognized mode preset", badMode]);
  const badSide = plain(idle); delete badSide.config.answer_with;
  invalid.push(["missing answer direction", badSide]);
  for (const value of [null, "false", 1]) {
    const view = plain(idle); view.config.haptics = value; invalid.push(["nonboolean haptics", view]);
  }
  const badAliases = plain(idle); badAliases.cards[0].aliases = {back: "not a list"};
  invalid.push(["malformed aliases", badAliases]);
  for (const field of ["id", "revision", "status", "queue", "card_ids", "round", "index", "attempts",
    "correct", "best_streak", "counts", "remaining", "misses", "round_results", "question"]) {
    const view = plain(question); delete view.session[field]; invalid.push([`missing session.${field}`, view]);
  }
  for (const field of ["id", "card_id", "prompt", "type", "options", "assisted", "revealed"]) {
    const view = plain(question); delete view.session.question[field]; invalid.push([`missing question.${field}`, view]);
  }
  for (const field of ["correct", "mastery", "answer", "dont_know"]) {
    const view = serverView(env, f.feedback); delete view.session.feedback[field]; invalid.push([`missing feedback.${field}`, view]);
  }
  const badFeedback = serverView(env, f.feedback); delete badFeedback.session.feedback;
  invalid.push(["missing feedback in feedback status", badFeedback]);
  const missingAnswer = serverView(env, f.feedback); delete missingAnswer.session.question.answer;
  invalid.push(["missing reference answer after submission", missingAnswer]);
  for (const [label, view] of invalid) {
    const {adapter, calls} = backend(env, [reply(view)]);
    try { const error = await failure(env, () => adapter.api("/drill")); assert.equal(error.code, "contract", "schema errors are not reported as network failures"); }
    catch (error) { error.message = `${label}: ${error.message}`; throw error; }
    assert.equal(calls.length, 1);
  }
});

test("malformed plans and card creation receipts fail clearly", async () => {
  const env = load();
  for (const value of [null, {}, {added: "1"}, {added: -1}, {added: 1.5}]) {
    const {adapter} = backend(env, [reply(value)]);
    await failure(env, () => adapter.api("/cards", {tsv: "a\tb"}));
  }
  for (const value of [null, {}, {card_ids: [], total: 1}, {card_ids: ["a"], total: "1", fresh: 1},
    {card_ids: ["a"], total: 1, fresh: -1}]) {
    const {adapter} = backend(env, [reply(value)], {capabilities: {plan: true}});
    await failure(env, () => adapter.api("/drill/plan", {config: {mode: "easy"}}));
  }
});

test("HTTP, non-JSON, and network failures never retry or fall back", async () => {
  const env = load();
  for (const status of [400, 401, 403, 409, 429, 500]) {
    const {adapter, calls} = backend(env, [reply({error: "contract failure"}, status)]);
    await failure(env, () => adapter.api("/drill/action", {action: "answer", request_id: "unique-receipt"}), {status});
    assert.equal(calls.length, 1);
  }
  const nonJson = backend(env, [new Response("<html>login</html>", {status: 200})]);
  await failure(env, () => nonJson.adapter.api("/drill"));
  assert.equal(nonJson.calls.length, 1);
  for (const mutation of [false, true]) {
    const {adapter, calls} = backend(env, [new TypeError("connection reset")]);
    await failure(env, () => adapter.api(mutation ? "/drill/action" : "/drill", mutation ? {action: "answer"} : undefined),
      {uncertain: mutation});
    assert.equal(calls.length, 1);
  }
});

test("timeouts abort once and identify an uncertain mutation result", async () => {
  const env = load();
  for (const mutation of [false, true]) {
    let aborts = 0;
    const pending = (_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => {
        aborts += 1; reject(new DOMException("aborted", "AbortError"));
      }, {once: true});
    });
    const {adapter, calls} = backend(env, [pending], {timeoutMs: 5});
    await failure(env, () => adapter.api(mutation ? "/drill/action" : "/drill", mutation ? {action: "answer"} : undefined),
      {uncertain: mutation});
    assert.equal(aborts, 1);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].options.signal.aborted, true);
  }
});

test("backend reset and unsafe backend addresses are refused before any fetch", async () => {
  const env = load();
  const {adapter, calls} = backend(env, []);
  await failure(env, () => adapter.api("/reset"));
  assert.equal(calls.length, 0);
  for (const baseUrl of ["https://example.com/api/learn", "//example.com/api/learn", "api/learn"])
    await failure(env, () => Promise.resolve(env.API.create({mode: "backend", baseUrl, fetch: () => {
      throw new Error("unsafe backend address was fetched");
    }})));
  const f = fixtures(env);
  const custom = backend(env, [reply(serverView(env, f.idle))], {baseUrl: "/application/api/learn/"});
  await custom.adapter.api("/drill");
  assert.equal(custom.calls[0].url, "/application/api/learn/drill");
});

test("wrong methods and unknown paths are refused before any fetch", async () => {
  const env = load(), {adapter, calls} = backend(env, []);
  for (const [path, body, method] of [["/drill", {}, "POST"], ["/drill/start", {}, "GET"],
    ["/drill/action", {}, "DELETE"], ["/cards", {}, "DELETE"], ["/cards/card-1/edit", {}, "PATCH"],
    ["/cards/card-1", null, "POST"], ["/unknown", {}, "POST"], ["/drill?token=outside-contract", null, "GET"],
    ["/cards/..", null, "DELETE"], ["/cards/%2e%2e/edit", {}, "POST"], ["/cards/\\card/edit", {}, "POST"]])
    await failure(env, () => adapter.api(path, body, method));
  assert.equal(calls.length, 0);
});

(async () => {
  let passed = 0;
  for (const {name, run} of tests) {
    try { await run(); passed += 1; console.log(`PASS ${name}`); }
    catch (error) { console.error(`FAIL ${name}\n${error.stack || error}`); process.exitCode = 1; }
  }
  console.log(`${passed}/${tests.length} mock-backed API contract checks passed; private backend remains unverified.`);
})();
