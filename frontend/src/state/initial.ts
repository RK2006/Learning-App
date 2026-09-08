import type { AppState, Profile, Schedule, Settings, StreakState } from '../types/state';
import { localTimeZone, now } from '../domain/time';

// 4: lessonCache re-keyed from concept id to the full generation identity, so
// a re-teach can no longer be served the lesson it exists to differ from.
export const SCHEMA_VERSION = 4;

/** Caps applied in the reducer, so persisted state is bounded by construction.
 *  Unbounded arrays are the realistic quota bug in an app like this. */
export const LIMITS = {
  sessions: 200,
  days: 400,
  lessonCache: 20,
  scoreHistory: 10,
  masteryHistory: 50,
  toasts: 3,
} as const;

export function defaultSettings(): Settings {
  return {
    dailyGoalXp: 30,
    dailyTimeMin: 10,
    level: 'medium',
    questionsPerLesson: 2,
    pathLength: 7,
    autoAdvanceOnCorrect: false,
    showSrsInternals: false,
    challengeMode: false,
    heartsPerSession: 3,
    timeZone: localTimeZone(),
    weekStartsOn: 1,
    sound: false,
    clockOffsetMs: 0,
  };
}

export function defaultProfile(at: number = now()): Profile {
  return {
    displayName: 'You',
    avatarPreset: 0,
    createdAt: at,
    totalXp: 0,
    sessionCount: 0,
    totalTimeMs: 0,
    lastSeenAt: null,
  };
}

/**
 * Weekdays, 19:00, ten minutes' warning.
 *
 * Mon-Fri rather than all seven on purpose: a plan that asks for every single
 * day is the one people abandon first, and the streak already has freezes
 * precisely because missing a day is expected. `savedAt: null` marks this as a
 * suggestion nobody has agreed to yet, which is what lets the Schedule screen
 * tell the difference between a default and a decision.
 */
export function defaultSchedule(): Schedule {
  return {
    timeOfDay: '19:00',
    durationMin: 15,
    weekdays: [1, 2, 3, 4, 5],
    reminderMin: 10,
    weeks: 8,
    savedAt: null,
    exportedAt: null,
  };
}

export function defaultStreak(): StreakState {
  return {
    current: 0,
    longest: 0,
    lastGoalDate: null,
    freezes: 0,
    repairOfferedFor: null,
    clockSkewDetected: false,
  };
}

export function initialState(): AppState {
  return {
    hydrated: false,
    onboarded: false,
    profile: defaultProfile(),
    settings: defaultSettings(),
    schedule: defaultSchedule(),
    courses: [],
    activeCourseId: null,
    lessonCache: {},
    sessions: [],
    days: {},
    streak: defaultStreak(),
    achievements: {},
    toasts: [],
    pathStatus: 'idle',
    pathError: null,
  };
}
