import { useLayoutEffect, useRef } from 'react';
import type { RefObject } from 'react';
import type { PicaState } from './Pica';

/**
 * States driven by a one-shot @keyframes animation, which is the only kind that
 * can fail to re-trigger.
 *
 * `oof` is deliberately NOT here even though it is also a reaction: it is a
 * held pose reached by a transition -- antennae down, body slumped -- and it
 * stays there. Two wrong answers in a row should leave Pica exactly as
 * dejected as one did, so there is nothing to replay, and clearing
 * `style.animation` on a transition-driven pose would be a no-op pretending to
 * be a fix.
 */
const ONE_SHOT = new Set<PicaState>(['cheer', 'point']);

/**
 * Makes Pica's one-shot reactions replayable, and cancels them cleanly.
 *
 * The problem this solves is specific and easy to miss in review, because the
 * broken version looks correct the first time you try it.
 *
 * Pica's reactions are CSS animations selected by a state class. A CSS
 * animation is triggered by the class ARRIVING, so answering two questions
 * correctly in a row plays the cheer exactly once: the second render sets
 * `cheer` on an element that already has `cheer`, nothing changes, and the moth
 * sits there while the user is told they were right. The reward silently stops
 * arriving at precisely the point someone is doing well.
 *
 * There is no CSS solution to that -- an element cannot re-trigger an animation
 * it is already the subject of. Clearing `animation`, forcing the browser to
 * flush layout, and restoring it is the way to make the engine treat the next
 * frame as a fresh start.
 *
 * The forced reflow is the part that usually gets flagged, so: it is five small
 * SVG nodes inside a fixed-size viewBox, it happens on a discrete user action
 * rather than per frame, and it replaces the animation outright instead of
 * layering a second one on top. That last point is what "cancel in-flight"
 * means here -- a cheer interrupted by an oof does not blend into a half-hop.
 *
 * getBoundingClientRect() rather than the usual offsetHeight trick: SVG
 * elements are not HTMLElements and have no offsetHeight, so the idiom
 * everybody copies from Stack Overflow reads `undefined` and forces nothing.
 */
export function usePica(ref: RefObject<SVGSVGElement>, state: PicaState, replay?: number | string): void {
  const previous = useRef<{ state: PicaState; replay?: number | string } | null>(null);

  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;

    const last = previous.current;
    previous.current = { state, replay };

    // First render: the class is arriving on its own, so the browser will start
    // the animation without help.
    if (last === null) return;
    if (!ONE_SHOT.has(state)) return;
    // A genuine state change re-triggers by itself too. Only a repeat needs us.
    if (last.state !== state) return;
    if (last.replay === replay) return;

    const parts = root.querySelectorAll<SVGElement>('[data-part]');
    parts.forEach((el) => {
      el.style.animation = 'none';
    });
    root.getBoundingClientRect();
    parts.forEach((el) => {
      el.style.animation = '';
    });
  }, [ref, state, replay]);
}
