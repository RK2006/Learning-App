"""JSON schemas for the Responses API, built per request rather than declared.

WHY THESE ARE FUNCTIONS AND NOT CONSTANTS.

The old schemas hardcoded `"minItems": 7, "maxItems": 7` for concepts and
`2/2` for questions, so there was no way to ask for more of anything, ever.
Making the counts parameters is the whole of "unlimited" on the schema side.

That rests on a measured fact, not an assumption. Probed against gpt-4o-mini
with `strict: true`:

  * schema 12/12, prompt says 12          -> 12 concepts
  * no bounds at all, prompt says 12      -> 12 concepts
  * no bounds at all, prompt says 25      -> 25 concepts
  * schema 3/3, prompt says 12            ->  3 concepts

So minItems/maxItems ARE honoured under strict mode, and where the schema and
the prompt disagree THE SCHEMA WINS, hard. Two consequences shape everything
below:

  1. The schema is the enforcement mechanism. Bounds go here, always.
  2. The prompt must AGREE with the schema or it silently loses. Every builder
     in prompts.py is passed the same `n` these functions receive, so the two
     can never drift apart -- which is exactly what would happen if one lived in
     a constant and the other in an f-string.

`strict: true` also requires that `required` list every property and that
`additionalProperties` be False on every object. A field you forget to require
is not optional, it is a 400 from the API.
"""

from __future__ import annotations

from typing import Any

# `why` and `hint` are non-nullable on purpose. As `["string", "null"]` the
# model simply returned null for all of them, every time -- a nullable field is
# an invitation, and it accepted. Every question genuinely has a reason and a
# nudge, so the schema insists.
#
# `options`, `correct_answer`, `misconception_on_wrong` and `rubric` stay
# nullable because they really do not apply to both question types.
_QUESTION_PROPS: dict[str, Any] = {
    "id": {"type": "string"},
    "type": {"type": "string", "enum": ["multiple-choice", "short-answer"]},
    "prompt": {"type": "string"},
    "options": {"type": ["array", "null"], "items": {"type": "string"}},
    "correct_answer": {"type": ["string", "null"]},
    "why": {"type": "string"},
    "hint": {"type": "string"},
    "misconception_on_wrong": {
        "type": ["object", "null"],
        "additionalProperties": {"type": "string"},
    },
    "rubric": {
        "type": ["object", "null"],
        "properties": {
            "keywords": {"type": "array", "items": {"type": "string"}},
            "required": {"type": "integer"},
        },
        "required": ["keywords", "required"],
        "additionalProperties": False,
    },
}

_QUESTION = {
    "type": "object",
    "properties": _QUESTION_PROPS,
    "required": list(_QUESTION_PROPS),
    "additionalProperties": False,
}

_SLIDE = {
    "type": "object",
    "properties": {
        "id": {"type": "string"},
        "kind": {"type": "string", "enum": ["concept", "example", "contrast", "recap"]},
        "heading": {"type": "string"},
        "body": {"type": "string"},
    },
    "required": ["id", "kind", "heading", "body"],
    "additionalProperties": False,
}


def path_schema(n: int) -> dict[str, Any]:
    """A learning path of exactly `n` concepts.

    Note what is NOT here: `mastery` and `status`.

    They used to be required, and the model was asked to fill them in -- which
    produced brand-new courses arriving with three concepts already marked
    `completed` at 3% mastery. Both fabricated, and not even consistent with
    each other, since `completed` is supposed to mean >= 80.

    A stateless server has never seen one of this learner's answers, so anything
    it says about their progress is invented. The client always ignored the
    values (normalize.ts::toConcept hardcodes 0), but `guards.ts` still REQUIRED
    the fields, so dropping them was a breaking change disguised as a cleanup.
    The guard was relaxed and shipped first; only then could these come out.
    """
    return {
        "type": "object",
        "properties": {
            "concepts": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "id": {"type": "string"},
                        "name": {"type": "string"},
                        "order": {"type": "integer"},
                    },
                    "required": ["id", "name", "order"],
                    "additionalProperties": False,
                },
                "minItems": n,
                "maxItems": n,
            }
        },
        "required": ["concepts"],
        "additionalProperties": False,
    }


def lesson_schema(questions: int, min_slides: int, max_slides: int) -> dict[str, Any]:
    """A full lesson.

    `slides` and `objectives` are REQUIRED here and declared on LessonResponse in
    models.py, and both facts matter. wire.ts declared them, normalize.ts mapped
    them, and SessionScreen rendered objectives -- but the schema never asked for
    them and `LessonResponse(**lesson)` dropped any key the model did not
    declare. Two UI surfaces sat built and permanently unreachable.

    That exact mechanism had already eaten `why`, `hint`, `rubric` and
    `misconception_on_wrong` once before. Pydantic silently discarding
    undeclared keys is this service's recurring bug, and the only defence is
    that a field must be added in BOTH places or it does not exist.
    """
    return {
        "type": "object",
        "properties": {
            "concept": {"type": "string"},
            "title": {"type": "string"},
            "explanation": {"type": "string"},
            "example": {"type": "string"},
            "objectives": {"type": "array", "items": {"type": "string"}, "minItems": 2, "maxItems": 5},
            "slides": {
                "type": "array",
                "items": _SLIDE,
                "minItems": min_slides,
                "maxItems": max_slides,
            },
            "questions": {
                "type": "array",
                "items": _QUESTION,
                "minItems": questions,
                "maxItems": questions,
            },
        },
        "required": ["concept", "title", "explanation", "example", "objectives", "slides", "questions"],
        "additionalProperties": False,
    }


def questions_schema(n: int) -> dict[str, Any]:
    """A bare batch of `n` questions, with no lesson around them.

    This split is the single most important structural decision in the service,
    and it is forced by the latency measurements. Questions are the expensive
    part of a lesson -- each one carries a `why`, a `hint`, a rubric and a
    misconception map -- so a 20-question lesson takes 19.8s against 7.0s for a
    2-question one.

    "Unlimited practice, forever" therefore cannot mean one enormous /lesson
    call: it would cross the client's 30s abort somewhere past 25 questions and
    bill for a generation nobody receives. It means asking THIS endpoint for
    another batch, as many times as the learner wants, each batch told what they
    have already seen.
    """
    return {
        "type": "object",
        "properties": {
            "questions": {"type": "array", "items": _QUESTION, "minItems": n, "maxItems": n},
        },
        "required": ["questions"],
        "additionalProperties": False,
    }


def hint_schema() -> dict[str, Any]:
    return {
        "type": "object",
        "properties": {"text": {"type": "string"}},
        "required": ["text"],
        "additionalProperties": False,
    }


def explain_schema() -> dict[str, Any]:
    return {
        "type": "object",
        "properties": {"explanation": {"type": "string"}},
        "required": ["explanation"],
        "additionalProperties": False,
    }


def teach_back_schema() -> dict[str, Any]:
    return {
        "type": "object",
        "properties": {
            "coverage": {"type": "integer", "minimum": 0, "maximum": 100},
            "understood": {"type": "array", "items": {"type": "string"}},
            "missing": {"type": "array", "items": {"type": "string"}},
            "incorrect": {"type": "array", "items": {"type": "string"}},
            "follow_up_question": {"type": "string"},
        },
        "required": ["coverage", "understood", "missing", "incorrect", "follow_up_question"],
        "additionalProperties": False,
    }


def recommend_schema() -> dict[str, Any]:
    return {
        "type": "object",
        "properties": {
            "action": {"type": "string", "enum": ["review", "continue", "practice", "rest"]},
            "concept_names": {"type": "array", "items": {"type": "string"}},
            "reason": {"type": "string"},
        },
        "required": ["action", "concept_names", "reason"],
        "additionalProperties": False,
    }


def assess_schema() -> dict[str, Any]:
    """Grading.

    The bounds on `score` were always here and were never the problem. The
    prompt never named the SCALE, so "2 of 2 correct" satisfied 0-100 perfectly
    and a flawless session was recorded as 2% mastery. The schema constrains
    shape; it cannot constrain meaning. The fix lives in prompts.py and this
    comment exists so nobody tries to move it back here.
    """
    return {
        "type": "object",
        "properties": {
            "score": {"type": "integer", "minimum": 0, "maximum": 100},
            "correct": {"type": "boolean"},
            "misconceptions": {"type": "array", "items": {"type": "string"}},
            "feedback": {"type": "string"},
            "needs_review": {"type": "boolean"},
        },
        "required": ["score", "correct", "misconceptions", "feedback", "needs_review"],
        "additionalProperties": False,
    }
