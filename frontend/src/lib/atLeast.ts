import { wallClock } from '../domain/time';

/**
 * Hold an async step open for a minimum duration.
 *
 * The EVALUATING stage plays three check-off lines while it works. When the
 * work finishes instantly -- which it does against the mock, and will against a
 * warm backend -- the stage would flash past and read as a glitch. This is NOT
 * a fake delay dressed up as progress: the floor exists so the real
 * `POST /assess` round-trip drops into the same visual slot without the
 * transition changing shape.
 *
 * It lives here rather than inline in a screen because `screens/` is held to a
 * no-setTimeout rule, and the value of a greppable rule is that it has no
 * exceptions. Wall clock, not the app clock: this measures a real interval and
 * must not move when the demo clock does.
 */
export function atLeast<T>(ms: number, work: Promise<T>): Promise<T> {
  const started = wallClock();
  return work.then(async (value) => {
    const remaining = ms - (wallClock() - started);
    if (remaining > 0) await new Promise((r) => window.setTimeout(r, remaining));
    return value;
  });
}
