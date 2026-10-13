/* Milkplexity Learn · api.js
   Explicit demo/HTTP boundary. The server owns grading, scheduling, mastery
   and receipts. HTTP failures never seed cards or fall back to local progress. */
"use strict";
(() => {
  const E = window.LearnEngine;
  class ApiError extends Error {
    constructor(message, {status = 0, code = "", uncertain = false} = {}) {
      super(message); this.name = "ApiError";
      Object.assign(this, {status, code, uncertain});
    }
  }
  const object = v => Boolean(v && typeof v === "object" && !Array.isArray(v));
  const integer = v => Number.isInteger(v) && v >= 0;
  const id = v => typeof v === "string" && v.length > 0;
  const list = (v, check) => Array.isArray(v) && v.every(check);
  const contract = (ok, field) => { if (!ok) throw new ApiError(`Learn API returned an incompatible ${field}.`, {code: "contract"}); };
  function counts(v, field) { contract(object(v) && E.STATES.every(k => integer(v[k])), field); }
  function modeOf(cfg) {
    contract(object(cfg), "config");
    const sameTypes = mode => Array.isArray(cfg.types) && cfg.types.length === E.MODES[mode].types.length && E.MODES[mode].types.every(t => cfg.types.includes(t));
    if (cfg.mode !== undefined) {
      contract(Object.keys(E.MODES).includes(cfg.mode), "config.mode");
      contract(cfg.goal === undefined || cfg.goal === E.MODES[cfg.mode].goal, "config.goal");
      contract(cfg.types === undefined || sameTypes(cfg.mode), "config.types");
      return cfg.mode;
    }
    const mode = Object.keys(E.MODES).find(m => cfg.goal === E.MODES[m].goal && sameTypes(m));
    contract(Boolean(mode), "config goal/types preset");
    return mode;
  }
  function uiConfig(cfg, sets) {
    contract(object(cfg), "config");
    contract(cfg.answer_with === "front" || cfg.answer_with === "back", "config.answer_with");
    for (const k of ["haptics", "sound", "auto_advance", "shuffle", "starred"]) contract(cfg[k] === undefined || typeof cfg[k] === "boolean", `config.${k}`);
    return {...E.DEFAULTS, haptics: false, ...cfg, mode: modeOf(cfg), ...(!sets ? {deck: "all"} : {})};
  }
  function wireConfig(cfg, sets) {
    contract(object(cfg), "request config");
    const out = {...cfg};
    if (cfg.mode !== undefined) {
      contract(Object.keys(E.MODES).includes(cfg.mode), "request config.mode");
      Object.assign(out, {goal: E.MODES[cfg.mode].goal, types: [...E.MODES[cfg.mode].types]});
    }
    delete out.mode;
    // These are UI-only. Do not invent a set model in the private ledger.
    delete out.side; delete out.tutor_mode;
    if (!sets) delete out.deck;
    return out;
  }
  function normalizeView(raw, capabilities) {
    contract(object(raw), "view");
    for (const k of ["total", "due", "daily"]) contract(integer(raw[k]), k);
    counts(raw.counts, "counts");
    contract(Array.isArray(raw.cards), "cards");
    for (const c of raw.cards) {
      contract(object(c) && id(c.id) && typeof c.front === "string", "card identity/front");
      contract(c.back === undefined || typeof c.back === "string", "card.back");
      contract(c.mastery === undefined || E.STATES.includes(c.mastery), "card.mastery");
      contract(c.due === undefined || (typeof c.due === "string" && Number.isFinite(Date.parse(c.due))), "card.due");
      for (const k of ["note", "mnemonic"]) contract(c[k] === undefined || typeof c[k] === "string", `card.${k}`);
      contract(c.starred === undefined || typeof c.starred === "boolean", "card.starred");
      contract(c.aliases === undefined || (object(c.aliases) && ["front", "back"].every(k => c.aliases[k] === undefined || list(c.aliases[k], v => typeof v === "string"))), "card.aliases");
    }
    contract(new Set(raw.cards.map(c => c.id)).size === raw.cards.length, "unique card ids");
    let decks = [];
    if (capabilities.sets) {
      contract(list(raw.decks, d => object(d) && id(d.id) && typeof d.name === "string"), "decks");
      contract(raw.cards.every(c => raw.decks.some(d => d.id === c.deck)), "card.deck");
      decks = raw.decks;
    }
    const features = {sets: capabilities.sets, library: raw.cards.every(c => typeof c.back === "string"),
      cardMastery: raw.cards.every(c => E.STATES.includes(c.mastery)), cardDue: raw.cards.every(c => typeof c.due === "string"),
      cardStars: raw.cards.every(c => typeof c.starred === "boolean")};
    contract(raw.session === null || object(raw.session), "session");
    let session = null;
    if (raw.session) {
      const s = raw.session;
      const sessionConfig = uiConfig(s.config, capabilities.sets);
      contract(id(s.id) && integer(s.revision), "session identity/revision");
      contract(["question", "feedback", "checkpoint", "complete", "ended"].includes(s.status), "session.status");
      for (const k of ["queue", "card_ids", "misses"]) contract(list(s[k], id), `session.${k}`);
      for (const k of ["round", "index", "remaining", "attempts", "correct", "best_streak"]) contract(integer(s[k]), `session.${k}`);
      contract(s.index <= s.queue.length, "session.index");
      counts(s.counts, "session.counts");
      if (s.counts_start !== undefined) counts(s.counts_start, "session.counts_start");
      contract(list(s.round_results, r => object(r) && id(r.card_id) && typeof r.front === "string" && typeof r.correct === "boolean" && E.STATES.includes(r.mastery)), "session.round_results");
      if (["question", "feedback"].includes(s.status)) {
        const q = s.question;
        contract(object(q) && id(q.id) && id(q.card_id) && typeof q.prompt === "string", "question identity/prompt");
        contract(s.queue[s.index] === q.card_id && raw.cards.some(c => c.id === q.card_id), "question queue/card");
        contract(["multiple_choice", "true_false", "flashcard", "written"].includes(q.type), "question.type");
        contract(E.MODES[sessionConfig.mode].types.includes(q.type), "question type for the selected mode");
        contract(typeof q.assisted === "boolean" && typeof q.revealed === "boolean", "question assistance/reveal state");
        if (q.type === "multiple_choice") contract(list(q.options, v => typeof v === "string") && q.options.length === 4 && new Set(q.options).size === 4, "question.options");
        if (q.type === "true_false") contract(typeof q.candidate === "string", "question.candidate");
        if (q.revealed || s.status === "feedback") contract(typeof q.answer === "string" && q.answer.trim().length > 0, "question.answer");
        if (s.status === "feedback") {
          const f = s.feedback;
          contract(object(f) && typeof f.correct === "boolean" && typeof f.dont_know === "boolean" && typeof f.answer === "string" && E.STATES.includes(f.mastery), "feedback");
          if (f.before_mastery !== undefined) contract(E.STATES.includes(f.before_mastery), "feedback.before_mastery");
        }
      }
      session = {...s, config: sessionConfig};
    }
    return {...raw, config: uiConfig(raw.config, capabilities.sets), decks, session, features};
  }
  class HttpAdapter {
    constructor(options) {
      this.kind = "backend"; this.engine = null;
      this.defaults = {...E.DEFAULTS, haptics: false};
      this.capabilities = {plan: options.capabilities?.plan === true, sets: options.capabilities?.sets === true, reset: false};
      this.baseUrl = options.baseUrl || "/api/learn";
      if (typeof this.baseUrl !== "string" || !/^\/(?!\/)[^?#\\\s]*$/.test(this.baseUrl) || this.baseUrl.split("/").some(p => p === "." || p === ".." || /%/i.test(p))) {
        throw new ApiError("Learn API baseUrl must be a same-origin absolute path.", {code: "configuration"});
      }
      this.baseUrl = this.baseUrl.replace(/\/+$/, "");
      this.fetch = options.fetch || window.fetch?.bind(window);
      if (typeof this.fetch !== "function") throw new ApiError("This browser cannot connect to the Learn API.", {code: "configuration"});
      this.timeoutMs = options.timeoutMs ?? 15000;
      contract(Number.isFinite(this.timeoutMs) && this.timeoutMs > 0, "timeoutMs");
      this.headers = {...options.headers};
    }
    async api(path, body, method) {
      const expected = path === "/drill" ? "GET" : ["/drill/start", "/drill/action", "/drill/plan", "/cards"].includes(path) || /^\/cards\/[^/?#]+\/edit$/.test(path) ? "POST" : /^\/cards\/[^/?#]+$/.test(path) ? "DELETE" : null;
      if (!expected) throw new ApiError("That action is only available in the Learn demo or is unknown.", {code: "unsupported"});
      if (new URL("https://learn.invalid" + path).pathname !== path) throw new ApiError("Learn API path must identify a single supported endpoint.", {code: "unsupported"});
      const verb = method || (body == null ? "GET" : "POST");
      if (verb !== expected) throw new ApiError(`Learn ${path} requires ${expected}.`, {code: "method"});
      if (expected === "POST") contract(object(body), "request body");
      if (path === "/drill/plan" && !this.capabilities.plan) return null;
      let payload = body;
      if (body?.config !== undefined) payload = {...body, config: wireConfig(body.config, this.capabilities.sets)};
      if (path === "/cards" && !this.capabilities.sets) { payload = {...body}; delete payload.deck; }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      let response, data;
      try {
        response = await this.fetch(this.baseUrl + path, {method: verb, credentials: "same-origin", cache: "no-store",
          headers: {Accept: "application/json", ...this.headers, ...(verb === "POST" ? {"Content-Type": "application/json"} : {})},
          ...(verb === "POST" ? {body: JSON.stringify(payload)} : {}), signal: controller.signal});
        if (path === "/drill/plan" && [404, 405, 501].includes(response.status)) { this.capabilities.plan = false; return null; }
        const content = await response.text();
        if (content.trim()) {
          try { data = JSON.parse(content); }
          catch { throw new ApiError(response.ok ? "Learn API returned invalid JSON." : `Learn API request failed (${response.status}).`, {status: response.status, code: "json", uncertain: response.ok && verb !== "GET"}); }
        }
        if (!response.ok) {
          const error = data?.error;
          const message = typeof error === "string" ? error : error?.message || data?.message;
          throw new ApiError(typeof message === "string" ? message : `Learn API request failed (${response.status}).`, {status: response.status, code: error?.code || data?.code || "http", uncertain: verb !== "GET" && response.status >= 500});
        }
        if (path === "/drill" || path === "/drill/start" || path === "/drill/action") return normalizeView(data, this.capabilities);
        if (path === "/drill/plan") {
          contract(object(data) && list(data.card_ids, id) && integer(data.total) && integer(data.fresh) && data.total >= data.card_ids.length && data.fresh <= data.card_ids.length, "plan");
          contract(new Set(data.card_ids).size === data.card_ids.length, "plan card ids");
          return data;
        }
        if (path === "/cards") { contract(object(data) && integer(data.added), "cards added count"); return data; }
        return data ?? {ok: true};
      } catch (e) {
        if (e instanceof ApiError) { if (response?.ok && verb !== "GET") e.uncertain = true; throw e; }
        throw new ApiError(controller.signal.aborted ? "Learn API timed out. Refresh to check the saved session before continuing." : "Learn API could not be reached. Refresh to check the saved session before continuing.", {code: controller.signal.aborted ? "timeout" : "network", uncertain: verb !== "GET"});
      } finally { clearTimeout(timer); }
    }
  }
  function create(options = {}) {
    const mode = options.mode || "demo";
    if (mode === "backend") return new HttpAdapter(options);
    if (mode !== "demo") throw new ApiError("Choose demo or backend for the Learn API.", {code: "configuration"});
    const engine = options.engine || new E.Engine(window.LearnDecks);
    return {kind: "demo", engine, defaults: E.DEFAULTS, capabilities: {plan: true, sets: true, reset: true}, api: (path, body, method) => engine.api(path, body, method)};
  }
  window.LearnAPI = {create, ApiError};
})();
