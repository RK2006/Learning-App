/**
 * WIRE TYPES -- exact mirrors of the FastAPI Pydantic models.
 *
 * SOURCE OF TRUTH: backend/app/models.py. Keep in sync by hand; a mismatch
 * here is a silent runtime bug, not a compile error.
 *
 * This file and lib/api/normalize.ts are the ONLY two modules in the app
 * permitted to contain a snake_case identifier. Enforceable in review:
 *
 *   grep -rn '_[a-z]' src --include=*.ts* | grep -v 'api/normalize\|types/wire'
 *
 * The bug this rule exists to kill: main.py:40 and llm_service.py:114 both emit
 * `correct_answer`, while the previous App.tsx:22 declared `correctAnswer`. The
 * field was silently always undefined on the client, and would have marked every
 * multiple-choice answer wrong the moment anything graded locally.
 *
 * FORWARD-COMPAT RULE: additive only. New fields must be optional. Pydantic
 * ignores unknown fields on the way in, and we treat unmapped fields as
 * undefined on the way out -- so adding is free, renaming is a breaking change.
 */

export type LevelWire = 'Easy' | 'Medium' | 'Hard';
export type ConceptStatusWire = 'locked' | 'current' | 'completed' | 'needs-review';
export type QuestionTypeWire = 'multiple-choice' | 'short-answer';

export interface SetupRequestWire {
  topic: string;
  /** Removed from the setup UI, but the backend model still accepts it. */
  goal: string;
  daily_time: number;
  level: LevelWire;
  /** Optional, defaulting server-side to 7 -- the value that used to be
   *  hardcoded as `minItems: 7, maxItems: 7` in the JSON schema with no way to
   *  ask for anything else. Sending it is what makes a path any length. */
  concept_count?: number;
  prior_knowledge?: string;
}

/** POST /path/extend. Continues a finished path instead of starting one. */
export interface ExtendPathRequestWire {
  topic: string;
  goal: string;
  daily_time: number;
  level: LevelWire;
  /** The curriculum so far. Without it the model regenerates concepts the
   *  learner has already completed. */
  after: string[];
  concept_count: number;
}

/**
 * POST /lesson. No longer a SetupRequest.
 *
 * `concept_name` is the field that ends the smuggling: the client used to pass
 * the concept through `goal` as "Teach specifically: <name>", which landed in
 * the prompt as a free-floating sentence and was also an injection hole.
 *
 * The next three are the ones SessionScreen has always computed from real
 * learner state and httpProvider always threw away. `misconceptions_to_watch`
 * is described by contracts.ts as "the single highest-value input here"; before
 * this field existed it had never reached a model, which is why a live review
 * lesson used to be byte-identical to the first teaching.
 */
export interface LessonRequestWire {
  topic: string;
  concept_name: string;
  goal?: string;
  daily_time: number;
  level: LevelWire;
  minutes?: number;
  misconceptions_to_watch?: string[];
  attempt_history?: number[];
  is_review?: boolean;
  question_count?: number;
  slide_min?: number;
  slide_max?: number;
}

/** POST /questions. Unbounded practice, one batch at a time. */
export interface QuestionsRequestWire {
  topic: string;
  concept_name: string;
  level: LevelWire;
  count: number;
  types: QuestionTypeWire[];
  /** Prompts already shown. This is the whole mechanism behind
   *  "more practice, forever" being non-repeating. */
  seen_prompts: string[];
  target_misconception?: string;
}

export interface QuestionsResponseWire {
  questions: QuestionWire[];
}

/** POST /hint. `level` is a number, not 1|2|3 -- see contracts.ts. */
export interface HintRequestWire {
  topic: string;
  concept_name: string;
  question_prompt: string;
  partial_attempt: string;
  level: number;
  max_level: number;
  /** Hints already shown for THIS question. A stateless endpoint given only a
   *  level number regenerates the same nudge with a bigger number on it. */
  prior_hints: string[];
}

export interface HintResponseWire {
  text: string;
  exhausted: boolean;
}

export interface ExplainRequestWire {
  topic: string;
  concept_name: string;
  prior_explanation: string;
  confusion_point: string;
}

export interface ExplanationResponseWire {
  explanation: string;
}

export interface TeachBackRequestWire {
  topic: string;
  concept_name: string;
  explanation: string;
}

export interface TeachBackResponseWire {
  coverage: number;
  understood: string[];
  missing: string[];
  incorrect: string[];
  follow_up_question: string;
}

export interface RecommendRequestWire {
  topic: string;
  mastery_by_concept: Record<string, number>;
  due_concepts: string[];
  overdue_concepts: string[];
  minutes_available: number;
}

export interface RecommendationResponseWire {
  action: 'review' | 'continue' | 'practice' | 'rest';
  concept_names: string[];
  reason: string;
}

/** The shape every failure arrives in. The client branches on `kind`, not on
 *  the status code -- see lib/ai/errorCopy.ts. */
export interface ApiErrorWire {
  kind?: string;
  message?: string;
  detail?: string;
}

/**
 * `mastery` and `status` are OPTIONAL now, and the current backend sends
 * neither.
 *
 * They were always fiction: a stateless server has never seen one of this
 * learner's answers, and `normalize.ts::toConcept` has always ignored both. But
 * `guards.ts` REQUIRED them, so the server could not stop sending them without
 * breaking every path fetch -- an "obviously safe" removal that was in fact a
 * breaking change, gated by code on the other side of the wire. The guard was
 * relaxed and shipped first; only then did the server drop the fields.
 *
 * They stay declared because an older backend may still send them and wire.ts
 * mirrors the contract rather than the wish.
 */
export interface ConceptWire {
  id: string;
  name: string;
  order: number;
  mastery?: number;
  status?: ConceptStatusWire;
}

export interface QuestionWire {
  id: string;
  type: QuestionTypeWire;
  prompt: string;
  /** Pydantic `List[str] | None = None` -- both optional AND nullable. */
  options?: string[] | null;
  correct_answer?: string | null;

  /* ---- additive client-side extensions ----
     The backend does not send these yet. They are optional so a real response
     simply leaves them undefined, and a future backend can start sending them
     with no migration. */

  /** One sentence on WHY the answer is what it is. Shown in the feedback stage. */
  why?: string | null;
  /** Keyed by distractor text: the misconception that choosing it reveals. */
  misconception_on_wrong?: Record<string, string> | null;
  /** Offline grading aid for short answers. */
  rubric?: { keywords: string[]; required: number } | null;
  hint?: string | null;
}

export interface LessonWire {
  concept: string;
  title: string;
  explanation: string;
  example: string;
  questions: QuestionWire[];
  /** Additive: when absent, slides are derived from explanation + example. */
  slides?: SlideWire[] | null;
  objectives?: string[] | null;
}

export interface SlideWire {
  id: string;
  kind: 'concept' | 'example' | 'contrast' | 'recap';
  heading: string;
  body: string;
}

export interface AssessmentResultWire {
  score: number;
  correct: boolean;
  misconceptions: string[];
  feedback: string;
  needs_review: boolean;
}

export interface SetupResponseWire {
  topic: string;
  goal: string;
  daily_time: number;
  level: LevelWire;
  concepts: ConceptWire[];
}

/**
 * POST /assess is TYPED now (backend/app/models.py::AssessRequest), so a
 * camelCase lesson is a 422 rather than a lesson quietly handed to the model
 * with keys its prompt never mentions. The lesson still goes out in wire shape
 * -- see toLessonWire -- but a mistake there is now loud instead of silent.
 *
 * `concept_name` was computed by the client and dropped before sending, so the
 * grader never learned which concept it was grading.
 */
export interface AssessRequestWire {
  topic: string;
  concept_name: string;
  answers: Record<string, string>;
  lesson: LessonWire;
}
