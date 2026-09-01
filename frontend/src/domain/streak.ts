import type { DayKey } from '../types/domain';
import type { DayStat, StreakState } from '../types/state';
import { addDays, daysBetween } from './time';

/**
 * The streak.
 *
 * What earns a day: hitting the XP goal. Not opening the app, not starting a
 * lesson. That single choice is the difference between a streak that means
 * something and a participation counter.
 *
 * Freezes are consumed RETROACTIVELY, at the moment you come back -- never
 * spent in advance. You cannot lose one by being away longer than you planned.
 */

const FREEZE_CAP = 2;
const FREEZE_EVERY = 7;

export interface StreakUpdate {
  streak: StreakState;
  /** Set when this update consumed a freeze, so the calendar can mark it. */
  freezeUsedOn: DayKey | null;
  extended: boolean;
  earnedFreeze: boolean;
}

export function updateStreak(prev: StreakState, today: DayKey, goalMet: boolean): StreakUpdate {
  const unchanged: StreakUpdate = {
    streak: prev,
    freezeUsedOn: null,
    extended: false,
    earnedFreeze: false,
  };

  if (!goalMet || prev.lastGoalDate === today) return unchanged;

  const gap = prev.lastGoalDate ? daysBetween(prev.lastGoalDate, today) : Infinity;

  const bump = (freezes: number, freezeUsedOn: DayKey | null): StreakUpdate => {
    const current = prev.current + 1;
    const earnedFreeze = current % FREEZE_EVERY === 0 && freezes < FREEZE_CAP;
    return {
      streak: {
        ...prev,
        current,
        longest: Math.max(prev.longest, current),
        lastGoalDate: today,
        freezes: Math.min(FREEZE_CAP, freezes + (earnedFreeze ? 1 : 0)),
        repairOfferedFor: null,
      },
      freezeUsedOn,
      extended: true,
      earnedFreeze,
    };
  };

  if (gap === 1) return bump(prev.freezes, null);

  // Exactly one missed day, and we are holding a freeze: cover it.
  if (gap === 2 && prev.freezes > 0) {
    return bump(prev.freezes - 1, addDays(today, -1));
  }

  // Streak broken.
  return {
    streak: {
      ...prev,
      current: 1,
      longest: Math.max(prev.longest, 1),
      lastGoalDate: today,
      repairOfferedFor: null,
    },
    freezeUsedOn: null,
    extended: true,
    earnedFreeze: false,
  };
}

/** Is the streak still live, or has the user already missed too long? */
export function isStreakAlive(s: StreakState, today: DayKey): boolean {
  if (!s.lastGoalDate || s.current === 0) return false;
  const gap = daysBetween(s.lastGoalDate, today);
  return gap <= (s.freezes > 0 ? 2 : 1);
}

/** Display value: a streak you have already lost should read 0, not linger at
 *  its old number until the next session. */
export function displayStreak(s: StreakState, today: DayKey): number {
  return isStreakAlive(s, today) ? s.current : 0;
}

export function goalMetOn(days: Record<string, DayStat>, key: DayKey): boolean {
  return Boolean(days[key]?.goalMet);
}

/* -------------------------------------------------------------- repair --- */

export const REPAIR_MIN_STREAK = 3;
export const REPAIR_COOLDOWN_DAYS = 30;
export const REPAIR_SESSIONS_REQUIRED = 2;

/**
 * A streak worth several days is worth one second chance.
 *
 * Offered at most once a month, only for a streak that was actually long
 * enough to hurt to lose, and only when no freeze was available to cover it --
 * if a freeze existed, updateStreak already used it and there is nothing to
 * repair. The work required is real (two sessions today), so this restores a
 * streak you re-earn rather than handing one back.
 */
export function canOfferRepair(s: StreakState, today: DayKey): boolean {
  if (!s.lastGoalDate || s.current < REPAIR_MIN_STREAK) return false;
  if (isStreakAlive(s, today)) return false;
  if (s.freezes > 0) return false;
  if (s.repairOfferedFor && daysBetween(s.repairOfferedFor, today) < REPAIR_COOLDOWN_DAYS) return false;
  return true;
}

/** Sessions completed today, which is what the repair is priced in. */
export function repairProgress(days: Record<string, DayStat>, today: DayKey): number {
  return Math.min(REPAIR_SESSIONS_REQUIRED, days[today]?.sessions ?? 0);
}

/**
 * Bridge the gap: the streak resumes from where it stopped and counts today.
 * `repairOfferedFor` starts the 30-day cooldown whether or not it is ever
 * offered again.
 */
export function applyRepair(s: StreakState, today: DayKey): StreakState {
  const current = s.current + 1;
  return {
    ...s,
    current,
    longest: Math.max(s.longest, current),
    lastGoalDate: today,
    repairOfferedFor: today,
  };
}

/* --------------------------------------------------------- clock guard --- */

const SKEW_TOLERANCE_MS = 60_000;

/**
 * Did the machine's clock move backwards since we last saw it?
 *
 * Compared against the REAL wall clock, never against now() -- now() carries
 * the demo time-travel offset, so every use of that tool would otherwise read
 * as tampering.
 *
 * Honest limitation, stated rather than papered over: setting the clock
 * FORWARD still fakes a streak, and nothing running only in the browser can
 * stop that. Catching the backwards case is worth it anyway because that is
 * the accidental one -- a machine correcting its clock after a flat battery.
 */
export function detectClockSkew(lastSeenAt: number | null, wallNow: number): boolean {
  return lastSeenAt != null && wallNow < lastSeenAt - SKEW_TOLERANCE_MS;
}
