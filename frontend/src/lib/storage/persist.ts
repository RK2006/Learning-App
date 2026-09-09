import { storage } from './storage';
import { wallClock } from '../../domain/time';
import type { AppState } from '../../types/state';
import {
  LIMITS,
  SCHEMA_VERSION,
  defaultProfile,
  defaultSchedule,
  defaultSettings,
  defaultStreak,
} from '../../state/initial';

const PREFIX = 'learnable.';
const KEY_STATE = `${PREFIX}state`;
const KEY_VERSION = `${PREFIX}v`;
const KEY_BACKUP_PREFIX = `${PREFIX}backup.`;

/** Only these slices persist. Loading flags, errors and the toast queue are
 *  transient by definition -- persisting them means a refresh restores a
 *  spinner that will never resolve. */
type Persisted = Pick<
  AppState,
  | 'onboarded'
  | 'profile'
  | 'settings'
  | 'schedule'
  | 'courses'
  | 'activeCourseId'
  | 'lessonCache'
  | 'sessions'
  | 'days'
  | 'streak'
  | 'achievements'
>;

interface Envelope {
  version: number;
  savedAt: number;
  data: Persisted;
}

export type LoadOutcome =
  | { kind: 'empty' }
  | { kind: 'ok'; data: Persisted }
  | { kind: 'quarantined'; reason: string };

export function snapshot(s: AppState): Persisted {
  return {
    onboarded: s.onboarded,
    profile: s.profile,
    settings: s.settings,
    schedule: s.schedule,
    courses: s.courses,
    activeCourseId: s.activeCourseId,
    lessonCache: s.lessonCache,
    sessions: s.sessions,
    days: s.days,
    streak: s.streak,
    achievements: s.achievements,
  };
}

/* ---------------------------------------------------------- migrations --- */

type Migration = (d: Record<string, unknown>) => Record<string, unknown>;

/**
 * Version chain. Starts at 3 so the machinery is exercised from day one rather
 * than sitting dead until the first real migration.
 *
 * RULE: additive changes need no migration -- the validator fills defaults. A
 * rename or a type change needs an entry here AND a SCHEMA_VERSION bump.
 */
const migrations: Record<number, Migration> = {
  1: (d) => ({ ...d, streak: d.streak ?? defaultStreak() }),
  2: (d) => ({ ...d, lessonCache: d.lessonCache ?? {} }),
  /**
   * `lessonCache` changed KEY, not shape: it was keyed by concept id and is now
   * keyed by the full generation identity (concept + level + minutes + isReview
   * + question count + misconceptions), because a cache keyed on the concept
   * alone would serve a re-teach the very lesson it exists to replace.
   *
   * Old entries are unreachable under the new key rather than wrong, so nothing
   * breaks without this. It is here because the cache holds only 20 entries and
   * leaving it full of records that can never be hit means the first twenty
   * lessons after an upgrade evict each other for no benefit.
   */
  3: (d) => ({ ...d, lessonCache: {} }),
};

/* ----------------------------------------------------------- validate --- */

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Coerce, never throw.
 *
 * Anything unrecognised is replaced with a default rather than rejected. Only
 * unparseable JSON or a thrown migration triggers quarantine -- a single bad
 * field must not cost the user their history.
 */
function validate(raw: unknown): Persisted {
  const d = isObj(raw) ? raw : {};
  const settings = { ...defaultSettings(), ...(isObj(d.settings) ? d.settings : {}) };
  const profile = { ...defaultProfile(), ...(isObj(d.profile) ? d.profile : {}) };
  const streak = { ...defaultStreak(), ...(isObj(d.streak) ? d.streak : {}) };
  // Additive field, so no migration entry -- the documented rule is that the
  // validator fills the default. A saved state from before the Schedule screen
  // existed simply gets the suggested plan, marked unsaved.
  const schedule = { ...defaultSchedule(), ...(isObj(d.schedule) ? d.schedule : {}) };
  // One guard beyond the spread: an empty weekday set would make
  // firstOccurrence() fall back to "today, whatever day that is", so a plan
  // exported from corrupted state would quietly become a one-off.
  if (!Array.isArray(schedule.weekdays) || schedule.weekdays.length === 0) {
    schedule.weekdays = defaultSchedule().weekdays;
  }

  const courses = Array.isArray(d.courses) ? (d.courses as Persisted['courses']) : [];
  const sessions = Array.isArray(d.sessions)
    ? (d.sessions as Persisted['sessions']).slice(-LIMITS.sessions)
    : [];

  return {
    onboarded: Boolean(d.onboarded),
    profile,
    settings,
    schedule,
    courses,
    activeCourseId: typeof d.activeCourseId === 'string' ? d.activeCourseId : null,
    lessonCache: isObj(d.lessonCache) ? (d.lessonCache as Persisted['lessonCache']) : {},
    sessions,
    days: isObj(d.days) ? (d.days as Persisted['days']) : {},
    streak,
    achievements: isObj(d.achievements) ? (d.achievements as Persisted['achievements']) : {},
  };
}

/* ------------------------------------------------------------- export --- */

export interface ExportEnvelope extends Envelope {
  exportedAt: number;
  app: string;
}

/** The same envelope that goes to localStorage, plus provenance. */
export function exportState(s: AppState): string {
  const env: ExportEnvelope = {
    app: 'learnable',
    version: SCHEMA_VERSION,
    savedAt: wallClock(),
    exportedAt: wallClock(),
    data: snapshot(s),
  };
  return JSON.stringify(env, null, 2);
}

export type ImportOutcome =
  | { kind: 'ok'; data: Persisted; version: number }
  | { kind: 'error'; reason: string };

/**
 * Import runs through the SAME migration and validation path as a normal load.
 *
 * A file the user picked is exactly as untrustworthy as a localStorage value
 * someone hand-edited -- more so, since it may have been exported by an older
 * build, or be an entirely unrelated JSON file. Reusing migrate+validate means
 * an old export is upgraded rather than rejected, and a malformed one is
 * coerced field by field rather than white-screening the app.
 *
 * The one thing this refuses outright is a FUTURE version: a file written by a
 * newer build may contain fields whose meaning this code does not know, and
 * silently dropping them would turn "import my backup" into "quietly lose
 * half my history".
 */
export function parseImport(text: string): ImportOutcome {
  let env: unknown;
  try {
    env = JSON.parse(text);
  } catch {
    return { kind: 'error', reason: 'That file is not JSON.' };
  }
  if (!isObj(env)) return { kind: 'error', reason: 'That file is not a Learnable export.' };

  const data = isObj(env.data) ? env.data : env;
  let version = Number(env.version) || 1;
  if (version > SCHEMA_VERSION) {
    return {
      kind: 'error',
      reason: `That file was written by a newer version (v${version}, this build reads v${SCHEMA_VERSION}).`,
    };
  }

  let migrated: Record<string, unknown> = data;
  try {
    while (version < SCHEMA_VERSION) {
      const step = migrations[version];
      migrated = step ? step(migrated) : migrated;
      version += 1;
    }
  } catch {
    return { kind: 'error', reason: 'That file could not be upgraded to the current format.' };
  }

  // A file with no courses AND no sessions is almost certainly not ours, and
  // importing it would silently wipe what the user has.
  const validated = validate(migrated);
  if (validated.courses.length === 0 && validated.sessions.length === 0) {
    return { kind: 'error', reason: 'That file has no courses or sessions in it.' };
  }
  return { kind: 'ok', data: validated, version: SCHEMA_VERSION };
}

/* --------------------------------------------------------------- load --- */

function quarantine(reason: string, rawText: string | null): LoadOutcome {
  if (rawText) storage.set(`${KEY_BACKUP_PREFIX}${wallClock()}`, rawText);
  storage.remove(KEY_STATE);
  storage.remove(KEY_VERSION);
  return { kind: 'quarantined', reason };
}

/**
 * Memoized for the lifetime of the page, because this function is NOT PURE.
 *
 * Quarantining writes a backup and deletes the bad key. StrictMode invokes the
 * useReducer lazy initializer twice and keeps the SECOND result, so the first
 * call quarantined and cleaned up, the second found nothing and returned
 * `empty` -- and the quarantine outcome, along with the "we couldn't read your
 * saved progress" message and its Download backup action, was thrown away every
 * single time. The failure path had never once been reachable in development.
 *
 * A cache is the right fix rather than moving the cleanup: reading saved state
 * is a once-per-page-load operation by nature, and making it idempotent is what
 * the lazy initializer's contract actually requires.
 */
let cached: LoadOutcome | null = null;

export function loadPersisted(): LoadOutcome {
  if (cached) return cached;
  cached = loadPersistedOnce();
  return cached;
}

/** Test/`?reset=1` seam: forget the memo so a fresh read happens. */
export function resetLoadCache(): void {
  cached = null;
}

function loadPersistedOnce(): LoadOutcome {
  const rawText = storage.get(KEY_STATE);
  if (!rawText) return { kind: 'empty' };

  let env: unknown;
  try {
    env = JSON.parse(rawText);
  } catch {
    return quarantine('unreadable', rawText);
  }
  if (!isObj(env)) return quarantine('unreadable', rawText);

  let version = Number(env.version) || 1;
  // A version from the FUTURE means a teammate ran a newer branch in this
  // browser. Guessing at a downgrade is worse than starting clean.
  if (version > SCHEMA_VERSION) return quarantine('newer-schema', rawText);

  let data = isObj(env.data) ? (env.data as Record<string, unknown>) : {};
  try {
    while (version < SCHEMA_VERSION) {
      const step = migrations[version];
      if (step) data = step(data);
      version += 1;
    }
  } catch {
    return quarantine('migration-failed', rawText);
  }

  return { kind: 'ok', data: validate(data) };
}

export function hasBackup(): boolean {
  return storage.keys(KEY_BACKUP_PREFIX).length > 0;
}

export function readLatestBackup(): string | null {
  const keys = storage.keys(KEY_BACKUP_PREFIX).sort();
  const last = keys[keys.length - 1];
  return last ? storage.get(last) : null;
}

/* --------------------------------------------------------------- save --- */

export function clearAll(opts: { keepBackups?: boolean } = {}): void {
  storage.removeByPrefix(PREFIX, (k) => Boolean(opts.keepBackups) && k.startsWith(KEY_BACKUP_PREFIX));
}

export interface Persister {
  schedule(state: AppState): void;
  flush(): void;
  dispose(): void;
}

/**
 * Debounced writer: 400ms trailing with a 3s max-wait, plus a hard flush on
 * pagehide and on visibility change.
 *
 * Explicitly NOT beforeunload -- it is unreliable on mobile Safari and it
 * blocks the back/forward cache.
 */
export function createPersister(onQuotaError: () => void): Persister {
  let timer = 0;
  let firstPendingAt = 0;
  let pending: AppState | null = null;
  let lastWritten = '';
  let disabled = false;

  const writeNow = () => {
    if (!pending || disabled) return;
    const env: Envelope = { version: SCHEMA_VERSION, savedAt: wallClock(), data: snapshot(pending) };
    const text = JSON.stringify(env);
    pending = null;
    firstPendingAt = 0;
    // With a reducer, a surprising number of dispatches produce an identical
    // snapshot. Skipping those avoids pointless multi-hundred-KB writes.
    if (text === lastWritten) return;

    if (storage.set(KEY_STATE, text)) {
      storage.set(KEY_VERSION, String(SCHEMA_VERSION));
      lastWritten = text;
      return;
    }

    // Quota: drop the largest optional slice and retry once.
    try {
      const trimmed: Envelope = {
        ...env,
        data: { ...env.data, lessonCache: {}, sessions: env.data.sessions.slice(-50) },
      };
      const trimmedText = JSON.stringify(trimmed);
      if (storage.set(KEY_STATE, trimmedText)) {
        lastWritten = trimmedText;
        return;
      }
    } catch {
      /* fall through */
    }
    disabled = true;
    onQuotaError();
  };

  const clear = () => {
    if (timer) window.clearTimeout(timer);
    timer = 0;
  };

  const onHide = () => {
    if (document.visibilityState === 'hidden') writeNow();
  };
  const onPageHide = () => writeNow();

  window.addEventListener('visibilitychange', onHide);
  window.addEventListener('pagehide', onPageHide);

  return {
    schedule(state) {
      pending = state;
      const t = wallClock();
      if (!firstPendingAt) firstPendingAt = t;
      clear();
      // Max-wait: continuous typing must still checkpoint.
      if (t - firstPendingAt >= 3000) {
        writeNow();
        return;
      }
      timer = window.setTimeout(writeNow, 400);
    },
    flush() {
      clear();
      writeNow();
    },
    dispose() {
      clear();
      window.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onPageHide);
    },
  };
}
