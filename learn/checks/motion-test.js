// Headless spring checks with a manual clock: convergence, overshoot per damping ratio,
// interruption keeping velocity, staggered delays, rubber-band monotonicity, velocity tracking.
const fs = require("fs"), vm = require("vm"), path = require("path");
const LEARN = path.join(__dirname, "..");
let clock = 0; const frames = [];
const ctx = {window: {}, performance: {now: () => clock}, requestAnimationFrame: fn => { frames.push(fn); return frames.length; }, navigator: {}, document: {}, console};
ctx.window.matchMedia = () => ({matches: false});
ctx.window.performance = ctx.performance; ctx.window.requestAnimationFrame = ctx.requestAnimationFrame;
vm.createContext(ctx); vm.runInContext(fs.readFileSync(path.join(LEARN, "motion.js"), "utf8"), ctx, {filename: "motion.js"});
const M = ctx.window.Motion;
const step = (ms = 16.67) => { clock += ms; const fs = frames.splice(0); for (const f of fs) f(clock); };
const assert = (c, m) => { if (!c) { console.error("FAIL", m); process.exitCode = 1; } };

// 1. Standard spring converges from 0 to 100 and settles under ~1s, with a small overshoot (damping .75 < 1)
let s = new M.Spring({preset: "standard", from: 0}); let rested = false; s.onRest = () => { rested = true; };
s.set(100); let maxV = 0; let t = 0;
while (!rested && t < 3000) { step(); t += 16.67; maxV = Math.max(maxV, s.value); }
assert(rested, "standard spring rests");
assert(t < 1200, "standard settles in under 1.2s, took " + t.toFixed(0) + "ms");
assert(maxV > 100 && maxV < 106, "standard overshoots a little: max " + maxV.toFixed(2));
assert(s.value === 100, "snaps exactly to target at rest: " + s.value);

// 2. Snappy spring is faster and overshoots more (damping .6)
s = new M.Spring({preset: "snappy", from: 1}); rested = false; s.onRest = () => { rested = true; };
s.set(.96); let minV = 1; t = 0;
while (!rested && t < 3000) { step(); t += 16.67; minV = Math.min(minV, s.value); }
assert(t < 700, "snappy settles quickly: " + t.toFixed(0) + "ms");
assert(minV < .96 && minV > .95, "snappy overshoots the press target slightly: " + minV.toFixed(4));

// 3. Interruption: retarget mid-flight keeps velocity (no snap); position is continuous
s = new M.Spring({preset: "standard", from: 0}); s.set(100);
for (let i = 0; i < 6; i++) step();
const xBefore = s.value, vBefore = s.velocity;
assert(xBefore > 5 && xBefore < 95, "mid-flight sample " + xBefore.toFixed(1));
s.set(0); // reverse
assert(s.value === xBefore && s.velocity === vBefore, "retarget preserves position and velocity");
step();
assert(s.value > xBefore, "momentum carries past the reversal for a frame: " + s.value.toFixed(2) + " > " + xBefore.toFixed(2));
rested = false; s.onRest = () => { rested = true; }; t = 0; while (!rested && t < 3000) { step(); t += 16.67; }
assert(rested && s.value === 0, "reversed spring rests at the new target");

// 4. Vector springs and delay (stagger)
s = new M.Spring({preset: "standard", from: {y: 14, opacity: 0}}); s.set({y: 0, opacity: 1}, {delay: 90});
step(30); step(30); assert(s.value.y === 14 && s.value.opacity === 0, "holds during the delay");
step(60); step(); assert(s.value.y < 14 && s.value.opacity > 0, "moves after the delay");

// 5. Reduced motion jumps immediately
ctx.window.matchMedia = () => ({matches: true});
vm.runInContext(fs.readFileSync(path.join(LEARN, "motion.js"), "utf8"), ctx, {filename: "motion.js"});
const R = ctx.window.Motion; let rs = new R.Spring({preset: "standard", from: 0}); rs.set(50);
assert(rs.value === 50, "reduced motion lands immediately");
let restFired = false; rs.onRest = () => { restFired = true; }; rs.set(70); assert(restFired && rs.value === 70, "reduced motion still reports rest");

// 6. Rubber band: monotonic, bounded, gentle
const rb = [0, 50, 100, 200, 400, 800].map(d => M.rubberband(d, 700));
assert(rb.every((v, i) => i === 0 || v > rb[i - 1]), "rubberband increases monotonically " + rb.map(v => v.toFixed(0)));
assert(rb[5] < 700 && rb[1] < 50 && rb[1] > 25, "rubberband stays under the limit and resists: " + rb.map(v => v.toFixed(0)));
assert(M.rubberband(-100, 700) < 0, "sign preserved");

// 7. Velocity tracker uses the last 100ms
const tr = M.tracker(); clock = 0; tr.push(0, 0); clock = 50; tr.push(50, 50); clock = 100; tr.push(100, 100);
assert(Math.abs(tr.velocity() - 1000) < 1, "1000 px/s measured: " + tr.velocity());
clock = 400; assert(tr.velocity() === 0, "stale samples ignored");
console.log(process.exitCode ? "MOTION TESTS FAILED" : "motion tests passed");
