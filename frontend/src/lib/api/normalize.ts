/**
 * WIRE <-> DOMAIN mapping.
 *
 * This module and types/wire.ts are the ONLY files in the app allowed to
 * contain a snake_case identifier.
 *
 * Deliberately hand-written rather than a generic deep snake<->camel converter:
 * a generic converter cannot be typed without `any` (which defeats `strict`
 * everywhere downstream) and it silently passes through fields the backend
 * added that we never mapped. These mappers are ~90 lines, typed end to end,
 * and produce a compile error the moment wire.ts changes.
 */

import type {
  AssessRequestWire,
  ExplainRequestWire,
  ExtendPathRequestWire,
  GradeRequestWire,
  GradeResponseWire,
  HintRequestWire,
  HintResponseWire,
  LessonRequestWire,
  QuestionsRequestWire,
  RecommendRequestWire,
  RecommendationResponseWire,
  TeachBackRequestWire,
  TeachBackResponseWire,
  AssessmentResultWire,
  ConceptStatusWire,
  ConceptWire,
  LessonWire,
  LevelWire,
  QuestionWire,
  SetupRequestWire,
  SetupResponseWire,
  SlideWire,
} from '../../types/wire';
import type {
  AssessmentResult,
  Concept,
  ConceptStatus,
  Lesson,
  Level,
  PathResult,
  Question,
  Slide,
  TopicSetup,
} from '../../types/domain';
import type {
  ExplainDifferentlyRequest,
  ExtendPathRequest,
  GradeAnswerRequest,
  GradeResult,
  GenerateHintRequest,
  GenerateLessonRequest,
  GenerateQuestionsRequest,
  HintResult,
  NextRecommendation,
  QuestionResult,
  RecommendNextRequest,
  TeachBackAnalysis,
  TeachBackRequest,
} from '../ai/contracts';

/* ---------------------------------------------------------------- enums --- */

const STATUS_IN: Record<ConceptStatusWire, ConceptStatus> = {
  locked: 'locked',
  current: 'current',
  completed: 'completed',
  'needs-review': 'needsReview',
};

const STATUS_OUT: Record<ConceptStatus, ConceptStatusWire> = {
  locked: 'locked',
  current: 'current',
  completed: 'completed',
  needsReview: 'needs-review',
};

const LEVEL_IN: Record<LevelWire, Level> = { Easy: 'easy', Medium: 'medium', Hard: 'hard' };
const LEVEL_OUT: Record<Level, LevelWire> = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };

/* ------------------------------------------------------------- inbound --- */

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/**
 * A concept arrives with server-owned IDENTITY and client-owned PROGRESS.
 *
 * The current backend sends NEITHER `mastery` NOR `status`, and that is the
 * end of a two-step change rather than a happy accident.
 *
 * They were always fiction. A stateless server has never seen one of your
 * answers, so anything it reports about your progress is invented -- and it did
 * invent it: the old prompt asked for "completed for the first three concepts",
 * so a brand-new Roman History course arrived with three concepts already
 * marked Strong at 3% mastery. Both at once, which is not even internally
 * consistent, since `completed` is supposed to mean >= 80.
 *
 * This mapper has always ignored them. But `guards.ts` REQUIRED them, so the
 * server could not simply stop sending them -- that "obvious cleanup" would
 * have failed every path fetch with AiError('malformed'). The guard was relaxed
 * and shipped first; only then did the fields come out of the response.
 *
 * They remain optional in ConceptWire because an older backend still sends
 * them, and this function still ignores them when it does. Progress is derived
 * from sessions THIS client recorded; a path fetch supplies curriculum, nothing
 * more.
 */
export function toConcept(w: ConceptWire, index = 0): Concept {
  return {
    // --- server-owned ---
    id: String(w.id),
    name: w.name,
    order: Number(w.order) || index + 1,

    // --- client-owned: a fetched path is unstudied, whatever it claims ---
    mastery: 0,
    status: index === 0 ? 'current' : 'locked',
    peakMastery: 0,
    attempts: 0,
    lastStudiedAt: null,
    bestScore: 0,
    scoreHistory: [],
    misconceptions: [],
    markedKnown: false,
    review: { dueOn: null, intervalDays: 0, ease: 2.5, reps: 0, lapses: 0, snoozes: 0 },
    masteryHistory: [],
  };
}

export function toQuestion(w: QuestionWire): Question {
  return {
    id: String(w.id),
    type: w.type === 'short-answer' ? 'shortAnswer' : 'multipleChoice',
    prompt: w.prompt,
    // Collapse optional-AND-nullable to a single absent-representation here,
    // once, so nine screens never have to double-guard it.
    options: w.options ?? null,
    correctAnswer: w.correct_answer ?? null,
    why: w.why ?? null,
    misconceptionOnWrong: w.misconception_on_wrong ?? null,
    rubric: w.rubric ?? null,
    hint: w.hint ?? null,
  };
}

function toSlide(w: SlideWire): Slide {
  return { id: w.id, kind: w.kind, heading: w.heading, body: w.body };
}

/**
 * Split a lesson's prose into a slide deck when the backend sends none.
 *
 * The current backend has no concept of slides, so this is what delivers
 * design.md's "distinct lesson slide progression" without touching it. Paragraph
 * breaks become slides; the example always gets its own.
 */
function deriveSlides(w: LessonWire): Slide[] {
  const paragraphs = w.explanation
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  const slides: Slide[] = paragraphs.map((body, i) => ({
    id: `s-concept-${i}`,
    kind: 'concept',
    heading: i === 0 ? w.title : 'Going deeper',
    body,
  }));

  if (w.example.trim()) {
    slides.push({ id: 's-example', kind: 'example', heading: 'A worked example', body: w.example });
  }
  return slides.length > 0 ? slides : [{ id: 's-concept-0', kind: 'concept', heading: w.title, body: w.explanation }];
}

export function toLesson(w: LessonWire): Lesson {
  return {
    conceptName: w.concept,
    title: w.title,
    explanation: w.explanation,
    example: w.example,
    slides: w.slides?.length ? w.slides.map(toSlide) : deriveSlides(w),
    objectives: w.objectives ?? [],
    questions: (w.questions ?? []).map(toQuestion),
  };
}

export function toAssessment(w: AssessmentResultWire): AssessmentResult {
  return {
    score: clamp(Number(w.score) || 0, 0, 100),
    correct: Boolean(w.correct),
    misconceptions: w.misconceptions ?? [],
    feedback: w.feedback ?? '',
    needsReview: Boolean(w.needs_review),
  };
}

export function toPathResult(w: SetupResponseWire): PathResult {
  return {
    topic: w.topic,
    level: LEVEL_IN[w.level] ?? 'medium',
    dailyTimeMin: Number(w.daily_time) || 10,
    concepts: (w.concepts ?? []).map((c, i) => toConcept(c, i)),
  };
}

/* ------------------------------------------------------------ outbound --- */

export function toSetupWire(
  s: TopicSetup,
  conceptCount?: number,
  priorKnowledge?: string,
): SetupRequestWire {
  return {
    topic: s.topic,
    goal: s.goal ?? '',
    daily_time: s.dailyTimeMin,
    level: LEVEL_OUT[s.level],
    ...(priorKnowledge ? { prior_knowledge: priorKnowledge } : {}),
    // Omitted rather than defaulted when absent: the server's own default is 7,
    // and sending `undefined` lets that stand instead of this file inventing a
    // second copy of the number that can drift from it.
    ...(conceptCount != null ? { concept_count: conceptCount } : {}),
  };
}

export function toQuestionWire(q: Question): QuestionWire {
  return {
    id: q.id,
    type: q.type === 'shortAnswer' ? 'short-answer' : 'multiple-choice',
    prompt: q.prompt,
    options: q.options,
    correct_answer: q.correctAnswer,
    why: q.why,
    misconception_on_wrong: q.misconceptionOnWrong,
    rubric: q.rubric,
    hint: q.hint,
  };
}

/**
 * Required for correctness, not tidiness.
 *
 * POST /assess echoes the lesson object into the grading prompt. Having
 * normalized it to camelCase on the way in, we must denormalize on the way out.
 *
 * The endpoint is typed now, so getting this wrong is a 422 rather than a
 * lesson quietly handed to the model with keys its prompt never mentions -- but
 * the mapping is still required, and it is still required HERE, because this is
 * the only file allowed to know both spellings.
 */
export function toLessonWire(l: Lesson): LessonWire {
  return {
    concept: l.conceptName,
    title: l.title,
    explanation: l.explanation,
    example: l.example,
    questions: l.questions.map(toQuestionWire),
    slides: l.slides.length ? l.slides.map((s) => ({ ...s })) : null,
    objectives: l.objectives.length ? l.objectives : null,
  };
}

export function toStatusWire(s: ConceptStatus): ConceptStatusWire {
  return STATUS_OUT[s];
}

export function toAssessWire(
  topic: string,
  conceptName: string,
  answers: Record<string, string>,
  lesson: Lesson,
  results: QuestionResult[] = [],
): AssessRequestWire {
  return {
    topic,
    concept_name: conceptName,
    answers,
    lesson: toLessonWire(lesson),
    // Omitted entirely when empty rather than sent as []: the server branches on
    // "were any verdicts supplied", and an empty array is the same question as
    // an absent field only if nobody later reads it as "everything scored zero".
    ...(results.length
      ? {
          question_results: results.map((r) => ({
            question_id: r.questionId,
            prompt: r.prompt,
            answer: r.answer,
            score: r.score,
            correct: r.correct,
            ...(r.misconception ? { misconception: r.misconception } : {}),
          })),
        }
      : {}),
  };
}

/* ---- the request mappers for the tasks that gained routes ----
   Each one exists so httpProvider stays free of snake_case. The rule is not
   tidiness: `correct_answer` vs `correctAnswer` was silently undefined on the
   client for an entire build, and keeping the mapping in exactly one file is
   what makes that class of bug a compile error instead of a blank screen. */

/**
 * Note what this sends that its predecessor did not.
 *
 * `setupBody(topic, goal, minutes, level)` carried four of the seven fields in
 * GenerateLessonRequest. `misconceptionsToWatch`, `attemptHistory` and
 * `isReview` were computed from real learner state on every load and dropped
 * here. Their absence is why a live review lesson came back byte-identical to
 * the first teaching.
 */
export function toLessonRequestWire(r: GenerateLessonRequest, questionCount: number): LessonRequestWire {
  return {
    topic: r.topic,
    concept_name: r.conceptName,
    daily_time: r.minutes,
    minutes: r.minutes,
    level: LEVEL_OUT[r.level],
    misconceptions_to_watch: r.misconceptionsToWatch,
    attempt_history: r.attemptHistory,
    is_review: r.isReview,
    question_count: questionCount,
  };
}

export function toExtendWire(r: ExtendPathRequest): ExtendPathRequestWire {
  return {
    topic: r.topic,
    goal: r.goal ?? '',
    daily_time: r.dailyTimeMin,
    level: LEVEL_OUT[r.level],
    after: r.after,
    concept_count: r.conceptCount,
  };
}

export function toGradeWire(r: GradeAnswerRequest): GradeRequestWire {
  return {
    topic: r.topic,
    concept_name: r.conceptName,
    question_prompt: r.question.prompt,
    // The model answer and rubric are context for the grader, not a checklist:
    // the prompt says so explicitly, because handing a model a keyword list and
    // asking it to grade is how you rebuild the keyword grader with extra steps.
    model_answer: r.question.correctAnswer ?? '',
    rubric_keywords: r.question.rubric?.keywords ?? [],
    answer: r.answer,
  };
}

export function toGradeResult(w: GradeResponseWire): GradeResult {
  return {
    score: clamp(Number(w.score) || 0, 0, 100),
    correct: Boolean(w.correct),
    feedback: w.feedback ?? '',
    misconception: w.misconception ?? null,
  };
}

export function toExplainWire(r: ExplainDifferentlyRequest): ExplainRequestWire {
  return {
    topic: r.topic,
    concept_name: r.conceptName,
    prior_explanation: r.priorExplanation,
    confusion_point: r.confusionPoint,
  };
}

export function toTeachBackWire(r: TeachBackRequest): TeachBackRequestWire {
  return { topic: r.topic, concept_name: r.conceptName, explanation: r.explanation };
}

export function toQuestionsWire(r: GenerateQuestionsRequest): QuestionsRequestWire {
  return {
    topic: r.topic,
    concept_name: r.conceptName,
    level: LEVEL_OUT[r.level],
    count: r.count,
    types: r.types.map((x) => (x === 'shortAnswer' ? 'short-answer' : 'multiple-choice')),
    seen_prompts: r.seenPrompts,
    target_misconception: r.targetMisconception ?? '',
  };
}

export function toHintWire(r: GenerateHintRequest): HintRequestWire {
  return {
    topic: r.topic,
    concept_name: r.conceptName,
    question_prompt: r.question.prompt,
    partial_attempt: r.partialAttempt,
    level: r.level,
    max_level: r.maxLevel,
    prior_hints: r.priorHints,
  };
}

export function toRecommendWire(r: RecommendNextRequest): RecommendRequestWire {
  return {
    topic: r.topic,
    mastery_by_concept: Object.fromEntries(
      Object.entries(r.masteryByConcept).map(([k, v]) => [k, Math.round(v)]),
    ),
    due_concepts: r.dueConcepts,
    overdue_concepts: r.overdueConcepts,
    minutes_available: r.minutesAvailable,
  };
}

export function toHintResult(w: HintResponseWire): HintResult {
  return { text: w.text, exhausted: Boolean(w.exhausted) };
}

export function toTeachBack(w: TeachBackResponseWire): TeachBackAnalysis {
  return {
    coverage: clamp(Number(w.coverage) || 0, 0, 100),
    understood: w.understood ?? [],
    missing: w.missing ?? [],
    incorrect: w.incorrect ?? [],
    followUpQuestion: w.follow_up_question ?? '',
  };
}

export function toRecommendation(w: RecommendationResponseWire): NextRecommendation {
  return { action: w.action, conceptNames: w.concept_names ?? [], reason: w.reason ?? '' };
}
