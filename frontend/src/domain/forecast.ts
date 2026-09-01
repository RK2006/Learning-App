import type { Concept, DayKey } from '../types/domain';
import { DAY_MS, addDays, dayKey, formatDayShort, now } from './time';
import { FLOOR_RATIO, UNLOCK_AT, effectiveMastery, halfLifeDays, hasAttempted } from './mastery';

/**
 * Retention forecast.
 *
 * The mastery model already says what you know *now*. This inverts it and says
 * when you will stop knowing it -- which is the only part a learner can act on.
 * "You are 74% on this" is a score; "this drops below 60% on Friday unless you
 * review it" is a reason to open the app.
 *
 * Entirely derived, like the decay itself: one closed-form solve per concept,
 * no stored predictions to go stale, and it reads the injectable clock so the
 * demo time-travel tool moves the forecast along with everything else.
 */

export const FORECAST_THRESHOLD = UNLOCK_AT; // 60 -- the same line the path unlocks on

/**
 * Days from `at` until a concept's effective mastery crosses below `threshold`.
 *
 * `null` means never: either it has not been studied yet (there is nothing to
 * forget), or its floor -- 40% of the best it has ever been -- already sits at
 * or above the threshold, so the curve flattens out before it gets there.
 *
 * Solving rather than stepping: effective(d) = mastery * 2^(-d / halfLife), so
 * the crossing is at d = halfLife * log2(mastery / threshold). Iterating a day
 * at a time would give the same answer more slowly and less precisely.
 */
export function daysUntilBelow(
  c: Concept,
  threshold: number = FORECAST_THRESHOLD,
  at: number = now(),
): number | null {
  if (c.lastStudiedAt == null || !hasAttempted(c)) return null;
  if (FLOOR_RATIO * c.peakMastery >= threshold) return null;
  if (c.mastery <= threshold) return 0;

  const daysFromStudy = halfLifeDays(c.review.reps) * Math.log2(c.mastery / threshold);
  const elapsed = (at - c.lastStudiedAt) / DAY_MS;
  return Math.max(0, daysFromStudy - elapsed);
}

export interface ForecastEntry {
  concept: Concept;
  courseId: string;
  /** Days from now until the crossing. 0 means it is already below. */
  days: number;
  on: DayKey;
  current: number;
}

/**
 * Every concept that falls below the threshold inside the horizon, soonest
 * first. Concepts already below are included at day 0 -- they are the most
 * urgent case, not an edge case to filter out.
 */
export function forecast(
  courses: { id: string; concepts: Concept[] }[],
  opts: { withinDays?: number; threshold?: number } = {},
  at: number = now(),
): ForecastEntry[] {
  const withinDays = opts.withinDays ?? 14;
  const threshold = opts.threshold ?? FORECAST_THRESHOLD;
  const today = dayKey(at);
  const out: ForecastEntry[] = [];

  for (const course of courses) {
    for (const concept of course.concepts) {
      if (concept.status === 'locked' || concept.markedKnown) continue;
      const days = daysUntilBelow(concept, threshold, at);
      if (days == null || days > withinDays) continue;
      out.push({
        concept,
        courseId: course.id,
        days,
        on: addDays(today, Math.round(days)),
        current: effectiveMastery(concept, at),
      });
    }
  }

  return out.sort((a, b) => a.days - b.days);
}

/**
 * The Progress screen's one-line headline.
 *
 * Deliberately phrased as a conditional ("without review") rather than a
 * prediction -- the whole point is that it is avoidable, and a forecast the
 * user can falsify by acting is the only honest way to state it.
 */
export function describeForecast(
  entries: ForecastEntry[],
  withinDays = 14,
  threshold: number = FORECAST_THRESHOLD,
): string | null {
  if (entries.length === 0) return null;
  const last = entries[entries.length - 1]!;
  const n = entries.length;
  const noun = n === 1 ? 'concept drops' : 'concepts drop';
  if (last.days === 0) {
    return `${n} ${noun} below ${threshold}% right now.`;
  }
  return `Without review, ${n} ${noun} below ${threshold}% within ${withinDays} days — the last on ${formatDayShort(last.on)}.`;
}

/**
 * Sampled decay curve for one concept, for a sparkline.
 *
 * Sampled rather than solved because the floor makes the curve piecewise, and
 * a chart wants points anyway.
 */
export function retentionCurve(
  c: Concept,
  days = 30,
  step = 1,
  at: number = now(),
): { day: number; value: number }[] {
  const out: { day: number; value: number }[] = [];
  for (let d = 0; d <= days; d += step) {
    out.push({ day: d, value: effectiveMastery(c, at + d * DAY_MS) });
  }
  return out;
}
