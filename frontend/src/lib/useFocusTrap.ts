import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';

/**
 * Anything that can take focus, in DOM order.
 *
 * `:not([disabled])` matters on every control type, not just buttons -- a
 * disabled input is still matched by `input` and would silently become a dead
 * stop inside the cycle.
 */
const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function focusable(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => {
    // offsetParent is null for display:none and for anything inside it. The
    // extra checks catch position:fixed elements (whose offsetParent is always
    // null) and visibility:hidden, which offsetParent does not see.
    if (el.hasAttribute('inert')) return false;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') return false;
    return el.offsetParent !== null || cs.position === 'fixed';
  });
}

export interface FocusTrapOptions {
  onEscape?: () => void;
  /** Focus this instead of the first focusable child. */
  initial?: RefObject<HTMLElement>;
}

/**
 * Keep Tab inside a dialog, and give focus back when it closes.
 *
 * `aria-modal="true"` is a promise to assistive technology, not an
 * implementation. It tells a screen reader to treat everything outside as
 * hidden; it does nothing whatsoever about the Tab key, so without this hook a
 * "modal" dialog is one Tab away from the page behind it. The audit found
 * exactly that: focus left the achievement dialog on all twelve of twelve tabs,
 * and the session's exit confirmation never received focus at all -- pressing
 * Escape opened a dialog the keyboard could not reach.
 *
 * Three things have to happen together, and all three are easy to ship half of:
 *
 *  1. FOCUS GOES IN. On open, to the caller's choice or the first control.
 *  2. FOCUS STAYS IN. Tab from the last element wraps to the first;
 *     Shift+Tab from the first wraps to the last.
 *  3. FOCUS COMES BACK. On close, to whatever was focused before -- otherwise
 *     the user is returned to the top of the document and has to tab back
 *     through the whole page to where they were.
 *
 * The focusable list is recomputed on every Tab rather than cached, because
 * these dialogs change: a button can become disabled, and the achievement modal
 * renders different controls depending on whether the badge is unlocked.
 */
export function useFocusTrap(
  ref: RefObject<HTMLElement>,
  active: boolean,
  { onEscape, initial }: FocusTrapOptions = {},
): void {
  const escapeRef = useRef(onEscape);
  escapeRef.current = onEscape;

  useEffect(() => {
    if (!active) return;
    const root = ref.current;

    /**
     * A null node here is always a caller bug, and it used to be a SILENT one.
     *
     * usePresence defers mounting by one state update, so `useFocusTrap(ref,
     * open)` runs its effect while the node still does not exist: it returns,
     * the dependencies never change again, and the dialog ships untrapped with
     * no error anywhere. That shipped twice -- LevelUp in Phase 6 and the
     * achievement modal in Phase 8 -- because nothing complained either time.
     *
     * The fix at the call site is to pass `mounted && open`. The warning is so
     * the third occurrence announces itself instead of being found by an audit.
     */
    if (!root) {
      if (import.meta.env.DEV) {
        // eslint-disable-next-line no-console
        console.warn(
          '[useFocusTrap] active with no node — pass `mounted && open` so the trap runs after usePresence mounts it.',
        );
      }
      return;
    }

    const previous = document.activeElement;

    // A frame's grace: usePresence mounts the node a render before this runs
    // in some orders, and a dialog that animates in may still be laying out.
    const raf = requestAnimationFrame(() => {
      const target = initial?.current ?? focusable(root)[0] ?? root;
      target.focus();
    });

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        escapeRef.current?.();
        return;
      }
      if (e.key !== 'Tab') return;

      const items = focusable(root);
      if (items.length === 0) {
        // Nothing to move to: keep focus on the dialog rather than letting it
        // escape to the page behind.
        e.preventDefault();
        root.focus();
        return;
      }

      const first = items[0]!;
      const last = items[items.length - 1]!;
      const current = document.activeElement;

      // Focus may be outside entirely (a click on the scrim, a stale restore),
      // in which case Tab should pull it back in rather than continue past.
      if (!root.contains(current)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
        return;
      }
      if (e.shiftKey && current === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && current === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKey, true);

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('keydown', onKey, true);
      // `isConnected` because the element that opened the dialog may itself
      // have been removed by whatever the dialog did.
      if (previous instanceof HTMLElement && previous.isConnected) {
        previous.focus({ preventScroll: true });
      }
    };
  }, [ref, active, initial]);
}
