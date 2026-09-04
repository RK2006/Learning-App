import { createContext, useContext, useEffect, useMemo, useReducer, useRef } from 'react';
import type { Dispatch, ReactNode } from 'react';
import type { AppAction, AppState } from '../types/state';
import { reducer } from './reducer';
import { initialState } from './initial';
import { createPersister, loadPersisted } from '../lib/storage/persist';
import type { Persister } from '../lib/storage/persist';
import { storage } from '../lib/storage/storage';
import { setClockOffset } from '../domain/time';
import { setSoundEnabled } from '../lib/sound';
import { useClock } from './useClock';

/**
 * Two contexts, deliberately.
 *
 * `dispatch` identity is stable forever, so any component that only writes --
 * which is every button in the app -- never re-renders when state changes.
 * Bundling them into one value would make every keystroke in a lesson textarea
 * re-render the rail, the streak flame and the XP counter.
 */
const StateContext = createContext<AppState | null>(null);
const DispatchContext = createContext<Dispatch<AppAction> | null>(null);

/**
 * Hydrate synchronously, before first render, via the lazy initializer.
 *
 * Not in a useEffect: that gives a visible flash of empty state and races the
 * first render's reads.
 *
 * StrictMode calls this TWICE and keeps the second result, so it has to be
 * idempotent -- and loadPersisted() is not, because quarantining deletes the
 * bad key. The first call quarantined, the second found an empty store, and the
 * quarantine toast was discarded on every single corrupt load. loadPersisted()
 * is memoized per page load for exactly this reason; see lib/storage/persist.ts.
 */
function init(): AppState {
  const base = initialState();

  // Escape hatch for a wedged demo: ?reset=1 clears before anything loads.
  if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('reset')) {
    storage.removeByPrefix('learnable.');
    return { ...base, hydrated: true };
  }

  const outcome = loadPersisted();
  if (outcome.kind === 'ok') {
    const next = { ...base, ...outcome.data, hydrated: true };
    setClockOffset(next.settings.clockOffsetMs || 0);
    setSoundEnabled(next.settings.sound === true);
    return next;
  }
  if (outcome.kind === 'quarantined') {
    return {
      ...base,
      hydrated: true,
      toasts: [
        {
          id: 'quarantine',
          text:
            outcome.reason === 'newer-schema'
              ? 'Your saved progress came from a newer version of the app, so we started fresh. A backup was kept.'
              : "We couldn't read your saved progress, so we started fresh. A backup was kept.",
          tone: 'stop',
          actionLabel: 'Download backup',
          actionKind: 'downloadBackup',
        },
      ],
    };
  }
  return { ...base, hydrated: true };
}

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, init);
  const persister = useRef<Persister | null>(null);

  if (persister.current === null) {
    persister.current = createPersister(() => {
      dispatch({
        type: 'PUSH_TOAST',
        payload: { id: 'quota', text: 'Storage is full, so progress may not be saved.', tone: 'stop' },
      });
    });
  }

  useEffect(() => {
    const p = persister.current;
    return () => {
      p?.flush();
      p?.dispose();
    };
  }, []);

  useEffect(() => {
    if (state.hydrated) persister.current?.schedule(state);
  }, [state]);

  /**
   * Milestones bypass the debounce entirely.
   *
   * Observed in testing, twice: navigating within the 400ms window lost a
   * completed session, and then -- the same bug wearing a different hat -- lost
   * a just-generated course when onboarding handed off to the path screen. The
   * pagehide flush does not reliably win that race.
   *
   * The rule is worth stating rather than patching case by case: anything the
   * user would have to REDO if it vanished is flushed immediately. A settings
   * toggle or an answer draft can wait; work they just did cannot.
   */
  const milestone = `${state.sessions.length}:${state.courses.length}:${state.onboarded}`;
  const lastMilestone = useRef(milestone);
  useEffect(() => {
    if (milestone !== lastMilestone.current) {
      lastMilestone.current = milestone;
      persister.current?.flush();
    }
  }, [milestone]);

  // Decay, scheduling and the streak are all functions of the clock, so status
  // has to be re-derived as it moves -- not only when a session commits.
  useClock(state, dispatch);

  // Tell the user once, rather than silently losing their work.
  useEffect(() => {
    if (!storage.available) {
      dispatch({
        type: 'PUSH_TOAST',
        payload: { id: 'no-storage', text: "Progress won't be saved in this browser.", tone: 'stop' },
      });
    }
  }, []);

  return (
    <StateContext.Provider value={state}>
      <DispatchContext.Provider value={dispatch}>{children}</DispatchContext.Provider>
    </StateContext.Provider>
  );
}

export function useAppState(): AppState {
  const v = useContext(StateContext);
  if (!v) throw new Error('useAppState must be used inside <AppStateProvider>');
  return v;
}

export function useDispatch(): Dispatch<AppAction> {
  const v = useContext(DispatchContext);
  if (!v) throw new Error('useDispatch must be used inside <AppStateProvider>');
  return v;
}

/** The active course, or null. Memoized so consumers get a stable reference. */
export function useActiveCourse() {
  const { courses, activeCourseId } = useAppState();
  return useMemo(
    () => courses.find((c) => c.id === activeCourseId) ?? courses[0] ?? null,
    [courses, activeCourseId],
  );
}
