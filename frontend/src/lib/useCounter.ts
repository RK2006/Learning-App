import { useLayoutEffect, useRef } from 'react';
import { dur, ease, shouldAnimate } from './motion';

export interface CounterOptions {
  /** Start value for the FIRST run. Omit to have the number simply appear. */
  from?: number;
  format?: (n: number) => string;
  durationToken?: string;
  easeToken?: string;
}

const round = (n: number) => Math.round(n).toLocaleString();

/**
 * A number that counts, without re-rendering React.
 *
 * The obvious implementation -- setState in a rAF loop -- re-renders the
 * component 60 times a second. On the results screen that component is the
 * whole panel, so counting the XP up would re-render the score ring, the
 * mastery bar, the misconception chips and every Press underneath them, sixty
 * times, while confetti is running. That is the single largest jank source in a
 * screen like this one.
 *
 * So the value is written straight to `el.textContent` from inside the loop.
 * React renders the final value as children (which is what a screen reader and
 * a copy-paste get, and what shows if this hook never runs); the hook overwrites
 * it in a layout effect, before paint, so there is no flash of the end value
 * first.
 *
 * Timing comes from the rAF callback's own timestamp rather than a clock call,
 * which keeps this file honest about the app's one-clock rule and is more
 * accurate anyway -- it is the timestamp the frame will actually be composited
 * with.
 */
export function useCounter<T extends HTMLElement>(value: number, opts: CounterOptions = {}) {
  const { from, format = round, durationToken = '--d-6', easeToken = '--e-settle' } = opts;
  const ref = useRef<T>(null);
  /** What the DOM currently shows, so a change mid-count resumes from there. */
  const shown = useRef<number | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    const start = shown.current ?? from ?? value;
    const land = () => {
      shown.current = value;
      el.textContent = format(value);
    };

    if (!shouldAnimate() || start === value) {
      land();
      return;
    }

    const ms = dur(durationToken);
    const curve = ease(easeToken);
    let t0 = 0;
    let raf = 0;

    const step = (t: number) => {
      if (!t0) t0 = t;
      const p = Math.min(1, (t - t0) / ms);
      if (p >= 1) {
        land();
        return;
      }
      const n = start + (value - start) * curve(p);
      shown.current = n;
      el.textContent = format(n);
      raf = requestAnimationFrame(step);
    };

    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // `format` is intentionally not a dependency: callers pass inline arrows,
    // and restarting the count because a closure identity changed would make
    // the number visibly stutter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, from, durationToken, easeToken]);

  return ref;
}
