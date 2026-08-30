from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Literal

from app.llm_service import LLMService

app = FastAPI(title="AI Learning App API")
llm_service = LLMService()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class SetupRequest(BaseModel):
    topic: str
    goal: str = ""
    daily_time: int
    level: Literal["Easy", "Medium", "Hard"]


class Concept(BaseModel):
    id: str
    name: str
    order: int
    mastery: int
    status: Literal["locked", "current", "completed", "needs-review"]


class Question(BaseModel):
    id: str
    type: Literal["multiple-choice", "short-answer"]
    prompt: str
    options: List[str] | None = None
    correct_answer: str | None = None


class LessonResponse(BaseModel):
    concept: str
    title: str
    explanation: str
    example: str
    questions: List[Question]


class AssessmentResult(BaseModel):
    score: int
    correct: bool
    misconceptions: List[str]
    feedback: str
    needs_review: bool


@app.get("/health")
def health_check():
    return {"status": "ok"}


@app.post("/setup")
def setup_topic(payload: SetupRequest):
    concepts = llm_service.generate_learning_path(payload.topic, payload.goal, payload.level, payload.daily_time)
    return {
        "topic": payload.topic,
        "goal": payload.goal,
        "daily_time": payload.daily_time,
        "level": payload.level,
        "concepts": concepts,
    }


@app.post("/lesson")
def generate_lesson(payload: SetupRequest):
    lesson = llm_service.generate_lesson(payload.topic, payload.goal, payload.level)
    return LessonResponse(**lesson)


@app.post("/assess")
def assess_response(payload: dict):
    result = llm_service.assess_answer(payload.get("topic", "Probability"), payload.get("answers", {}), payload.get("lesson", {}))
    return AssessmentResult(**result)
