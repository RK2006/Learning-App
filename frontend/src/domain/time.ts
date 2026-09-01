import type { DayKey } from '../types/domain';

/**
 * The clock.
 *
 * EVERY read of the current time in this app goes through now(). Nothing calls
 * Date.now() directly. Two reasons:
 *
 *  1. The demo time-travel tool adds an offset here, which is what makes decay,
 *     streak loss and review scheduling demonstrable in thirty seconds instead
 *     of over a week. It is the single most convincing feature in the demo and
 *     it costs one indirection.
 *
 *  2. The reducer must stay pure. Impurity enters through action payloads built
 *     by actions.ts, which calls this -- so the reducer itself never reads a
 *     clock and StrictMode's double-invocation is harmless.
 */

let clockOffsetMs = 0;

export function setClockOffset(ms: number): void {
  clockOffsetMs = ms;
}

export function getClockOffset(): number {
  return clockOffsetMs;
}

export function now(): number {
  return Date.now() + clockOffsetMs;
}

/**
 * The real wall clock, ignoring the demo offset.
 *
 * Used only for "has the machine's clock moved backwards since we last saw it"
 * -- comparing that against now() would flag every use of the time-travel tool
 * as tampering. Persistence timestamps use this for the same reason.
 */
export function wallClock(): number {
  return Date.now();
}

export const DAY_MS = 86_400_000;

/**
 * Local calendar date as 'YYYY-MM-DD'.
 *
 * 'en-CA' is the trick: it is the one widely-available locale that formats as
 * ISO. Using it with an explicit timeZone gives the user's real local date
 * without any date library and without UTC drift at the day boundary.
 */
export function dayKey(t: number = now(), timeZone?: string): DayKey {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: timeZone || undefined,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return fmt.format(new Date(t)) as DayKey;
}

export function localTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** Parse 'YYYY-MM-DD' as a LOCAL midnight, not UTC. `new Date('2026-09-11')`
 *  is parsed as UTC and silently shifts the day for anyone west of Greenwich. */
export function dayKeyToDate(key: DayKey): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y!, (m ?? 1) - 1, d ?? 1);
}

/** Whole days from a to b. Positive when b is later. */
export function daysBetween(a: DayKey, b: DayKey): number {
  const ms = dayKeyToDate(b).getTime() - dayKeyToDate(a).getTime();
  return Math.round(ms / DAY_MS);
}

export function addDays(key: DayKey, n: number): DayKey {
  const d = dayKeyToDate(key);
  d.setDate(d.getDate() + n);
  return dayKey(d.getTime());
}

export function startOfLocalDay(t: number = now()): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Days elapsed since a timestamp, fractional. Used by the decay curve. */
export function daysSince(t: number, from: number = now()): number {
  return Math.max(0, (from - t) / DAY_MS);
}

export function isToday(key: DayKey, timeZone?: string): boolean {
  return key === dayKey(now(), timeZone);
}

/* ------------------------------------------------------------ display --- */

export function formatDayLong(key: DayKey): string {
  return dayKeyToDate(key).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

export function formatDayShort(key: DayKey): string {
  return dayKeyToDate(key).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** "in 3 days" / "2 days overdue" / "today". Relative to the app clock. */
export function describeDue(due: DayKey | null, today: DayKey = dayKey()): string {
  if (!due) return 'Not scheduled';
  const delta = daysBetween(today, due);
  if (delta === 0) return 'Due today';
  if (delta === 1) return 'Due tomorrow';
  if (delta > 1) return `Due in ${delta} days`;
  if (delta === -1) return '1 day overdue';
  return `${Math.abs(delta)} days overdue`;
}

/** "in 3 days" / "in 2 weeks". For forecast copy, where the subject is a
 *  future crossing rather than a scheduled date. */
export function describeInDays(days: number): string {
  const d = Math.round(days);
  if (d <= 0) return 'already';
  if (d === 1) return 'tomorrow';
  if (d < 14) return `in ${d} days`;
  const weeks = Math.round(d / 7);
  return weeks < 9 ? `in ${weeks} weeks` : `in ${Math.round(d / 30)} months`;
}

export function describeAgo(t: number | null): string {
  if (t == null) return 'Never';
  const d = Math.floor(daysSince(t));
  if (d === 0) return 'Today';
  if (d === 1) return 'Yesterday';
  if (d < 30) return `${d} days ago`;
  const months = Math.floor(d / 30);
  return months === 1 ? '1 month ago' : `${months} months ago`;
}

export function formatDuration(ms: number): string {
  // Seconds below a minute. Rounding to minutes rendered every quick review as
  // "0m", which reads as "this did not happen" in a session-history row.
  if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))}s`;
  const mins = Math.round(ms / 60_000);
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  return `${h}h ${mins % 60}m`;
}
