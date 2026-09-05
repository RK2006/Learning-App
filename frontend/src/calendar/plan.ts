import type { Concept, DayKey } from '../types/domain';
import type { Course, Schedule } from '../types/state';
import { BYDAY, firstOccurrence, parseTimeOfDay } from './ics';
import type { VEvent } from './ics';
import { dayKey, dayKeyToDate, now } from '../domain/time';
import { hasAttempted } from '../domain/mastery';

/**
 * Turning the app's own state into calendar events.
 *
 * Kept separate from ics.ts so that module stays a pure RFC 5545 encoder with
 * no idea what a concept is -- which is what makes it testable by reading it.
 */

/** UIDs are stable per course so a re-export updates rather than duplicates. */
const uid = (suffix: string) => `${suffix}@learnable.app`;

export function planSummary(course: Course | null): string {
  return course ? `Study: ${course.topic}` : 'Study session';
}

/**
 * The recurring study block.
 *
 * COUNT rather than UNTIL: the plan is "eight weeks of this", which is a number
 * of occurrences, and COUNT says that directly. UNTIL would need a date
 * computed from the weekday pattern, and would drift by a day whenever the
 * pattern changed.
 *
 * The description says what the app can and cannot do, in the calendar entry
 * itself, because that is where someone will be looking at 19:00 on a Tuesday
 * wondering why their phone did not buzz.
 */
export function planEvent(
  schedule: Schedule,
  course: Course | null,
  at: number = now(),
): VEvent {
  const days = schedule.weekdays.length > 0 ? schedule.weekdays : [1];
  const byday = [...days].sort((a, b) => a - b).map((d) => BYDAY[d]).join(',');

  return {
    uid: uid(`plan-${course?.id ?? 'default'}`),
    start: firstOccurrence(days, schedule.timeOfDay, at),
    durationMin: schedule.durationMin,
    summary: planSummary(course),
    description: course
      ? `Your daily session in Learnable.\n\nOpen the app to pick up wherever your review queue is. This entry is a reminder only — it does not sync back, so changing it here will not change your plan in the app.`
      : 'Your daily session in Learnable.',
    rrule: `FREQ=WEEKLY;BYDAY=${byday};COUNT=${Math.max(1, schedule.weeks * days.length)}`,
    alarmMinutesBefore: schedule.reminderMin,
    transparent: true,
  };
}

/**
 * One event per DUE DATE, not per concept.
 *
 * Six concepts coming due on the same Thursday is one thing to do that
 * Thursday, not six appointments. Exporting them individually produces a
 * calendar that looks like a full day of work and gets deleted wholesale.
 */
export function reviewEvents(
  concepts: Concept[],
  schedule: Schedule,
  at: number = now(),
): VEvent[] {
  const today = dayKey(at);
  const byDate = new Map<DayKey, string[]>();

  for (const c of concepts) {
    const due = c.review.dueOn;
    // Only real, future-or-today reviews for concepts actually studied. An
    // unstudied concept has no retention to protect, and exporting a date in
    // the past would land the reminder behind the user.
    if (!due || !hasAttempted(c) || c.markedKnown) continue;
    if (due < today) continue;
    const names = byDate.get(due) ?? [];
    names.push(c.name);
    byDate.set(due, names);
  }

  const { hours, minutes } = parseTimeOfDay(schedule.timeOfDay);

  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([due, names]) => {
      const start = dayKeyToDate(due);
      start.setHours(hours, minutes, 0, 0);
      return {
        uid: uid(`review-${due}`),
        start,
        durationMin: schedule.durationMin,
        summary: names.length === 1 ? `Review: ${names[0]}` : `Review: ${names.length} concepts`,
        description: names.map((n) => `• ${n}`).join('\n'),
        alarmMinutesBefore: schedule.reminderMin,
        transparent: true,
      };
    });
}

/** How many review events an export would actually contain, for the button. */
export function dueExportCount(concepts: Concept[], at: number = now()): number {
  const today = dayKey(at);
  const dates = new Set<DayKey>();
  for (const c of concepts) {
    const due = c.review.dueOn;
    if (!due || !hasAttempted(c) || c.markedKnown || due < today) continue;
    dates.add(due);
  }
  return dates.size;
}

/** Mon-first or Sun-first labels, matching the weekStartsOn setting. */
export function weekdayLabels(weekStartsOn: 0 | 1): { index: number; short: string }[] {
  const base = [
    { index: 0, short: 'Sun' },
    { index: 1, short: 'Mon' },
    { index: 2, short: 'Tue' },
    { index: 3, short: 'Wed' },
    { index: 4, short: 'Thu' },
    { index: 5, short: 'Fri' },
    { index: 6, short: 'Sat' },
  ];
  return weekStartsOn === 1 ? [...base.slice(1), base[0]!] : base;
}
