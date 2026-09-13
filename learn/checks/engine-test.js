// Headless engine check: runs the study loop in every mode with a fake DOM.
const fs = require("fs"), vm = require("vm"), path = require("path");
const LEARN = path.join(__dirname, "..");
const store = {}; const ctx = {window: {}, crypto: require("crypto"), localStorage: {getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = v; }}, console};
ctx.window.crypto = ctx.crypto; vm.createContext(ctx);
for (const f of ["decks.js", "engine.js"]) vm.runInContext(fs.readFileSync(path.join(LEARN, f), "utf8"), ctx, {filename: f});
const {Engine, MODES, grade} = ctx.window.LearnEngine;
const assert = (c, m) => { if (!c) { console.error("FAIL", m); process.exitCode = 1; } };
// grading counterexamples from the app's rules
assert(grade("Precision", "precision") === true, "case");
assert(grade("precison", "precision") === true, "missing letter in long word");
assert(grade("precisoin", "precision") === true, "transposed");
assert(grade("rate", "rat") === false, "short words no fuzz");
assert(grade("Recall", "Precision", "smart", [], ["Recall"]) === false, "another answer in set");
assert(grade("precision.", "precision") === true, "terminal punctuation");
assert(grade("Precision", "precision", "exact") === false, "exact keeps case");
assert(grade("the fraction", "fraction", "smart", ["the fraction"]) === true, "alias");

const e = new Engine(ctx.window.LearnDecks);
let v = e.get();
assert(v.total === 24 && v.decks.length === 3 && v.due === 24, "seeded " + JSON.stringify([v.total, v.decks.length, v.due]));

function op(v, action, extra = {}) { const s = v.session; return e.action({session_id: s.id, revision: s.revision, question_id: s.question?.id, action, ...extra}); }
function playRound(v, {right = true} = {}) {
  let guard = 0;
  while (v.session.status === "question" && guard++ < 40) {
    const q = v.session.question, card = e.s.cards.find(c => c.id === q.card_id), answer = card.back;
    if (q.type === "multiple_choice") { assert(q.options.length === 4 && new Set(q.options).size === 4 && q.options.includes(answer), "mc options"); assert(!("answer" in q), "answer hidden"); v = op(v, "answer", {answer: right ? answer : q.options.find(o => o !== answer)}); }
    else if (q.type === "true_false") v = op(v, "answer", {answer: right ? String(q.candidate === answer) : String(q.candidate !== answer)});
    else if (q.type === "flashcard") { v = op(v, "reveal"); assert(v.session.question.answer === answer, "revealed answer"); v = op(v, "answer", {answer: right ? "got_it" : "again"}); }
    else if (q.type === "written") v = op(v, "answer", {answer: right ? answer : "nonsense"});
    assert(v.session.status === "feedback", "feedback after answer");
    assert(v.session.feedback.correct === right, `correctness ${q.type}`);
    if (!right) { let threw = false; try { op(v, "continue", {correction: "wrong"}); } catch { threw = true; } assert(threw, "retype required"); }
    v = op(v, "continue", {correction: right ? "" : answer});
  }
  return v;
}
// Easy: multiple choice only, correct answers reach FAMILIAR, never MASTERED
v = e.start({config: {mode: "easy", deck: "numbers", shuffle: false}});
assert(v.session && v.session.status === "question" && v.session.queue.length === 4, "easy round of 4 new " + JSON.stringify(v.session?.queue?.length));
assert(v.session.question.type === "multiple_choice", "easy asks multiple choice");
v = playRound(v);
assert(v.session.status === "checkpoint", "checkpoint " + v.session.status);
assert(v.session.counts.FAMILIAR === 4 && v.session.counts.MASTERED === 0, "easy -> familiar only " + JSON.stringify(v.session.counts));
v = op(v, "next_round"); v = playRound(v);
assert(v.session.status === "complete", "eight cards familiar after two rounds of four: " + v.session.status + " remaining " + v.session.remaining);
assert(["checkpoint","complete"].includes(v.session.status), "ends at checkpoint or complete: " + v.session.status);
v = op(v, "end");
assert(v.session.status === "ended", "ended");
// counts persisted
v = e.get(); assert(v.decks[0].counts.FAMILIAR === 8, "deck counts " + JSON.stringify(v.decks[0].counts));
// Recall: flashcard/true-false only; no typing
v = e.start({config: {mode: "recall", deck: "numbers", scope: "all", shuffle: false}});
const kinds = new Set();
{ let guard = 0; while (v.session.status === "question" && guard++ < 20) { kinds.add(v.session.question.type); const q = v.session.question, answer = e.s.cards.find(c => c.id === q.card_id).back; if (q.type === "flashcard") { v = op(v, "reveal"); v = op(v, "answer", {answer: "got_it"}); } else v = op(v, "answer", {answer: String(q.candidate === answer)}); v = op(v, "continue"); } }
assert(!kinds.has("written") && !kinds.has("multiple_choice"), "recall never types or chooses: " + [...kinds]);
v = op(v, "end");
// Hard test: written; FAMILIAR -> MASTERED; a miss steps down one, misses reviewable; override works
v = e.start({config: {mode: "hard", deck: "numbers", scope: "all", shuffle: false}});
assert(v.session.question.type === "written", "hard asks written");
{ const q = v.session.question, card = e.s.cards.find(c => c.id === q.card_id);
  v = op(v, "answer", {answer: "not this"}); assert(v.session.feedback.correct === false, "miss");
  assert(v.session.feedback.mastery === "SEEN", "step down from familiar to seen: " + v.session.feedback.mastery);
  v = op(v, "override"); assert(v.session.feedback.correct === true && v.session.feedback.mastery === "MASTERED", "override restores and masters: " + v.session.feedback.mastery);
  v = op(v, "continue");
  const q2 = v.session.question, card2 = e.s.cards.find(c => c.id === q2.card_id);
  v = op(v, "answer", {answer: card2.back}); assert(v.session.feedback.mastery === "MASTERED", "typed unaided -> mastered");
  v = op(v, "continue");
  const q3 = v.session.question, card3 = e.s.cards.find(c => c.id === q3.card_id);
  v = op(v, "tutor"); assert(v.session.question.assisted === true && v.session.tutor_context.reference_answer === card3.back, "tutor marks assisted");
  v = op(v, "answer", {answer: card3.back}); assert(v.session.feedback.credited === false && v.session.feedback.mastery === "FAMILIAR", "assisted answer earns no mastery: " + v.session.feedback.mastery);
  v = op(v, "continue");
  const q4 = v.session.question; v = op(v, "answer", {dont_know: true}); assert(v.session.feedback.dont_know && !v.session.feedback.correct, "dont know");
  const card4 = e.s.cards.find(c => c.id === q4.card_id); v = op(v, "continue", {correction: card4.back});
  while (v.session.status === "question") { const q = v.session.question, card = e.s.cards.find(c => c.id === q.card_id); v = op(v, "answer", {answer: card.back}); v = op(v, "continue"); }
  assert(v.session.misses.length === 1, "one miss recorded: " + v.session.misses.length);
  v = op(v, "review_misses"); assert(v.session.queue.length === 1, "review misses builds a 1-card round");
}
// stale revision rejected
{ let threw = false; try { e.action({session_id: v.session.id, revision: -1, action: "end"}); } catch { threw = true; } assert(threw, "stale revision rejected"); }
// persistence round trip
const e2 = new Engine(ctx.window.LearnDecks); assert(e2.get().session && e2.get().session.id === v.session.id, "session persisted in localStorage");
// request receipts: a repeated id replays, a changed body under the same id is refused
{ const e4 = new Engine(ctx.window.LearnDecks); e4.reset(); let v4 = e4.start({config: {mode: "easy", deck: "ml", shuffle: false}});
  const q = v4.session.question, card = e4.s.cards.find(c => c.id === q.card_id);
  const body = {session_id: v4.session.id, revision: v4.session.revision, question_id: q.id, request_id: "req-1", action: "answer", answer: card.back};
  const a = e4.action(body); const b = e4.action(body);
  assert(a.session.revision === b.session.revision && b.session.status === "feedback", "same request id replays without a second apply");
  let threw = false; try { e4.action({...body, answer: "other"}); } catch { threw = true; } assert(threw, "same id with a different body is refused");
  assert(!("receipts" in b.session), "receipts never leave the engine"); }
console.log(process.exitCode ? "ENGINE TESTS FAILED" : "engine tests passed");
// plan -> start honors the previewed order
{ const e3 = new Engine(ctx.window.LearnDecks); e3.reset(); const cfg = {mode: "easy", deck: "ml", shuffle: true};
  const p = e3.plan({config: cfg}); assert(p.card_ids.length === 4 && p.total === 8 && p.fresh === 4, "plan previews 4 of 8 new: " + JSON.stringify(p));
  const v3 = e3.start({config: cfg}); assert(JSON.stringify(v3.session.queue) === JSON.stringify(p.card_ids), "start uses the planned queue in order");
  assert(v3.session.question.card_id === p.card_ids[0], "first question is the first bubble");
  console.log("plan test passed"); }
