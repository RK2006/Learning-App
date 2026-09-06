"""Checks the JSON schema structurally cannot make.

THE PATTERN THIS EXISTS FOR. Three bugs shipped here before anyone had a key,
and all three had the same shape: the model satisfied the schema perfectly while
being wrong about what the fields MEANT.

  1. `score` was constrained to 0-100, and the model answered "2" meaning two
     questions out of two. Schema-valid. Recorded 2% mastery for a perfect
     session.
  2. The path schema required `status`, so the model supplied one, so brand-new
     courses arrived with three concepts already `completed`.
  3. Extra question fields were generated correctly and then silently dropped by
     `LessonResponse(**lesson)`, because Pydantic discards undeclared keys.

So: assume the model will satisfy the schema while being wrong. `correct_answer`
not among `options`, a rubric keyword absent from the model answer, an id
repeated across a batch, five options where the client's keyboard shortcuts only
go up to four.

WHY REPAIR RATHER THAN REJECT, MOSTLY. A 502 costs the learner their whole
lesson and a 12-second wait. Most of what goes wrong here is locally fixable
without inventing subject matter -- dropping a keyword the model answer does not
support removes a wrong assertion rather than adding a right one. Only the
defects that would actively teach something false are fatal.

A note on why these cannot be unit-tested against the mock: mockProvider builds
options as `shuffle([correct, ...distractors])`, so `correct_answer` is among
`options` BY CONSTRUCTION. The mock cannot produce the failure this module
catches. That is what tests/fixtures/ is for -- recorded real model output.
"""

from __future__ import annotations

import re
from typing import Any

from app.errors import malformed

# The client's keyboard handler is `KEYS = ['1','2','3','4']`. A 5-option
# question renders an option with a blank key badge and is mouse-only, so the
# count is a real contract rather than a preference. Neither side enforced it.
MC_OPTIONS = 4


def _trim(s: Any, limit: int = 400) -> str:
    text = str(s or "").strip()
    return text if len(text) <= limit else text[:limit].rstrip() + "..."


def validate_questions(questions: list[dict[str, Any]], *, id_prefix: str) -> list[dict[str, Any]]:
    """Check and repair a batch of questions. Raises only on unteachable output.

    `id_prefix` namespaces every id. This is NOT tidiness: a live /lesson used to
    return literally "mc1" and "sa1", and so did the mock. Answers are keyed by
    question id in the session reducer, so appending a practice batch to a
    session in flight silently overwrote an earlier answer in the map -- and
    /assess then graded text the learner had written for a different question.
    Server-assigned ids are the only place this can be fixed once for every
    caller, so the model's ids are overwritten rather than trusted.
    """
    out: list[dict[str, Any]] = []
    for i, q in enumerate(questions):
        qtype = q.get("type")
        prompt = _trim(q.get("prompt"))
        if not prompt:
            raise malformed("The model returned a question with an empty prompt.")

        q = dict(q)
        q["id"] = f"{id_prefix}-{i + 1}"

        if qtype == "multiple-choice":
            options = [str(o).strip() for o in (q.get("options") or []) if str(o).strip()]

            # Duplicates make two option buttons that look identical, one of
            # which is "wrong" -- and because React keys options by text, they
            # also collapse into one node with a duplicate-key warning.
            seen: set[str] = set()
            options = [o for o in options if not (o.lower() in seen or seen.add(o.lower()))]

            if len(options) < 2:
                raise malformed(
                    f"Multiple-choice question {i + 1} came back with fewer than two "
                    f"distinct options, which is not answerable."
                )

            answer = str(q.get("correct_answer") or "").strip()

            # THE central check. An answer not among the options means every
            # possible choice is marked wrong -- the learner cannot pass, and
            # the client's local grader compares by exact string.
            if answer not in options:
                match = _resolve_answer(answer, options)
                if match is None:
                    raise malformed(
                        f"Multiple-choice question {i + 1} has a correct_answer "
                        f"({_trim(answer, 80)!r}) that is not one of its options. Every "
                        f"available choice would be marked wrong."
                    )
                answer = match

            # Enforce exactly 4, keeping the correct one. Truncating is safe --
            # the remaining distractors are still wrong for their own reasons --
            # whereas padding would mean inventing subject matter here, which is
            # the one thing this service must never do. Under-count is left
            # alone and the client renders what it gets.
            if len(options) > MC_OPTIONS:
                keep = [o for o in options if o != answer][: MC_OPTIONS - 1]
                options = _restore_order(options, keep + [answer])

            q["options"] = options
            q["correct_answer"] = answer

            # A misconception mapped to an option that no longer exists (or was
            # never an option) would never be shown. Drop rather than keep.
            mw = q.get("misconception_on_wrong")
            if isinstance(mw, dict):
                q["misconception_on_wrong"] = {
                    k: v for k, v in mw.items() if k in options and k != answer
                } or None
            q["rubric"] = None  # never applies to multiple choice

        elif qtype == "short-answer":
            q["options"] = None
            q["misconception_on_wrong"] = None
            q["rubric"] = _clean_rubric(q.get("rubric"), str(q.get("correct_answer") or ""))
        else:
            raise malformed(f"Unknown question type {qtype!r} on question {i + 1}.")

        out.append(q)

    if not out:
        raise malformed("The model returned no questions.")
    return out


def _resolve_answer(answer: str, options: list[str]) -> str | None:
    """Recover the intended option when the model paraphrased its own answer.

    Only recoveries that are unambiguous are accepted. Three real failure modes,
    in decreasing order of confidence:

      * a letter or index ("B", "2", "option C") -- the model answered the
        label rather than the text;
      * a case or whitespace difference;
      * exactly one option containing the answer as a substring.

    Anything looser is refused. Guessing which option was meant and guessing
    wrong teaches the learner the wrong fact with full confidence, which is
    strictly worse than an honest error screen.
    """
    if not answer:
        return None

    m = re.fullmatch(r"(?:option\s*)?([a-dA-D]|[1-9])[).:]?", answer.strip())
    if m:
        token = m.group(1)
        idx = int(token) - 1 if token.isdigit() else ord(token.upper()) - ord("A")
        if 0 <= idx < len(options):
            return options[idx]

    folded = {o.strip().casefold(): o for o in options}
    hit = folded.get(answer.strip().casefold())
    if hit is not None:
        return hit

    needle = answer.strip().casefold()
    contains = [o for o in options if needle and needle in o.strip().casefold()]
    if len(contains) == 1:
        return contains[0]
    return None


def _restore_order(original: list[str], subset: list[str]) -> list[str]:
    """Keep the model's original ordering for whatever survived the trim.

    Reordering would cluster the correct answer at a predictable position, and
    a learner who notices that the answer is always last stops reading.
    """
    keep = set(subset)
    return [o for o in original if o in keep]


# Two-word keys are allowed ("sample space", "base rate" are real terms).
# Three or more is where the grader starts failing correct answers.
_MAX_KEYWORD_WORDS = 2
_MAX_KEYWORDS = 5
_STOPWORDS = {
    "the", "a", "an", "of", "and", "or", "to", "in", "on", "for", "with",
    "that", "this", "is", "are", "how", "why", "what", "it", "its",
}


def _clean_rubric(rubric: Any, model_answer: str) -> dict[str, Any] | None:
    """Make the offline grader's keys usable.

    A real call returned `['territorial expansion', 'dominance', 'Mediterranean',
    'power dynamics', ...]` despite the prompt asking for short distinctive
    terms. The client's grader (domain/grade.ts) requires EVERY significant
    token of a multi-word key to appear in the answer, so long keys make the
    local check far harsher than intended and mark correct answers wrong. The
    learner sees "not quite" for an answer that was right.

    So the prompt asks for short keys and this enforces it, because the prompt
    asking is demonstrably not sufficient.

    The second check is subtler: a keyword absent from the model's OWN answer is
    one the model has no grounds to demand. Dropping it removes an unsupported
    assertion; it never adds one.
    """
    if not isinstance(rubric, dict):
        return None
    raw = rubric.get("keywords")
    if not isinstance(raw, list):
        return None

    answer_fold = model_answer.casefold()
    kept: list[str] = []
    seen: set[str] = set()
    for item in raw:
        kw = re.sub(r"\s+", " ", str(item or "")).strip().strip(".,;:")
        if not kw:
            continue
        words = [w for w in kw.casefold().split() if w not in _STOPWORDS]
        if len(words) > _MAX_KEYWORD_WORDS:
            continue
        if model_answer and not all(w in answer_fold for w in words):
            continue
        if kw.casefold() in seen:
            continue
        seen.add(kw.casefold())
        kept.append(kw)
        if len(kept) >= _MAX_KEYWORDS:
            break

    if not kept:
        # Better no rubric than a rubric that cannot be satisfied. With none,
        # the client falls back to rubricFromModelAnswer, and the feedback UI
        # stops claiming to check key ideas it does not actually have.
        return None

    required = rubric.get("required")
    if not isinstance(required, int) or required < 1:
        required = max(1, (len(kept) + 1) // 2)
    return {"keywords": kept, "required": min(required, len(kept))}


def validate_lesson(lesson: dict[str, Any], *, concept_name: str, id_prefix: str) -> dict[str, Any]:
    lesson = dict(lesson)
    lesson["questions"] = validate_questions(lesson.get("questions") or [], id_prefix=id_prefix)

    if not str(lesson.get("explanation") or "").strip():
        raise malformed("The model returned a lesson with no explanation.")

    slides = [s for s in (lesson.get("slides") or []) if str(s.get("body") or "").strip()]
    for i, s in enumerate(slides):
        # Slide ids are React keys in the teach stage; duplicates make slides
        # disappear into one another.
        s["id"] = f"{id_prefix}-s{i + 1}"
    lesson["slides"] = slides or None

    lesson["objectives"] = [
        o for o in (str(x).strip() for x in (lesson.get("objectives") or [])) if o
    ] or None

    # The model naming a different concept than the one requested means the
    # learner would be taught the wrong thing under the right heading. Trusting
    # the request is right: the client renders the concept from its own path.
    if concept_name:
        lesson["concept"] = concept_name
    return lesson


def validate_path(concepts: list[dict[str, Any]], *, exclude: list[str] | None = None) -> list[dict[str, Any]]:
    """De-duplicate and renumber a generated path.

    `exclude` carries the already-completed concepts on an extend call. A model
    asked to continue a path will sometimes restate the last one or two of it,
    and a duplicate concept on the path screen looks exactly like a bug in the
    client.
    """
    banned = {c.strip().casefold() for c in (exclude or [])}
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for c in concepts:
        name = re.sub(r"\s+", " ", str(c.get("name") or "")).strip()
        fold = name.casefold()
        if not name or fold in seen or fold in banned:
            continue
        seen.add(fold)
        out.append({"id": str(c.get("id") or "").strip() or f"c{len(out) + 1}", "name": name,
                    "order": len(out) + 1})

    if not out:
        raise malformed("The model returned no usable concepts.")

    # Ids must be unique or the client's `concepts.find(c => c.id === id)` picks
    # the wrong one and the session screen teaches a different concept than the
    # one that was tapped.
    if len({c["id"] for c in out}) != len(out):
        for i, c in enumerate(out):
            c["id"] = f"c{i + 1}"
    return out
