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
        self.client = OpenAI(api_key=self.api_key) if self.api_key and OpenAI else None

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

        prompt = f"Create a 7-concept beginner-friendly learning path for {topic}. Goal: {goal}. Difficulty: {level}. Daily study time: {daily_time} minutes. Respond as JSON list of objects with id, name, order, mastery, status."
        response = self.client.responses.create(
            model="gpt-4o-mini",
            input=[{"role": "user", "content": prompt}],
        )
        content = response.output_text
        try:
            import json
            data = json.loads(content)
            return data
        except Exception:
            return self.generate_learning_path(topic, goal, level, daily_time)

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
        response = self.client.responses.create(
            model="gpt-4o-mini",
            input=[{"role": "user", "content": prompt}],
        )
        content = response.output_text
        try:
            import json
            return json.loads(content)
        except Exception:
            return self.generate_lesson(topic, goal, level)

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
        response = self.client.responses.create(
            model="gpt-4o-mini",
            input=[{"role": "user", "content": prompt}],
        )
        content = response.output_text
        try:
            import json
            return json.loads(content)
        except Exception:
            return self.assess_answer(topic, answers, lesson)
