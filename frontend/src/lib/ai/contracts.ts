/**
 * THE AI CONTRACT.
 *
 * The organizing principle of this frontend: it is written as if a working LLM
 * sits behind it, and NO subject-matter content is ever a literal in a
 * component. Every piece of teaching material arrives through one of the eight
 * tasks below.
 *
 * Each task declares exactly what we would feed a model and exactly what shape
 * we expect back. That request type IS the specification of the prompt -- see
 * prompts.ts, where each one is rendered. Wiring a real model later means
 * implementing `AiProvider` once; no screen changes.
 *
 * Responses are in DOMAIN types. A provider that talks to the backend is
 * responsible for running wire payloads through lib/api/normalize.ts, so the
 * rest of the app cannot tell the two implementations apart.
 */

import type {
  AssessmentResult,
  Concept,
  Lesson,
  Level,
  Question,
  QuestionType,
} from '../../types/domain';

/* ------------------------------------------------------------ requests --- */

export interface ExtendPathRequest {
  topic: string;
  level: Level;
  dailyTimeMin: number;
  goal: string;
  /** The concept names already on the path, in order. Without them the model
   *  regenerates what the learner has already completed. */
  after: string[];
  conceptCount: number;
}

export interface GeneratePathRequest {
  topic: string;
  level: Level;
  dailyTimeMin: number;
  /** Free text from onboarding. Empty string when the user skipped it. */
  goal: string;
  /** Anything the learner says they already know, so the path can skip ahead. */
  priorKnowledge?: string;
  conceptCount: number;
}

export interface GenerateLessonRequest {
  topic: string;
  conceptName: string;
  level: Level;
  minutes: number;
  /** Misconceptions this learner has already shown on this concept. The single
   *  highest-value input here -- it is what makes the second attempt different
   *  from the first. */
  misconceptionsToWatch: string[];
  /** Previous scores on this concept, oldest first. */
  attemptHistory: number[];
  /** True on a repeat pass, so the model re-explains rather than re-teaches. */
  isReview: boolean;
  /**
   * How many questions this lesson should contain.
   *
   * Optional so existing callers keep the old fixed behaviour, and because it
   * is the field that finally gives `settings.questionsPerLesson` a reader.
   * That setting has been a live 2/3/4/5 control in the UI, persisted and
   * migrated, read by NOTHING -- a shipping example of the dead control this
   * project exists to delete.
   */
  questionCount?: number;
}

export interface GenerateQuestionsRequest {
  topic: string;
  conceptName: string;
  level: Level;
  count: number;
  types: QuestionType[];
  /** Prompts the learner has already seen, so the model does not repeat them. */
  seenPrompts: string[];
  targetMisconception?: string;
}

export interface AssessResponseRequest {
  topic: string;
  conceptName: string;
  /** The full lesson, echoed back so the model grades against what was taught. */
  lesson: Lesson;
  /** questionId -> the learner's answer. */
  answers: Record<string, string>;
}

export interface GenerateHintRequest {
  topic: string;
  conceptName: string;
  question: Question;
  /** What the learner has typed or selected so far. May be empty. */
  partialAttempt: string;
  /**
   * 1 = nudge, rising to `maxLevel` = almost tell them.
   *
   * Was `1 | 2 | 3`, a closed type -- and the single caller always sent 1 and
   * then disabled the button, so levels 2 and 3 were unreachable anyway.
   * Widening the type is necessary for unlimited escalating hints but nowhere
   * near sufficient: a STATELESS endpoint handed `level: 7` and nothing else
   * regenerates roughly the nudge it gave at level 1, with a bigger number
   * next to it. `priorHints` is what actually makes hint 4 differ from hint 1.
   */
  level: number;
  /** Total hints available for this question. The server interpolates the
   *  depth between "nudge" and "almost tell them" across this range, so 3 of 6
   *  is genuinely gentler than 5 of 6. */
  maxLevel: number;
  /** Every hint already shown for THIS question, in order. */
  priorHints: string[];
}

export interface ExplainDifferentlyRequest {
  topic: string;
  conceptName: string;
  priorExplanation: string;
  /** What the learner said they did not follow. */
  confusionPoint: string;
}

export interface TeachBackRequest {
  topic: string;
  conceptName: string;
  /** The learner explaining the concept in their own words. */
  explanation: string;
}

export interface RecommendNextRequest {
  topic: string;
  /** Concept name -> effective (decayed) mastery, 0..100. */
  masteryByConcept: Record<string, number>;
  dueConcepts: string[];
  overdueConcepts: string[];
  minutesAvailable: number;
}

/* ----------------------------------------------------------- responses --- */

export interface TeachBackAnalysis {
  /** 0..100 -- how completely the explanation covers the concept. */
  coverage: number;
  understood: string[];
  missing: string[];
  incorrect: string[];
  followUpQuestion: string;
}

export interface NextRecommendation {
  action: 'review' | 'continue' | 'practice' | 'rest';
  conceptNames: string[];
  reason: string;
}

export interface HintResult {
  text: string;
  /** True when this was the last hint level available. */
  exhausted: boolean;
}

/* ----------------------------------------------------------- provider --- */

/**
 * OPEN, not closed.
 *
 * This was a closed union of six, and `errorCopy.ts` indexed a Record with it
 * unguarded -- so the first backend to emit a seventh kind would have handed
 * `SessionScreen` an `undefined` copy object and rendered a white screen on the
 * error path, in an app with no error boundary anywhere. The union is still
 * exhaustive for the kinds we KNOW, but `describeAiError` now treats it as
 * open, because the wire is a place other people's code can put strings.
 *
 * The `(string & {})` arm keeps autocomplete for the known members while
 * admitting the unknown one. Fix order mattered here: this shipped, and stayed
 * shipped, before the backend was allowed to emit anything new.
 */
export type KnownAiErrorKind =
  | 'network'
  | 'http'
  | 'malformed'
  | 'aborted'
  | 'timeout'
  | 'unconfigured'
  /** 429. Our own limiter or the model provider's. Retryable, but not yet. */
  | 'rate_limited'
  /** 502. The model was unreachable or returned nothing usable. */
  | 'model_down'
  /** The model declined to answer. Retrying the same prompt will not help. */
  | 'content_refused'
  /** 422. The request itself was rejected -- a retry sends the same bad thing. */
  | 'invalid';

// eslint-disable-next-line @typescript-eslint/ban-types
export type AiErrorKind = KnownAiErrorKind | (string & {});

export class AiError extends Error {
  constructor(
    readonly kind: AiErrorKind,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'AiError';
  }
}

export interface RequestOpts {
  signal?: AbortSignal;
}

/**
 * The swap seam. `mockProvider` simulates a model; `httpProvider` calls FastAPI.
 * Both return domain types, so callers cannot distinguish them.
 */
export interface AiProvider {
  readonly name: 'mock' | 'http';

  generatePath(req: GeneratePathRequest, opts?: RequestOpts): Promise<Concept[]>;
  /** Continue a finished path. Without this, reaching the end of a course is a
   *  dead end: selectNextLocked returns null and the results screen falls
   *  through to "Back to Today". */
  extendPath(req: ExtendPathRequest, opts?: RequestOpts): Promise<Concept[]>;
  generateLesson(req: GenerateLessonRequest, opts?: RequestOpts): Promise<Lesson>;
  generateQuestions(req: GenerateQuestionsRequest, opts?: RequestOpts): Promise<Question[]>;
  assessResponse(req: AssessResponseRequest, opts?: RequestOpts): Promise<AssessmentResult>;
  generateHint(req: GenerateHintRequest, opts?: RequestOpts): Promise<HintResult>;
  explainDifferently(req: ExplainDifferentlyRequest, opts?: RequestOpts): Promise<string>;
  analyzeTeachBack(req: TeachBackRequest, opts?: RequestOpts): Promise<TeachBackAnalysis>;
  recommendNext(req: RecommendNextRequest, opts?: RequestOpts): Promise<NextRecommendation>;

  health(opts?: RequestOpts): Promise<{ ok: boolean }>;
}
