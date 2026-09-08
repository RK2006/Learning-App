import type { AppState, Course, SessionRecord } from '../types/state';
import type { Concept, DayKey } from '../types/domain';
import { dayKey, now } from '../domain/time';
import { courseMastery, effectiveMastery, hasAttempted } from '../domain/mastery';
import { buildQueue } from '../domain/srs';
import { canOfferRepair, displayStreak, repairProgress, REPAIR_SESSIONS_REQUIRED } from '../domain/streak';
import { describeForecast, forecast } from '../domain/forecast';
import { levelInfo } from '../domain/xp';

export function selectToday(s: AppState): DayKey {
  return dayKey(now(), s.settings.timeZone);
}

export function selectActiveCourse(s: AppState): Course | null {
  return s.courses.find((c) => c.id === s.activeCourseId) ?? s.courses[0] ?? null;
}

/** `find` returns T | undefined for every lookup; this is the variant for call
 *  sites where the route already guarantees existence. */
export function requireCourse(s: AppState, id: string): Course {
  const c = s.courses.find((x) => x.id === id);
  if (!c) throw new Error(`No course ${id}`);
  return c;
}

export function selectCurrentConcept(course: Course | null): Concept | null {
  if (!course) return null;
  return (
    course.concepts.find((c) => c.status === 'current') ??
    course.concepts.find((c) => c.status === 'needsReview') ??
    course.concepts.find((c) => c.status !== 'locked' && c.status !== 'completed') ??
    null
  );
}

export function selectNextLocked(course: Course | null): Concept | null {
  if (!course) return null;
  return [...course.concepts].sort((a, b) => a.order - b.order).find((c) => c.status === 'locked') ?? null;
}

export function selectWeakest(course: Course | null): Concept | null {
  if (!course) return null;
  const open = course.concepts.filter((c) => c.status !== 'locked' && hasAttempted(c));
  if (open.length === 0) return null;
  return open.reduce((a, b) => (effectiveMastery(a) <= effectiveMastery(b) ? a : b));
}

/**
 * The concept a session record refers to, looked up in the record's OWN course.
 *
 * Not the active one. Session history spans every course, and resolving a
 * record against whatever course happens to be selected is how a probability
 * session ended up labelled with a chess concept. Returns null rather than
 * guessing when the course or concept has since been deleted.
 */
export function selectRecordConcept(s: AppState, record: SessionRecord): Concept | null {
  const course = s.courses.find((c) => c.id === record.courseId);
  const id = record.conceptIds[0];
  if (!course || !id) return null;
  return course.concepts.find((c) => c.id === id) ?? null;
}

export function selectXpToday(s: AppState): number {
  return s.days[selectToday(s)]?.xp ?? 0;
}

export function selectGoalMet(s: AppState): boolean {
  return selectXpToday(s) >= s.settings.dailyGoalXp;
}

export function selectStreak(s: AppState): number {
  return displayStreak(s.streak, selectToday(s));
}

export function selectLevel(s: AppState) {
  return levelInfo(s.profile.totalXp);
}

export function selectQueue(s: AppState, horizonDays = 0) {
  return buildQueue(s.courses, selectToday(s), { horizonDays });
}

export function selectDueCount(s: AppState): number {
  return selectQueue(s).length;
}

export function selectOverdueCount(s: AppState): number {
  return selectQueue(s).filter((e) => e.overdueDays > 0).length;
}

export function selectCourseProgress(course: Course | null): number {
  return course ? courseMastery(course.concepts) / 100 : 0;
}

/* ------------------------------------------------------------ forecast --- */

export function selectForecast(s: AppState, withinDays = 14) {
  return forecast(s.courses, { withinDays });
}

/** The Progress headline. null when nothing is slipping -- an empty forecast
 *  should show nothing, not "0 concepts will drop". */
export function selectForecastLine(s: AppState, withinDays = 14): string | null {
  return describeForecast(selectForecast(s, withinDays), withinDays);
}

/* -------------------------------------------------------------- repair --- */

export interface StreakRepair {
  available: boolean;
  lostStreak: number;
  done: number;
  required: number;
}

export function selectStreakRepair(s: AppState): StreakRepair {
  const today = selectToday(s);
  return {
    available: canOfferRepair(s.streak, today),
    lostStreak: s.streak.current,
    done: repairProgress(s.days, today),
    required: REPAIR_SESSIONS_REQUIRED,
  };
}

/* ------------------------------------------------------- next action --- */

export type NextActionKind =
  | 'setup'
  | 'reviewUrgent'
  | 'lesson'
  | 'review'
  | 'lessonBonus'
  | 'practice';

export interface NextAction {
  kind: NextActionKind;
  label: string;
  conceptId: string | null;
  count: number;
}

/**
 * The single unambiguous next action.
 *
 * Exact priority order -- the old build made you re-derive this on every visit,
 * and its only real control destroyed the session.
 */
export function selectNextAction(s: AppState): NextAction {
  const course = selectActiveCourse(s);
  if (!course) return { kind: 'setup', label: 'Pick your first subject', conceptId: null, count: 0 };

  const overdue = selectOverdueCount(s);
  const due = selectDueCount(s);
  const current = selectCurrentConcept(course);
  const goalMet = selectGoalMet(s);

  if (overdue >= 3) {
    return { kind: 'reviewUrgent', label: 'Clear your review queue', conceptId: null, count: due };
  }
  if (!goalMet && current) {
    return { kind: 'lesson', label: `Continue: ${current.name}`, conceptId: current.id, count: 0 };
  }
  if (due >= 1) {
    return {
      kind: 'review',
      label: `Review ${due} concept${due === 1 ? '' : 's'}`,
      conceptId: null,
      count: due,
    };
  }
  if (current) {
    return { kind: 'lessonBonus', label: `Bonus lesson: ${current.name}`, conceptId: current.id, count: 0 };
  }
  const weakest = selectWeakest(course);
  return weakest
    ? { kind: 'practice', label: `Practice: ${weakest.name}`, conceptId: weakest.id, count: 0 }
    : { kind: 'setup', label: 'Pick a new subject', conceptId: null, count: 0 };
}

/* ------------------------------------------------------------- decide --- */

export interface DecideNext {
  primaryLabel: string;
  primaryKind: 'retry' | 'advance' | 'review' | 'home';
  secondaryLabel: string;
  banner: string | null;
  conceptId: string | null;
}

export function selectDecideNext(s: AppState, score: number, conceptId: string): DecideNext {
  const course = selectActiveCourse(s);
  const due = selectDueCount(s);
  const next = selectNextLocked(course);

  if (score < 50) {
    return {
      primaryLabel: 'Try this again',
      primaryKind: 'retry',
      secondaryLabel: 'Back to Today',
      banner: null,
      conceptId,
    };
  }
  if (score < 70) {
    return {
      primaryLabel: 'Continue',
      primaryKind: 'home',
      secondaryLabel: 'Try this again',
      banner: "We'll bring this back tomorrow.",
      conceptId,
    };
  }
  if (due > 0) {
    return {
      primaryLabel: `Review ${due} due concept${due === 1 ? '' : 's'}`,
      primaryKind: 'review',
      secondaryLabel: next ? `Next: ${next.name}` : 'Back to Today',
      banner: null,
      conceptId: null,
    };
  }
  if (next) {
    return {
      primaryLabel: `Next: ${next.name}`,
      primaryKind: 'advance',
      secondaryLabel: 'Back to Today',
      banner: null,
      conceptId: next.id,
    };
  }
  return {
    primaryLabel: 'Back to Today',
    primaryKind: 'home',
    secondaryLabel: 'Practice weakest',
    banner: null,
    conceptId: null,
  };
}

/**
 * The identity of a generated lesson.
 *
 * `lessonCache` was write-only: dispatched, stored, LRU-trimmed, persisted,
 * migrated, and shed first under storage pressure -- and read by nothing at
 * all. Every re-entry to a concept paid full latency (7-20 seconds, measured)
 * and full cost to regenerate material the client already had on disk.
 *
 * Wiring it up needed a key that is not the concept id. A lesson is only
 * interchangeable with another if every input that shapes it matches, so all of
 * them are in here. The one that must never be dropped is `isReview` together
 * with the misconception set: a re-teach exists precisely to differ from the
 * first attempt, and a key without them would serve the lesson the learner
 * already failed to understand, instantly and for free, which is worse than
 * the slow correct answer.
 *
 * The misconception list is sorted before hashing because it comes from a
 * Record whose order is not meaningful -- two identical sets in different
 * orders are the same lesson and must not miss.
 */
export function lessonCacheKey(input: {
  courseId: string;
  conceptId: string;
  level: string;
  minutes: number;
  isReview: boolean;
  questionCount: number;
  misconceptions: string[];
}): string {
  const m = [...input.misconceptions].sort().join('|');
  return [
    input.courseId,
    input.conceptId,
    input.level,
    input.minutes,
    input.isReview ? 'review' : 'first',
    input.questionCount,
    m,
  ].join('::');
}
