"""The API.

A STATELESS CONTENT SERVICE. That is the architectural decision, and it is a
decision rather than a default -- the alternative was a stateful platform owning
learner progress.

The evidence against that: the browser already holds ~3,100 lines of pure,
tested, clock-injectable engines (mastery with half-life decay, SM-2 Lite,
streaks, XP, achievements, forecasting) plus eleven persisted state slices, and
`state/commit.ts` applies all of it in ONE synchronous transition on zero
network. A server would gain no correctness by owning mastery -- decay is a pure
function of the stored value and a clock, so it would recompute the identical
function on read -- and it would inherit a timezone problem, because streak day
boundaries are the learner's local wall time. Worse, making the commit a round
trip puts a network boundary in the middle of an atomic transition, which is the
exact split-state failure that file was written to prevent.

So: this service generates content and nothing else. It has never seen a
learner's answers, and it does not pretend to. Where a response used to carry
`mastery` and `status`, it now carries neither, because those were invented.

WHAT EVERY ENDPOINT HERE SHARES.
  * No canned content on any path, including the no-key path. It fails loudly.
  * Counts are parameters, defaulted to the old hardcoded values.
  * Free client text is sanitized and fenced before it reaches a prompt.
  * Model output is semantically validated, not merely schema-checked.
  * Errors carry a `kind` the client has copy for.
"""

from __future__ import annotations

import os
import secrets

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app import prompts, schemas
from app.errors import LlmError
from app.limits import (
    MAX_ANSWER, MAX_ANSWERS, MAX_ATTEMPTS, MAX_CONCEPTS, MAX_CONCEPT_NAME,
    MAX_EXTEND_CONCEPTS, MAX_FREE_TEXT, MAX_GOAL, MAX_LESSON_QUESTIONS,
    MAX_MISCONCEPTIONS, MAX_MISCONCEPTION_LEN, MAX_PRACTICE_QUESTIONS,
    MAX_SEEN_PROMPTS, MAX_SEEN_PROMPT_LEN, MAX_SLIDES, MAX_TOPIC, MIN_SLIDES,
    RateLimiter, clamp_int, sanitize, sanitize_list,
)
from app.llm import LlmClient
from app.models import (
    AssessRequest, AssessmentResult, ExplainRequest, ExplanationResponse,
    ExtendPathRequest, HintRequest, HintResponse, LessonRequest, LessonResponse,
    QuestionsRequest, QuestionsResponse, RecommendRequest, RecommendationResponse,
    SetupRequest, SetupResponse, TeachBackRequest, TeachBackResponse,
)
from app.validate import validate_lesson, validate_path, validate_questions

app = FastAPI(title="Learnable content API")
llm = LlmClient()

# Generation is metered; everything else is not. Measured cost is about a third
# of a cent per session, so this is not about a legitimate learner's bill -- it
# is about an unauthenticated endpoint with permissive CORS that will generate
# for anyone who asks.
generation_limiter = RateLimiter(
    limit=int(os.getenv("LEARNABLE_RATE_LIMIT", "60")),
    window_s=float(os.getenv("LEARNABLE_RATE_WINDOW", "60")),
)

# Defaults to the Vite dev server rather than "*". The previous `allow_origins
# =["*"]` with `allow_credentials=True` is a combination browsers reject anyway,
# and it let any page on the internet spend this key. Override for deployment.
_origins = os.getenv("LEARNABLE_CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in _origins.split(",") if o.strip()],
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type"],
)


@app.exception_handler(LlmError)
async def _llm_error(_: Request, exc: LlmError) -> JSONResponse:
    """One shape for every failure.

    `kind` is the field that matters. The client does not branch on status code;
    it reads `kind`, looks up copy, and decides from that whether showing a
    Retry button would be honest. `detail` is FastAPI's convention and is kept
    so the interactive docs stay useful.
    """
    return JSONResponse(
        status_code=exc.status,
        content={"kind": exc.kind, "message": exc.message, "detail": exc.message},
    )


def _meter(request: Request) -> None:
    client = request.client
    generation_limiter.check(client.host if client else "unknown")


def _nonce() -> str:
    """A per-response id namespace.

    Question ids were literally "mc1" and "sa1" on every single lesson. Answers
    are keyed by question id in the session reducer, so appending a practice
    batch to a running session silently overwrote an earlier answer, and /assess
    then graded the wrong text against the wrong question. Ids have to be unique
    across BATCHES, not just within one, and only the server can guarantee that.
    """
    return secrets.token_hex(3)


@app.get("/health")
def health() -> dict:
    """Readiness, not liveness.

    `configured` is the field with teeth: the process is up either way, but with
    no key every generation endpoint will 503, and it is better for a client to
    know that before committing someone to a twelve-second wait.

    Usage is reported because "what does unlimited cost" should be answerable
    from the running service rather than estimated. Process-lifetime only, and
    labelled as an estimate because it is computed from a hardcoded list price,
    not from anything actually billed.
    """
    return {
        "status": "ok",
        "ok": True,
        "configured": llm.configured,
        "model": os.getenv("LEARNABLE_MODEL", "gpt-4o-mini"),
        "cache": llm.cache.stats(),
        "usage_this_process": llm.usage(),
    }


# ------------------------------------------------------------------ path ---

@app.post("/setup", response_model=SetupResponse)
def setup(payload: SetupRequest, request: Request) -> SetupResponse:
    _meter(request)
    topic = sanitize(payload.topic, MAX_TOPIC, "topic")
    if not topic:
        from app.errors import invalid
        raise invalid("A topic is required.")
    goal = sanitize(payload.goal, MAX_GOAL, "goal")
    prior = sanitize(payload.prior_knowledge, MAX_GOAL, "prior_knowledge")
    n = clamp_int(payload.concept_count, 1, MAX_CONCEPTS, "concept_count")
    minutes = clamp_int(payload.daily_time, 1, 240, "daily_time")

    prompt = prompts.path_prompt(topic, goal, payload.level, minutes, n, prior_knowledge=prior)
    data = llm.generate(
        "path", prompt, "learning_path", schemas.path_schema(n),
        key_payload={"topic": topic, "goal": goal, "level": payload.level,
                     "minutes": minutes, "n": n, "prior": prior},
    )
    concepts = validate_path(data.get("concepts") or [])
    return SetupResponse(topic=topic, goal=goal, daily_time=minutes,
                         level=payload.level, concepts=concepts)


@app.post("/path/extend", response_model=SetupResponse)
def extend_path(payload: ExtendPathRequest, request: Request) -> SetupResponse:
    """Unbounded depth. Finishing a course used to be a dead end."""
    _meter(request)
    topic = sanitize(payload.topic, MAX_TOPIC, "topic")
    if not topic:
        from app.errors import invalid
        raise invalid("A topic is required.")
    goal = sanitize(payload.goal, MAX_GOAL, "goal")
    n = clamp_int(payload.concept_count, 1, MAX_EXTEND_CONCEPTS, "concept_count")
    minutes = clamp_int(payload.daily_time, 1, 240, "daily_time")
    # Bounded independently of MAX_CONCEPTS: this is prompt INPUT, and a path
    # that has been extended many times would otherwise grow the prompt without
    # limit. The most recent concepts are the ones that constrain what follows.
    after = sanitize_list(payload.after, MAX_CONCEPTS, MAX_CONCEPT_NAME, "after")

    prompt = prompts.path_prompt(topic, goal, payload.level, minutes, n, after=after)
    data = llm.generate(
        "path_extend", prompt, "learning_path", schemas.path_schema(n),
        key_payload={"topic": topic, "goal": goal, "level": payload.level,
                     "minutes": minutes, "n": n, "after": after},
    )
    concepts = validate_path(data.get("concepts") or [], exclude=after)
    return SetupResponse(topic=topic, goal=goal, daily_time=minutes,
                         level=payload.level, concepts=concepts)


# ---------------------------------------------------------------- lesson ---

@app.post("/lesson", response_model=LessonResponse)
def lesson(payload: LessonRequest, request: Request) -> LessonResponse:
    _meter(request)
    topic = sanitize(payload.topic, MAX_TOPIC, "topic")
    # Falls back to `goal` only because that is where the concept name used to
    # be smuggled. A client that has not been updated still works; a current one
    # sends the typed field and never touches this branch.
    concept_name = sanitize(payload.concept_name, MAX_CONCEPT_NAME, "concept_name") or sanitize(
        payload.goal.replace("Teach specifically:", ""), MAX_CONCEPT_NAME, "goal"
    )
    if not topic:
        from app.errors import invalid
        raise invalid("A topic is required.")

    n_q = clamp_int(payload.question_count, 1, MAX_LESSON_QUESTIONS, "question_count")
    smin = clamp_int(payload.slide_min, MIN_SLIDES, MAX_SLIDES, "slide_min")
    smax = clamp_int(payload.slide_max, smin, MAX_SLIDES, "slide_max")
    minutes = clamp_int(payload.minutes if payload.minutes is not None else payload.daily_time,
                        1, 240, "minutes")

    misconceptions = sanitize_list(
        payload.misconceptions_to_watch, MAX_MISCONCEPTIONS, MAX_MISCONCEPTION_LEN,
        "misconceptions_to_watch",
    )
    history = [int(s) for s in payload.attempt_history[-MAX_ATTEMPTS:] if isinstance(s, (int, float))]

    prompt = prompts.lesson_prompt(
        topic, concept_name, payload.level, minutes, misconceptions, history,
        payload.is_review, n_q, smin, smax,
    )
    data = llm.generate(
        "lesson", prompt, "lesson", schemas.lesson_schema(n_q, smin, smax),
        # is_review and the misconception set are IN the key deliberately. A key
        # without them would serve a re-teach the very lesson it exists to
        # differ from -- the one the learner already failed to understand.
        key_payload={"topic": topic, "concept": concept_name, "level": payload.level,
                     "minutes": minutes, "misconceptions": misconceptions,
                     "history": history, "is_review": payload.is_review,
                     "n_q": n_q, "smin": smin, "smax": smax},
    )
    return LessonResponse(**validate_lesson(data, concept_name=concept_name, id_prefix=_nonce()))


# ------------------------------------------------------------- questions ---

@app.post("/questions", response_model=QuestionsResponse)
def questions(payload: QuestionsRequest, request: Request) -> QuestionsResponse:
    """More practice, forever.

    Unbounded by repetition rather than by size: ask again with a longer
    `seen_prompts` and get material you have not seen. That is also what keeps
    the cache honest -- a different seen-list is a different cache key, so
    "cached" and "non-repeating" do not fight each other.
    """
    _meter(request)
    topic = sanitize(payload.topic, MAX_TOPIC, "topic")
    concept_name = sanitize(payload.concept_name, MAX_CONCEPT_NAME, "concept_name")
    if not topic or not concept_name:
        from app.errors import invalid
        raise invalid("Both topic and concept_name are required.")

    n = clamp_int(payload.count, 1, MAX_PRACTICE_QUESTIONS, "count")
    seen = sanitize_list(payload.seen_prompts, MAX_SEEN_PROMPTS, MAX_SEEN_PROMPT_LEN, "seen_prompts")
    target = sanitize(payload.target_misconception, MAX_MISCONCEPTION_LEN, "target_misconception")
    types = [t for t in payload.types if t in ("multiple-choice", "short-answer")] or [
        "multiple-choice", "short-answer"
    ]

    prompt = prompts.questions_prompt(topic, concept_name, payload.level, n, types, seen, target)
    data = llm.generate(
        "questions", prompt, "questions", schemas.questions_schema(n),
        key_payload={"topic": topic, "concept": concept_name, "level": payload.level,
                     "n": n, "types": types, "seen": seen, "target": target},
    )
    return QuestionsResponse(
        questions=validate_questions(data.get("questions") or [], id_prefix=_nonce())
    )


# ---------------------------------------------------------------- assess ---

@app.post("/assess", response_model=AssessmentResult)
def assess(payload: AssessRequest, request: Request) -> AssessmentResult:
    _meter(request)
    topic = sanitize(payload.topic, MAX_TOPIC, "topic")
    concept_name = sanitize(payload.concept_name, MAX_CONCEPT_NAME, "concept_name") or sanitize(
        payload.lesson.concept, MAX_CONCEPT_NAME, "concept"
    )
    answers = {
        sanitize(k, 64, "answer key"): sanitize(v, MAX_ANSWER, "answer")
        for k, v in list(payload.answers.items())[:MAX_ANSWERS]
    }

    lesson_body = payload.lesson.model_dump()
    prompt = prompts.assess_prompt(topic, concept_name, lesson_body, answers)
    # NOT cached. Two learners can write the same answer and still deserve a
    # separately considered grade, and a cached assessment is the one response
    # in this service where a stale hit would be a lie about a person's work.
    data = llm.generate("assess", prompt, "assessment", schemas.assess_schema())

    score = max(0, min(100, int(data.get("score", 0))))
    return AssessmentResult(
        score=score,
        # Recomputed from the score rather than trusted. The prompt states the
        # rule (correct when >= 70) and the model will occasionally return a
        # score of 90 alongside correct=false, which shows the learner a failing
        # verdict on a passing score.
        correct=score >= 70,
        needs_review=score < 70,
        misconceptions=[m for m in (data.get("misconceptions") or []) if str(m).strip()],
        feedback=str(data.get("feedback") or ""),
    )


# ------------------------------------------------------------------ hint ---

@app.post("/hint", response_model=HintResponse)
def hint(payload: HintRequest, request: Request) -> HintResponse:
    """The one task that had a caller and no route.

    Clicking Hint in live mode threw `unconfigured` and, with no catch anywhere
    near it, produced an unhandled rejection and nothing on screen -- the single
    path where the learner has already admitted they are stuck was the one that
    failed silently.
    """
    _meter(request)
    topic = sanitize(payload.topic, MAX_TOPIC, "topic")
    concept_name = sanitize(payload.concept_name, MAX_CONCEPT_NAME, "concept_name")
    question_prompt = sanitize(payload.question_prompt, MAX_FREE_TEXT, "question_prompt")
    if not question_prompt:
        from app.errors import invalid
        raise invalid("question_prompt is required to hint at anything.")

    max_level = clamp_int(payload.max_level, 1, 10, "max_level")
    level = clamp_int(payload.level, 1, max_level, "level")
    partial = sanitize(payload.partial_attempt, MAX_ANSWER, "partial_attempt")
    prior = sanitize_list(payload.prior_hints, max_level, MAX_FREE_TEXT, "prior_hints")

    prompt = prompts.hint_prompt(topic, concept_name, question_prompt, partial, level, max_level, prior)
    data = llm.generate(
        "hint", prompt, "hint", schemas.hint_schema(),
        # Keyed on the prior hints too, so hint 2 cannot be served hint 1 back.
        key_payload={"topic": topic, "concept": concept_name, "q": question_prompt,
                     "partial": partial, "level": level, "max": max_level, "prior": prior},
    )
    # Arithmetic, computed here rather than asked of the model: a model that got
    # it wrong would retire a hint button with hints still behind it.
    return HintResponse(text=str(data.get("text") or ""), exhausted=level >= max_level)


# --------------------------------------------------------------- explain ---

@app.post("/explain", response_model=ExplanationResponse)
def explain(payload: ExplainRequest, request: Request) -> ExplanationResponse:
    """Re-explain one passage, mid-lesson.

    Distinct from `/lesson` with `is_review`, and both exist because they are
    genuinely different products: this replaces a PARAGRAPH the learner is
    reading right now and keeps them in place, while a review lesson replaces
    the whole session on a later day. Collapsing them would mean regenerating a
    full lesson to answer "I don't follow this slide".
    """
    _meter(request)
    topic = sanitize(payload.topic, MAX_TOPIC, "topic")
    concept_name = sanitize(payload.concept_name, MAX_CONCEPT_NAME, "concept_name")
    prior = sanitize(payload.prior_explanation, MAX_FREE_TEXT, "prior_explanation")
    confusion = sanitize(payload.confusion_point, MAX_FREE_TEXT, "confusion_point")
    if not prior:
        from app.errors import invalid
        raise invalid("prior_explanation is required -- there is nothing to re-explain without it.")

    prompt = prompts.explain_prompt(topic, concept_name, prior, confusion)
    data = llm.generate(
        "explain", prompt, "explanation", schemas.explain_schema(),
        key_payload={"topic": topic, "concept": concept_name, "prior": prior, "confusion": confusion},
    )
    return ExplanationResponse(explanation=str(data.get("explanation") or ""))


# ------------------------------------------------------------ teach back ---

@app.post("/teach-back", response_model=TeachBackResponse)
def teach_back(payload: TeachBackRequest, request: Request) -> TeachBackResponse:
    _meter(request)
    topic = sanitize(payload.topic, MAX_TOPIC, "topic")
    concept_name = sanitize(payload.concept_name, MAX_CONCEPT_NAME, "concept_name")
    explanation = sanitize(payload.explanation, MAX_FREE_TEXT, "explanation")
    if not explanation:
        from app.errors import invalid
        raise invalid("There is nothing to assess without an explanation.")

    prompt = prompts.teach_back_prompt(topic, concept_name, explanation)
    # Not cached: this grades a specific person's specific words.
    data = llm.generate("teach_back", prompt, "teach_back", schemas.teach_back_schema())
    return TeachBackResponse(
        coverage=max(0, min(100, int(data.get("coverage", 0)))),
        understood=[str(x) for x in (data.get("understood") or [])],
        missing=[str(x) for x in (data.get("missing") or [])],
        incorrect=[str(x) for x in (data.get("incorrect") or [])],
        follow_up_question=str(data.get("follow_up_question") or ""),
    )


# ------------------------------------------------------------- recommend ---

@app.post("/recommend", response_model=RecommendationResponse)
def recommend(payload: RecommendRequest, request: Request) -> RecommendationResponse:
    _meter(request)
    topic = sanitize(payload.topic, MAX_TOPIC, "topic")
    mastery = {
        sanitize(k, MAX_CONCEPT_NAME, "concept"): max(0, min(100, int(v)))
        for k, v in list(payload.mastery_by_concept.items())[:MAX_CONCEPTS]
    }
    due = sanitize_list(payload.due_concepts, MAX_CONCEPTS, MAX_CONCEPT_NAME, "due_concepts")
    overdue = sanitize_list(payload.overdue_concepts, MAX_CONCEPTS, MAX_CONCEPT_NAME, "overdue_concepts")
    minutes = clamp_int(payload.minutes_available, 1, 240, "minutes_available")

    prompt = prompts.recommend_prompt(topic, mastery, due, overdue, minutes)
    data = llm.generate(
        "recommend", prompt, "recommendation", schemas.recommend_schema(),
        key_payload={"topic": topic, "mastery": mastery, "due": due,
                     "overdue": overdue, "minutes": minutes},
    )

    # A recommended concept that is not on the path is one the client cannot
    # navigate to -- it would render a button leading nowhere, which is exactly
    # the dead control this project exists to remove. Filter, do not trust.
    known = {name.casefold(): name for name in mastery}
    for name in due + overdue:
        known.setdefault(name.casefold(), name)
    names = [known[str(n).casefold()] for n in (data.get("concept_names") or [])
             if str(n).casefold() in known]

    action = data.get("action")
    if action not in ("review", "continue", "practice", "rest"):
        action = "review" if overdue else "continue"
    # "continue" means a concept the learner has not started, which is by
    # definition not in the mastery map, so an empty list is correct there.
    if action in ("review", "practice") and not names:
        action = "continue"

    return RecommendationResponse(
        action=action, concept_names=names, reason=str(data.get("reason") or "")
    )
