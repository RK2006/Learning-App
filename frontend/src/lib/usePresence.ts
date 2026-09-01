import { useEffect, useRef, useState } from 'react';
import { dur } from './motion';

export type PresenceState = 'entering' | 'entered' | 'exiting';

export interface PresenceOptions {
  /** Fired once the exit has finished and the node is about to unmount. */
  onExited?: () => void;
  /** Duration token to use as the exit deadline. */
  exitToken?: string;
}

/**
 * Deferred unmount, so exits can actually play.
 *
 * React unmounts synchronously. `{open && <Dialog/>}` removes the node from the
 * DOM in the same commit that flips the flag, so there is no element left to
 * animate -- which is why hand-rolled UIs so often animate in and then vanish.
 * This hook keeps the node mounted through its exit and reports which phase it
 * is in, for CSS to key off `[data-presence]`.
 *
 * Two details that are easy to get wrong, and both of which bite intermittently
 * rather than always -- the worst failure mode to debug:
 *
 * 1. ENTER NEEDS A DOUBLE requestAnimationFrame. A single rAF fires before the
 *    browser has necessarily committed the freshly-inserted element's styles,
 *    so the transition has no `from` value to leave and the element simply
 *    appears at its end state. The second frame guarantees a style recalc has
 *    happened in between.
 *
 * 2. EXIT WAITS ON BOTH AN EVENT AND A TIMER, whichever lands first. Listening
 *    only for `animationend` deadlocks whenever the animation never runs --
 *    `display: none`, a collapsed ancestor, reduced motion zeroing the
 *    duration, a browser that skips animations in a background tab -- and the
 *    node is then stuck on screen forever. Using only a timer drifts out of
 *    sync with the CSS the moment someone edits a duration token.
 */
export function usePresence<T extends HTMLElement>(show: boolean, opts: PresenceOptions = {}) {
  const { onExited, exitToken = '--d-3' } = opts;
  const [mounted, setMounted] = useState(show);
  const [state, setState] = useState<PresenceState>(show ? 'entering' : 'exiting');
  const ref = useRef<T>(null);

  // Read through a ref so a caller passing an inline arrow does not restart the
  // exit on every render.
  const exitedRef = useRef(onExited);
  exitedRef.current = onExited;

  useEffect(() => {
    if (show) {
      setMounted(true);
      setState('entering');
      let second = 0;
      const first = requestAnimationFrame(() => {
        second = requestAnimationFrame(() => setState('entered'));
      });
      return () => {
        cancelAnimationFrame(first);
        if (second) cancelAnimationFrame(second);
      };
    }

    setState('exiting');
    const node = ref.current;
    let done = false;

    const finish = () => {
      if (done) return;
      done = true;
      setMounted(false);
      exitedRef.current?.();
    };

    // +60ms so a transition that starts a frame late is not cut off by its own
    // deadline. The timer is the backstop, not the intended path.
    const timer = window.setTimeout(finish, dur(exitToken) + 60);

    // Only this element's own animation counts. A child finishing a shorter
    // animation bubbles up here and would otherwise end the exit early.
    const onEnd = (e: Event) => {
      if (e.target === node) finish();
    };
    node?.addEventListener('animationend', onEnd);
    node?.addEventListener('transitionend', onEnd);

    return () => {
      window.clearTimeout(timer);
      node?.removeEventListener('animationend', onEnd);
      node?.removeEventListener('transitionend', onEnd);
    };
  }, [show, exitToken]);

  return { mounted, state, ref };
}
