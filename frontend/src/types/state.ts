import type {
  AssessmentResult,
  Concept,
  DayKey,
  Lesson,
  Level,
  SessionMode,
} from './domain';

/* ------------------------------------------------------------ settings --- */

export interface Settings {
  dailyGoalXp: number;
  dailyTimeMin: number;
  level: Level;
  questionsPerLesson: number;
  /**
   * How many concepts a new path is generated with.
   *
   * There was no such setting, and no way to want one: `conceptCount: 7` was a
   * literal at both call sites, and the backend's JSON schema pinned the array
   * at `minItems: 7, maxItems: 7` so asking for anything else was impossible
   * even if a caller had tried. Both ends are parameters now.
   */
  pathLength: number;
  autoAdvanceOnCorrect: boolean;
  showSrsInternals: boolean;
  challengeMode: boolean;
  heartsPerSession: number;
  timeZone: string;
  weekStartsOn: 0 | 1;
  sound: boolean;
  /** Demo time travel. Mirrored into domain/time.ts on hydrate. */
  clockOffsetMs: number;
}

/**
 * The study plan.
 *
 * Deliberately NOT a list of scheduled sessions. This app cannot wake itself up
 * when the tab is closed, so a stored queue of future appointments would be a
 * promise it has no way to keep. What it stores is the shape of the intention --
 * when, how long, which days -- which is exactly what a real calendar needs in
 * order to do the waking up itself.
 */
export interface Schedule {
  /** Local wall time, 'HH:MM'. Floating: 19:00 stays 19:00 across time zones. */
  timeOfDay: string;
  durationMin: number;
  /** JS getDay() indices, 0 = Sunday. At least one, enforced in the UI. */
  weekdays: number[];
  /** Alarm lead in minutes. 0 means no VALARM. */
  reminderMin: number;
  /** How many weeks an exported series runs for. */
  weeks: number;
  savedAt: number | null;
  /** When a calendar export last happened. Drives `on_the_books`, and is the
   *  only thing this app can honestly claim to know about the export -- a
   *  download and a deep link both end at the browser without reporting back. */
  exportedAt: number | null;
}

export interface Profile {
  displayName: string;
  avatarPreset: number;
  createdAt: number;
  totalXp: number;
  sessionCount: number;
  totalTimeMs: number;
  /** REAL wall clock, not the app clock -- this exists to notice the machine's
   *  clock moving backwards, and the demo time-travel tool moves the app clock
   *  on purpose. See domain/streak.ts::detectClockSkew. */
  lastSeenAt: number | null;
}

/* -------------------------------------------------------------- course --- */

export interface Course {
  id: string;
  topic: string;
  goal: string;
  level: Level;
  dailyTimeMin: number;
  createdAt: number;
  archivedAt: number | null;
  concepts: Concept[];
}

/* -------------------------------------------------------- day / streak --- */

export interface DayStat {
  xp: number;
  sessions: number;
  ms: number;
  goalMet: boolean;
  freezeUsed: boolean;
}

export interface StreakState {
  current: number;
  longest: number;
  /** Last day the XP goal was actually MET -- not the last day the app was
   *  opened. That distinction is the whole difference between an honest streak
   *  and a vanity one. */
  lastGoalDate: DayKey | null;
  freezes: number;
  repairOfferedFor: DayKey | null;
  clockSkewDetected: boolean;
}

/* ------------------------------------------------------------- session --- */

export interface XpLine {
  label: string;
  value: number;
}

export interface SessionRecord {
  id: string;
  courseId: string;
  conceptIds: string[];
  mode: SessionMode;
  startedAt: number;
  /** null means abandoned. Abandoning is free -- no XP, no mastery change, no
   *  scheduling change -- which is what lets the mastery stake be meaningful. */
  finishedAt: number | null;
  durationMs: number;
  score: number;
  correct: number;
  total: number;
  xpAwarded: number;
  /** Achievement bonuses unlocked by this session. Counted toward the level,
   *  NOT toward the daily goal -- see state/commit.ts for why. */
  achievementXp: number;
  hintsUsed: number;
  xpLines: XpLine[];
  masteryBefore: Record<string, number>;
  masteryAfter: Record<string, number>;
  assessment: AssessmentResult | null;
  answers: Record<string, string>;
}

/* --------------------------------------------------------------- toast --- */

export interface Toast {
  id: string;
  text: string;
  tone: 'neutral' | 'go' | 'stop' | 'spark';
  actionLabel?: string;
  actionKind?: 'downloadBackup';
}

export interface AchievementState {
  unlockedAt: number;
  seen: boolean;
}

/* ----------------------------------------------------------- app state --- */

export interface AppState {
  hydrated: boolean;
  onboarded: boolean;
  profile: Profile;
  settings: Settings;
  schedule: Schedule;
  courses: Course[];
  activeCourseId: string | null;
  /**
   * Lesson CACHE KEY -> the lesson generated for it. Bounded LRU.
   *
   * The key is NOT the concept id, and that distinction is the whole reason
   * this cache is safe to read. A lesson is identified by everything that
   * changes what it says: the concept, yes, but also whether it is a re-teach,
   * which misconceptions it was told to target, and how many questions were
   * asked for. Keyed on the concept alone, serving a review from cache would
   * hand back the very lesson the learner has already failed to understand --
   * the one a re-teach exists to differ from.
   *
   * See `lessonCacheKey` in state/selectors.ts for the identity itself.
   */
  lessonCache: Record<string, Lesson>;
  sessions: SessionRecord[];
  days: Record<string, DayStat>;
  streak: StreakState;
  achievements: Record<string, AchievementState>;
  toasts: Toast[];
  /** Transient. Never persisted. */
  pathStatus: 'idle' | 'loading' | 'error';
  pathError: string | null;
}

/* -------------------------------------------------------------- action --- */

export type AppAction =
  | { type: 'HYDRATE'; payload: Partial<AppState> }
  | { type: 'RESET_ALL'; payload: { at: number; timeZone: string } }
  | { type: 'RESET_PROGRESS'; payload: { at: number } }
  | { type: 'PATH_REQUEST' }
  | {
      type: 'PATH_SUCCESS';
      payload: { course: Course; at: number };
    }
  | { type: 'PATH_FAILURE'; payload: { message: string } }
  | { type: 'SELECT_COURSE'; payload: { courseId: string } }
  | { type: 'ARCHIVE_COURSE'; payload: { courseId: string; at: number | null } }
  | { type: 'CACHE_LESSON'; payload: { key: string; lesson: Lesson } }
  /**
   * Append newly generated concepts to an existing course.
   *
   * Finishing a course used to be a dead end with no way out: `selectNextLocked`
   * returns null once nothing is locked, the results screen falls through to
   * "Back to Today", and there was no endpoint that could have produced another
   * concept even if a button had existed to ask for one.
   *
   * Appended rather than replacing, so every mastery record, SRS schedule and
   * misconception already attached to the earlier concepts survives untouched.
   */
  | { type: 'EXTEND_PATH'; payload: { courseId: string; concepts: Concept[] } }
  /**
   * The one atomic commit.
   *
   * Mastery, status, scheduling, XP, streak, achievements and history all move
   * together. Splitting them is the classic bug in this shape of app: XP
   * awarded but mastery not, or a streak bumped for a session that never got
   * recorded.
   */
  | {
      type: 'COMMIT_SESSION';
      payload: {
        record: SessionRecord;
        /** Full replacement concept list for the session's course. */
        concepts: Concept[];
        /** Everything below is computed by state/commit.ts, so the reducer
         *  stays a dumb applier and the rules live in exactly one place. */
        day: DayStat;
        streak: StreakState;
        today: DayKey;
        /** The day a freeze covered, so the calendar can mark it. Dropping this
         *  is what made the heatmap unable to explain its own gaps. */
        freezeUsedOn: DayKey | null;
        unlockedAchievements: string[];
        at: number;
      };
    }
  /**
   * Re-derive every concept's status against the current clock.
   *
   * Status depends on decayed mastery and on today's date, so it goes stale
   * without anything happening -- on a day rollover, after a week away, or the
   * instant the demo clock jumps. Before this existed, a decayed concept kept
   * reading `completed` until you happened to finish another session on it,
   * which quietly hid the entire retention model.
   */
  | { type: 'RESTATUS'; payload: { today: DayKey; at: number } }
  | { type: 'SET_CLOCK_OFFSET'; payload: { offsetMs: number; today: DayKey; at: number } }
  | { type: 'SEEN_AT'; payload: { wallNow: number; skewed: boolean } }
  | {
      type: 'SNOOZE_CONCEPT';
      payload: { courseId: string; conceptId: string; days: number; today: DayKey; at: number };
    }
  | {
      type: 'MARK_KNOWN';
      payload: { courseId: string; conceptId: string; known: boolean; today: DayKey; at: number };
    }
  | { type: 'RESET_CONCEPT'; payload: { courseId: string; conceptId: string; today: DayKey; at: number } }
  | { type: 'REPAIR_STREAK'; payload: { today: DayKey } }
  | { type: 'BREAK_STREAK'; payload: { today: DayKey } }
  | { type: 'LOAD_DEMO'; payload: Partial<AppState> }
  | { type: 'SET_SETTING'; payload: Partial<Settings> }
  | { type: 'SET_PROFILE'; payload: Partial<Profile> }
  | { type: 'SET_SCHEDULE'; payload: Partial<Schedule> }
  /**
   * Unlock an achievement outside a session commit.
   *
   * `on_the_books` is earned by exporting a calendar, which happens on the
   * Schedule screen with no session in flight -- so it cannot go through
   * checkAchievements(), which is a pure function of a finished session. The
   * XP is paid the same way commit.ts pays it: to totalXp only, never to the
   * daily goal, so that earning a badge can never itself complete the goal
   * that awards the next badge.
   */
  | { type: 'UNLOCK_ACHIEVEMENT'; payload: { id: string; at: number } }
  | { type: 'ACK_ACHIEVEMENTS'; payload: { ids: string[] } }
  | { type: 'PUSH_TOAST'; payload: Toast }
  | { type: 'DISMISS_TOAST'; payload: { id: string } }
  | { type: 'CLEAR_ERROR' };
