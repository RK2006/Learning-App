import json
import os
from pathlib import Path
from typing import Any

from dotenv import load_dotenv


load_dotenv(Path(__file__).resolve().parents[1] / ".env")

try:
    from openai import OpenAI
except Exception:  # pragma: no cover
    OpenAI = None


class LLMService:
    def __init__(self) -> None:
        self.api_key = os.getenv("OPENAI_API_KEY")
        self.client = OpenAI(api_key=self.api_key, timeout=30.0) if self.api_key and OpenAI else None

    def _generate_json(self, prompt: str, name: str, schema: dict[str, Any]) -> dict[str, Any]:
        if self.client is None:
            raise RuntimeError("OpenAI is not configured")

        response = self.client.responses.create(
            model="gpt-4o-mini",
            input=[{"role": "user", "content": prompt}],
            text={
                "format": {
                    "type": "json_schema",
                    "name": name,
                    "schema": schema,
                    "strict": True,
                }
            },
        )
        try:
            data = json.loads(response.output_text)
        except json.JSONDecodeError as exc:
            raise RuntimeError("OpenAI returned invalid JSON") from exc

        if not isinstance(data, dict):
            raise RuntimeError("OpenAI returned an unexpected response shape")
        return data

    def generate_learning_path(self, topic: str, goal: str, level: str, daily_time: int) -> list[dict[str, Any]]:
        if self.client is None:
            return [
                {"id": "1", "name": "Sample Spaces", "order": 1, "mastery": 30, "status": "completed"},
                {"id": "2", "name": "Events", "order": 2, "mastery": 45, "status": "completed"},
                {"id": "3", "name": "Basic Probability", "order": 3, "mastery": 62, "status": "completed"},
                {"id": "4", "name": "Conditional Probability", "order": 4, "mastery": 58, "status": "current"},
                {"id": "5", "name": "Independence", "order": 5, "mastery": 40, "status": "locked"},
                {"id": "6", "name": "Bayes' Theorem", "order": 6, "mastery": 20, "status": "locked"},
                {"id": "7", "name": "Random Variables", "order": 7, "mastery": 10, "status": "locked"},
            ]

        prompt = f"Create a 7-concept beginner-friendly learning path for {topic}. Goal: {goal}. Difficulty: {level}. Daily study time: {daily_time} minutes. Return a JSON object with a concepts array. Each concept must contain id, name, order, mastery, and status. Use completed for the first three concepts, current for the fourth, and locked for the rest."
        data = self._generate_json(
            prompt,
            "learning_path",
            {
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
                                "mastery": {"type": "integer", "minimum": 0, "maximum": 100},
                                "status": {
                                    "type": "string",
                                    "enum": ["locked", "current", "completed", "needs-review"],
                                },
                            },
                            "required": ["id", "name", "order", "mastery", "status"],
                            "additionalProperties": False,
                        },
                        "minItems": 7,
                        "maxItems": 7,
                    }
                },
                "required": ["concepts"],
                "additionalProperties": False,
            },
        )
        concepts = data.get("concepts")
        if not isinstance(concepts, list):
            raise RuntimeError("OpenAI response did not contain a concepts list")
        return concepts

    def generate_lesson(self, topic: str, goal: str, level: str) -> dict[str, Any]:
        if self.client is None:
            return {
                "concept": "Conditional Probability",
                "title": "Understanding conditional probability",
                "explanation": "Conditional probability asks: if we already know that event B happened, what is the chance that event A also happened? We write it as P(A|B), which means probability of A given B.",
                "example": "If 20 of 100 students study statistics and 10 of those 20 also play chess, then the chance a student plays chess given they study statistics is 10/20 = 0.5.",
                "questions": [
                    {
                        "id": "mc1",
                        "type": "multiple-choice",
                        "prompt": "Which equation represents conditional probability?",
                        "options": [
                            "P(A|B) = P(A) / P(B)",
                            "P(A|B) = P(A and B) / P(B)",
                            "P(A|B) = P(A and B) + P(B)",
                            "P(A|B) = P(B) / P(A)",
                        ],
                        "correct_answer": "P(A|B) = P(A and B) / P(B)",
                    },
                    {
                        "id": "sa1",
                        "type": "short-answer",
                        "prompt": "Explain conditional probability in your own words and give one example.",
                    },
                ],
            }

        prompt = f"Teach a short daily lesson on {topic}. Goal: {goal}. Difficulty: {level}. Produce JSON with concept, title, explanation, example, and two questions: one multiple choice and one short answer."
        return self._generate_json(
            prompt,
            "lesson",
            {
                "type": "object",
                "properties": {
                    "concept": {"type": "string"},
                    "title": {"type": "string"},
                    "explanation": {"type": "string"},
                    "example": {"type": "string"},
                    "questions": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "id": {"type": "string"},
                                "type": {"type": "string", "enum": ["multiple-choice", "short-answer"]},
                                "prompt": {"type": "string"},
                                "options": {"type": ["array", "null"], "items": {"type": "string"}},
                                "correct_answer": {"type": ["string", "null"]},
                            },
                            "required": ["id", "type", "prompt", "options", "correct_answer"],
                            "additionalProperties": False,
                        },
                        "minItems": 2,
                        "maxItems": 2,
                    },
                },
                "required": ["concept", "title", "explanation", "example", "questions"],
                "additionalProperties": False,
            },
        )

    def assess_answer(self, topic: str, answers: dict[str, str], lesson: dict[str, Any]) -> dict[str, Any]:
        if self.client is None:
            return {
                "score": 75,
                "correct": True,
                "misconceptions": ["Confuses P(A|B) with P(B|A)"],
                "feedback": "You understand the basic idea, but you should be careful not to reverse the condition and the event. Review the definition and compare P(A|B) with P(B|A) in a worked example.",
                "needs_review": True,
            }

        prompt = f"Evaluate this answer for a learning lesson on {topic}. Lesson: {lesson}. Answers: {answers}. Return JSON with score, correct, misconceptions, feedback, needs_review."
        return self._generate_json(
            prompt,
            "assessment",
            {
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
            },
        )
