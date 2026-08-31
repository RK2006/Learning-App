import type { Concept, ConceptStatus } from '../types/domain';
import { DAY_MS, now } from './time';

/**
 * The mastery model.
 *
 * Decay is DERIVED, never stored. No background timer, no cron, no "last
 * updated" sweep -- effective mastery is a pure function of the stored value and
 * the elapsed time, so it is always correct, and because it reads the injectable
 * clock the demo time-travel tool makes weeks of forgetting visible instantly.
 */

const HALF_LIFE_BASE = 3; // days, at reps = 0
const HALF_LIFE_GROWTH = 1.7; // per successful repetition
const HALF_LIFE_CAP = 120;
/** You never forget everything you once knew well. Exported because the
 *  retention forecast has to know where the curve bottoms out -- a concept
 *  whose floor is already above the threshold never crosses it. */
export const FLOOR_RATIO = 0.4;

export const UNLOCK_AT = 60;
export const COMPLETED_AT = 80;

/** reps: 0->3d 1->5.1d 2->8.7d 3->14.7d 4->25d 5->42.6d 6->72.4d 7+->120d */
export function halfLifeDays(reps: number): number {
  return Math.min(HALF_LIFE_BASE * Math.pow(HALF_LIFE_GROWTH, Math.max(0, reps)), HALF_LIFE_CAP);
}

export function effectiveMastery(c: Concept, at: number = now()): number {
  if (!c.lastStudiedAt || c.mastery <= 0) return c.mastery > 0 ? c.mastery : 0;
  const days = Math.max(0, (at - c.lastStudiedAt) / DAY_MS);
  const retained = c.mastery * Math.pow(2, -days / halfLifeDays(c.review.reps));
  /**
   * The floor can never RAISE you above what is stored.
   *
   * `max(0.4 * peak, retained)` alone did exactly that: score badly twice on a
   * concept that once hit 100 and it stores 30, but reads back 40 immediately,
   * with zero days elapsed. The results screen would say "75% -> 30%" while the
   * path beside it said 40% for the same concept at the same instant.
   *
   * The floor models "you never forget everything you once knew well", which is
   * a statement about DECAY. Capping it at the stored value keeps it that.
   */
  const floor = Math.min(FLOOR_RATIO * c.peakMastery, c.mastery);
  return Math.max(floor, Math.min(100, retained));
}

/**
 * Exponential moving average toward the session score.
 *
 * Asymmetric alpha on purpose: a first exposure should move fast, an
 * improvement should move fairly fast, and a regression should move SLOWLY --
 * one bad day on a concept you know well is usually noise, and punishing it
 * hard makes the number untrustworthy.
 *
 * Takes `firstExposure`, NOT `reps`. Called with `review.reps === 0` it applied
 * the fast first-exposure alpha to anyone who had just lapsed -- SM-2 zeroes
 * reps on a lapse -- so the second bad session in a row moved 0.60 instead of
 * the 0.25 the comment above promises. A struggling learner got the harshest
 * possible treatment from the branch written to protect them, which could drop
 * a concept below 60 and re-lock the one after it.
 */
export function nextMastery(prev: number, score: number, firstExposure: boolean): number {
  const alpha = firstExposure ? 0.6 : score >= prev ? 0.45 : 0.25;
  return Math.max(0, Math.min(100, prev + alpha * (score - prev)));
}

/**
 * Has this been studied at all, ever?
 *
 * NOT `review.reps`. That is SM-2's count of consecutive successes and it resets
 * to zero on every lapse, so reading it as "has been studied" silently treats a
 * struggling learner as a brand-new one -- which is the exact opposite of what
 * every caller here wants. `attempts` only ever goes up, and only an explicit
 * concept reset clears it.
 *
 * This cost a concept with 8 attempts and 57% mastery its place in the path: it
 * lapsed, reps went to 0, and the guard that exists to stop decay re-locking
 * anything re-locked it anyway.
 */
export function hasAttempted(c: Concept): boolean {
  return c.attempts > 0 || c.lastStudiedAt != null;
}

export function isUnlocked(c: Concept, prev: Concept | undefined, at: number = now()): boolean {
  if (!prev) return true; // the first concept is always open
  if (hasAttempted(c)) return true; // see deriveStatus
  return hasAttempted(prev) && effectiveMastery(prev, at) >= UNLOCK_AT;
}

/**
 * Status is derived, in this exact order.
 *
 * Note the consequence: a `completed` concept CAN decay back into
 * `needsReview`. That is the behaviour that makes the Review screen worth
 * having.
 *
 * The guard matters though -- once a concept has been attempted it never
 * re-locks. Letting decay strand someone mid-course behind a prerequisite they
 * already passed reads as punishment, not adaptation.
 */
export function deriveStatus(
  c: Concept,
  prev: Concept | undefined,
  today: string,
  at: number = now(),
): ConceptStatus {
  if (!isUnlocked(c, prev, at)) return 'locked';
  const m = effectiveMastery(c, at);
  const overdue = c.review.dueOn != null && c.review.dueOn <= today;
  if (hasAttempted(c) && (m < UNLOCK_AT || overdue)) return 'needsReview';
  if (m >= COMPLETED_AT) return 'completed';
  return 'current';
}

/**
 * Recompute every status in path order.
 *
 * Returns the SAME array reference when nothing changed. That is not a
 * micro-optimisation: this runs on a timer so the path stays honest as the day
 * rolls over, and allocating a fresh concept list every tick would make the
 * reducer produce a new state object every minute, which re-renders the tree
 * and triggers a pointless localStorage write forever.
 */
export function restatus(concepts: Concept[], today: string, at: number = now()): Concept[] {
  let changed = false;
  const out = concepts.map((c, i) => {
    const status = deriveStatus(c, concepts[i - 1], today, at);
    if (status === c.status) return c;
    changed = true;
    return { ...c, status };
  });
  return changed ? out : concepts;
}

export function courseMastery(concepts: Concept[], at: number = now()): number {
  if (concepts.length === 0) return 0;
  return concepts.reduce((sum, c) => sum + effectiveMastery(c, at), 0) / concepts.length;
}
