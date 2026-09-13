/* Milkplexity Learn · sheet.js
   The elastic bottom sheet. One spring on `y` (the sheet's offset from its
   fully open position) drives every correlated change each frame: the
   sheet's transform, the blur layer's opacity, and the main view's scale
   and corner radius underneath. Dragging writes y directly for zero-lag
   tracking; releasing hands the pointer's velocity to the spring, which
   snaps to the nearest detent. Pulling past the top, or below the floor,
   rubber-bands.

   Detents: full (y = 0), half (about half the viewport), peek (a strip at
   the bottom, used during a round) and closed. The floor is peek while a
   peek height is set, otherwise closed. From half upward the sheet is
   modal: the main view is inert and the scrim covers it. A drag begun
   while the spring is still moving takes over from wherever the sheet is. */
"use strict";
(() => {
  const M = window.Motion;
  const ORDER = ["full", "half", "peek", "closed"];
  class Sheet {
    constructor({el, scrim, main, half = .5, peek = 0, label = "Sheet", onChange}) {
      const q = v => typeof v === "string" ? document.querySelector(v) : v;
      this.el = q(el); this.scrim = q(scrim); this.main = q(main);
      this.halfFraction = half; this.peekHeight = peek;
      this.onChange = onChange || null;
      this.state = "closed"; this.height = 0; this.y = 0; this.detents = {full: 0, half: 0, peek: 0, closed: 0};
      this.returnFocus = null; this.drag = null; this.pending = null; this.modal = false; this.suspended = false;
      this.el.setAttribute("role", "dialog"); this.el.setAttribute("aria-label", label);
      this.el.hidden = true; this.scrim.hidden = true;
      this.spring = new M.Spring({preset: "standard", restDelta: .05, restVelocity: 2, onUpdate: v => this.paint(v.y), onRest: () => this.rested()});
      this.spring.jump({y: 0});
      this.bind();
    }
    get floor() { return this.peekHeight > 0 && !this.suspended ? "peek" : "closed"; }
    get order() { return ORDER.filter(k => (k !== "half" || this.detents.half > 0) && (k !== "peek" || this.floor === "peek") && (k !== "closed" || this.floor === "closed")); }
    measure() {
      const vh = window.innerHeight;
      this.el.style.maxHeight = `${Math.round(vh * .92)}px`;
      const body = this.el.querySelector(".sheet-body"); const kept = body ? body.style.maxHeight : "";
      if (body) body.style.maxHeight = "";
      this.el.style.height = "";
      this.height = this.el.offsetHeight;
      /* Lock the element's height so fitting the body later never shrinks
         the bottom-anchored sheet under its own detents. */
      this.el.style.height = `${this.height}px`;
      if (body) body.style.maxHeight = kept;
      const halfHeight = Math.min(this.height, Math.round(vh * this.halfFraction));
      const peek = Math.min(this.height, this.peekHeight);
      this.detents = {full: 0, half: this.height - halfHeight, peek: this.height - peek, closed: this.height};
      if (this.detents.half < 24) this.detents.half = 0;
      if (this.detents.half > 0 && this.detents.peek - this.detents.half < 40) this.detents.half = 0;
    }
    /* Everything under the sheet is a function of its live y. */
    paint(y) {
      this.y = y;
      const floorY = this.detents[this.floor] || this.height || 1;
      const halfY = this.detents.half > 0 ? this.detents.half : 0;
      const span = Math.max(1, floorY - halfY);
      const progress = this.el.hidden || !this.height ? 0 : Math.max(0, Math.min(1, (floorY - y) / span));
      this.el.style.transform = `translate3d(0, ${y.toFixed(2)}px, 0)`;
      this.scrim.style.opacity = progress.toFixed(3);
      if (this.main) {
        const scale = 1 - .045 * progress, radius = 20 * progress;
        this.main.style.transform = progress > .001 ? `translate3d(0, ${(8 * progress).toFixed(2)}px, 0) scale(${scale.toFixed(4)})` : "";
        this.main.style.borderRadius = progress > .001 ? `${radius.toFixed(1)}px` : "";
      }
    }
    rested() {
      if (this.state === "closed") { this.el.hidden = true; this.scrim.hidden = true; this.el.dataset.state = "closed"; }
      if (this.state === "peek") this.el.dataset.state = "peek";
      if (!this.modal) this.scrim.hidden = true;
    }
    setModal(on) {
      if (on === this.modal) return;
      this.modal = on;
      if (on) {
        this.returnFocus = document.activeElement;
        this.scrim.hidden = false;
        if (this.main) this.main.inert = true;
        this.el.setAttribute("aria-modal", "true");
        document.documentElement.classList.add("sheet-open");
        requestAnimationFrame(() => { const first = this.el.querySelector("[data-sheet-focus]") || this.el.querySelector("button, [href], input, textarea, select"); (first || this.el).focus({preventScroll: true}); });
      } else {
        if (this.main) { this.main.inert = false; }
        this.el.removeAttribute("aria-modal");
        document.documentElement.classList.remove("sheet-open");
        if (this.returnFocus && this.returnFocus.isConnected && this.el.contains(document.activeElement)) this.returnFocus.focus({preventScroll: true});
        this.returnFocus = null;
      }
    }
    /* Move to a detent. Hidden -> visible transitions start from the closed edge. */
    to(detent, {velocity, immediate = false} = {}) {
      const hidden = this.el.hidden;
      if (hidden) { this.el.hidden = false; this.scrim.hidden = false; this.measure(); this.spring.jump({y: this.detents.closed}); }
      else this.measure();
      if (detent === "half" && this.detents.half === 0) detent = "full";
      if (detent === "peek" && this.floor !== "peek") detent = "closed";
      if (detent === "closed" && this.floor === "peek") detent = "peek";
      const changed = detent !== this.state;
      this.state = detent;
      this.el.dataset.state = detent === "closed" ? "closing" : detent;
      this.setModal(detent === "half" || detent === "full");
      if (detent === "half" || detent === "full") this.scrim.hidden = false;
      this.fitBody(detent);
      this.spring.set({y: this.detents[detent]}, {velocity: velocity !== undefined ? {y: velocity} : undefined, immediate});
      if (immediate || M.reduced()) this.rested();
      if (changed && this.onChange) this.onChange(detent);
      return this;
    }
    /* The body scrolls within the part of the sheet that is on screen at
       this detent, so nothing sits unreachably below the fold at half. */
    fitBody(detent) {
      const body = this.el.querySelector(".sheet-body"); if (!body) return;
      if (detent === "peek" || detent === "closed") { body.style.maxHeight = ""; return; }
      const head = body.offsetTop;
      body.style.maxHeight = `${Math.max(120, this.height - this.detents[detent] - head - 8)}px`;
    }
    open(detent = "half") { return this.to(detent); }
    close(velocity) { return this.to(this.floor, {velocity}); }
    /* Peek strip on or off (a round shows one; Home does not). */
    setPeek(px) {
      this.peekHeight = px;
      if (px > 0 && (this.state === "closed")) this.to("peek");
      else if (px === 0 && this.state === "peek") this.to("closed");
      else if (this.state !== "closed") { this.measure(); this.spring.set({y: this.detents[this.state]}); }
    }
    /* Drop out of the way (the software keyboard) and come back afterwards. */
    suspend() { if (this.suspended) return; this.suspended = true; if (this.state === "peek") { this.state = "closed"; this.el.dataset.state = "closing"; this.measure(); this.spring.set({y: this.detents.closed}); } }
    resume() { if (!this.suspended) return; this.suspended = false; if (this.peekHeight > 0 && this.state === "closed") this.to("peek"); }
    refresh() { if (this.state !== "closed") { this.measure(); this.spring.set({y: this.detents[this.state]}); } }
    toggle() { return this.modal ? this.close() : this.open(); }

    /* Drag zone: the whole sheet at peek or half; only the handle and header
       at full, so the body can scroll natively once expanded. */
    canDrag(target) {
      if (this.state !== "full") return true;
      return Boolean(target.closest("[data-sheet-handle], [data-sheet-header]"));
    }
    bind() {
      const el = this.el;
      el.addEventListener("pointerdown", e => {
        if (e.button !== 0 || this.state === "closed" || !this.canDrag(e.target)) return;
        if (e.target.closest("button, a, input, textarea, select, [role=radio]") && !e.target.closest("[data-sheet-handle]")) { this.pending = {id: e.pointerId, y: e.clientY, x: e.clientX}; return; }
        this.begin(e);
      });
      el.addEventListener("pointermove", e => {
        if (this.pending && e.pointerId === this.pending.id && !this.drag) {
          const dy = e.clientY - this.pending.y, dx = e.clientX - this.pending.x;
          if (Math.abs(dy) > 8 && Math.abs(dy) > Math.abs(dx)) { this.begin(e, this.pending.y); this.pending = null; }
          return;
        }
        if (!this.drag || e.pointerId !== this.drag.id) return;
        const raw = this.drag.startY + (e.clientY - this.drag.pointerY);
        const floorY = this.detents[this.floor];
        let y = raw;
        if (raw < 0) y = M.rubberband(raw, this.height);
        else if (raw > floorY) y = floorY + M.rubberband(raw - floorY, this.height, .3);
        this.drag.tracker.push(e.clientY);
        this.spring.jump({y});
        const p = this.detents.half > 0 ? this.detents.half : 0;
        this.setModal(y < (this.detents[this.floor] + p) / 2);
      });
      const end = e => {
        if (this.pending && e.pointerId === this.pending.id) this.pending = null;
        if (!this.drag || e.pointerId !== this.drag.id) return;
        const velocity = this.drag.tracker.velocity();
        const moved = Math.abs(this.y - this.drag.startY) > 2;
        const onHandle = this.drag.onHandle;
        try { el.releasePointerCapture(this.drag.id); } catch {}
        this.drag = null; el.classList.remove("dragging");
        if (!moved && Math.abs(velocity) < 50) {
          /* A tap on the grabber or the strip steps the sheet up one detent;
             pointer capture means the click itself lands on the sheet, so it
             is handled here rather than in a click listener. */
          if (onHandle) this.to(this.state === "peek" ? "half" : this.state === "half" ? "full" : "half");
          else this.to(this.state);
          return;
        }
        this.release(velocity);
      };
      el.addEventListener("pointerup", end); el.addEventListener("pointercancel", end);
      this.scrim.addEventListener("click", () => this.close());
      el.addEventListener("keydown", e => { if (e.key === "Escape" && this.modal) { e.preventDefault(); this.close(); } });
      el.addEventListener("click", e => {
        if (e.target.closest("[data-sheet-close]")) this.close();
        else if (e.target.closest("[data-sheet-expand]")) this.to(this.state === "full" ? "half" : "full");
      });
      window.addEventListener("resize", () => this.refresh());
    }
    begin(e, pointerY = e.clientY) {
      this.spring.stop();
      this.drag = {id: e.pointerId, pointerY, startY: this.y, tracker: M.tracker(), onHandle: Boolean(e.target.closest("[data-sheet-handle], [data-sheet-header]")) && !e.target.closest("button")};
      this.drag.tracker.push(pointerY);
      try { this.el.setPointerCapture(e.pointerId); } catch {}
      this.el.classList.add("dragging");
    }
    /* Project the release velocity a little way ahead, snap to the nearest
       detent, and let a fast flick decide direction on its own. */
    release(velocity) {
      const order = this.order;
      const projected = this.y + velocity * .12;
      let target;
      if (Math.abs(velocity) > 900) {
        const current = order.reduce((best, k) => Math.abs(this.detents[k] - this.y) < Math.abs(this.detents[best] - this.y) ? k : best, order[0]);
        const i = order.indexOf(current);
        const dir = velocity > 0 ? 1 : -1;
        let j = i + dir;
        if (dir > 0 && this.y > this.detents[current]) j = i + 1; else if (dir < 0 && this.y < this.detents[current]) j = i - 1;
        target = order[Math.max(0, Math.min(order.length - 1, j))];
      } else target = order.reduce((best, k) => Math.abs(this.detents[k] - projected) < Math.abs(this.detents[best] - projected) ? k : best, order[0]);
      this.to(target, {velocity});
    }
  }
  window.Sheet = Sheet;
})();
