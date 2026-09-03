import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { Press } from '../Press/Press';
import { usePresence } from '../../lib/usePresence';
import { useFocusTrap } from '../../lib/useFocusTrap';
import { ROUTES } from '../../router/routes';
import s from './Shortcuts.module.css';

/**
 * A `g`-prefixed jump, plus `?` for the list.
 *
 * The prefix is doing real work. Bare letters collide immediately: 1-4 already
 * pick multiple-choice options in the player, and any single-letter binding
 * would fire the moment someone types in the topic field or the short-answer
 * box. A two-key sequence cannot be produced by accident and is the convention
 * a lot of people already have in their fingers from Gmail and GitHub.
 *
 * `g` then `g` is Progress rather than a second Today, because "g g" for the
 * screen you are most likely already on would be the one binding nobody needs.
 */
const JUMPS: { key: string; to: string; label: string }[] = [
  { key: 't', to: ROUTES.today, label: 'Today' },
  { key: 'p', to: ROUTES.path, label: 'Path' },
  { key: 'r', to: ROUTES.review, label: 'Review' },
  { key: 'g', to: ROUTES.progress, label: 'Progress' },
  { key: 's', to: ROUTES.schedule, label: 'Schedule' },
  { key: 'u', to: ROUTES.profile, label: 'Profile (you)' },
];

/** How long the `g` prefix stays armed before it is forgotten. */
const PREFIX_MS = 1200;

/**
 * True when a keystroke belongs to whatever the user is typing into.
 *
 * Without this, every shortcut fires while someone writes a short answer -- and
 * `contentEditable` is included because a rich-text field is not an <input> and
 * is the case people forget.
 */
function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  const tag = el.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable;
}

export function Shortcuts() {
  const [, navigate] = useLocation();
  const [location] = useLocation();
  const [open, setOpen] = useState(false);
  const armed = useRef(false);
  const armedTimer = useRef(0);

  const { mounted, state, ref } = usePresence<HTMLDivElement>(open);
  const closeRef = useRef<HTMLButtonElement>(null);
  // `mounted &&` — usePresence mounts a render later, and without it the
  // trap's effect finds a null node and silently never runs. The hook warns
  // about this in dev, which is how this very line was caught.
  useFocusTrap(ref, mounted && open, { onEscape: () => setOpen(false), initial: closeRef });

  // The session player is a takeover with its own key handling -- Escape exits,
  // 1-4 answer. Navigating away mid-question with a stray keypress would
  // discard the attempt, so shortcuts are off entirely in there.
  const inTakeover = location.startsWith('/session') || location.startsWith('/onboarding');

  useEffect(() => {
    if (inTakeover) return;

    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === '?') {
        e.preventDefault();
        setOpen((v) => !v);
        return;
      }
      // Escape is handled by the focus trap while the sheet is open.
      if (open) return;

      if (armed.current) {
        const jump = JUMPS.find((j) => j.key === e.key.toLowerCase());
        armed.current = false;
        window.clearTimeout(armedTimer.current);
        if (jump) {
          e.preventDefault();
          navigate(jump.to);
        }
        return;
      }

      if (e.key.toLowerCase() === 'g') {
        armed.current = true;
        // Disarm on a timer so a stray `g` does not silently swallow the next
        // keystroke minutes later.
        window.clearTimeout(armedTimer.current);
        armedTimer.current = window.setTimeout(() => {
          armed.current = false;
        }, PREFIX_MS);
      }
    };

    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.clearTimeout(armedTimer.current);
      armed.current = false;
    };
  }, [navigate, open, inTakeover]);

  if (!mounted) return null;

  return (
    <div
      ref={ref}
      className={s.scrim}
      data-presence={state}
      role="dialog"
      aria-modal="true"
      aria-labelledby="shortcuts-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <div className={s.sheet}>
        <h2 id="shortcuts-title" className={s.title}>
          Keyboard shortcuts
        </h2>

        <dl className={s.list}>
          <div className={s.row}>
            <dt>
              <kbd className={s.kbd}>?</kbd>
            </dt>
            <dd>Show or hide this list</dd>
          </div>
          {JUMPS.map((j) => (
            <div key={j.key} className={s.row}>
              <dt>
                <kbd className={s.kbd}>g</kbd> <kbd className={s.kbd}>{j.key}</kbd>
              </dt>
              <dd>Go to {j.label}</dd>
            </div>
          ))}
          <div className={s.row}>
            <dt>
              <kbd className={s.kbd}>Tab</kbd>
            </dt>
            <dd>First stop is “Skip to content”</dd>
          </div>
        </dl>

        <p className={s.note}>
          In a lesson: <kbd className={s.kbd}>1</kbd>–<kbd className={s.kbd}>4</kbd> pick an answer,{' '}
          <kbd className={s.kbd}>Enter</kbd> confirms, <kbd className={s.kbd}>Esc</kbd> asks whether to
          leave. Shortcuts are off while you are typing.
        </p>

        <Press ref={closeRef} block onClick={() => setOpen(false)}>
          Close
        </Press>
      </div>
    </div>
  );
}
