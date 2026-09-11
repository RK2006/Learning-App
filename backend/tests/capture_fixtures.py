"""Record RAW model output, once, so validators can be tested against it forever.

WHY THIS EXISTS AND WHY IT IS NOT A UNIT TEST.

The three bugs this service shipped were all invisible without an API key: a
score that meant "2 of 2" instead of 2%, a path that arrived pre-completed, and
generated fields Pydantic silently dropped. All three satisfied the JSON schema
perfectly. No amount of testing against the mock would have caught any of them,
because the mock constructs valid output BY CONSTRUCTION -- mockProvider builds
options as `shuffle([correct, ...distractors])`, so `correct_answer` is always
among `options` and the single most important check in validate.py has nothing
to bite on.

So the testable artifact is a corpus of real responses. Run this once (it costs
a few cents), commit the JSON, and every later run of the test suite checks the
validators against output a model actually produced, with no key and no network.

    ../.venv/bin/python tests/capture_fixtures.py

Recorded output is captured BEFORE validation, deliberately. Fixtures of
already-cleaned data would prove only that clean data stays clean.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app import prompts, schemas  # noqa: E402
from app.llm import LlmClient  # noqa: E402

OUT = Path(__file__).parent / "fixtures"
OUT.mkdir(exist_ok=True)

# Spread across subjects, levels and counts on purpose. A corpus of one topic
# records one topic's quirks; the rubric-keyword problem showed up on history
# and not on probability.
CASES = [
    ("path_roman_12", "path", lambda: (
        prompts.path_prompt("Roman History", "", "Medium", 10, 12),
        "learning_path", schemas.path_schema(12))),
    ("path_music_5", "path", lambda: (
        prompts.path_prompt("Music Theory", "write songs", "Easy", 5, 5),
        "learning_path", schemas.path_schema(5))),
    ("lesson_punic_4q", "lesson", lambda: (
        prompts.lesson_prompt("Roman History", "The Punic Wars", "Medium", 10,
                              ["Thinks Hannibal captured Rome itself"], [40, 55],
                              True, 4, 3, 5),
        "lesson", schemas.lesson_schema(4, 3, 5))),
    ("lesson_bayes_2q", "lesson", lambda: (
        prompts.lesson_prompt("Probability", "Conditional Probability", "Hard", 15,
                              [], [], False, 2, 2, 4),
        "lesson", schemas.lesson_schema(2, 2, 4))),
    ("lesson_chords_6q", "lesson", lambda: (
        prompts.lesson_prompt("Music Theory", "Diatonic chords", "Easy", 5,
                              [], [], False, 6, 2, 4),
        "lesson", schemas.lesson_schema(6, 2, 4))),
    ("questions_punic_5", "questions", lambda: (
        prompts.questions_prompt("Roman History", "The Punic Wars", "Medium", 5,
                                 ["multiple-choice", "short-answer"], []),
        "questions", schemas.questions_schema(5))),
    ("assess_partial", "assess", lambda: (
        prompts.assess_prompt(
            "Roman History", "The Punic Wars",
            {"explanation": "Rome fought Carthage three times between 264 and 146 BC.",
             "example": "Hannibal crossed the Alps in 218 BC.",
             "questions": [
                 {"id": "q1", "type": "multiple-choice",
                  "prompt": "Who led Carthage in the Second Punic War?",
                  "correct_answer": "Hannibal"},
                 {"id": "q2", "type": "short-answer",
                  "prompt": "Why did Rome win despite Cannae?",
                  "correct_answer": "Rome could replace losses and Hannibal could not."},
             ]},
            {"q1": "Hannibal", "q2": "Because Hannibal captured Rome and then left"}),
        "assessment", schemas.assess_schema())),
]


def main() -> int:
    llm = LlmClient()
    if not llm.configured:
        print("No OPENAI_API_KEY. Capturing fixtures requires a real key, by design:\n"
              "the whole point is output a model actually produced.")
        return 1

    for name, task, build in CASES:
        prompt, schema_name, schema = build()
        print(f"capturing {name} ...", end=" ", flush=True)
        try:
            # key_payload omitted so the cache is bypassed: a fixture recorded
            # from a cache hit is a copy of an earlier fixture.
            data = llm.generate(task, prompt, schema_name, schema)
        except Exception as exc:
            print(f"FAILED {type(exc).__name__}: {exc}")
            continue
        (OUT / f"{name}.json").write_text(json.dumps(data, indent=2, ensure_ascii=False))
        print("ok")

    print("\nusage:", json.dumps(llm.usage()))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
