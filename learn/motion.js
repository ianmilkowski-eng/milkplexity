/* Milkplexity Learn · motion.js
   State-driven spring physics for the whole surface.

   Nothing here has a duration. Every animated value is a spring that can be
   retargeted at any moment, so a tap that lands mid-flight simply changes
   where the spring is heading; velocity carries over and nothing snaps.

   Tokens (from the brief):
     standard  response .35 s, damping ratio .75   UI shifts, card expansions
     snappy    response .20 s, damping ratio .60   presses, active states
   A "response" is the spring's natural period; the damping ratio decides how
   much it overshoots (< 1 overshoots a little, 1 settles without overshoot).

   Flow: [gesture or tap] -> [state mutation] -> [Spring retarget]
         -> [one rAF write per frame: transform, opacity, radius, blur]. */
"use strict";
(() => {
  const SPRINGS = {
    standard: {response: .35, dampingRatio: .75},
    snappy:   {response: .2,  dampingRatio: .6},
    settle:   {response: .45, dampingRatio: .9},
  };
  const DEFAULTS = {x: 0, y: 0, scale: 1, scaleX: 1, scaleY: 1, opacity: 1, rotate: 0, rotateY: 0, blur: 0};
  /* Rest thresholds in each property's own units: [displacement, velocity per second]. */
  const REST = {x: [.05, 1], y: [.05, 1], width: [.1, 1], height: [.1, 1], radius: [.1, 1], rotate: [.05, .5], rotateY: [.05, .5], blur: [.05, .5],
    scale: [.001, .01], scaleX: [.001, .01], scaleY: [.001, .01], opacity: [.002, .02], value: [.01, .05]};
  const query = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  const reduced = () => Boolean(query && query.matches);
  const settings = {haptics: true};

  /* One requestAnimationFrame loop drives every live spring, and every
     DOM write happens after every spring has stepped, so a frame is
     always internally consistent. */
  const live = new Set();
  let frame = 0, last = 0;
  function tick(now) {
    frame = 0;
    const dt = Math.min(.064, Math.max(0, (now - last) / 1000));
    last = now;
    for (const s of live) s._step(dt, now);
    for (const s of [...live]) s._emit();
    for (const s of resting.splice(0)) s._emit();
    if (live.size && !frame) frame = requestAnimationFrame(tick);
  }
  const resting = [];
  function wake(s) { live.add(s); if (!frame) { last = performance.now(); frame = requestAnimationFrame(tick); } }

  class Spring {
    constructor(opts = {}) {
      const p = SPRINGS[opts.preset] || opts;
      this.response = p.response ?? SPRINGS.standard.response;
      this.dampingRatio = p.dampingRatio ?? SPRINGS.standard.dampingRatio;
      this.restDelta = opts.restDelta ?? null;
      this.restVelocity = opts.restVelocity ?? null;
      this.onUpdate = opts.onUpdate || null;
      this.onRest = opts.onRest || null;
      this.x = {}; this.v = {}; this.t = {};
      this.delayUntil = 0; this.active = false; this.dirty = false; this.rested = false;
      if (opts.from !== undefined) this.jump(opts.from);
    }
    static wrap(value) { return typeof value === "number" ? {value} : (value || {}); }
    get value() { const keys = Object.keys(this.x); return keys.length === 1 && keys[0] === "value" ? this.x.value : {...this.x}; }
    get velocity() { const keys = Object.keys(this.v); return keys.length === 1 && keys[0] === "value" ? this.v.value : {...this.v}; }
    get target() { const keys = Object.keys(this.t); return keys.length === 1 && keys[0] === "value" ? this.t.value : {...this.t}; }
    use(preset) { const p = SPRINGS[preset] || preset; if (p) { this.response = p.response; this.dampingRatio = p.dampingRatio; } return this; }
    /* Land on a value now. Used for reduced motion and for initial states. */
    jump(value) {
      const t = Spring.wrap(value);
      for (const k in t) { this.x[k] = t[k]; this.v[k] = 0; this.t[k] = t[k]; }
      this._stop(); this.dirty = true; this._emit(); return this;
    }
    /* Retarget. Keeps the current position and velocity, so calling this
       mid-flight is the interruption story: no reset, no glitch. */
    set(value, {velocity, delay = 0, immediate = false} = {}) {
      const t = Spring.wrap(value);
      if (immediate || reduced()) {
        /* Land now, but still report the rest: callers rely on it to remove
           faded screens, hide toasts and finish flights. */
        for (const k in t) { this.x[k] = t[k]; this.v[k] = 0; this.t[k] = t[k]; }
        this._stop(); this.dirty = true; this.rested = true; this._emit(); return this;
      }
      for (const k in t) { if (!(k in this.x)) { this.x[k] = t[k]; this.v[k] = 0; } this.t[k] = t[k]; }
      if (velocity !== undefined) { const vel = Spring.wrap(velocity); for (const k in vel) this.v[k] = vel[k]; }
      this.delayUntil = delay > 0 ? performance.now() + delay : 0;
      this.active = true; wake(this); return this;
    }
    _step(dt, now) {
      if (this.delayUntil && now < this.delayUntil) return;
      this.delayUntil = 0;
      const w = 2 * Math.PI / this.response, k = w * w, c = 2 * this.dampingRatio * w;
      const n = Math.max(1, Math.ceil(dt * 240)), h = dt / n;
      let rest = true;
      for (const key in this.t) {
        let x = this.x[key], v = this.v[key];
        const target = this.t[key];
        for (let i = 0; i < n; i++) { v += (-k * (x - target) - c * v) * h; x += v * h; }
        this.x[key] = x; this.v[key] = v;
        const bounds = REST[key] || REST.value;
        if (Math.abs(x - target) > (this.restDelta ?? bounds[0]) || Math.abs(v) > (this.restVelocity ?? bounds[1])) rest = false;
      }
      this.dirty = true;
      if (rest) { for (const key in this.t) { this.x[key] = this.t[key]; this.v[key] = 0; } this._stop(); this.rested = true; resting.push(this); }
    }
    _emit() {
      if (!this.dirty) return;
      this.dirty = false;
      if (this.onUpdate) this.onUpdate(this.value, this);
      if (this.rested) { this.rested = false; if (this.onRest) this.onRest(this.value, this); }
    }
    _stop() { this.active = false; live.delete(this); }
    stop() { this._stop(); return this; }
  }

  /* ---- element animation ------------------------------------------------
     animate(el, {x, y, scale, opacity, radius, blur, height}, {preset, from,
     delay, velocity, onRest}) keeps one spring per element, so successive
     calls retarget the same physical object. `from` only applies to keys the
     element has never animated: an interrupted element never snaps back. */
  const states = new WeakMap();
  function stateOf(el) { let s = states.get(el); if (!s) { s = {spring: null, props: {}, onRest: null}; states.set(el, s); } return s; }
  function write(el, p) {
    const parts = [];
    if (p.x !== undefined || p.y !== undefined) parts.push(`translate3d(${round(p.x || 0)}px, ${round(p.y || 0)}px, 0)`);
    if (p.scale !== undefined) parts.push(`scale(${round(p.scale, 4)})`);
    if (p.scaleX !== undefined || p.scaleY !== undefined) parts.push(`scale(${round(p.scaleX ?? 1, 4)}, ${round(p.scaleY ?? 1, 4)})`);
    if (p.rotate !== undefined) parts.push(`rotate(${round(p.rotate)}deg)`);
    if (p.rotateY !== undefined) parts.push(`rotateY(${round(p.rotateY)}deg)`);
    el.style.transform = parts.join(" ");
    if (p.opacity !== undefined) el.style.opacity = clamp(p.opacity, 0, 1);
    if (p.radius !== undefined) el.style.borderRadius = `${Math.max(0, p.radius)}px`;
    if (p.height !== undefined) el.style.height = `${Math.max(0, p.height)}px`;
    if (p.width !== undefined) el.style.width = `${Math.max(0, p.width)}px`;
    if (p.blur !== undefined) el.style.filter = p.blur > .05 ? `blur(${round(p.blur)}px)` : "";
  }
  const round = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  function animate(el, to, opts = {}) {
    const st = stateOf(el);
    if (!st.spring) {
      st.spring = new Spring({preset: opts.preset || "standard", restDelta: opts.restDelta, restVelocity: opts.restVelocity,
        onUpdate: v => { Object.assign(st.props, v); write(el, st.props); },
        onRest: () => { if (st.onRest) st.onRest(el); }});
      const init = {};
      for (const k in to) init[k] = opts.from?.[k] ?? DEFAULTS[k] ?? to[k];
      st.spring.jump(init);
    } else {
      if (opts.preset) st.spring.use(opts.preset);
      /* A key this element has not animated yet starts from its resting
         default (or `from`); a key already in flight is left alone. */
      for (const k in to) if (!(k in st.spring.x)) { const start = opts.from?.[k] ?? DEFAULTS[k] ?? to[k]; st.spring.x[k] = start; st.spring.v[k] = 0; st.spring.t[k] = start; }
    }
    st.onRest = opts.onRest || null;
    st.spring.set(to, {velocity: opts.velocity, delay: opts.delay, immediate: opts.immediate});
    return st.spring;
  }
  function springOf(el) { return states.get(el)?.spring || null; }
  /* FLIP: after a DOM move, add the layout delta to the element's current
     position and spring it back to zero. Works mid-flight: the delta is added
     to wherever the element is, velocity untouched. */
  function shift(el, delta, opts = {}) {
    const st = stateOf(el);
    if (!st.spring) return animate(el, {x: 0, y: 0}, {from: {x: delta.x || 0, y: delta.y || 0}, preset: opts.preset || "standard", onRest: opts.onRest});
    for (const k of ["x", "y"]) { if (!(k in st.spring.x)) { st.spring.x[k] = 0; st.spring.v[k] = 0; st.spring.t[k] = 0; } st.spring.x[k] += delta[k] || 0; }
    if (opts.preset) st.spring.use(opts.preset);
    st.onRest = opts.onRest || null;
    st.spring.set({x: 0, y: 0});
    return st.spring;
  }
  function settle(el) { const st = states.get(el); if (!st) return; st.spring.stop(); el.style.transform = ""; el.style.opacity = ""; el.style.filter = ""; states.delete(el); }

  /* Staggered entry: each item fades and rises in turn, 30 ms apart. */
  function stagger(elements, {from = {y: 14, opacity: 0}, to = {y: 0, opacity: 1}, delay = 30, start = 0, preset = "standard", onRest} = {}) {
    const list = [...elements];
    list.forEach((el, i) => animate(el, to, {from, preset, delay: start + i * delay, onRest: i === list.length - 1 ? onRest : null}));
    return list;
  }

  /* Pressable: scale to .96 on touch with a light haptic tap; release
     springs back. One pointer at a time per element; an AbortController
     removes every listener the press attached. */
  function haptic(ms = 8) { if (settings.haptics && navigator.vibrate) { try { navigator.vibrate(ms); } catch {} } }
  function pressable(root, selector) {
    root.addEventListener("pointerdown", e => {
      if (e.button !== undefined && e.button !== 0) return;
      const el = e.target.closest(selector);
      if (!el || el.disabled || el.getAttribute("aria-disabled") === "true" || el.dataset.pressing) return;
      el.dataset.pressing = "1";
      const scale = Number(el.dataset.pressScale || .96);
      haptic(8);
      animate(el, {scale}, {preset: "snappy"});
      const ctl = new AbortController();
      const release = () => { delete el.dataset.pressing; ctl.abort(); animate(el, {scale: 1}, {preset: "snappy"}); };
      for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) window.addEventListener(type, release, {signal: ctl.signal});
      el.addEventListener("pointerleave", release, {signal: ctl.signal});
    }, {passive: true});
  }

  /* Shared-element morph. A fixed ghost (any element the caller builds,
     usually a clone of the destination) is sprung from one rect to another
     with translate + uniform scale, so a circle stays a circle and text
     scales with it. `hide` elements vanish for the flight; `reveal`
     elements appear when it lands. reverse() retargets the ghost back to
     the source mid-flight: that is the tap-then-swipe-away case. */
  function morph({ghost, from, to, hide = [], reveal = [], preset = "standard", onRest, onReverse}) {
    const rectOf = r => (r && typeof r.getBoundingClientRect === "function") ? r.getBoundingClientRect() : r;
    const a = rectOf(from), b = rectOf(to);
    const show = list => list.forEach(el => { if (el) el.style.visibility = ""; });
    const m = {ghost, done: false, reversed: false, reverse() {}, cancel() {}};
    if (reduced() || !a || !b || !a.width || !b.width) { show(reveal); m.done = true; if (onRest) onRest(); return m; }
    Object.assign(ghost.style, {position: "fixed", left: `${a.left}px`, top: `${a.top}px`, margin: "0", transformOrigin: "0 0",
      zIndex: "80", pointerEvents: "none", willChange: "transform"});
    document.body.append(ghost);
    const w = ghost.offsetWidth || a.width;
    const s0 = a.width / w, s1 = b.width / w;
    hide.forEach(el => { if (el) el.style.visibility = "hidden"; });
    reveal.forEach(el => { if (el) el.style.visibility = "hidden"; });
    const finish = () => {
      if (m.done) return;
      m.done = true; ghost.remove();
      if (!m.reversed) { show(reveal); if (onRest) onRest(); }
      else { show(hide); if (onReverse) onReverse(); }
    };
    animate(ghost, {x: b.left - a.left, y: b.top - a.top, scale: s1}, {from: {x: 0, y: 0, scale: s0}, preset, onRest: finish});
    m.reverse = () => { if (m.done) return; m.reversed = true; animate(ghost, {x: 0, y: 0, scale: s0}, {preset, onRest: finish}); };
    m.cancel = () => { if (m.done) return; m.done = true; ghost.remove(); show(hide); show(reveal); };
    return m;
  }

  /* Gesture helpers for the sheet. */
  function rubberband(offset, limit, c = .55) {
    if (limit <= 0) return 0;
    const sign = Math.sign(offset), d = Math.abs(offset);
    return sign * (1 - 1 / ((d * c) / limit + 1)) * limit;
  }
  function tracker() {
    const samples = [];
    return {
      push(v, t = performance.now()) { samples.push({v, t}); while (samples.length > 8) samples.shift(); },
      velocity() {
        const now = performance.now();
        const recent = samples.filter(s => now - s.t <= 100);
        if (recent.length < 2) return 0;
        const a = recent[0], b = recent[recent.length - 1], dt = (b.t - a.t) / 1000;
        return dt > 0 ? (b.v - a.v) / dt : 0;
      },
      reset() { samples.length = 0; },
    };
  }

  window.Motion = {Spring, SPRINGS, animate, springOf, shift, settle, stagger, pressable, haptic, morph, rubberband, tracker, reduced, settings};
})();
