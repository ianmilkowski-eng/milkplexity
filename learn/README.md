# Milkplexity Learn, redesigned

A working prototype of the Learn study loop rebuilt as a fluid, surface-based
interface: short rounds that start easy, spring physics with no fixed
durations, and typing only in the Hard test. It runs on its own from this
folder (open `learn/index.html` on the published site); demo cards and progress
stay in the browser's local storage. A switchable adapter also supports the
documented `/api/learn` interface. The private application's current backend
and SQLite ledger have not been inspected, connected or deployed by this work.

## What it does

- **Three modes on one pill.** Easy asks you to choose (four options from the
  set; true or false when a set is tiny). Recall asks you to think, reveal and
  rate yourself. Hard test asks you to type, and only an unaided typed answer
  on a Familiar card reaches Mastered, so a new card needs two typed wins.
  These are the local engine's rules; preserving them in the private backend
  is an integration acceptance requirement.
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
| `engine.js` | In-browser implementation of the documented study rules: states, rounds, grading, misses, receipts, scheduler |
| `api.js` | Demo/backend adapters, configuration translation, response validation and optional capabilities |
| `decks.js` | Sample sets for the prototype |
| `app.js` | Screens, router, choreography, the tutor preview |
| `checks/` | Engine, motion and adapter contract checks; demo and mock-backend browser flows (Chromium, needs Playwright) |

Run the checks from the repository root:

```sh
node learn/checks/motion-test.js
node learn/checks/engine-test.js
node learn/checks/api-test.js
NODE_PATH=$(npm root -g) node learn/checks/flow.js            # motion on
NODE_PATH=$(npm root -g) node learn/checks/flow.js --reduced  # prefers-reduced-motion
NODE_PATH=$(npm root -g) node learn/checks/backend-flow.js   # mocked /api/learn
```

The flow check drives a full Easy round with a miss and the rebuild tray, a
Recall round, the Hard test with an override, the tutor, the sheet gestures
(drag to full, rubber band, flick to peek), an interrupted morph, the library,
card detail, adding cards, both themes, contrast in paper, and the 1440 rail.
Screenshots land in `.checks/learn/`.

The adapter tests and backend browser flow use mocks. Passing those checks
demonstrates that the public prototype follows its declared contract against
those fixtures; it does not verify compatibility with the private application.
Browser checks need Playwright and a Chromium installation. Run the commands
above in the environment where those dependencies are available.
If Playwright's bundled browser is unavailable, set `CHROMIUM` to an installed
Chrome/Chromium executable. `NODE_PATH` can also point to the package location
when Playwright is installed outside the global npm directory.

## Choosing the adapter

`app.js` uses `LearnAPI.create()` through its central
`api(path, body, method)` function. The default is `demo`: it creates the
existing `LearnEngine`, seeds sample sets as before and uses the original demo
storage keys. No server is needed.

To select the backend adapter, define `window.LEARN_API` before loading
`app.js`:

```html
<script>
  window.LEARN_API = {
    mode: "backend",
    baseUrl: "/api/learn",
    capabilities: {plan: false, sets: false},
    // headers: {"X-CSRF-Token": "the host application's token"},
  };
</script>
```

The base URL must be a same-origin absolute path. Serve the prototype from
the application's origin and use the host's existing authentication and CSRF
requirements. Configure any required headers through `headers`; do not put
credentials in the public repository. The adapter does not invent an
authentication endpoint or copy browser demo progress into the ledger.

For the default `/api/learn` path, `?api=backend` selects the backend adapter;
`?api=demo` explicitly selects the standalone demo. Backend mode does not
construct or seed the local engine, and a server error never switches to
demo. Backend display preferences use a separate browser storage key.
Backend haptics default off unless server configuration explicitly enables
them or a saved backend preference overrides them; demo haptics retain their
existing default.

## Declared backend contract

The following paths are relative to `baseUrl`. They are the prototype's
documented expectations, not observations of the current private server.

| Request | Expected result |
| --- | --- |
| `GET /drill` | Complete view, with a saved session or `session: null` |
| `POST /drill/start` with `{config}` | Complete view of the started or resumed session |
| `POST /drill/action` | Complete view after a successful study action; an error for a rejected action |
| `POST /cards` with `{tsv}` and optional `deck` when sets are enabled | `{added: number}` |
| `POST /cards/{id}/edit` | Successful response; the UI then refreshes `/drill` |
| `DELETE /cards/{id}` | Successful response; the UI then refreshes `/drill` |
| `POST /drill/plan` with `{config}` | Optional `{card_ids, total, fresh}`, enabled by `capabilities.plan` |

Study actions carry `session_id`, `revision`, a fresh `request_id`, and
`question_id` when there is a current question. The adapter forwards the
action payload, including `answer`, `dont_know`, `correction`, draft `text`
or checkpoint `config`, without grading or applying mastery locally.
The supported action names are `answer`, `continue`, `override`, `reveal`,
`next_round`, `end`, `review_misses`, `settings`, `draft` and `tutor`.
Transport failures and invalid essential response fields surface as errors.
Requests time out after 15 seconds by default (`timeoutMs` is configurable).
The adapter never retries mutations automatically. A stale revision (`409`)
or uncertain study write triggers an authoritative `/drill` refresh. If a
card write may have committed, the UI refreshes the library before another
attempt; if that read fails, creation stays disabled across navigation until
an authoritative refresh or reload succeeds. This is
recovery from an unknown outcome, not proof of server receipt semantics.

The adapter translates UI modes into the existing `LearnEngine.MODES`
presets, sending `goal` and `types` rather than the prototype-only `mode`:

| UI mode | `goal` | `types` |
| --- | --- | --- |
| Easy | `understanding` | `multiple_choice`, `true_false`, `flashcard` |
| Recall | `understanding` | `flashcard`, `true_false` |
| Hard test | `mastery` | `written` |

This translation is based on the September 13 documentation. Acceptance of
these fields, the private server's question selection and Recall alternation
still require validation. Unrecognized or conflicting presets are rejected
rather than changing a saved session's meaning. The adapter omits `deck` unless
set support is explicitly enabled.

The UI requires authoritative view totals and mastery counts; saved sessions
also need identifiers, revision, status, configuration, round/card queues,
progress counters and results. A current question needs its identity, card,
type and prompt, plus `options` for multiple choice or `candidate` for
true/false. Once revealed or in feedback, its reference `answer` is needed
for the reveal and exact correction tray. Feedback needs correctness and the
submitted-answer state. Essential fields are validated rather than fabricated
from demo data; `api.js` and `checks/api-test.js` define the executable shape.

## Optional features and private application changes

- **Planned rounds.** Planning is off by default. Home uses the server's
  available count and Start morphs from the button. To enable bubble previews,
  the server must persist `/drill/plan`'s selected order until `start`, using
  the same filtering and round-selection rules. When planning is opted in,
  an unsupported endpoint (`404`, `405` or `501`) falls back to the count.
  Other failures remain errors rather than claims that no cards are due.
- **Sets.** Set support is off by default; set chips and set request fields
  are hidden/omitted. Enable `capabilities.sets` only after the backend supplies
  set metadata and per-card set keys and applies set filtering consistently.
  The September 13 README described `drill.py` as having no sets; its current
  implementation has not been inspected.
- **Card metadata.** Missing per-card `mastery`, `due` or `back` hides the
  associated claims, filters or library features. Supporting the complete
  library requires those fields, with mastery for the chosen answer side.
  Notes, mnemonics, stars and side-specific aliases also need matching card
  edit behavior. Missing editable metadata hides its controls and is not sent
  back as blank defaults, so saving a note cannot erase omitted aliases.
  Backend alias editors require an explicit array for the current answer side;
  return an empty array to allow adding the first accepted answer on that side.
- **Progress comparisons.** Without `feedback.before_mastery` or
  `session.counts_start`, the UI hides the corresponding transition or
  "Since you started" comparison. Add them server-side to enable those details.
- **Tutor.** The standalone preview stays available in demo mode. Backend
  tutor UI is unavailable until the private conversation API is integrated;
  the adapter can forward the `tutor` study action but does not simulate a
  backend conversation. The September 13 notes referenced
  `ui/static/learn-drill.js`; inspect its current API before integrating it.
  Opening help before an answer must mark the question assisted before any
  conversation begins.
- **Demo reset.** `/reset` is a local sample-data operation. Backend mode
  hides and blocks it; the prototype does not assume any ledger-reset endpoint.

## Private integration acceptance

Before calling the backend connected, verify these against the actual private
application with a test ledger:

- Confirm paths, methods, request names, error bodies, authentication/CSRF
  requirements and all essential response fields.
- Resume a saved question, reveal and feedback after reload. Reject stale
  revisions and stale question identifiers, and replay the same request
  identifier without applying an answer twice. A reused identifier with a
  different body must be rejected.
- Confirm Easy/Recall never require typed answers; Hard uses typed answers.
  Unaided typed correctness on Familiar can reach Mastered, a new card needs
  two typed wins, and tutor-assisted correctness cannot earn mastery credit.
- Confirm smart/exact grading, aliases, Don't know, exact correction before
  continuing a miss, typed-only overrides, miss review, new-card limits and
  checkpoint option changes. The adapter must not implement these server rules.
- Verify card creation/edit/delete persistence in SQLite, including restrictions
  for cards used by an active session; verify daily activity and due scheduling.
- If planning or sets are enabled, verify preview/start order and set filtering.
  Check both normal and reduced motion with actual server latency.

The local engine and mock-backed checks establish prototype behavior only.
These private acceptance checks remain outstanding until the backend is
independently inspected and exercised.

Assets: the page uses `../assets/learn-mark.png` (the glass pouring into "Ai";
`../assets/learn-logo.png` is the full "Learn" lockup); in the app use
`/static/brand/learn-app.png`.
