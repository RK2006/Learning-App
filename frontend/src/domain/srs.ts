import type { Concept, DayKey, ReviewState } from '../types/domain';
import { addDays, dayKey, daysBetween, now } from './time';
import { effectiveMastery, hasAttempted } from './mastery';

/**
 * SM-2 Lite.
 *
 * Chosen over Leitner (fixed boxes cannot personalize, so intervals never adapt
 * and the demo looks static) and over FSRS (needs a fitted parameter set and a
 * review history we do not have on day one). SM-2 gives personalized intervals
 * from the very first session in about twenty-five lines, and it is keyed on
 * `reps` -- the same variable as the mastery half-life -- so the two systems
 * agree with each other instead of fighting.
 */

const EASE_MIN = 1.3;
const EASE_MAX = 2.8;
const INTERVAL_CAP = 180;

export type Grade = 0 | 1 | 2 | 3 | 4 | 5;

export function grade(score: number): Grade {
  if (score >= 95) return 5;
  if (score >= 85) return 4;
  if (score >= 70) return 3;
  if (score >= 50) return 2;
  if (score >= 30) return 1;
  return 0;
}

const clampEase = (e: number) => Math.max(EASE_MIN, Math.min(EASE_MAX, e));

/**
 * Ladder at the default 2.5 ease: 1 -> 3 -> 8 -> 20 -> 50 -> 125 -> 180 (cap).
 * Six good answers and a concept disappears for half a year, which is correct:
 * reviewing something you reliably know is wasted time.
 */
export function schedule(review: ReviewState, score: number, today: DayKey): ReviewState {
  const q = grade(score);

  if (q < 3) {
    // Lapse. Reset the ladder, drop ease, and make it due immediately so it
    // lands at the top of the queue.
    return {
      dueOn: today,
      intervalDays: 1,
      ease: clampEase(review.ease - 0.2),
      reps: 0,
      lapses: review.lapses + 1,
      snoozes: 0,
    };
  }

  const intervalDays =
    review.reps === 0 ? 1 : review.reps === 1 ? 3 : Math.min(Math.round(review.intervalDays * review.ease), INTERVAL_CAP);

  // Standard SM-2 ease delta: q=5 -> +0.10, q=4 -> 0.00, q=3 -> -0.14.
  const ease = clampEase(review.ease + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)));

  return {
    dueOn: addDays(today, intervalDays),
    intervalDays,
    ease,
    reps: review.reps + 1,
    lapses: review.lapses,
    snoozes: 0,
  };
}

export const MAX_SNOOZES = 3;

export function snooze(review: ReviewState, days: number, today: DayKey): ReviewState {
  const base = review.dueOn && review.dueOn > today ? review.dueOn : today;
  // Deliberately does NOT touch ease, interval or mastery. Putting something
  // off is not evidence about whether you know it.
  return { ...review, dueOn: addDays(base, days), snoozes: review.snoozes + 1 };
}

export function canSnooze(review: ReviewState): boolean {
  return review.snoozes < MAX_SNOOZES;
}

/* --------------------------------------------------------------- queue --- */

export interface QueueEntry {
  concept: Concept;
  courseId: string;
  overdueDays: number;
  effective: number;
}

/**
 * Lapsed: failed recently enough that SM-2 has reset its ladder.
 *
 * `reps === 0` alone means "never studied"; paired with `lapses > 0` it means
 * "knocked back to the start". That distinction is the whole reason
 * hasAttempted() exists, so the pairing lives here rather than being
 * re-derived at each call site where the two halves could drift apart.
 */
export function isLapsed(c: Concept): boolean {
  return c.review.lapses > 0 && c.review.reps === 0;
}

export function isDue(c: Concept, today: DayKey = dayKey()): boolean {
  return c.review.dueOn != null && c.review.dueOn <= today;
}

/**
 * Queue order:
 *   1. lapsed in the last 24h   -- fix it while it is still fresh
 *   2. overdue, longest first
 *   3. due today, weakest first
 *   4. due soon, weakest first
 * Anything not due is excluded unless `includeNotDue` (the "practice anyway"
 * path, which must not affect scheduling).
 */
export function buildQueue(
  courses: { id: string; concepts: Concept[] }[],
  today: DayKey = dayKey(),
  opts: { includeNotDue?: boolean; horizonDays?: number; at?: number } = {},
): QueueEntry[] {
  const horizon = opts.horizonDays ?? 0;
  // `at` matters when replaying history: without it the weakest-first tiebreak
  // would rank a simulated day's concepts by their mastery in the real present.
  const at = opts.at ?? now();
  const out: QueueEntry[] = [];

  for (const course of courses) {
    for (const concept of course.concepts) {
      // hasAttempted, NOT reps > 0: a lapse resets reps to 0, and filtering on
      // that dropped every lapsed concept out of the queue -- the one case the
      // queue exists for, and the case the lapsed-first sort below is written
      // to prioritise. That sort was unreachable until this line was fixed.
      if (concept.status === 'locked' || !hasAttempted(concept)) continue;
      const due = concept.review.dueOn;
      const overdueDays = due ? -daysBetween(today, due) : -Infinity;
      const withinHorizon = due ? daysBetween(today, due) <= horizon : false;
      if (!opts.includeNotDue && !withinHorizon) continue;
      out.push({ concept, courseId: course.id, overdueDays, effective: effectiveMastery(concept, at) });
    }
  }

  return out.sort((a, b) => {
    const aLapsed = isLapsed(a.concept) && a.overdueDays >= 0;
    const bLapsed = isLapsed(b.concept) && b.overdueDays >= 0;
    if (aLapsed !== bLapsed) return aLapsed ? -1 : 1;
    if (a.overdueDays !== b.overdueDays) return b.overdueDays - a.overdueDays;
    return a.effective - b.effective;
  });
}

export function dueCount(courses: { id: string; concepts: Concept[] }[], today: DayKey = dayKey()): number {
  return buildQueue(courses, today).length;
}

export function overdueCount(courses: { id: string; concepts: Concept[] }[], today: DayKey = dayKey()): number {
  return buildQueue(courses, today).filter((e) => e.overdueDays > 0).length;
}
