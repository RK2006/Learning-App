# AI Learning App — Design Doc & Agent Handoff Summary

## Project description

This project is a lightweight MVP for an AI-powered adaptive learning app inspired by Duolingo, but for any subject. The experience is designed around a simple loop:

1. User picks a topic and difficulty
2. The app generates a learning path
3. A daily lesson teaches one concept
4. The user answers a quiz and a free-response question
5. AI evaluates understanding and misconceptions
6. Mastery is updated
7. The app recommends review before moving forward

The goal is not a full commercial education platform. It is a focused demonstration that generative AI can create a personalized learning loop with minimal architecture and a clean demo path.

## What has been built so far

The MVP currently includes:

- Frontend UI in React + TypeScript (Vite)
- Backend API in FastAPI
- Learning path generation flow
- Lesson flow with teaching slide and assessment questions
- Simple adaptive review/recommendation messaging
- Progress summary cards for streak, sessions, concept progress, and review state
- LLM service scaffold with graceful fallback behavior if no API key is configured

### Relevant files

| File | Role |
| --- | --- |
| [frontend/src/App.tsx](frontend/src/App.tsx) | Entire UI and client state: setup form, learning path list, lesson viewer, questions, results panel, progress cards |
| [frontend/src/styles.css](frontend/src/styles.css) | All styling (sidebar shell, panels, stat cards, concept list, option buttons) |
| [backend/app/main.py](backend/app/main.py) | FastAPI app, CORS, Pydantic models, the four endpoints |
| [backend/app/llm_service.py](backend/app/llm_service.py) | OpenAI client wrapper, JSON-schema-constrained generation, demo fallbacks |

Supporting: [backend/run.py](backend/run.py) (uvicorn entrypoint, port 8000), [backend/requirements.txt](backend/requirements.txt), [frontend/package.json](frontend/package.json).

### Current user flow

1. User opens setup screen
2. User enters topic, difficulty level, and daily time
3. App calls the backend to generate a learning path (falling back to demo data if the call fails)
4. App displays a lesson around the current concept
5. User answers a multiple-choice quiz
6. User writes a short free-response explanation
7. App evaluates the answer and shows feedback
8. App recommends reviewing the concept before moving on

## Architecture

```
React + TS (Vite, :5173)            FastAPI (uvicorn, :8000)           OpenAI
  App.tsx  ──POST /setup ─────────▶  llm_service.generate_learning_path ──▶ gpt-4o-mini
           ──POST /lesson ────────▶  llm_service.generate_lesson        ──▶ (json_schema,
           ──POST /assess ────────▶  llm_service.assess_answer          ──▶  strict: true)
```

Two processes, no database. All state lives in React `useState` for the duration of the page session. `LLMService` is instantiated once at import time in `main.py`; if `OPENAI_API_KEY` is absent it returns hardcoded demo content instead of calling out, so the demo path works with no credentials.

### API surface

| Endpoint | Request | Response |
| --- | --- | --- |
| `GET /health` | — | `{"status": "ok"}` |
| `POST /setup` | `SetupRequest` | topic, goal, daily_time, level, `concepts[]` |
| `POST /lesson` | `SetupRequest` | `LessonResponse` (concept, title, explanation, example, 2 questions) |
| `POST /assess` | raw dict: topic, answers, lesson | `AssessmentResult` (score, correct, misconceptions, feedback, needs_review) |

`SetupRequest` = `{ topic, goal = "", daily_time, level: Easy | Medium | Hard }`.

### Data model (in-memory)

- **Concept** — `id`, `name`, `order`, `mastery` (0–100), `status` ∈ `locked | current | completed | needs-review`
- **Question** — `id`, `type` ∈ `multiple-choice | short-answer`, `prompt`, optional `options[]`, optional `correct_answer`
- **AssessmentResult** — `score`, `correct`, `misconceptions[]`, `feedback`, `needs_review`

All three shapes are mirrored between the Pydantic models in `main.py`, the JSON schemas in `llm_service.py`, and the TypeScript types in `App.tsx`. **Any change to one must be made in all three places** — there is no shared schema source today.

## Current status

The app is in a working MVP state and has been verified with fresh checks:

- Frontend production build succeeded after the final setup changes
- Backend API responds correctly via FastAPI test client for health, setup, lesson, and assessment endpoints

This means the project is solid enough to continue with real persistence and richer AI integration.

### Known shortcuts (deliberate, for the demo)

These were the seams where the original demo was scripted rather than real. The frontend overhaul (`frontend/`, Phases 0–4) has retired the first six:

- ~~**No persistence.** A page refresh resets everything.~~ — **Fixed (Phase 3).** Versioned localStorage envelope, synchronous hydrate, quarantine-on-corruption, immediate flush on any milestone.
- ~~**Mastery is display-only.**~~ — **Fixed (Phase 4).** `domain/mastery.ts`: an EMA over real answers, decayed by a half-life that grows with successful repetitions. Decay is *derived*, never stored, so it is always correct and needs no background job.
- ~~**Streak and sessions are hardcoded** (`streak: 6`, `sessions: 9`).~~ — **Fixed.** The streak counts days where XP actually met the goal, with retroactive freezes and a once-a-month repair offer; sessions are `sessions.length`.
- ~~**The recommendation line is a fixed string** naming Bayes' theorem.~~ — **Fixed.** `selectNextAction` in `state/selectors.ts` runs a documented six-rule priority over the real queue, and `selectDecideNext` branches the results screen on the real score.
- ~~**Concept selection is cosmetic.**~~ — **Fixed.** Every concept is its own route (`/session/:conceptId`) and requests its own lesson; locked nodes open to show their unlock requirement rather than dead-clicking.
- ~~**API base URL is hardcoded** in three fetch calls.~~ — **Fixed.** `VITE_API_BASE_URL`, read in one place in `lib/ai/httpProvider.ts`.
- ~~**`/assess` takes an untyped dict** rather than a Pydantic request model.~~ — **Fixed (Phase 9).** `AssessRequest` is typed, so a camelCase lesson is a 422 instead of a lesson quietly handed to the model with keys its prompt never mentions. It also carries `concept_name`, which the client computed and dropped, so the grader now knows what it is grading.
- ~~**Errors fall through to demo data.**~~ — **Fixed.** Real error states keyed on `AiError.kind`. Demo data is now an explicit, labelled tool in Settings rather than a silent fallback.

### The key works now

With `OPENAI_API_KEY` set in `backend/.env`, the whole loop runs on a real model. Three prompt bugs had to be fixed before it was correct — all of them invisible without a key:

- **`/assess` scored out of 2.** The JSON schema constrained `score` to 0–100, but the prompt never named the scale, so "2 of 2 questions correct" satisfied it and a perfect session recorded **2% mastery**. The scale belongs in the prompt, not only the schema.
- **`/setup` fabricated progress.** Its prompt said "use completed for the first three concepts, current for the fourth" — so a brand-new course arrived with three concepts already marked Strong. The client now ignores server-sent `mastery`/`status` outright (the backend is stateless and cannot know them), and the prompt asks for honest zeros.
- **`/lesson`'s extra fields were generated and then discarded.** `why`, `hint`, `rubric` and `misconception_on_wrong` were added to the LLM schema, but `main.py`'s `Question` model did not declare them and `LessonResponse(**lesson)` dropped every one. All four now arrive, and light up the feedback UI with no client change — `types/wire.ts` had declared them since Phase 2.

Measured end to end: path 2.2s, lesson 12.3s, assessment 1.8s. Perfect answers score 100, partial 70, wrong 0, with specific misconceptions on the wrong ones.

### Phase 9 — all content AI-generated, and unbounded

The ask was two words: *"all the content should be ai generated and unlimited"*. Both halves were violated.

#### The violation that mattered most

Every method in `llm_service.py` opened with `if self.client is None:` and returned hardcoded **probability** material — a 7-concept Bayes path with invented mastery numbers, a full conditional-probability lesson, and an assessment of `{"score": 75, "correct": true, "misconceptions": ["Confuses P(A|B) with P(B|A)"]}`.

So with no API key, a learner who asked for Roman History was **taught conditional probability and told they scored 75%** regardless of what they wrote. That is strictly worse than anything the frontend overhaul removed: those were fake numbers, this was fake teaching and a fake grade. All three branches are gone. There is exactly one no-key branch left in the service and it raises `unconfigured`, which the client already had typed copy for. `tests/test_api.py` asserts that no endpoint returns subject matter or a score on that path.

#### What was measured first

`§11` of the backend handoff listed token cost, per-call pricing, whether the Responses API honours `minItems`/`maxItems`, and latency-vs-count as *not verified at all*, and warned that guessing would produce a confidently wrong plan. It would have. Probed against `gpt-4o-mini`:

| call | latency | output tokens | cost |
| --- | --- | --- | --- |
| path, 12 concepts | 2.8s | 242 | $0.00016 |
| path, 25 concepts | 3.1s | 440 | $0.00028 |
| lesson, 2 questions | 7.0s | 808 | $0.00054 |
| lesson, 5 questions | 9.1s | 1258 | $0.00081 |
| lesson, 10 questions | 14.2s | 1789 | $0.00113 |
| lesson, 20 questions | 19.8s | 2973 | $0.00184 |
| lesson, 12 slides | 7.6s | 990 | $0.00065 |
| assess | 1.1s | 62 | $0.00006 |
| hint | 0.9s | 54 | $0.00004 |

Three results, two of which contradicted the assumptions:

1. **`minItems`/`maxItems` are honoured under `strict: true`, and the schema beats the prompt.** A schema of 3/3 against a prompt demanding 12 returned 3. So per-request schema bounds are the enforcement mechanism, and the prompt must agree with them or it silently loses. Every schema in `schemas.py` is a function of the count for this reason, and the same `n` is passed to the prompt builder.

2. **Cost is not the binding constraint.** A full session is about a third of a cent. The handoff's "unlimited practice on a metered API is an unbounded bill" is wrong for a real learner at these prices. The genuine exposure was an unauthenticated endpoint with `allow_origins=["*"]` that would generate for anyone — which is a *rate limit* problem, not a count-cap problem, and is now handled as one.

3. **Latency is the constraint, and it tracks output tokens linearly** at roughly `1.5s + tokens/150`. This is the finding that shaped the architecture.

#### What "unlimited" means here

Because latency scales with output, one enormous generation is the wrong shape: 20 questions is already 19.8s and 40 would breach the client's abort — the learner would wait, fail, and still be billed. So **unlimited is delivered by repeatable batches**, not by unbounded single requests:

| dimension | before | now |
| --- | --- | --- |
| concepts per path | exactly 7, both sides | 1–40, and `/path/extend` continues forever |
| questions per lesson | exactly 2, both sides | 1–20, from `settings.questionsPerLesson` |
| practice | impossible | `/questions` in batches, non-repeating via `seen_prompts`, forever |
| re-teach | silently impossible | `/lesson` with `is_review` + the misconception set |
| hints | one, level always 1 | escalating, `prior_hints` makes each go further |
| tasks with endpoints | 3 of 8 | 9 of 9, each with a caller |

#### The input that had never reached a model

`GenerateLessonRequest` declares seven fields. `SessionScreen` computed all seven from real learner state; `httpProvider` built the body from four and discarded the rest. Among the discarded was `misconceptionsToWatch`, which `contracts.ts` calls *"the single highest-value input here — it is what makes the second attempt different from the first"*.

The consequence was that **in live mode a review lesson was byte-identical to the first teaching**. The re-explain branch was unreachable through the live path entirely. Verified fixed end to end: a re-teach of the same concept now returns different prose and targets the named misconception.

#### Decisions taken

- **Stateless content service** (`§10.1`). The browser keeps owning mastery, SRS, streak and XP. A server would recompute the same pure functions on read, inherit a timezone problem, and turn `commit.ts` — one synchronous transition on zero network — into a round trip with a partial-failure window. The service generates content and knows nothing about any learner.
- **Prompts live in the backend** (`§10.2`). They existed twice with different text, and the live copy was the worse one. `prompts.ts` had a header claiming it was "already wired"; it never was. The better text moved to `backend/app/prompts.py`, and `prompts.ts` is now scoped as reference with its false claim corrected.
- **Both re-teach shapes, because they are different products** (`§10.3`). `/lesson` with `is_review` replaces the session on a later day; `/explain` replaces the paragraph in front of you and keeps you in place.
- **`lessonCache` is wired up, and re-keyed** (`§10.4`). It was dispatched, stored, trimmed, persisted, migrated, shed under quota — and read by nothing. The key is now the full generation identity, including `isReview` and the misconception set; keyed on concept alone, a re-teach would have been served the very lesson it exists to replace.

#### Semantic validation

The pattern behind all three historical prompt bugs is that **the schema constrains shape, never meaning** — the model satisfies it perfectly while being wrong. `validate.py` assumes exactly that: it rejects a `correct_answer` that is not among `options` (every choice would be marked wrong), recovers unambiguous label answers like "B" or "option C", trims to exactly 4 options because `KEYS = ['1','2','3','4']`, drops rubric keywords longer than two words (a real call returned `'power dynamics in the Mediterranean'`, which the client's grader could never satisfy, so correct answers were marked wrong), and namespaces every question id server-side.

That last one was a latent data-loss bug: ids were literally `mc1`/`sa1` on every batch, and answers are keyed by id — so appending practice questions to a running session overwrote earlier answers and `/assess` graded the wrong text.

None of this is testable against the mock, which builds options as `shuffle([correct, ...distractors])` and therefore cannot produce the failure. The testable artifact is `backend/tests/fixtures/` — real model output, captured once, asserted against forever. 52 tests, no key and no network required.

#### Found by running it

An end-to-end run caught a `/questions` call taking **49.5s against a 45s timeout**, which is only possible if a first attempt timed out and the SDK silently retried. The learner's client had already aborted; they waited the full time, saw an error, and were billed for a generation that completed into a closed connection. `max_retries` is now pinned to 0 — every loading state in this app is deliberately unmeasurable, so a silent retry is indistinguishable from a hang and doubles the worst case invisibly.

The same kind of check caught the mock exhausting its question frames at batch 4 of a drill and silently repeating — the precise property "more practice, forever" has to demonstrate.

#### Ordering that mattered

Two changes looked additive and were breaking, and both had to ship on the client *first*:

- **Dropping `mastery`/`status`** from concepts. `normalize.ts` ignored them with a comment explaining why a stateless server cannot know them — but `guards.ts` still *required* them, and a failed guard is `AiError('malformed')`. The obviously-correct server cleanup would have broken every path fetch.
- **New `AiError.kind` values.** `AiErrorKind` was a closed union of six, `errorCopy.ts` indexed a `Record` with it unguarded, and there was no error boundary anywhere in the app. Emitting a seventh kind would have been a **white screen on the session error path**. `describeAiError` was made default-safe (with `retryable: false`, because house rule #1 bans a retry button on something that cannot be retried) and an `ErrorBoundary` added, before the backend emitted anything new.

### The animation layer (Phase 6)

Motion is now a system rather than a set of per-screen flourishes: `lib/motion.ts` (the reduced-motion gate and the token→JS bridge), `lib/usePresence.ts` (deferred unmount so exits can play), `lib/useCounter.ts` (counters that write `textContent` in a rAF loop instead of re-rendering React 60 times a second), and `lib/celebrate.ts` (confetti in ink-splat and torn-ribbon shapes, coloured from the live token set).

Two findings from Phase 6 are worth recording:

- **Most of the animation in Phases 1–5 was never running.** CSS Modules scopes `@keyframes` *and* every identifier in an `animation-name` position, so a module writing `animation: fadeUp 300ms` referenced `_fadeUp_a1b2c3`, which only exists if that module defined the keyframe. The shared keyframes live in a global stylesheet, so 17 references across 8 files pointed at nothing — Pica never breathed, the streak embers never rose, wrong answers never shook, the feedback footer never slid up, and no screen ever animated in. It is invisible in review (the CSS is correct), invisible in the build (it compiles), and invisible to `getComputedStyle` (which reports the animation as set). Only `getAnimations()` returning an empty array shows it. Keyframe names are now tokens (`var(--kf-fade-up)`), because a `var()` is not an identifier and the scoper leaves it alone.
- **GSAP was dropped**, against the plan. The plugins it was chosen for (MotionPath, DrawSVG) were for a serpentine connector line that Phase 5's redesign removed, and 41.6 KB gzip — a third of the JS budget — was buying one FLIP animation and some sequencing. See `frontend/README.md` for the measurement.

Reduced motion is a degradation table rather than a kill switch: the duration ladder collapses to 120ms, the stagger to zero, idle loops stop with a deliberate resting pose, confetti is suppressed entirely — and the button press is **kept**, at half travel, because it is feedback about something the user is doing rather than motion happening at them.

### Calendar, Schedule and Profile (Phase 7)

`.ics` generation is hand-written (`frontend/src/calendar/ics.ts`, ~120 lines) rather than pulled from a library, because the four things that break iCalendar files in the wild are each a one-line decision that a dependency makes for you silently:

- **CRLF everywhere**, including after the final line. A bare `\n` fails in Outlook.
- **Fold at 75 octets** — UTF-8 *bytes*, not characters — and never through the middle of a character. `for...of` walks code points, so an accented letter or an emoji in a course title survives the fold.
- **Escape** `\`, `;`, `,` and newlines in every TEXT value, backslash first. A colon needs no escaping, and escaping it is the common overcorrection.
- **Floating local time** (`DTSTART:20260912T190000`, no `Z`, no `TZID`), which is correct precisely *because* it carries no zone — 19:00 stays 19:00 if you fly to Berlin. `TZID` would mean embedding a full `VTIMEZONE` with DST rules that go stale.

Verified against **ical.js**, an independent parser: a summary carrying accented Latin, Japanese, an emoji, commas, semicolons, a backslash and an embedded newline round-trips byte-for-byte identical, the longest line is exactly 75 octets, and the zone reads as `floating`.

The deep links are a convenience with strictly less capability, and the menu says so on each item rather than in a footnote — Google carries the repeat but has no alarm parameter at all; Outlook Web has no recurrence parameter and creates a single event. What needs a server (push notifications, two-way sync, `webcal://` subscription, and knowing whether the user actually accepted) is listed on the Schedule screen with the actual reason, rather than hidden.

One real bug this phase surfaced: **the export was a one-way door.** The router sends anyone with `onboarded === false` to the first-run flow and never lets them out, so a user who cleared their site data could not reach the Profile screen holding Import. Restore now also lives on step 0 of onboarding.

### Polish and hardening (Phase 8)

The acceptance test for this phase was a full keyboard-only run, and it found more than the visual pass would have:

- **No skip link.** Reaching page content cost fourteen Tab presses on every screen — and focus is moved back to the heading on every navigation, so it was fourteen presses *per route change*.
- **Three dialogs claimed `aria-modal="true"` and trapped nothing.** That attribute tells a screen reader to ignore the page behind it and has no effect on the Tab key. Focus left the achievement modal on twelve of twelve tabs, and the session's exit confirmation — the one you reach by pressing Escape — never received focus at all. `lib/useFocusTrap.ts` now handles focus-in, containment, focus-restore and Escape together, since shipping three of the four is the normal failure.
- **The same null-node bug shipped three times.** `usePresence` mounts a dialog one render after it is requested, so `useFocusTrap(ref, open)` runs against a null node and silently never runs again. The hook now warns in dev — and caught its own third occurrence within minutes of the warning being added.
- **The Sound toggle had never done anything.** Five phases of a switch that wrote a boolean nothing read. Cues are synthesised with Web Audio (no audio files, no bundle cost), default off, and the toggle plays a tone on enable so "on" is distinguishable from "broken".
- **`AiError.kind` had six values and nothing read any of them.** Every error path printed `error.message`. The copy is now keyed on the kind, and `retryable` decides whether a Retry button is rendered — a retry button on an endpoint that does not exist is a lie with a click target. The Hint button had no pending state and no catch at all, so in live mode it threw an unhandled rejection and did nothing visible: the one path where the user has already admitted they are stuck was the one that failed silently.
- **Five keyframes were dead** — `drawIn` for the serpentine connector Phase 5 removed, `inkFill` for skeletons the narrative loader made unnecessary — and are deleted rather than kept.

Keyboard shortcuts are `g`-prefixed (`g t`, `g p`, `g r`, `g g`, `g s`, `g u`) with `?` for the list, off while typing and off inside the player, where `1`–`4` already pick answers.

Verified: 360px with no overflow on any of seven screens, exactly two things looping on idle, every neutral warm, nothing translucent, cards do not lift on hover, and every focusable paints a ring including on blue buttons.

Still scripted, and labelled as such in the UI:

- **The instant check after each question is local** — exact match for multiple choice, rubric-keyword overlap for short answers. The *score* comes from the real `/assess`. The UI says which is which rather than implying the keyword check is comprehension.
- **Five of the eight AI tasks have no endpoint.** `lib/ai/httpProvider.ts` throws `unconfigured` naming the exact route each one needs. That list is the backend work order.

## Requested UX change implemented

The initial setup page no longer asks for a goal field. It now asks for:

- Topic
- Difficulty level
- Daily time

This change was applied in the frontend form. The backend request model remains backward compatible with an optional `goal` field (defaults to `""`), and the frontend sends `goal: ''` on every call. `goal` still flows into the path and lesson prompts, so it can be reintroduced later without an API change.

## Future steps

These are the next logical improvements for the project.

### 1. Persistence layer
- Add SQLite database
- Save user topic, concept mastery, streak, and session history

### 2. Real mastery engine
- Update concept mastery values based on performance
- Mark concepts as mastered, current, or needs-review
- Use that to determine which concept appears next

### 3. Better adaptive learning logic
- Recommend review if a misconception is detected
- Prevent advancing too quickly
- Reuse mastery to decide next sessions

### 4. Real OpenAI integration
- Add the OpenAI API key
- Use the LLM for path generation, lesson generation, and structured assessment feedback
- Add better prompt engineering for educational explanations

### 5. More polished lesson experience
- Add distinct lesson slide progression
- Improve UI for the teaching/explanation stage
- Add a clearer "Next" flow between teaching and questions

### 6. More complete progress dashboard
- Show mastery by concept
- Show total progress through path
- Add date-based streak logic

### 7. Optional "Teach It Back" feature
- Let the user explain a concept in their own words
- Have AI analyze what they understand, what is missing, and what to review

## Short handoff note for another agent

> This is a lightweight AI learning app MVP inspired by Duolingo, built in React + TypeScript on the frontend and FastAPI on the backend. The core loop is: choose a topic, generate a learning path, complete a short lesson, answer a set of quiz and free-response questions, evaluate understanding, update mastery, and recommend review or next steps.
>
> The project already has:
> - setup flow
> - learning path display
> - daily lesson viewer
> - multiple-choice and short-answer questions
> - basic assessment score + misconception feedback
> - progress summary cards
> - backend endpoints for setup, lesson generation, and assessment
>
> The current UX has been simplified so the initial setup only asks for topic, difficulty level, and daily time; the goal field was removed from the first screen. The code structure is ready for the next phase, which should focus on persistence, real mastery tracking, stronger adaptive recommendations, and actual OpenAI-driven lesson generation and evaluation.

## Running it

The backend virtualenv lives at `.venv/` in the repo root (gitignored) and is built on **Python 3.12** — pydantic 2.9.2 has no prebuilt wheel for 3.14, so 3.12 avoids a source build.

```bash
# one-time setup
python3.12 -m venv .venv
.venv/bin/pip install -r backend/requirements.txt
cd frontend && npm install

# run backend (:8000)
cd backend && ../.venv/bin/python run.py

# run frontend (:5173)
cd frontend && npm run dev
```

Set `OPENAI_API_KEY` in `backend/.env` (see `backend/.env.example`) for live generation; without it the API serves the built-in probability demo content.
