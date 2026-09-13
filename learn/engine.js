/* Milkplexity Learn · engine.js
   The study loop, in the browser, mirroring learn/drill.py in the app:
   NEW -> SEEN -> FAMILIAR -> MASTERED, a round builder (7 per round, at
   most 4 new), distractors drawn only from the set, conservative local
   grading, Don't know, retype-to-continue, "I was correct", missed-card
   review, checkpoints and a stability heuristic for the next review.

   What changed for this design: a three-way mode replaces the question-type
   checklist. Easy asks you to choose; Recall asks you to think, then
   reveal and rate yourself; only the Hard test asks you to type, and only a typed, unaided
   answer moves a Familiar card to Mastered (drill.py's rule, unchanged), so a
   new card needs two typed wins.

   The public surface is api(path, body), the same paths the app exposes at
   /api/learn, so app.js can be pointed at the real server by replacing one
   function. State lives in localStorage; in the app it lives in the private
   SQLite ledger and never leaves the owner's Mac. */
"use strict";
(() => {
  const STATES = ["NEW", "SEEN", "FAMILIAR", "MASTERED"];
  const MODES = {
    easy:   {label: "Easy",      hint: "Choose the answer",   types: ["multiple_choice", "true_false", "flashcard"], goal: "understanding"},
    recall: {label: "Recall",    hint: "Think, then reveal",  types: ["flashcard", "true_false"],                    goal: "understanding", alternate: true},
    hard:   {label: "Hard test", hint: "Type it from memory", types: ["written"],                                    goal: "mastery"},
  };
  const DEFAULTS = {mode: "easy", answer_with: "back", grading: "smart", scope: "due", shuffle: true, starred: false,
    test_date: "", round_size: 7, max_new: 4, sound: false, haptics: true, auto_advance: false, daily_goal: 10, deck: "all"};
  const KEY = "milkplexity-learn-prototype-v1";

  class LearnError extends Error {}
  const now = () => new Date();
  const stamp = () => new Date().toISOString();
  const today = () => stamp().slice(0, 10);
  const ident = prefix => `${prefix}-${(crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2)).replace(/-/g, "").slice(0, 10)}`;
  const normalize = v => String(v ?? "").normalize("NFC").split(/\s+/).filter(Boolean).join(" ");
  const choice = (value, allowed, name) => { if (!allowed.includes(value)) throw new LearnError(`Choose a valid ${name}.`); return value; };
  function text(value, name, max, empty = false) {
    if (typeof value !== "string") throw new LearnError(`${name} must be text.`);
    const v = value.trim();
    if (!v && !empty) throw new LearnError(`${name} is required.`);
    if (v.length > max) throw new LearnError(`${name} is too long.`);
    return v;
  }
  const shuffle = list => { for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; } return list; };
  const pick = list => list[Math.floor(Math.random() * list.length)];
  const clone = v => JSON.parse(JSON.stringify(v));

  /* Conservative local matching, ported from drill.py. Exact preserves case
     and symbols. Smart accepts case, terminal punctuation, and one missing,
     extra or transposed letter in a longer single word, unless the typed
     text is another answer in the set. Saved aliases are explicit synonyms. */
  function grade(value, expected, mode = "smart", aliases = [], alternatives = []) {
    if (mode === "exact") return normalize(value) === normalize(expected);
    const clean = v => normalize(v).toLowerCase().replace(/[.!?]+$/, "");
    const got = clean(value);
    const answers = [expected, ...aliases].map(clean);
    if (answers.includes(got)) return true;
    if (alternatives.map(clean).includes(got)) return false;
    const alpha = s => /^[A-Za-z]+$/.test(s);
    for (const answer of answers) {
      if (!(alpha(got) && alpha(answer) && Math.min(got.length, answer.length) >= 5)) continue;
      if (Math.abs(got.length - answer.length) === 1) {
        const [long, short] = got.length > answer.length ? [got, answer] : [answer, got];
        for (let i = 0; i < long.length; i++) if (long.slice(0, i) + long.slice(i + 1) === short) return true;
      }
      if (got.length === answer.length) {
        for (let i = 0; i < got.length - 1; i++) if (got.slice(0, i) + got[i + 1] + got[i] + got.slice(i + 2) === answer) return true;
      }
    }
    return false;
  }

  function config(body, previous) {
    if (!body || typeof body !== "object") throw new LearnError("Study options must be an object.");
    const cfg = {...DEFAULTS, ...(previous || {}), ...body};
    choice(cfg.mode, Object.keys(MODES), "mode");
    choice(cfg.answer_with, ["front", "back"], "answer side");
    choice(cfg.grading, ["smart", "exact"], "grading");
    choice(cfg.scope, ["due", "all"], "scope");
    for (const k of ["shuffle", "starred", "sound", "haptics", "auto_advance"]) if (typeof cfg[k] !== "boolean") throw new LearnError(`Choose whether to enable ${k}.`);
    for (const [k, lo, hi] of [["round_size", 1, 12], ["max_new", 1, 4], ["daily_goal", 1, 100]]) {
      if (!Number.isInteger(cfg[k]) || cfg[k] < lo || cfg[k] > hi) throw new LearnError(`${k} must be between ${lo} and ${hi}.`);
    }
    if (typeof cfg.test_date !== "string" || typeof cfg.deck !== "string") throw new LearnError("Choose a valid test date.");
    if (cfg.test_date && (!/^\d{4}-\d{2}-\d{2}$/.test(cfg.test_date) || cfg.test_date < today())) throw new LearnError("Choose a test date today or later.");
    return Object.fromEntries(Object.keys(DEFAULTS).map(k => [k, cfg[k]]));
  }
  const goalOf = cfg => MODES[cfg.mode].goal;

  function memory(card, side) {
    card.learning = card.learning || {};
    return card.learning[side] = card.learning[side] || {mastery: "NEW", stability: 1, difficulty: 5, seen: 0, correct: 0, last_reviewed: null};
  }
  function schedule(card, mem, correct, cfg) {
    /* Intraday repetitions never inflate long-term stability repeatedly. */
    let delayMs;
    if (!correct) {
      mem.difficulty = Math.min(10, mem.difficulty + 1);
      mem.stability = Math.max(.5, mem.stability * .5);
      delayMs = 60 * 1000;
    } else {
      if (!mem.last_reviewed || mem.last_reviewed.slice(0, 10) !== today()) mem.stability = Math.min(365, mem.stability * (1 + 1.15 * (11 - mem.difficulty) / 10));
      const retention = {quick: .85, understanding: .9, mastery: .95}[goalOf(cfg)];
      let days = Math.max(1, Math.round(9 * mem.stability * (1 / retention - 1)));
      if (cfg.test_date) days = Math.min(days, Math.max(1, Math.round((Date.parse(cfg.test_date) - Date.parse(today())) / 86400000)));
      delayMs = days * 86400000;
    }
    mem.last_reviewed = stamp();
    card.due = new Date(now().getTime() + delayMs).toISOString();
    card.revision += 1;
  }

  class Engine {
    constructor(decks) {
      this.decks = decks;
      this.s = this.load() || this.seed();
    }
    seed() {
      const cards = [];
      for (const deck of this.decks) for (const [front, back] of deck.cards) {
        cards.push({id: ident("card"), deck: deck.id, front, back, starred: false, note: "", mnemonic: "", aliases: {}, due: stamp(), revision: 0, learning: {}});
      }
      return {cards, activities: [], drill_config: {...DEFAULTS}, drill_session: null, created: stamp()};
    }
    load() { try { const raw = localStorage.getItem(KEY); const s = raw && JSON.parse(raw); return s && Array.isArray(s.cards) ? s : null; } catch { return null; } }
    save() { try { localStorage.setItem(KEY, JSON.stringify(this.s)); } catch {} }
    reset() { this.s = this.seed(); this.save(); return this.view(this.s); }
    /* Every write runs inside a transaction: a thrown LearnError leaves the
       state exactly as it was, the way the ledger's SQLite transaction does. */
    transaction(fn) {
      const snapshot = JSON.stringify(this.s);
      try { const result = fn(this.s); this.save(); return result; }
      catch (e) { this.s = JSON.parse(snapshot); throw e; }
    }

    cards(s, session) { const ids = new Set(session.card_ids); return s.cards.filter(c => ids.has(c.id)); }
    current(s, session) {
      const card = s.cards.find(c => c.id === session.question?.card_id);
      if (!card) throw new LearnError("This card is no longer available. End this session and start again.");
      return card;
    }
    eligible(s, cfg) {
      return s.cards.filter(c => (cfg.deck === "all" || c.deck === cfg.deck) && (!cfg.starred || c.starred)
        && (cfg.scope === "all" || c.due <= stamp() || memory(c, cfg.answer_with).mastery === "NEW"));
    }
    remaining(s, session) {
      const side = session.config.answer_with, target = goalOf(session.config) === "mastery" ? 3 : 2;
      return this.cards(s, session).filter(c => STATES.indexOf(memory(c, side).mastery) < target || !session.tested.includes(c.id));
    }
    /* The selection rule, shared by the round builder and the Home preview:
       missed cards first, then cards already seen, then at most max_new new
       ones, round_size in all. */
    select(pool, session, ordered = false) {
      const cfg = session.config;
      pool = [...pool];
      if (cfg.shuffle && !ordered) shuffle(pool);
      const key = c => [session.misses.includes(c.id) ? 0 : 1, memory(c, cfg.answer_with).mastery === "NEW" ? 1 : 0, cfg.shuffle ? "" : c.due];
      if (!ordered) pool.sort((a, b) => { const ka = key(a), kb = key(b); for (let i = 0; i < 3; i++) if (ka[i] !== kb[i]) return ka[i] < kb[i] ? -1 : 1; return 0; });
      const selected = []; let fresh = 0;
      for (const c of pool) {
        const isNew = memory(c, cfg.answer_with).mastery === "NEW";
        if (isNew && fresh >= cfg.max_new) continue;
        selected.push(c.id); fresh += isNew ? 1 : 0;
        if (selected.length >= cfg.round_size) break;
      }
      return selected;
    }
    buildRound(s, session, only = null, ordered = false) {
      const pool = only === null ? this.remaining(s, session) : [...only];
      if (!pool.length) { Object.assign(session, {status: "complete", question: null}); return; }
      const selected = this.select(pool, session, ordered);
      Object.assign(session, {queue: selected, index: 0, round: session.round + 1, round_results: [], status: "question"});
      this.question(s, session);
    }
    static planKey(cfg) { return JSON.stringify(["deck", "scope", "starred", "answer_with", "round_size", "max_new", "shuffle"].map(k => cfg[k])); }
    /* Preview the next round and remember it, so Home can show the very cards
       that start() will ask, in order, and the first bubble can morph onto
       the stage honestly. */
    plan(body) {
      const cfg = config(body?.config || {}, this.s.drill_config);
      return this.transaction(s => {
        const eligible = this.eligible(s, cfg);
        const ids = this.select(eligible, {config: cfg, misses: []});
        s.drill_plan = {key: Engine.planKey(cfg), card_ids: ids};
        const side = cfg.answer_with;
        return {card_ids: ids, total: eligible.length, fresh: ids.filter(id => memory(eligible.find(c => c.id === id), side).mastery === "NEW").length};
      });
    }
    question(s, session) {
      const cfg = session.config, mode = MODES[cfg.mode];
      const card = s.cards.find(c => c.id === session.queue[session.index]);
      const side = cfg.answer_with, mem = memory(card, side);
      /* Four distinct choices, never padded with duplicate or invented answers. */
      const alternatives = new Map();
      for (const candidate of this.cards(s, session)) {
        const key = normalize(candidate[side]).toLowerCase();
        if (key !== normalize(card[side]).toLowerCase() && !alternatives.has(key)) alternatives.set(key, candidate[side]);
      }
      const pool = [...alternatives.values()].sort((a, b) => Math.abs(a.length - card[side].length) - Math.abs(b.length - card[side].length) || (a < b ? -1 : 1));
      let kind;
      if (mode.types.includes("written") && (["FAMILIAR", "MASTERED"].includes(mem.mastery) || !pool.length)) kind = "written";
      else {
        const usable = mode.types.filter(t => (t !== "multiple_choice" || pool.length >= 3) && (t !== "true_false" || pool.length));
        kind = usable[0] || "flashcard";
        if (mode.alternate && usable.length > 1 && mem.seen % 2 === 1) kind = usable[1];
      }
      const q = {id: ident("question"), card_id: card.id, type: kind, prompt: card[side === "back" ? "front" : "back"], answer: card[side],
        assisted: false, revealed: false, draft: "", card_revision: card.revision};
      if (kind === "multiple_choice") q.options = shuffle([...pool.slice(0, 3), card[side]]);
      else if (kind === "true_false") q.candidate = pick([card[side], pool[0]]);
      Object.assign(session, {question: q, feedback: null, status: "question"});
      delete session.tutor_context;
    }
    view(s) {
      const session = s.drill_session, cfg = s.drill_config || DEFAULTS;
      const tally = list => { const counts = Object.fromEntries(STATES.map(k => [k, 0])); for (const c of list) counts[memory(c, cfg.answer_with).mastery] += 1; return counts; };
      const day = today();
      const decks = this.decks.map(d => {
        const cards = s.cards.filter(c => c.deck === d.id);
        return {id: d.id, name: d.name, glyph: d.glyph, hue: d.hue, total: cards.length, counts: tally(cards),
          due: this.eligible(s, {...cfg, deck: d.id, scope: "due", starred: false}).length};
      });
      const result = {config: cfg, modes: MODES, counts: tally(s.cards), total: s.cards.length,
        due: this.eligible(s, {...cfg, scope: "due"}).length,
        daily: s.activities.filter(a => a.at.slice(0, 10) === day && a.drill === true).length,
        decks, session: null,
        cards: s.cards.map(c => ({id: c.id, deck: c.deck, front: c.front, back: c.back, starred: c.starred, note: c.note, mnemonic: c.mnemonic,
          aliases: c.aliases, due: c.due, mastery: memory(c, cfg.answer_with).mastery}))};
      if (session) {
        const out = clone(session);
        delete out.receipts;
        if (out.question) {
          delete out.question.card_revision;
          if (out.status === "question" && !out.question.revealed) delete out.question.answer;
        }
        const cards = this.cards(s, session);
        out.counts = Object.fromEntries(STATES.map(k => [k, 0]));
        for (const c of cards) out.counts[memory(c, session.config.answer_with).mastery] += 1;
        out.remaining = this.remaining(s, session).length;
        out.next_due = cards.reduce((m, c) => (m === null || c.due < m ? c.due : m), null);
        out.deck = this.decks.find(d => d.id === session.config.deck) || null;
        result.session = out;
      }
      return result;
    }

    get() { return this.view(this.s); }
    start(body) {
      const cfg = config(body?.config || {});
      return this.transaction(s => {
        if (s.drill_session && !["complete", "ended"].includes(s.drill_session.status)) return this.view(s);
        const cards = this.eligible(s, cfg);
        if (!cards.length) throw new LearnError("No cards match these options. Study all cards, or turn off starred only.");
        s.drill_config = cfg;
        const session = {id: ident("study"), revision: 0, config: cfg, card_ids: cards.map(c => c.id), at: stamp(), round: 0,
          tested: [], misses: [], attempts: 0, correct: 0, streak: 0, best_streak: 0, tutors: {}};
        const side = cfg.answer_with;
        session.counts_start = Object.fromEntries(STATES.map(k => [k, cards.filter(c => memory(c, side).mastery === k).length]));
        s.drill_session = session;
        const plan = s.drill_plan;
        delete s.drill_plan;
        if (plan && plan.key === Engine.planKey(cfg) && plan.card_ids.length && plan.card_ids.every(id => cards.some(c => c.id === id))) {
          this.buildRound(s, session, plan.card_ids.map(id => cards.find(c => c.id === id)), true);
        } else this.buildRound(s, session);
        return this.view(s);
      });
    }
    applyResult(s, session, correct, override = false) {
      const q = session.question, c = this.current(s, session);
      const mem = memory(c, session.config.answer_with);
      if (override) {
        Object.assign(mem, session.feedback.before);
        mem.seen += 1;
        session.streak = session.feedback.streak_before;
        session.correct += 1;
        if (!session.feedback.was_missed) session.misses = session.misses.filter(id => id !== c.id);
      } else {
        session.feedback.before = clone(mem);
        session.feedback.streak_before = session.streak;
        session.feedback.was_missed = session.misses.includes(c.id);
        session.attempts += 1;
        session.correct += correct ? 1 : 0;
        mem.seen += 1;
        if (!session.tested.includes(c.id)) session.tested.push(c.id);
      }
      const credit = correct && !q.assisted;
      if (credit) {
        /* Only a typed, unaided answer on a Familiar card reaches Mastered. */
        if (["FAMILIAR", "MASTERED"].includes(mem.mastery) && q.type === "written") mem.mastery = "MASTERED";
        else mem.mastery = STATES[Math.max(STATES.indexOf(mem.mastery), STATES.indexOf("FAMILIAR"))];
        mem.correct += 1;
      } else if (!correct) {
        mem.mastery = STATES[Math.max(1, STATES.indexOf(mem.mastery) - 1)];
        mem.correct = 0;
        if (!session.misses.includes(c.id)) session.misses.push(c.id);
      } else if (mem.mastery === "NEW") mem.mastery = "SEEN";
      session.streak = credit ? session.streak + 1 : 0;
      session.best_streak = Math.max(session.best_streak, session.streak);
      Object.assign(session.feedback, {correct, override, credited: credit, mastery: mem.mastery, before_mastery: session.feedback.before.mastery});
    }
    finishAnswer(s, session) {
      const q = session.question, f = session.feedback, c = this.current(s, session);
      schedule(c, memory(c, session.config.answer_with), f.credited, session.config);
      s.activities.push({at: stamp(), drill: true, card_id: c.id, correct: f.correct, assisted: q.assisted, question_id: q.id});
      if (s.activities.length > 2000) s.activities.splice(0, s.activities.length - 2000);
      session.round_results.push({card_id: c.id, front: c.front, correct: f.correct, mastery: f.mastery});
    }
    action(body) {
      const action = choice(body?.action, ["answer", "continue", "override", "reveal", "next_round", "end", "review_misses", "settings", "draft", "tutor"], "study action");
      const request_id = typeof body.request_id === "string" ? body.request_id.slice(0, 100) : "";
      const fingerprint = JSON.stringify(Object.keys(body).sort().map(k => [k, body[k]]));
      return this.transaction(s => {
        const session = s.drill_session;
        if (!session || session.id !== body.session_id) throw new LearnError("This study session changed. Refresh to resume it.");
        /* A repeated request with the same identifier is answered from the
           receipt, never applied twice; the same identifier with a different
           body is refused. Mirrors drill.py. */
        session.receipts = session.receipts || {};
        if (request_id && session.receipts[request_id]) {
          if (session.receipts[request_id] !== fingerprint) throw new LearnError("Use a new identifier for a different action.");
          return this.view(s);
        }
        if (body.revision !== session.revision) throw new LearnError("Your session changed on another page. Refresh to resume it.");
        const q = session.question;
        let c = null;
        if (["answer", "continue", "override", "reveal", "draft", "tutor"].includes(action)) {
          if (!q || body.question_id !== q.id) throw new LearnError("That question is no longer current.");
          c = this.current(s, session);
          if (c.revision !== q.card_revision) throw new LearnError("This card changed elsewhere. End this session and start again.");
        }
        if (action === "answer") {
          if (session.status !== "question") throw new LearnError("Continue from the saved feedback first.");
          const value = text(body.answer ?? "", "Answer", 3000, true);
          const unknown = body.dont_know === true;
          if (!value && !unknown) throw new LearnError("Try an answer or choose Don't know.");
          const aliases = c.aliases?.[session.config.answer_with] || [];
          let correct;
          if (q.type === "flashcard") {
            if (!q.revealed && !unknown) throw new LearnError("Reveal the card before rating your recall.");
            correct = value === "got_it" && !unknown;
          } else if (q.type === "true_false") correct = value === String(q.candidate === q.answer) && !unknown;
          else if (q.type === "multiple_choice") correct = value === q.answer && !unknown;
          else correct = !unknown && grade(value, q.answer, session.config.grading, aliases, this.cards(s, session).map(x => x[session.config.answer_with]));
          session.feedback = {answer: value, dont_know: unknown};
          this.applyResult(s, session, correct);
          session.status = "feedback";
        } else if (action === "override") {
          if (session.status !== "feedback" || session.feedback.correct || session.feedback.dont_know || q.type !== "written") throw new LearnError("Only a missed typed answer can be overridden.");
          this.applyResult(s, session, true, true);
        } else if (action === "continue") {
          if (session.status !== "feedback") throw new LearnError("Answer this question first.");
          const f = session.feedback;
          if (!f.correct && !grade(text(body.correction ?? "", "Correction", 3000, true), q.answer, "exact")) throw new LearnError("Retype the answer to continue.");
          this.finishAnswer(s, session);
          session.index += 1;
          if (session.index >= session.queue.length) {
            Object.assign(session, {status: "checkpoint", question: null});
            if (!this.remaining(s, session).length) session.status = "complete";
          } else this.question(s, session);
        } else if (action === "reveal") {
          if (session.status !== "question" || q.type !== "flashcard") throw new LearnError("This is not a card to reveal.");
          q.revealed = true;
        } else if (action === "draft") {
          if (session.status !== "question") throw new LearnError("This answer has already been submitted.");
          q.draft = text(body.text ?? "", "Draft", 3000, true);
        } else if (action === "tutor") {
          if (!["question", "feedback"].includes(session.status)) throw new LearnError("Open the tutor from a current question.");
          /* Help before submitting is practice, not an unaided mastery credit. */
          if (session.status === "question") q.assisted = true;
          session.tutor_context = {prompt: q.prompt, reference_answer: q.answer, question_type: q.type,
            your_answer: session.feedback ? session.feedback.answer : q.draft, mastery: memory(c, session.config.answer_with).mastery,
            note: c.note, mnemonic: c.mnemonic};
        } else if (action === "settings") {
          if (!["checkpoint", "complete"].includes(session.status)) throw new LearnError("Change session options at a round checkpoint.");
          const cfg = config(body.config || {}, session.config);
          for (const k of ["answer_with", "scope", "starred", "deck"]) if (cfg[k] !== session.config[k]) throw new LearnError("Start a new session to change the cards or answer direction.");
          session.config = cfg; s.drill_config = cfg;
        } else if (action === "end") {
          if (session.status === "feedback") this.finishAnswer(s, session);
          Object.assign(session, {status: "ended", question: null});
        } else if (action === "review_misses") {
          if (!["complete", "checkpoint", "ended"].includes(session.status)) throw new LearnError("Finish this round before reviewing misses.");
          const pool = this.cards(s, session).filter(x => session.misses.includes(x.id));
          if (!pool.length) throw new LearnError("No missed cards to review.");
          this.buildRound(s, session, pool);
        } else if (action === "next_round") {
          if (session.status !== "checkpoint") throw new LearnError("Finish this round first.");
          this.buildRound(s, session);
        }
        session.revision += 1;
        if (request_id) { session.receipts[request_id] = fingerprint; const keys = Object.keys(session.receipts); if (keys.length > 400) for (const k of keys.slice(0, keys.length - 400)) delete session.receipts[k]; }
        return this.view(s);
      });
    }
    editCard(id, body) {
      return this.transaction(s => {
        const c = s.cards.find(x => x.id === id);
        if (!c) throw new LearnError("That card no longer exists.");
        if ("starred" in body) { if (typeof body.starred !== "boolean") throw new LearnError("Choose whether to star this card."); c.starred = body.starred; }
        for (const k of ["note", "mnemonic"]) if (k in body) c[k] = text(body[k], k, 3000, true);
        if ("aliases" in body) {
          const side = choice(body.side || "back", ["front", "back"], "answer side");
          if (!Array.isArray(body.aliases) || body.aliases.length > 12) throw new LearnError("Use at most 12 accepted answers.");
          c.aliases = c.aliases || {}; c.aliases[side] = body.aliases.map(a => text(a, "Accepted answer", 2000));
        }
        return {ok: true};
      });
    }
    addCards(body) {
      return this.transaction(s => {
        const deck = this.decks.find(d => d.id === body.deck) ? body.deck : this.decks[0].id;
        const rows = String(body.tsv || "").split(/\r?\n/).map(l => l.split("\t")).filter(r => r.length >= 2 && r[0].trim() && r[1].trim());
        if (!rows.length) throw new LearnError("Write one card per line: the term, a tab, then the answer.");
        for (const [front, back] of rows) s.cards.push({id: ident("card"), deck, front: text(front, "Term", 1000), back: text(back, "Answer", 2000), starred: false, note: "", mnemonic: "", aliases: {}, due: stamp(), revision: 0, learning: {}});
        return {added: rows.length};
      });
    }
    deleteCard(id) {
      return this.transaction(s => {
        const i = s.cards.findIndex(x => x.id === id);
        if (i < 0) throw new LearnError("That card no longer exists.");
        if (s.drill_session && s.drill_session.card_ids.includes(id) && !["complete", "ended"].includes(s.drill_session.status)) throw new LearnError("Finish or end the current session before deleting a card in it.");
        s.cards.splice(i, 1);
        return {ok: true};
      });
    }

    /* The same paths the app serves under /api/learn, so the UI can be
       pointed at the real ledger by replacing this one method with fetch(). */
    api(path, body, method) {
      return new Promise((resolve, reject) => {
        try {
          if (path === "/drill" && !body) return resolve(this.get());
          if (path === "/drill/start") return resolve(this.start(body));
          if (path === "/drill/plan") return resolve(this.plan(body));
          if (path === "/drill/action") return resolve(this.action(body));
          if (path === "/cards" && body) return resolve(this.addCards(body));
          let m;
          if ((m = path.match(/^\/cards\/([^/]+)\/edit$/))) return resolve(this.editCard(m[1], body || {}));
          if ((m = path.match(/^\/cards\/([^/]+)$/)) && method === "DELETE") return resolve(this.deleteCard(m[1]));
          if (path === "/reset") return resolve(this.reset());
          throw new LearnError("Unknown Learn action.");
        } catch (e) { reject(e); }
      });
    }
  }

  window.LearnEngine = {Engine, LearnError, MODES, STATES, DEFAULTS, grade, normalize};
})();
