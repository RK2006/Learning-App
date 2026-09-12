# Learnable — Frontend

React 18 + TypeScript + Vite. No Tailwind, no shadcn/ui, no component framework — see [Design constraints](#design-constraints).

## Run

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # tsc -b && vite build
npm run preview  # http://localhost:4173
```

**`npm run dev` talks to the real backend.** From the repo root, `./start_app.sh` starts both halves and wires the frontend to whichever port the backend actually got — use it unless you have a reason not to.

```bash
# 1. put a key where the backend can find it (gitignored)
cp ../backend/.env.example ../backend/.env && $EDITOR ../backend/.env

# 2. both halves, ports negotiated, frontend pointed at the backend
cd .. && ./start_app.sh
```

Verified live against `gpt-4o-mini`: a path takes ~2s, a lesson ~12s, an assessment ~2s. All nine AI tasks have endpoints.

### Running without a backend

```bash
VITE_API_MODE=mock npm run dev
```

`src/lib/ai/mockProvider.ts` is a seeded simulator: free, deterministic, offline, and it exercises the same wire mapping the real client does. The top bar shows a **Simulated** chip whenever it is in play.

**It cannot read.** It marks free responses by matching rubric keywords, which is blind to negation — "Hannibal did not capture Rome" and "Hannibal captured Rome" score the same. That is the ceiling of a simulator with no model behind it, and it is why this is no longer the default: `mock` used to be what you got by forgetting an env var, so a demo could look like it was working while every lesson, path and grade was synthetic. Opting in to the simulator is cheap; opting in to the real thing by remembering a flag nobody told you about is not.

| Env var | Default | Meaning |
| --- | --- | --- |
| `VITE_API_MODE` | `live` | `mock` routes through `mockProvider` instead of FastAPI |
| `VITE_API_BASE_URL` | `http://localhost:8000` | Backend origin. `start_app.sh` sets this to the port it actually bound |
| `VITE_MOCK_FAIL_RATE` | `0` | `0`–`1`; fraction of mock calls that fail, for exercising error states |

## Architecture

```
src/
  lib/ai/        The "what do we feed the LLM" contract. Typed request/response per
                 generation task + prompt builders. mockProvider simulates a model;
                 httpProvider calls FastAPI. Swapping them is one env var.
  lib/api/       wire (snake_case, mirrors backend) <-> domain (camelCase) normalization.
  domain/        Pure engines: mastery decay, SM-2 scheduling, retention forecast,
                 streak, XP, achievements. Every one takes `at` and defaults to the
                 injectable clock, which is what makes demo time travel work.
  lib/motion.ts  The imperative motion layer and the reduced-motion gate. Reads
                 duration/easing tokens back out of CSS; owns animate() and flyTo().
  calendar/      RFC 5545 by hand. ics.ts is a pure encoder that has never heard of
                 a concept; plan.ts turns app state into events; links.ts holds the
                 two deep links and, next to each, what it cannot carry.
  state/         Two reducers behind split contexts: durable app state + ephemeral
                 session. actions.ts is the impurity boundary; commit.ts is the only
                 place the store learns anything from a finished session.
  screens/       One per route.
  components/    Presentational primitives. Never import from state/ or lib/api/.
  styles/        Global design tokens. Everything else is a *.module.css next to its component.
```

**Rules worth knowing before you edit:**

- **snake_case is confined to the wire boundary.** The backend emits `correct_answer`; the app uses `correctAnswer`. Only five files may mention a wire field name: `types/wire.ts` (declares them), `lib/api/normalize.ts` (translates them), `lib/api/guards.ts` (validates them), `lib/ai/mockProvider.ts` (deliberately *emits* wire shapes so the mock exercises the same mapping the real client does), and `lib/ai/prompts.ts` (the response schemas sent to the model). Anywhere else is a bug of the exact kind this boundary exists to prevent.
  ```bash
  grep -rn 'daily_time\|correct_answer\|needs_review\|misconception_on_wrong' src \
    --include='*.ts' --include='*.tsx' \
    | grep -v 'types/wire\|api/normalize\|api/guards\|ai/mockProvider\|ai/prompts'
  # only comments should match
  ```
- **wouter's `useLocation()` returns the PATHNAME ONLY.** The query string comes from `useSearch()`. Splitting the location on `?` yields `''` and every param silently falls back to its default — which made `?mode=review` run as a lesson for three phases, because the bug and the default were the same value. Anything reading a param goes through `router/session.ts`.
- **`review.reps` is not "has this been studied".** It is SM-2's count of *consecutive successes*, and a lapse resets it to zero. Use `hasAttempted(concept)` from `domain/mastery.ts` for "has this been studied at all". Reading `reps` as attendance is a trap that already bit four separate call sites: it re-locked a concept with 8 attempts behind a prerequisite the learner had passed, dropped every lapsed concept out of the review queue (the one case the queue exists for), and re-paid the first-time XP bonus each time someone failed. All three failures land on whoever is struggling most.
  ```bash
  grep -rn 'review\.reps' src --include='*.ts' --include='*.tsx'
  # legitimate uses only: halfLifeDays(reps), nextMastery's alpha, schedule()'s
  # ladder, and displaying the count. Anything shaped like `reps > 0` is a bug.
  ```
- **JS never hardcodes a color, duration or easing.** They live as CSS custom properties in `src/styles/tokens.css` so theming and reduced-motion work. `lib/motion.ts` parses them back out for imperative code, so a CSS transition and a JS animation that are supposed to land together actually do.
- **A `*.module.css` can never reference a shared keyframe by name.** CSS Modules scopes `@keyframes` *and* every identifier in an `animation-name` position, so `animation: fadeUp 300ms` compiles to `_fadeUp_a1b2c3` — a name that exists only if that same module defined the keyframe. Use the token: `animation: var(--kf-fade-up) var(--d-3) var(--e-settle) both`. This fails silently in every direction that matters — the build passes, the stylesheet reads correctly, `getComputedStyle` reports the animation as set — and it had disabled Pica's breathing, the streak embers, the wrong-answer shake, the feedback footer slide-up and every screen entrance from Phase 1 until Phase 6.
  ```bash
  # every animation in a module must name a LOCAL keyframe or a --kf-* token
  grep -rn 'animation[^;]*:' src --include='*.module.css' | grep -v 'var(--kf-'
  # each hit must have its @keyframes in the same file
  ```
- **Imperative motion goes through `lib/motion.ts`, which is the only file that consults `shouldAnimate()`.** A CSS media query cannot stop a running JS animation — that is the #1 reduced-motion bug in hand-rolled UI. `animate()` still runs under reduced motion, in a single frame, so end states land and `finished` resolves; motion with no end state to preserve (confetti) is guarded with `shouldAnimate()` and skipped outright. Skipping the journey is accessibility; skipping the destination is a bug.
- **`aria-modal="true"` is a promise, not an implementation.** It tells a screen reader to ignore the page behind; it does nothing whatsoever about the Tab key. Every dialog must call `useFocusTrap`, and must pass `mounted && open` — `usePresence` mounts the node a render later, so `useFocusTrap(ref, open)` runs its effect against a null node, returns, and never re-runs. That silently shipped untrapped dialogs three times, so the hook now warns in dev.
- **A control that does nothing is the bug this project exists to remove.** The Sound toggle shipped inert for five phases; `settings.sound` is now mirrored into `lib/sound.ts` the way `clockOffsetMs` is mirrored into `domain/time.ts`, and flipping it plays a tone so "on" is distinguishable from "broken".
- **Errors are keyed on `AiError.kind`, and `retryable` decides whether a Retry button exists at all.** A retry button on an `unconfigured` endpoint is a lie with a click target. See `lib/ai/errorCopy.ts`.
- **An export you cannot import is not a backup.** The router pins anyone with `onboarded === false` to the first-run flow, so Profile — and its Import button — is unreachable after clearing site data. `components/ImportData` is therefore mounted in *both* Profile and step 0 of onboarding. Any future "restore" affordance goes through that component for the same reason.
- **Reduced motion is a degradation table, not a kill switch.** Most of the table is the collapsed duration ladder in `tokens.css` (`--d-3`…`--d-7` → 120ms, `--stagger` → 0). `base.css` adds only what tokens cannot express: `animation-iteration-count: 1` as a safety net, since an infinite animation is by definition decoration or an idle state. `--d-1`/`--d-2` are deliberately *not* collapsed — they drive the button press, which is feedback about something the user is doing with their own hand.
- **No `setTimeout` inside `screens/`** — zero hits, no exceptions. Motion comes from a primitive or a token-driven class; a minimum-duration await goes through `lib/atLeast.ts`. A rule with one grandfathered exception stops being greppable, which is the only reason it is worth having.
- **Nothing calls `Date.now()` outside `domain/time.ts`.** `now()` is the app clock and carries the demo offset; `wallClock()` is the real one, for measuring elapsed intervals and for the clock-tamper check (which must not fire when the demo clock moves).
- **A verdict is `true`, `false`, or `null`.** `null` means *not graded* and is never a synonym for correct. The code this replaces collapsed it to `true`, so every short-answer question was marked Correct for any text at all. See `domain/grade.ts`.
- **Nothing in `src/` grades prose.** `domain/grade.ts` checks multiple choice — where string equality *is* the right check — and nothing else. Free responses go to `/grade`, and if it cannot be reached the answer is recorded ungraded rather than guessed at by counting words: a keyword grader cannot see negation, so it marks an answer and its exact opposite the same, and it disagreed with the recap about the same sentence. The one keyword matcher left in the tree is inside `mockProvider.ts`, where there is no model to ask.
  ```bash
  grep -rn 'matchRubric\|rubricFromModelAnswer' src --include='*.ts' --include='*.tsx'
  # mockProvider.ts only
  ```
- **Anything feeding the `useReducer` lazy initializer must be idempotent.** StrictMode calls it twice and keeps the SECOND result. `loadPersisted()` is not pure (quarantining deletes the bad key), so it is memoized per page load; without that the first call quarantined, the second saw an empty store, and the corrupt-save warning was discarded every single time.
- **The reducer is pure.** No clock, no RNG, no storage. Impure values arrive on action payloads built in `state/actions.ts`. That is what makes StrictMode's double-invoke harmless and lets `state/demoData.ts` generate a fortnight of history by replaying real sessions through the real `buildCommit` with nothing but `at` changed.

### Animation libraries

The plan specified GSAP with Flip, MotionPath and DrawSVG. It is not installed, and the reason is worth recording rather than rediscovering.

MotionPath and DrawSVG existed for the serpentine's connector line, and Phase 5 rebuilt the serpentine as discs on a wave with no connector. Presses, entrances, staggers, feedback states, sheets and toasts all turned out to be expressible in CSS, where they also degrade for free through the token ladder. What was actually left was one FLIP animation and some sequencing.

Measured against a 140 KB gzip budget: `gsap` 32.1 KB, `+ Flip` 9.5 KB. Roughly a third of the budget for `flyTo()` — forty lines in `lib/motion.ts` — and for sequencing that `await animation.finished` already expresses. The Web Animations API also accepts `easing: 'cubic-bezier(…)'` verbatim, so the same token string drives CSS and JS with no conversion table.

`canvas-confetti` (4.9 KB) is kept: particle physics is solved, and hand-rolling it is not this project's differentiator. If a later phase needs timeline scrubbing, morphing or inertia, `lib/motion.ts` is the seam — nothing outside it imports an animation API.

## Design constraints

The visual system is deliberately *not* what AI code generators produce. Banned project-wide: Tailwind, shadcn/ui, Radix, framer-motion, lucide, Inter (and Plus Jakarta Sans / Figtree / Outfit / Manrope / Space Grotesk / Geist / DM Sans / Poppins), `backdrop-filter`, decorative gradients, and the `#0f172a`/`#60a5fa`/`#8b5cf6` slate-indigo palette.

Instead: warm opaque paper surfaces, flat spot inks, 0-blur solid risers for depth, radii off the Tailwind scale (7/11/14/20/28), Bricolage Grotesque for UI and Source Serif 4 for lesson prose.

The full checklist is in the plan; the short version is `npm run build && grep` the ban list, then load the page and don't touch it — exactly two things should be moving.

## Build config note

`tsconfig.node.json` is `composite` (required by project references) **and** `noEmit`. Without `noEmit` it emits `vite.config.js` next to the source, and **Vite resolves `vite.config.js` before `vite.config.ts`** — so a stale compiled copy silently becomes the authoritative config. Both are also gitignored as a backstop. If `git status` is dirty after a build, something regressed here.
