# Milkplexity Learn, redesigned

A working prototype of the Learn study loop rebuilt as a fluid, surface-based
interface: short rounds that start easy, spring physics with no fixed
durations, and typing only in the Hard test. It runs on its own from this
folder (open `learn/index.html` on the published site); cards and progress
stay in the browser's local storage. In the app, the same loop runs against
the private ledger.

## What it does

- **Three modes on one pill.** Easy asks you to choose (four options from the
  set; true or false when a set is tiny). Recall asks you to think, reveal and
  rate yourself. Hard test asks you to type, and only an unaided typed answer
  on a Familiar card reaches Mastered, so a new card needs two typed wins,
  exactly as the app's `drill.py` decides.
- **Rounds you can see.** The Up-next row on Home shows the cards of the next
  round. Start morphs the first bubble onto the round's stage; every answered
  card flies back to its slot in the queue wearing its result. The queue is the
  progress bar.
- **Misses rebuilt, not retyped.** After a miss you rebuild the reference
  answer from shuffled tiles. The joined text is what the engine's exact
  retype rule receives, so Easy and Recall never need a keyboard.
- **A Progress sheet** that peeks during a round, drags to half and full, rubber
  bands past its limits, and scales and blurs the round beneath it. Options
  live at the full detent.
- **A tutor preview** that shows the card context the app would send, the
  exact prompt, and chip replies built only from the card's own text.

Type is Outfit for headings and numerals and Plus Jakarta Sans for everything else,
loaded from Google Fonts with a system fallback stack. That is a deliberate
change from the app's system-font rule, made at Ian's request; the tokens are
`--display` and `--sans` in `learn.css`. Bubbles carry a card's number in the
round with its name beneath, never initials.

Motion tokens follow the brief: standard spring (response .35 s, damping .75)
for layout and flights; snappy (.2 s, .6) for presses, badges and the pill;
30 ms staggered entry; press scale .96 with a light haptic where supported.
Reduced motion lands every spring immediately and keeps every state visible.

## Files

| File | Role |
| --- | --- |
| `index.html` | Page shell, tab bar, sheet and toast mount points |
| `learn.css` | Milkplexity tokens (dark and paper) and every surface |
| `motion.js` | Spring engine, `animate`, `stagger`, `pressable`, `morph`, `shift`, `rubberband`, `tracker` |
| `sheet.js` | The elastic sheet: peek, half and full detents, floor, keyboard suspend |
| `segmented.js` | The sliding pill (radiogroup, arrow keys) |
| `engine.js` | In-browser mirror of `learn/drill.py`: states, rounds, grading, misses, receipts, scheduler |
| `decks.js` | Sample sets for the prototype |
| `app.js` | Screens, router, choreography, the tutor preview |
| `checks/` | Headless checks: `motion-test.js`, `engine-test.js`, `flow.js` (Chromium, needs Playwright) |

Run the checks from the repository root:

```sh
node learn/checks/motion-test.js
node learn/checks/engine-test.js
NODE_PATH=$(npm root -g) node learn/checks/flow.js            # motion on
NODE_PATH=$(npm root -g) node learn/checks/flow.js --reduced  # prefers-reduced-motion
```

The flow check drives a full Easy round with a miss and the rebuild tray, a
Recall round, the Hard test with an override, the tutor, the sheet gestures
(drag to full, rubber band, flick to peek), an interrupted morph, the library,
card detail, adding cards, both themes, contrast in paper, and the 1440 rail.
Screenshots land in `.checks/learn/`.

## Wiring it to the app

`app.js` talks to the engine through one function, `api(path, body, method)`,
using the same paths the app serves under `/api/learn`: `GET /drill`,
`POST /drill/start`, `POST /drill/action`, `POST /cards`,
`POST /cards/{id}/edit`, `DELETE /cards/{id}`. Point it at `fetch` and the
screens stay the same. Every action carries `session_id`, `revision`,
`question_id` and a fresh `request_id`, and the engine keeps receipts the way
`drill.py` does.

The prototype reads a few things `drill.py` does not return today. Before
wiring, the lab needs one of these for each, or the adapter hides the feature:

- `POST /drill/plan`: the next round's cards in order, persisted until
  `start` (reference: `Engine.plan` and `Engine.select` in `engine.js`).
  Without it, Home shows a due count and Start morphs from the button.
- `config.mode` (`easy`, `recall`, `hard`) or the derived `goal` and `types`
  from `MODES` in `engine.js`; all three presets pass `drill.py`'s `config()`.
- Per-card `mastery`, `due`, `back` and a set key in `view().cards`, for the
  bubbles, the library and the Studying chips. `drill.py` has no sets; hide
  the chips unless one is added.
- `feedback.before_mastery` and `session.counts_start` for the
  "New → Seen" chips and the "Since you started" line.
- Haptics default on here and off in `drill.py`'s `DEFAULTS`; pick one.
- The tutor: replace the preview with the existing conversation API in
  `ui/static/learn-drill.js`. The `tutor` action is already sent on open, so
  asking before answering marks the question as practice, as it does today.

Assets: the page uses the public site's `../assets/favicon.png`; in the app use
`/static/brand/learn-app.png`.
