/**
 * iCalendar (RFC 5545) generation, by hand.
 *
 * A library was the obvious call and the wrong one. Four things break .ics
 * files in the wild, every one of them is a one-line decision, and every one of
 * them is a decision a library makes for you silently:
 *
 *   1. CRLF everywhere, including after the final line.
 *   2. Fold at 75 OCTETS -- UTF-8 bytes, not characters -- without ever
 *      splitting a character in half.
 *   3. Escape backslash, semicolon, comma and newline in every TEXT value.
 *   4. Floating local time. No trailing Z, no TZID.
 *
 * Each is explained at its implementation. The whole module is ~120 lines of
 * logic, which is less than the time it would take to verify that a dependency
 * got all four right.
 */

import { DAY_MS, now, wallClock } from '../domain/time';

export interface VEvent {
  /** Globally unique. Stable across exports of the same event, so re-importing
   *  updates the existing entry instead of duplicating it. */
  uid: string;
  /** Interpreted as FLOATING local time -- see floatingLocal(). */
  start: Date;
  durationMin: number;
  summary: string;
  description?: string;
  location?: string;
  /** Recurrence rule WITHOUT the "RRULE:" prefix, e.g. "FREQ=WEEKLY;BYDAY=MO". */
  rrule?: string;
  /** Minutes before the start. null or 0 for no alarm. */
  alarmMinutesBefore?: number | null;
  /** TRANSP:TRANSPARENT -- the event does not mark you busy. */
  transparent?: boolean;
}

/* ------------------------------------------------------------ escaping --- */

/**
 * RFC 5545 3.3.11. Backslash FIRST, or the escapes we add get re-escaped.
 *
 * A colon needs no escaping inside a TEXT value, which is worth knowing because
 * escaping it is a common overcorrection that makes "Study: Roman History"
 * arrive in the calendar as "Study\: Roman History".
 */
export function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/* ------------------------------------------------------------- folding --- */

const encoder = new TextEncoder();

/**
 * Fold a content line to 75 octets.
 *
 * The two traps, both of which produce a file that works until someone's topic
 * has a non-ASCII character in it:
 *
 * OCTETS, NOT CHARACTERS. The limit is bytes. "Le Régime" is 9 characters and
 * 10 bytes. Folding on `.length` writes lines that are over the limit, which
 * strict parsers reject.
 *
 * NEVER SPLIT A CHARACTER. If the budget runs out mid-character, the fold has
 * to happen before it, not through it -- a CRLF inserted between the two bytes
 * of "é" produces invalid UTF-8 and garbles the rest of the line. Iterating the
 * string with for...of walks whole code points, so a surrogate pair (an emoji
 * in a course title) stays intact too.
 *
 * A continuation line carries a leading space that counts toward its own 75,
 * so it gets 74 octets of content.
 */
export function foldLine(line: string): string {
  const parts: string[] = [];
  let current = '';
  let bytes = 0;
  let budget = 75;

  for (const char of line) {
    const size = encoder.encode(char).length;
    if (bytes + size > budget) {
      parts.push(current);
      current = '';
      bytes = 0;
      budget = 74;
    }
    current += char;
    bytes += size;
  }
  parts.push(current);

  return parts.join('\r\n ');
}

/* ---------------------------------------------------------------- time --- */

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Floating local time: 20260912T190000. No Z, no TZID.
 *
 * This is the correct representation for "study at 19:00", and it is correct
 * precisely BECAUSE it carries no zone. Every major client reads a floating
 * time as the viewer's own local time, so the event stays at 19:00 if the user
 * flies to Berlin -- which is what a daily habit means.
 *
 * The alternative, TZID, requires embedding a full VTIMEZONE component with
 * that zone's DST transition rules. That is roughly thirty lines of
 * hand-maintained data per zone, it goes stale whenever a government changes
 * its DST policy, and it would be wrong for this use case anyway.
 *
 * Local getters, deliberately: getFullYear/getMonth/getDate read the machine's
 * local calendar, which is exactly the number we want to write down.
 */
export function floatingLocal(d: Date): string {
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `T${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  );
}

/** DTSTAMP is defined as UTC, always -- it is a file timestamp, not an event. */
function utcStamp(ms: number): string {
  const d = new Date(ms);
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

/* -------------------------------------------------------------- events --- */

function eventLines(e: VEvent, stamp: string): string[] {
  const end = new Date(e.start.getTime() + e.durationMin * 60_000);
  const lines = [
    'BEGIN:VEVENT',
    `UID:${e.uid}`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${floatingLocal(e.start)}`,
    `DTEND:${floatingLocal(end)}`,
    `SUMMARY:${escapeText(e.summary)}`,
  ];

  if (e.description) lines.push(`DESCRIPTION:${escapeText(e.description)}`);
  if (e.location) lines.push(`LOCATION:${escapeText(e.location)}`);
  if (e.rrule) lines.push(`RRULE:${e.rrule}`);

  // TRANSPARENT means "does not block time". A recurring study reminder that
  // marks you busy every weekday evening will get turned off within a week.
  if (e.transparent !== false) lines.push('TRANSP:TRANSPARENT');

  if (e.alarmMinutesBefore != null && e.alarmMinutesBefore > 0) {
    lines.push(
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `DESCRIPTION:${escapeText(e.summary)}`,
      `TRIGGER:-PT${Math.round(e.alarmMinutesBefore)}M`,
      'END:VALARM',
    );
  }

  lines.push('END:VEVENT');
  return lines;
}

/**
 * One VCALENDAR wrapping every event, so an export is a single download.
 *
 * Shipping one file per review date would mean a browser firing eight download
 * prompts in a row, which most people read as the page being broken.
 */
export function buildCalendar(events: VEvent[], productName = 'Learnable'): string {
  const stamp = utcStamp(wallClock());
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:-//${productName}//Study Plan//EN`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    ...events.flatMap((e) => eventLines(e, stamp)),
    'END:VCALENDAR',
  ];

  // Trailing CRLF included. A file ending on END:VCALENDAR without one is
  // accepted by most parsers and rejected by some; the spec says every content
  // line ends with CRLF, and END:VCALENDAR is a content line.
  return lines.map(foldLine).join('\r\n') + '\r\n';
}

/* ----------------------------------------------------------- scheduling --- */

/** RFC weekday codes, indexed by JS getDay(). */
export const BYDAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const;

export function parseTimeOfDay(hhmm: string): { hours: number; minutes: number } {
  const [h, m] = hhmm.split(':').map(Number);
  return {
    hours: Number.isFinite(h) ? Math.max(0, Math.min(23, h!)) : 19,
    minutes: Number.isFinite(m) ? Math.max(0, Math.min(59, m!)) : 0,
  };
}

/**
 * The first occurrence at or after `from` that falls on one of `weekdays`.
 *
 * Includes today when today qualifies and the time has not passed yet --
 * a plan saved at 9am for a 7pm slot should start tonight, not next week.
 */
export function firstOccurrence(weekdays: number[], timeOfDay: string, from: number = now()): Date {
  const { hours, minutes } = parseTimeOfDay(timeOfDay);
  const days = weekdays.length > 0 ? weekdays : [new Date(from).getDay()];

  for (let offset = 0; offset < 8; offset++) {
    const d = new Date(from + offset * DAY_MS);
    d.setHours(hours, minutes, 0, 0);
    if (days.includes(d.getDay()) && d.getTime() >= from) return d;
  }
  // Unreachable for a non-empty weekday set; a sane value beats a throw.
  const fallback = new Date(from);
  fallback.setHours(hours, minutes, 0, 0);
  return fallback;
}
