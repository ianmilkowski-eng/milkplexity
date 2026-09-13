/* Milkplexity Learn · segmented.js
   The interactive pill. A capsule "thumb" slides under the chosen option on
   a spring while the option labels cross-fade their color at once. Arrow
   keys move the selection; the group is a radiogroup for assistive tech. */
"use strict";
(() => {
  const M = window.Motion;
  class Pill {
    constructor({el, options, value, onChange, label = "Mode"}) {
      this.el = typeof el === "string" ? document.querySelector(el) : el;
      this.options = options; this.value = value ?? options[0].value; this.onChange = onChange || null;
      this.el.classList.add("pill");
      this.el.setAttribute("role", "radiogroup"); this.el.setAttribute("aria-label", label);
      this.el.innerHTML = `<span class="pill-thumb" aria-hidden="true"></span>` + options.map(o =>
        `<button type="button" class="pill-option" role="radio" data-value="${o.value}" aria-checked="${o.value === this.value}" tabindex="${o.value === this.value ? 0 : -1}" ${o.hint ? `title="${o.hint}"` : ""}><span>${o.label}</span></button>`).join("");
      this.thumb = this.el.querySelector(".pill-thumb");
      this.buttons = [...this.el.querySelectorAll(".pill-option")];
      this.el.addEventListener("click", e => { const b = e.target.closest(".pill-option"); if (b) this.select(b.dataset.value); });
      this.el.addEventListener("keydown", e => {
        const i = this.options.findIndex(o => o.value === this.value);
        let next = null;
        if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (i + 1) % this.options.length;
        if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (i - 1 + this.options.length) % this.options.length;
        if (e.key === "Home") next = 0; if (e.key === "End") next = this.options.length - 1;
        if (next === null) return;
        e.preventDefault(); this.select(this.options[next].value); this.buttons[next].focus();
      });
      /* A pill rendered inside a hidden sheet has no size yet; observe it so
         the thumb lands the moment it becomes visible, and on every resize. */
      if (window.ResizeObserver) { this.observer = new ResizeObserver(() => this.place(true)); this.observer.observe(this.el); }
      else window.addEventListener("resize", () => this.place(true));
      requestAnimationFrame(() => this.place(true));
    }
    place(immediate = false) {
      const b = this.buttons.find(x => x.dataset.value === this.value);
      if (!b || !this.el.offsetWidth) return;
      const x = b.offsetLeft, width = b.offsetWidth;
      M.animate(this.thumb, {x, width}, {preset: "standard", immediate, from: {x, width}});
    }
    select(value, {silent = false} = {}) {
      if (!this.options.some(o => o.value === value)) return;
      const changed = value !== this.value;
      this.value = value;
      for (const b of this.buttons) { const on = b.dataset.value === value; b.setAttribute("aria-checked", String(on)); b.tabIndex = on ? 0 : -1; }
      this.place();
      if (changed) M.haptic(6);
      if (changed && !silent && this.onChange) this.onChange(value);
    }
  }
  window.Pill = Pill;
})();
