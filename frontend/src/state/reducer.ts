import type { AppAction, AppState, Course, DayStat } from '../types/state';
import type { Concept, DayKey } from '../types/domain';
import { restatus } from '../domain/mastery';
import { snooze as snoozeReview } from '../domain/srs';
import { applyRepair } from '../domain/streak';
import { ACHIEVEMENTS_BY_ID } from '../domain/achievements';
import { LIMITS, defaultProfile, defaultStreak, initialState } from './initial';

/**
 * PURE. No Date.now(), no Math.random(), no crypto.randomUUID(), no storage
 * access. Every impure value arrives on an action payload built in actions.ts.
 *
 * That is what makes StrictMode's double-invocation harmless and lets the
 * engines be called from here without dragging a clock along.
 */

function assertNever(x: never): never {
  throw new Error(`Unhandled action: ${JSON.stringify(x)}`);
}

/** Keep the newest N entries of a day map. Bounds the store by construction. */
function trimDays(days: Record<string, DayStat>): Record<string, DayStat> {
  const keys = Object.keys(days);
  if (keys.length <= LIMITS.days) return days;
  const keep = keys.sort().slice(-LIMITS.days);
  const out: Record<string, DayStat> = {};
  for (const k of keep) out[k] = days[k]!;
  return out;
}

/**
 * Re-derive statuses across every course, preserving identity when nothing
 * moved.
 *
 * Returning `state` itself on a no-op matters more than it looks: RESTATUS runs
 * on a timer, and a fresh state object every tick would re-render the tree and
 * schedule a localStorage write once a minute, forever. React bails out of the
 * update entirely when the reducer returns the same reference.
 */
function restatusCourses(state: AppState, today: DayKey, at: number): AppState {
  let changed = false;
  const courses = state.courses.map((c) => {
    const concepts = restatus(c.concepts, today, at);
    if (concepts === c.concepts) return c;
    changed = true;
    return { ...c, concepts };
  });
  return changed ? { ...state, courses } : state;
}

/** Apply a change to one concept, then re-derive statuses -- editing a
 *  concept's review state can unlock or re-flag the ones after it. */
function mapConcept(
  state: AppState,
  courseId: string,
  conceptId: string,
  today: DayKey,
  at: number,
  fn: (c: Concept) => Concept,
): AppState {
  const courses: Course[] = state.courses.map((c) =>
    c.id === courseId
      ? { ...c, concepts: c.concepts.map((concept) => (concept.id === conceptId ? fn(concept) : concept)) }
      : c,
  );
  return restatusCourses({ ...state, courses }, today, at);
}

/** Simple LRU by insertion order -- object key order is insertion order for
 *  string keys, which is all we need here. */
function trimLessonCache(cache: AppState['lessonCache']): AppState['lessonCache'] {
  const keys = Object.keys(cache);
  if (keys.length <= LIMITS.lessonCache) return cache;
  const keep = keys.slice(-LIMITS.lessonCache);
  const out: AppState['lessonCache'] = {};
  for (const k of keep) out[k] = cache[k]!;
  return out;
}

export function reducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'HYDRATE':
      return { ...state, ...action.payload, hydrated: true };

    case 'RESET_ALL': {
      const fresh = initialState();
      return {
        ...fresh,
        hydrated: true,
        profile: defaultProfile(action.payload.at),
        settings: { ...fresh.settings, timeZone: action.payload.timeZone },
      };
    }

    case 'RESET_PROGRESS':
      // Courses and settings survive; everything earned does not.
      return {
        ...state,
        sessions: [],
        days: {},
        streak: defaultStreak(),
        achievements: {},
        lessonCache: {},
        profile: { ...state.profile, totalXp: 0, sessionCount: 0, totalTimeMs: 0 },
        courses: state.courses.map((c) => ({
          ...c,
          concepts: c.concepts.map((concept, i) => ({
            ...concept,
            mastery: 0,
            peakMastery: 0,
            attempts: 0,
            lastStudiedAt: null,
            bestScore: 0,
            scoreHistory: [],
            misconceptions: [],
            markedKnown: false,
            masteryHistory: [],
            status: i === 0 ? ('current' as const) : ('locked' as const),
            review: { dueOn: null, intervalDays: 0, ease: 2.5, reps: 0, lapses: 0, snoozes: 0 },
          })),
        })),
      };

    case 'PATH_REQUEST':
      return { ...state, pathStatus: 'loading', pathError: null };

    case 'PATH_SUCCESS': {
      const course = action.payload.course;
      const courses = state.courses.some((c) => c.id === course.id)
        ? state.courses.map((c) => (c.id === course.id ? course : c))
        : [...state.courses, course];
      return {
        ...state,
        courses,
        activeCourseId: course.id,
        onboarded: true,
        pathStatus: 'idle',
        pathError: null,
      };
    }

    case 'PATH_FAILURE':
      return { ...state, pathStatus: 'error', pathError: action.payload.message };

    case 'SELECT_COURSE':
      return { ...state, activeCourseId: action.payload.courseId };

    case 'ARCHIVE_COURSE':
      return {
        ...state,
        courses: state.courses.map((c) =>
          c.id === action.payload.courseId ? { ...c, archivedAt: action.payload.at } : c,
        ),
      };

    case 'CACHE_LESSON':
      return {
        ...state,
        lessonCache: trimLessonCache({
          ...state.lessonCache,
          [action.payload.key]: action.payload.lesson,
        }),
      };

    case 'EXTEND_PATH': {
      const { courseId, concepts } = action.payload;
      if (concepts.length === 0) return state;
      return {
        ...state,
        courses: state.courses.map((c) => {
          if (c.id !== courseId) return c;
          const have = new Set(c.concepts.map((k) => k.id));
          const haveNames = new Set(c.concepts.map((k) => k.name.trim().toLowerCase()));
          const base = c.concepts.length;
          const fresh = concepts
            // The server already excludes the existing path from the prompt and
            // de-duplicates its own output, but ids are generated per response
            // and would collide with the ones already here. A collision means
            // `concepts.find(k => k.id === id)` returns the wrong concept and
            // the session screen teaches something other than what was tapped.
            .filter((k) => !haveNames.has(k.name.trim().toLowerCase()))
            .map((k, i) => ({
              ...k,
              id: have.has(k.id) ? `${k.id}-x${base + i + 1}` : k.id,
              order: base + i + 1,
              // Appended concepts are unstudied and locked, whatever index they
              // arrived at. toConcept marks index 0 `current`, which would
              // unlock a brand-new concept ahead of the ones before it.
              status: 'locked' as const,
            }));
          return { ...c, concepts: [...c.concepts, ...fresh] };
        }),
      };
    }

    case 'COMMIT_SESSION': {
      const { record, concepts, day, streak, today, freezeUsedOn, unlockedAchievements, at } =
        action.payload;

      const achievements = { ...state.achievements };
      for (const id of unlockedAchievements) {
        if (!achievements[id]) achievements[id] = { unlockedAt: at, seen: false };
      }

      const days = { ...state.days, [today]: day };
      // Mark the day a freeze covered, so the heatmap can explain its own gap
      // instead of showing an unexplained hole in a live streak.
      if (freezeUsedOn) {
        const covered = days[freezeUsedOn] ?? { xp: 0, sessions: 0, ms: 0, goalMet: false, freezeUsed: false };
        days[freezeUsedOn] = { ...covered, freezeUsed: true };
      }

      return {
        ...state,
        courses: state.courses.map((c) => (c.id === record.courseId ? { ...c, concepts } : c)),
        sessions: [...state.sessions, record].slice(-LIMITS.sessions),
        days: trimDays(days),
        streak,
        achievements,
        profile: {
          ...state.profile,
          totalXp: state.profile.totalXp + record.xpAwarded + record.achievementXp,
          sessionCount: state.profile.sessionCount + 1,
          totalTimeMs: state.profile.totalTimeMs + record.durationMs,
        },
      };
    }

    case 'RESTATUS':
      return restatusCourses(state, action.payload.today, action.payload.at);

    case 'SET_CLOCK_OFFSET': {
      // The module-level clock in domain/time.ts is moved by the action creator
      // BEFORE this runs, so `at`/`today` here already carry the new offset and
      // the restatus below is computed against the destination, not the origin.
      const next = { ...state, settings: { ...state.settings, clockOffsetMs: action.payload.offsetMs } };
      return restatusCourses(next, action.payload.today, action.payload.at);
    }

    case 'SEEN_AT': {
      const { wallNow, skewed } = action.payload;
      if (state.profile.lastSeenAt === wallNow && state.streak.clockSkewDetected === skewed) return state;
      return {
        ...state,
        profile: { ...state.profile, lastSeenAt: wallNow },
        // Sticky once detected: the streak stays paused until something
        // explicitly clears it, rather than un-flagging on the next tick.
        streak: skewed ? { ...state.streak, clockSkewDetected: true } : state.streak,
      };
    }

    case 'SNOOZE_CONCEPT': {
      const { courseId, conceptId, days, today, at } = action.payload;
      return mapConcept(state, courseId, conceptId, today, at, (c) => ({
        ...c,
        review: snoozeReview(c.review, days, today),
      }));
    }

    case 'MARK_KNOWN': {
      const { courseId, conceptId, known, today, at } = action.payload;
      return mapConcept(state, courseId, conceptId, today, at, (c) => ({ ...c, markedKnown: known }));
    }

    case 'RESET_CONCEPT': {
      const { courseId, conceptId, today, at } = action.payload;
      return mapConcept(state, courseId, conceptId, today, at, (c) => ({
        ...c,
        mastery: 0,
        peakMastery: 0,
        attempts: 0,
        lastStudiedAt: null,
        bestScore: 0,
        scoreHistory: [],
        misconceptions: [],
        markedKnown: false,
        masteryHistory: [],
        review: { dueOn: null, intervalDays: 0, ease: 2.5, reps: 0, lapses: 0, snoozes: 0 },
      }));
    }

    case 'REPAIR_STREAK':
      return { ...state, streak: applyRepair(state.streak, action.payload.today) };

    case 'BREAK_STREAK':
      // Demo tool. Leaves `longest` alone -- a broken streak does not erase the
      // record of the one you had.
      return {
        ...state,
        streak: { ...state.streak, current: 0, lastGoalDate: null, freezes: 0 },
      };

    case 'LOAD_DEMO':
      return { ...state, ...action.payload, hydrated: true };

    case 'SET_SETTING':
      return { ...state, settings: { ...state.settings, ...action.payload } };

    case 'SET_PROFILE':
      return { ...state, profile: { ...state.profile, ...action.payload } };

    case 'SET_SCHEDULE':
      return { ...state, schedule: { ...state.schedule, ...action.payload } };

    /**
     * The out-of-session unlock path.
     *
     * Idempotent by design: exporting a calendar three times unlocks
     * `on_the_books` once and pays its XP once. Without the guard, the badge
     * would be an XP faucet with a button on it.
     *
     * XP goes to totalXp only, never to the day's goal -- the same rule
     * commit.ts follows, and for the same reason. Letting achievement XP count
     * toward the daily goal creates a loop where hitting the goal awards a
     * badge whose XP hits the goal.
     */
    case 'UNLOCK_ACHIEVEMENT': {
      const { id, at } = action.payload;
      if (state.achievements[id]) return state;
      const def = ACHIEVEMENTS_BY_ID[id];
      if (!def) return state;
      return {
        ...state,
        achievements: { ...state.achievements, [id]: { unlockedAt: at, seen: false } },
        profile: { ...state.profile, totalXp: state.profile.totalXp + def.xp },
      };
    }

    case 'ACK_ACHIEVEMENTS': {
      const achievements = { ...state.achievements };
      for (const id of action.payload.ids) {
        const a = achievements[id];
        if (a) achievements[id] = { ...a, seen: true };
      }
      return { ...state, achievements };
    }

    case 'PUSH_TOAST':
      return { ...state, toasts: [...state.toasts, action.payload].slice(-LIMITS.toasts) };

    case 'DISMISS_TOAST':
      return { ...state, toasts: state.toasts.filter((t) => t.id !== action.payload.id) };

    case 'CLEAR_ERROR':
      return { ...state, pathStatus: 'idle', pathError: null };

    default:
      return assertNever(action);
  }
}
