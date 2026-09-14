# Cielo connector layout

Draft 1, 2026-09-14. Cielo is not in this repo yet; this doc is the plan for
its data layer before any code exists.

**Assumption.** Cielo is the personal daily-life app: sleep, food, movement,
money, study and mood in one place, with an AI that can read across them.
Everything below follows from that. If Cielo is something narrower, cut
categories, but keep the three rules.

## The three rules

1. **Two lanes per category.** Every category has an automatic lane (a
   connector) and a manual lane (typing it in). The manual lane ships first,
   always exists, and wins on conflict. A connector is a convenience on top of
   it, never the only way in.
2. **Three sensitivity tiers, and the tier picks the model.** Each connector
   declares a tier. The tier decides where the data lives, whether it can
   leave the phone, and which AI is allowed to read it. Finance is Vault tier:
   no cloud model ever sees the raw ledger.
3. **One record shape.** Every lane, automatic or manual, writes the same
   `Observation` record. The AI, the charts and the merge rules only ever see
   Observations, never vendor payloads.

## Tiers

| Tier | Name | What goes here | Where it lives | Which AI may read it |
|---|---|---|---|---|
| 1 | Open | calendar, tasks, study progress, weather, location coarse | encrypted on device; may sync | any model |
| 2 | Personal | sleep, food, workouts, body, heart, water, caffeine, mood | encrypted on device; sync only end-to-end encrypted | cloud frontier model under no-training terms, or on-device |
| 3 | Vault | finance; raw Limitless transcripts; later messages and email | encrypted on device with a key in the Secure Enclave; sync optional and end-to-end only | on-device model only. Cloud models get a derived summary card, never rows |

### The honest version of "encrypted so the AI companies can't see it"

A model cannot reason over ciphertext. Homomorphic encryption for language
models is research, not something to ship. So there are exactly two ways to
keep a cloud AI company from seeing finance data:

- **Don't send it.** Run the model on the phone. Since iOS 26 every Apple
  Intelligence device has a 3B-parameter on-device model that third-party
  apps call through the Foundation Models framework. It is free, offline,
  and nothing leaves the device. It is good enough for "summarize this
  month", "flag anything unusual", "answer a question about my ledger".
  It is not a frontier model.
- **Send only derived numbers.** A deterministic function on the phone
  (plain code, not an LLM) turns the ledger into a *finance card*: savings
  rate, net worth change as a percentage, spend by category as percentages,
  a count of flagged transactions. No institution names, account numbers,
  merchant names or raw dollar amounts. The user previews the card before it
  is included in any cloud request.

Contract terms are the third lever and they are trust, not math. Anthropic's
API does not train on inputs by default and keeps logs for seven days, with
zero-data-retention available by agreement. That is the right setting for
Tier 2. It is not sufficient for Tier 3 by Cielo's own rule.

One practical detail makes the router cheap: at WWDC 2026 Apple added a
`LanguageModel` protocol to the Foundation Models framework. The same
`LanguageModelSession` code can point at the on-device model, Private Cloud
Compute, or Claude (Anthropic ships a `ClaudeForFoundationModels` package).
The tier router is a one-argument swap, not a second AI stack.

## Category map

Phase 1 is the first build. It needs no external API keys except a free USDA
one. Phase 2 adds money. Phase 3 is direct vendor APIs where Apple Health is
thin.

| Category | Automatic lane | Manual lane | Tier | Phase |
|---|---|---|---|---|
| Sleep | Apple Health. Apple Watch, Oura, WHOOP, Eight Sleep and Withings all write sleep here, so one permission covers every ring and mattress the user owns. Direct Oura v2 / WHOOP APIs only in Phase 3 for readiness and strain details Health lacks. | Bedtime and wake pickers, quality 1 to 5, "same as last night". | 2 | 1 |
| Food | In-house logger (see below). Plus read Apple Health nutrition, which picks up MyFitnessPal, Cronometer and Lose It for free because they write meal summaries into Health. | Quick-add calories and macros, saved meals, "same as yesterday". | 2 | 1 |
| Movement and workouts | Apple Health: steps, active energy, workouts. Strava and Garmin write here too. Strava API in Phase 3 for route and gear detail. | Log a workout: type, duration, effort. | 2 | 1 |
| Body | Apple Health weight and body fat (smart scales write here). | Weight entry. | 2 | 1 |
| Heart and recovery | Apple Health HRV, resting heart rate. Oura readiness in Phase 3. | "How do you feel" 1 to 5. | 2 | 2 |
| Water, caffeine, alcohol | Apple Health has water and caffeine. MyFitnessPal does not send caffeine, so expect the manual lane to carry it. | One-tap counters. | 2 | 1 |
| Finance | Plaid for cash, cards and Fidelity holdings (see below). SnapTrade as the brokerage-only alternative. | Fidelity CSV export dropped into the app and parsed on device; monthly manual balances. | 3 | 2 |
| Calendar | EventKit on device, which already covers iCloud and Google accounts signed into the phone. No Google API needed. | Add an event. | 1 | 1 |
| Tasks and habits | In-house. Reminders via EventKit if wanted. | Check-off. | 1 | 1 |
| Study | The Learn prototype already in this repo, as a module. | n/a | 1 | 1 |
| Mood and journal | Limitless lifelogs API (`GET /lifelogs`, API key, 180 req/min) for the day's transcript. Raw transcript is Vault; the on-device model writes a Tier 2 day summary from it. | One-tap mood plus a voice note. | 3 raw, 2 summary | 2 |
| Weather and place | WeatherKit and CoreLocation, coarse. | n/a | 1 | 2 |
| Glucose | Dexcom API (sandbox is self-serve, production needs approval) or Apple Health. | Reading entry. | 2 | 3 |
| Medications and supplements | Manual. Health's medication data is not something to depend on. | Checklist with times. | 2 | 3 |
| Screen time | No API on iOS. A Shortcuts automation can export a daily total. | Daily minutes. | 2 | 3 |
| Music, reading | Spotify API is easy; Kindle has none. Low value for the AI. | Skip unless asked. | 1 | later |

### Apple Health is the mega-connector

The single biggest simplification in this plan. One permission sheet gives
sleep, workouts, steps, heart, HRV, weight, nutrition, water and caffeine,
and every wearable brand already writes into it. Garmin's own API is
partner-approval only and new sign-ups are reportedly paused, so never plan
on it directly; go through Health. Oura and WHOOP are self-serve and can
come later for the details Health does not carry.

Two consequences:

- Cielo is iOS-first. Android gets the same design on Health Connect later.
- Health data never touches a server. HealthKit has no server API; reads
  happen in the app via background delivery. That matches the privacy model
  anyway.

### Food: build the in-house logger, don't chase MyFitnessPal

MyFitnessPal's API is partner-only and closed to new applicants. Do not plan
on it. Two better routes:

1. **Read MyFitnessPal through Apple Health.** MFP writes meal summaries
   (calories and macros, no timestamps, no food items) into Health. A user
   who already logs in MFP gets their totals into Cielo with zero extra work.
2. **In-house logger, the Cal AI shape.** Photo, text, or barcode in;
   Observation out.
   - Photo or text goes to a vision model with a structured-output schema:
     items, portion estimates, confidence.
   - Nutrients come from USDA FoodData Central (free key) for whole foods
     and Open Food Facts for barcodes. The model names the food; the
     databases supply the numbers. This keeps the macros honest and cheap.
   - The user confirms or edits portions before it is saved. Every saved
     entry is an Observation with `lane: auto` and the photo hash as
     `raw_ref`.
   - Strip EXIF and location from photos, and do not keep the photo by
     default. A plate photo is Tier 2; the kitchen behind it might not be.

### Finance: Plaid for the pipe, Vault for the data, on-device for the brain

Fidelity has no public consumer API and blocks scraping. Aggregators reach
it through Akoya, the network Fidelity spun out. Two routes work:

- **Plaid.** Connects to Fidelity by OAuth. `Investments` gives holdings
  and balances; `Transactions` covers checking and cards at the same time.
  Teams created after April 15, 2026 get a free Trial plan with real
  production data, capped at 10 connected items and including both
  products. That covers a personal build and a small beta.
- **SnapTrade.** Brokerage-specialized, Fidelity read-only, needs an
  application to enable Fidelity. Use it only if Plaid's investment data is
  thin for Ian's account types.

Plaid needs a server secret, so Cielo needs one server component: a **blind
relay**. It exchanges tokens, receives webhooks, pulls data, encrypts it to
the user's device public key, and forwards ciphertext. It never persists
plaintext and holds no key that can read what it forwards. Everything else
in Cielo runs on the phone.

From there:

- Vault storage: SQLite with SQLCipher, key in the Secure Enclave via
  Keychain, never in iCloud backup as plaintext.
- The **finance card** is computed on device by plain code and previewed by
  the user before it enters a cloud request.
- A "finance in AI" switch with three settings: off, summary card only
  (default), full ledger on the on-device model only.
- Mixed questions ("does spending track my sleep?") join on the phone.
  The cloud model sees sleep Observations and the finance card, nothing else.

## The Observation record

```
Observation {
  id            ulid
  category      sleep | food | movement | body | heart | intake | finance | calendar | task | study | mood | env
  metric        e.g. sleep.duration, food.calories, finance.balance
  value         number | string | json
  unit          min | kcal | g | usd | count | ...
  start, end    timestamps; instant events have start == end
  source        apple_health | in_house | plaid | limitless | manual | ...
  lane          auto | manual
  tier          1 | 2 | 3
  confidence    0..1; manual is 1.0
  raw_ref       pointer to the vendor payload or photo hash, stored in the same tier
}
```

### Merge rules

- Same metric, overlapping window: the manual record wins; otherwise a
  per-category source priority list decides. Sleep: manual, Oura, Apple
  Watch, phone-only. Food: manual, in-house logger, Health nutrition.
- Two sources both reporting last night's sleep is the common case (Oura and
  Watch both write to Health). Dedup on `(metric, start, end)` with a 15-minute
  tolerance before applying priority.
- Nothing is deleted on conflict; the loser gets `superseded_by`.

### Connector contract

Each connector is a small module that implements:

- `authorize()`: HealthKit permission sheet, OAuth, API key, or nothing.
- `pull(since)`: returns Observations; called on a schedule or from a
  webhook via the relay.
- `tier`: declared once, checked by the router.
- `sources`: the priority name it writes under.

Manual entry is just a connector whose `pull` is the form.

## Phasing

| Phase | Ships | External keys needed |
|---|---|---|
| 1 | Manual lane for every category. Apple Health read for sleep, workouts, steps, weight, nutrition, water, caffeine. In-house food logger. Calendar via EventKit. Learn module. Tier 1 and 2 router with on-device and Claude. | USDA FoodData Central (free) |
| 2 | Finance: Plaid Trial, blind relay, Vault, finance card, CSV import. Limitless day summary. WeatherKit. | Plaid, Limitless |
| 3 | Direct Oura and WHOOP, Strava, Dexcom. Android on Health Connect. | Oura, WHOOP, Strava, Dexcom |

## Decisions only Ian can make

1. iOS-first is assumed. If Android matters early, Health Connect replaces
   HealthKit in Phase 1 and the on-device model story changes.
2. Which wearable Ian actually wears. It decides whether Phase 3 direct APIs
   matter at all.
3. Limitless: Vault or Personal? This plan says raw transcripts are Vault
   and only the on-device summary is Personal.
4. Whether Cielo runs any server beyond the blind relay. This plan says no.

## Sources

- MyFitnessPal developer portal, API closed to new partners: https://www.myfitnesspal.com/apps/api/version
- MyFitnessPal Apple Health sync (meal summaries, no caffeine, no timestamps): https://support.myfitnesspal.com/hc/en-us/articles/360032271092-Apple-Health-FAQ-and-Troubleshooting
- Fidelity blocks scrapers, routes through Akoya: https://riabiz.com/a/2023/10/19/fidelity-just-dropped-the-hammer-on-screen-scrapers-to-cheers-but-some-firms-like-plaid-are-holdouts-and-the-cfpb-may-wield-the-final-gavel
- Plaid Investments: https://plaid.com/products/investments/
- Plaid Trial plan, 10 items, includes Investments and Transactions: https://support.plaid.com/hc/en-us/articles/16194695660311-Can-I-use-Plaid-for-free
- SnapTrade Fidelity, read-only, application required: https://snaptrade.com/brokerage-integrations/fidelity-api
- Apple Foundation Models framework, on-device 3B model: https://www.apple.com/newsroom/2025/09/apples-foundation-models-framework-unlocks-new-intelligent-app-experiences/
- WWDC26, bring an LLM provider to Foundation Models: https://developer.apple.com/videos/play/wwdc2026/339/
- Anthropic API data retention: https://platform.claude.com/docs/en/manage-claude/api-and-data-retention
- Oura, WHOOP self-serve; Garmin partner-only and paused: https://aifitnessapi.com/fix/garmin-api-approval and https://openwearables.io/integrations/oura
- Limitless developer API: https://www.limitless.ai/developers
