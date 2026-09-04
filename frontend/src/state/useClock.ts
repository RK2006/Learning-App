import { useEffect, useRef } from 'react';
import type { Dispatch } from 'react';
import type { AppAction, AppState } from '../types/state';
import { restatusNow, seenNow } from './actions';

/** Often enough that a day rollover lands within a minute; rare enough to be
 *  invisible. */
const TICK_MS = 60_000;

/**
 * Keeps derived state honest as time passes.
 *
 * Mastery decay and review scheduling are pure functions of the clock, so a
 * concept's *status* goes stale with nothing happening -- the tab left open
 * across midnight, the laptop reopened a week later. Without this, a decayed
 * concept kept rendering as `completed` until you happened to finish another
 * session on it, which meant the retention model existed but was invisible:
 * the Path stayed green, the Review queue undercounted, and the forecast
 * described a future the rest of the UI disagreed with.
 *
 * RESTATUS costs nothing when nothing moved -- the reducer returns the same
 * state reference and React bails out of the render -- so this can tick
 * without causing a re-render or a storage write.
 */
export function useClock(state: AppState, dispatch: Dispatch<AppAction>): void {
  const hydrated = state.hydrated;

  /**
   * The effect must not re-subscribe on every state change or the interval
   * would reset before it ever fires. But the creators read the CURRENT state
   * -- `lastSeenAt` for skew detection, the timezone for the day key -- so a
   * captured `state` would have them comparing against mount-time values
   * forever. A ref is the honest way to have both.
   */
  const latest = useRef(state);
  latest.current = state;

  useEffect(() => {
    if (!hydrated) return;

    const sync = () => {
      dispatch(restatusNow(latest.current));
      dispatch(seenNow(latest.current));
    };

    sync(); // on mount: the app may have been closed for a week

    const id = window.setInterval(sync, TICK_MS);

    // Returning to a backgrounded tab is the common case for a long gap, and
    // timers in a hidden tab are throttled to the point of being unreliable.
    const onVisible = () => {
      if (document.visibilityState === 'visible') sync();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [hydrated, dispatch]);
}
