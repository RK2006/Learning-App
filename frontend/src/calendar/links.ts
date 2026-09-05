import type { VEvent } from './ics';
import { floatingLocal } from './ics';

/**
 * Deep links to the two web calendars that have them.
 *
 * These are not an alternative to the .ics file, they are a convenience with
 * strictly less capability, and the UI says so next to each one. Both providers
 * silently drop what they cannot express -- you get an event, it just is not
 * the event you asked for -- so the honest thing is to name the gap in the menu
 * rather than let someone discover it a week later when no reminder fires.
 */

export interface DeepLinkGap {
  /** Shown as the menu item's subtitle. */
  note: string;
}

/* -------------------------------------------------------------- Google --- */

/**
 * Google Calendar's template URL.
 *
 * Two details that are easy to get wrong and produce a plausible-looking event
 * at the wrong time:
 *
 * `dates` must be LOCAL and unsuffixed when `ctz` is present. Passing a UTC
 * value with a Z while also naming a zone makes Google apply the offset twice,
 * so a 19:00 study block lands at 14:00 or midnight depending on where you are.
 *
 * `recur` must carry the literal "RRULE:" prefix inside the parameter value,
 * then be URL-encoded whole. A bare "FREQ=WEEKLY..." is ignored, and the event
 * is created as a one-off with no error.
 *
 * There is no alarm parameter. None. The reminder cannot be carried.
 */
export function googleUrl(e: VEvent, timeZone: string): string {
  const end = new Date(e.start.getTime() + e.durationMin * 60_000);
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: e.summary,
    dates: `${floatingLocal(e.start)}/${floatingLocal(end)}`,
    ctz: timeZone,
  });
  if (e.description) params.set('details', e.description);
  if (e.rrule) params.set('recur', `RRULE:${e.rrule}`);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

export const GOOGLE_GAP: DeepLinkGap = {
  note: 'Carries the repeat. Reminder uses your Google default — the link has no field for it.',
};

/* ------------------------------------------------------------- Outlook --- */

/**
 * Outlook Web's compose deep link.
 *
 * `outlook.live.com` is a personal Microsoft account; `outlook.office.com` is a
 * work or school one. They are different hosts with the same path, and sending
 * someone to the wrong one shows a sign-in page for an account they do not
 * have -- which reads as the export being broken.
 *
 * There is NO recurrence parameter. The event is created as a single
 * occurrence, and the menu item says "single event" for that reason. Anyone who
 * wants the repeating plan needs the .ics file, so that is what the note
 * points at.
 *
 * startdt/enddt take an ISO-like local string with no zone suffix, which lines
 * up with the floating-time decision in ics.ts.
 */
export function outlookUrl(e: VEvent, account: 'personal' | 'work'): string {
  const end = new Date(e.start.getTime() + e.durationMin * 60_000);
  const host = account === 'work' ? 'outlook.office.com' : 'outlook.live.com';
  const iso = (d: Date) => floatingLocal(d).replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/, '$1-$2-$3T$4:$5:$6');

  const params = new URLSearchParams({
    rru: 'addevent',
    subject: e.summary,
    startdt: iso(e.start),
    enddt: iso(end),
  });
  if (e.description) params.set('body', e.description);
  return `https://${host}/calendar/0/deeplink/compose?${params.toString()}`;
}

export const OUTLOOK_GAP: DeepLinkGap = {
  note: 'Single event only — Outlook’s link has no recurrence field. Use the .ics for the repeating plan.',
};

/**
 * What a browser-only build genuinely cannot do, listed rather than hidden.
 *
 * Every one of these needs a server, and three of them need a server that holds
 * a secret. Showing them as a "coming with accounts" list is more useful than
 * an empty settings page, and much more useful than a toggle that does nothing.
 */
export const NEEDS_AN_ACCOUNT: { title: string; why: string }[] = [
  {
    title: 'Reminders when the tab is closed',
    why: 'Needs a service worker plus Web Push and a VAPID key pair, and the key has to live somewhere that is not the browser.',
  },
  {
    title: 'Two-way sync and free-slot finding',
    why: 'Needs OAuth against Google or Microsoft, which requires a client secret and a redirect URI on a real domain.',
  },
  {
    title: 'Knowing whether you actually added it',
    why: 'A download and a deep link both end at the browser. Neither reports back, so this app can only record that it offered.',
  },
  {
    title: 'A calendar you subscribe to once',
    why: 'webcal:// needs a hosted feed that regenerates as your reviews move. There is no server to host it yet.',
  },
];
