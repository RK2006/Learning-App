"""The wire contract, typed.

frontend/src/types/wire.ts is the hand-maintained mirror of this file. A
mismatch is a silent runtime bug on the client, not a compile error on either
side, so the two move together or not at all.

TWO RULES THIS FILE EXISTS TO ENFORCE.

1. EVERY FIELD THE MODEL PRODUCES MUST BE DECLARED HERE.
   `LessonResponse(**lesson)` drops any key this module does not know about.
   That mechanism has now eaten fields twice: first `why`/`hint`/`rubric`/
   `misconception_on_wrong`, which were generated and silently discarded, and
   then `slides`/`objectives`, which wire.ts declared, normalize.ts mapped and
   SessionScreen rendered -- while the response model quietly deleted them on
   the way out, leaving two built UI surfaces permanently unreachable. It is
   this service's recurring bug. Adding a field to the JSON schema without
   adding it here does nothing at all.

2. ADDITIVE ONLY, AND OPTIONAL.
   New request fields need defaults or every existing client 422s on its next
   request. New response fields must be optional so an older client ignores
   them. Renaming anything is a coordinated release.

On counts: every `*_count` field defaults to the value that endpoint used to
hardcode, so a client that has never heard of the field gets exactly the
behaviour it had before. That is what makes unbounded generation an additive
change rather than a breaking one.
"""

from __future__ import annotations

from typing import Dict, List, Literal

from pydantic import BaseModel, Field

Level = Literal["Easy", "Medium", "Hard"]
QuestionType = Literal["multiple-choice", "short-answer"]
SlideKind = Literal["concept", "example", "contrast", "recap"]


# ------------------------------------------------------------- requests ---

class SetupRequest(BaseModel):
    topic: str
    goal: str = ""
    daily_time: int = 10
    level: Level = "Medium"
    # Was hardcoded 7/7 in the JSON schema with no way to ask for anything else.
    # Defaults to 7 so an old client is unaffected.
    concept_count: int = 7
    prior_knowledge: str = ""


class ExtendPathRequest(BaseModel):
    """Continue an existing path.

    Finishing a course was a dead end: `selectNextLocked` returns null, the
    results screen falls through to "Back to Today", and there was no endpoint
    that could have produced a next concept even if a button had existed.

    `after` is the curriculum so far, which the model needs or it regenerates
    concepts the learner has already completed.
    """
    topic: str
    goal: str = ""
    daily_time: int = 10
    level: Level = "Medium"
    after: List[str] = Field(default_factory=list)
    concept_count: int = 5


class LessonRequest(BaseModel):
    """`concept_name` is the field this endpoint always needed.

    Without it the client smuggled the concept through `goal` as
    "Teach specifically: <name>", which landed in the prompt as a free-floating
    sentence. It worked by accident, and the accident was also the injection
    hole -- free client text concatenated into instruction position.

    The other three fields close a different gap. SessionScreen computed
    `misconceptions_to_watch`, `attempt_history` and `is_review` from real
    learner state on every single load, and httpProvider then built the body
    from four of the seven fields and threw these away. contracts.ts calls the
    misconception list "the single highest-value input here -- it is what makes
    the second attempt different from the first", and it had never once reached
    a model. In live mode a review lesson was byte-identical to the first
    teaching.
    """
    topic: str
    concept_name: str = ""
    goal: str = ""
    daily_time: int = 10
    level: Level = "Medium"
    minutes: int | None = None

    misconceptions_to_watch: List[str] = Field(default_factory=list)
    attempt_history: List[int] = Field(default_factory=list)
    is_review: bool = False

    question_count: int = 2  # was hardcoded 2/2 in the schema
    slide_min: int = 2
    slide_max: int = 4


class QuestionsRequest(BaseModel):
    """Practice, unbounded by repetition rather than by size.

    Questions are the expensive part of a generation (each carries a `why`, a
    `hint`, a rubric and a misconception map), so one enormous request is the
    wrong shape: 20 questions is already 19.8s against the client's 30s abort.
    `seen_prompts` is what makes repeated small batches non-repeating.
    """
    topic: str
    concept_name: str
    level: Level = "Medium"
    count: int = 5
    types: List[QuestionType] = Field(default_factory=lambda: ["multiple-choice", "short-answer"])
    seen_prompts: List[str] = Field(default_factory=list)
    target_misconception: str = ""


class AssessRequest(BaseModel):
    """Typed at last.

    This was `payload: dict`, which meant it could not 422 on a wrong shape --
    it silently handed the model keys its prompt never mentioned. It also never
    learned which concept it was grading: the client computed `conceptName` and
    dropped it before sending.
    """
    topic: str
    concept_name: str = ""
    lesson: "LessonBody"
    answers: Dict[str, str] = Field(default_factory=dict)
    # Optional so an older client still works, in which case the model grades
    # from scratch exactly as before. When present these are AUTHORITATIVE: the
    # score is computed from them and the model is told not to contradict them.
    question_results: List["QuestionResult"] = Field(default_factory=list)


class GradeAnswerRequest(BaseModel):
    """Grade one free-response answer, mid-session.

    `protected_namespaces` is cleared because `model_answer` collides with
    Pydantic's reserved `model_` prefix. Renaming it would be worse: the field
    is the MODEL ANSWER to a question, which is what a teacher calls it, and
    wire.ts mirrors this file by hand.
    """
    model_config = {"protected_namespaces": ()}

    topic: str
    concept_name: str = ""
    question_prompt: str
    model_answer: str = ""
    rubric_keywords: List[str] = Field(default_factory=list)
    answer: str


class GradeAnswerResponse(BaseModel):
    score: int
    correct: bool
    feedback: str
    misconception: str | None = None


class QuestionResult(BaseModel):
    """A verdict already reached for one question, sent back with the session.

    THIS IS WHAT MAKES THE TWO GRADERS AGREE. Every question is graded once, as
    it is answered -- multiple choice by exact comparison on the client, free
    response by /grade. The final assessment is then handed those verdicts and
    does NOT re-judge them; the server computes the overall score from these and
    the model only writes the narrative.

    Before this, the session graded each answer by keyword overlap and /assess
    independently graded the whole thing by meaning, so a learner was told they
    were wrong mid-lesson and right in the recap, about the same sentence. Two
    opinions with nothing reconciling them. Now there is one opinion, recorded
    once, and the summary is a summary rather than a second trial.
    """
    question_id: str
    prompt: str = ""
    answer: str = ""
    score: int
    correct: bool
    # Named by /grade, which saw the answer AND the model answer for that one
    # question. Carried here rather than re-derived at the end: a summariser
    # shown only marks produces categories ("key figures", "historical events")
    # instead of confusions, because it has nothing to diagnose from.
    misconception: str | None = None


class HintRequest(BaseModel):
    """`level` is an int, not `Literal[1, 2, 3]`.

    The contract typed it as a closed union of three, the only caller always
    sent 1, and the button disabled itself afterwards. Unlimited escalating
    hints needs the wider type AND `prior_hints`: a stateless endpoint handed
    `level: 7` and nothing else regenerates the level-1 nudge with a bigger
    number on it.
    """
    topic: str
    concept_name: str
    question_prompt: str
    partial_attempt: str = ""
    level: int = 1
    max_level: int = 3
    prior_hints: List[str] = Field(default_factory=list)


class ExplainRequest(BaseModel):
    topic: str
    concept_name: str
    prior_explanation: str
    confusion_point: str = ""


class TeachBackRequest(BaseModel):
    topic: str
    concept_name: str
    explanation: str


class RecommendRequest(BaseModel):
    topic: str
    mastery_by_concept: Dict[str, int] = Field(default_factory=dict)
    due_concepts: List[str] = Field(default_factory=list)
    overdue_concepts: List[str] = Field(default_factory=list)
    minutes_available: int = 10


# ------------------------------------------------------------ responses ---

class Rubric(BaseModel):
    """Key ideas a short answer must mention, for offline grading."""
    keywords: List[str]
    required: int


class Question(BaseModel):
    id: str
    type: QuestionType
    prompt: str
    options: List[str] | None = None
    correct_answer: str | None = None
    why: str | None = None
    hint: str | None = None
    misconception_on_wrong: Dict[str, str] | None = None
    rubric: Rubric | None = None


class Slide(BaseModel):
    id: str
    kind: SlideKind
    heading: str
    body: str


class LessonBody(BaseModel):
    """Shared by LessonResponse and the lesson echoed back to /assess."""
    concept: str
    title: str
    explanation: str
    example: str
    questions: List[Question] = Field(default_factory=list)
    # Declared here as well as in the JSON schema. Declared in only one place,
    # they do not exist -- see this module's header.
    slides: List[Slide] | None = None
    objectives: List[str] | None = None


class LessonResponse(LessonBody):
    pass


class Concept(BaseModel):
    """No `mastery`, no `status`.

    A stateless server has never seen one of this learner's answers, so any
    progress value it reports is invented -- and it did invent them: the old
    prompt asked for "completed for the first three concepts", so brand-new
    courses arrived with three concepts already Strong at 3% mastery.

    Removing them was a breaking change disguised as a cleanup, because
    `guards.ts` required both even though `normalize.ts` ignored both. The
    client guard was relaxed and shipped before this line was written.
    """
    id: str
    name: str
    order: int


class SetupResponse(BaseModel):
    topic: str
    goal: str = ""
    daily_time: int = 10
    level: Level = "Medium"
    concepts: List[Concept] = Field(default_factory=list)


class QuestionsResponse(BaseModel):
    questions: List[Question] = Field(default_factory=list)


class AssessmentResult(BaseModel):
    score: int
    correct: bool
    misconceptions: List[str] = Field(default_factory=list)
    feedback: str
    needs_review: bool


class HintResponse(BaseModel):
    text: str
    # Computed by the server from level vs max_level, never asked of the model:
    # it is arithmetic, and a model asked for it would occasionally get it wrong
    # and retire a hint button that still had hints behind it.
    exhausted: bool


class ExplanationResponse(BaseModel):
    explanation: str


class TeachBackResponse(BaseModel):
    coverage: int
    understood: List[str] = Field(default_factory=list)
    missing: List[str] = Field(default_factory=list)
    incorrect: List[str] = Field(default_factory=list)
    follow_up_question: str


class RecommendationResponse(BaseModel):
    action: Literal["review", "continue", "practice", "rest"]
    concept_names: List[str] = Field(default_factory=list)
    reason: str


AssessRequest.model_rebuild()
