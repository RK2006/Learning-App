/**
 * DOMAIN TYPES -- what the app actually works with.
 *
 * A superset of the wire model, not a rename. Server-owned fields keep their
 * names and semantics so a future re-fetch merges by key; client-only additions
 * are namespaced (`review`, `masteryHistory`) so it is obvious at a glance what
 * the backend does not know about.
 *
 * This file must never import from wire.ts. Only normalize.ts sees both.
 */

/** Local calendar date, 'YYYY-MM-DD'. Branded because it is the type most
 *  easily confused with an arbitrary string -- calendar, streak and scheduling
 *  all traffic in it. Zero runtime cost. */
export type DayKey = string & { readonly __brand: 'DayKey' };

export type Level = 'easy' | 'medium' | 'hard';
export type ConceptStatus = 'locked' | 'current' | 'completed' | 'needsReview';
export type QuestionType = 'multipleChoice' | 'shortAnswer';
export type SlideKind = 'concept' | 'example' | 'contrast' | 'recap';

export interface Question {
  id: string;
  type: QuestionType;
  prompt: string;
  /** Collapsed from the wire's optional-AND-nullable to exactly one
   *  absent-representation, so screens never write `q.options?.length ?? 0`. */
  options: string[] | null;
  correctAnswer: string | null;
  why: string | null;
  misconceptionOnWrong: Record<string, string> | null;
  rubric: { keywords: string[]; required: number } | null;
  hint: string | null;
}

export interface Slide {
  id: string;
  kind: SlideKind;
  heading: string;
  body: string;
}

export interface Lesson {
  conceptName: string;
  title: string;
  explanation: string;
  example: string;
  /** Derived client-side when the backend sends none. Delivers the "distinct
   *  lesson slide progression" from design.md with zero backend change. */
  slides: Slide[];
  objectives: string[];
  questions: Question[];
}

export interface AssessmentResult {
  score: number;
  correct: boolean;
  misconceptions: string[];
  feedback: string;
  needsReview: boolean;
}

/** Spaced-repetition state. See domain/srs.ts for the algorithm. */
export interface ReviewState {
  dueOn: DayKey | null;
  intervalDays: number;
  /** SM-2 ease factor, clamped [1.30, 2.80]. */
  ease: number;
  reps: number;
  lapses: number;
  snoozes: number;
}

export interface Concept {
  // --- server-owned core, same names as ConceptWire ---
  id: string;
  name: string;
  order: number;
  /** 0..100 as of lastStudiedAt. The DECAYED value is derived, never stored --
   *  see domain/mastery.ts::effectiveMastery. */
  mastery: number;
  status: ConceptStatus;

  // --- client-only ---
  peakMastery: number;
  attempts: number;
  lastStudiedAt: number | null;
  bestScore: number;
  scoreHistory: number[];
  misconceptions: LoggedMisconception[];
  markedKnown: boolean;
  review: ReviewState;
  masteryHistory: { at: number; value: number }[];
}

export interface LoggedMisconception {
  text: string;
  count: number;
  lastSeen: number;
  /** Set when the learner later scores >= 85 on the same concept. Drives the
   *  `honest_learner` achievement and the Progress screen's resolved section. */
  resolvedAt: number | null;
}

export interface TopicSetup {
  topic: string;
  level: Level;
  dailyTimeMin: number;
  /** Dropped from the setup UI; still threaded through to the prompts. */
  goal: string;
}

export interface PathResult {
  topic: string;
  level: Level;
  dailyTimeMin: number;
  concepts: Concept[];
}

export type SessionMode = 'lesson' | 'review' | 'practice' | 'unitReview';
