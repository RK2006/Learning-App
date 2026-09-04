import type { AppAction, AppState } from '../types/state';
import type { DayKey } from '../types/domain';
import { DAY_MS, dayKey, now, setClockOffset, wallClock } from '../domain/time';
import { detectClockSkew } from '../domain/streak';

/**
 * THE IMPURITY BOUNDARY.
 *
 * The reducer is pure -- no clock, no RNG, no storage. Everything it needs that
 * cannot be computed from its own arguments is read here and handed over on the
 * action payload. That is the whole reason StrictMode's double-invocation is
 * harmless, the engines are testable without stubbing globals, and the demo
 * seeder can replay a fortnight of sessions by feeding the same reducer a
 * different `at`.
 *
 * If you find yourself wanting Date.now() inside state/reducer.ts, the thing
 * you actually want is a creator in this file.
 */

/** Both clock reads every dated action needs, taken once so they cannot
 *  disagree with each other across a slow frame. */
function stamp(state: AppState): { today: DayKey; at: number } {
  const at = now();
  return { at, today: dayKey(at, state.settings.timeZone) };
}

export function restatusNow(state: AppState): AppAction {
  return { type: 'RESTATUS', payload: stamp(state) };
}

/**
 * Move the app clock. The single most convincing eight seconds in the demo:
 * decay, review scheduling and streak loss are all real functions of time, so
 * jumping the clock forward makes a week of forgetting visible immediately.
 *
 * The module-level offset is set FIRST so the stamp below -- and therefore the
 * restatus the reducer runs -- is computed at the destination.
 */
export function travelDays(state: AppState, days: number): AppAction {
  const offsetMs = state.settings.clockOffsetMs + days * DAY_MS;
  setClockOffset(offsetMs);
  return { type: 'SET_CLOCK_OFFSET', payload: { offsetMs, ...stamp(state) } };
}

export function resetClock(state: AppState): AppAction {
  setClockOffset(0);
  return { type: 'SET_CLOCK_OFFSET', payload: { offsetMs: 0, ...stamp(state) } };
}

/** Records the real wall clock and flags a backwards jump. See
 *  domain/streak.ts::detectClockSkew for what this can and cannot catch. */
export function seenNow(state: AppState): AppAction {
  const wallNow = wallClock();
  return {
    type: 'SEEN_AT',
    payload: { wallNow, skewed: detectClockSkew(state.profile.lastSeenAt, wallNow) },
  };
}

export function snoozeConcept(
  state: AppState,
  courseId: string,
  conceptId: string,
  days: number,
): AppAction {
  return { type: 'SNOOZE_CONCEPT', payload: { courseId, conceptId, days, ...stamp(state) } };
}

export function markKnown(
  state: AppState,
  courseId: string,
  conceptId: string,
  known: boolean,
): AppAction {
  return { type: 'MARK_KNOWN', payload: { courseId, conceptId, known, ...stamp(state) } };
}

export function resetConcept(state: AppState, courseId: string, conceptId: string): AppAction {
  return { type: 'RESET_CONCEPT', payload: { courseId, conceptId, ...stamp(state) } };
}

export function repairStreak(state: AppState): AppAction {
  return { type: 'REPAIR_STREAK', payload: { today: stamp(state).today } };
}

export function breakStreak(state: AppState): AppAction {
  return { type: 'BREAK_STREAK', payload: { today: stamp(state).today } };
}

export function resetAll(state: AppState): AppAction {
  return { type: 'RESET_ALL', payload: { at: now(), timeZone: state.settings.timeZone } };
}

export function resetProgress(): AppAction {
  return { type: 'RESET_PROGRESS', payload: { at: now() } };
}
