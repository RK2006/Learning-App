import { useEffect, useRef, useState } from 'react';
import { cx } from '../../lib/cx';
import { usePica } from './usePica';
import s from './Pica.module.css';

export type PicaState = 'idle' | 'think' | 'cheer' | 'oof' | 'sleep' | 'carry' | 'point' | 'peek';

export interface PicaProps {
  state?: PicaState;
  /** Rendered size in px. Below 34 the pupils and mouth are dropped. */
  size?: number;
  /**
   * Change this to replay a one-shot reaction that is already on screen --
   * two correct answers in a row should cheer twice. See usePica.ts.
   */
  replay?: number | string;
  className?: string;
}

/** Mouth path per expression. Swapping `d` is the whole expression system. */
const MOUTH: Record<PicaState, string> = {
  idle: 'M53 79 Q60 83 67 79',
  think: 'M53 80 q3.5 -4 7 0 t7 0',
  cheer: 'M52 77 Q60 87 68 77',
  oof: 'M53 82 q3.5 3 7 0 t7 0',
  sleep: 'M54 80 h12',
  carry: 'M54 81 q6 -3 12 0',
  point: 'M53 78 Q60 85 67 78',
  peek: 'M56 80 Q60 83 64 80',
};

/**
 * Said aloud, not spelled out.
 *
 * The label used to interpolate the state name, so a screen reader announced
 * "Pica the moth, oof" -- a word that means nothing outside this codebase.
 */
const LABEL: Record<PicaState, string> = {
  idle: 'Pica the moth',
  think: 'Pica the moth, thinking',
  cheer: 'Pica the moth, celebrating',
  oof: 'Pica the moth, sympathetic',
  sleep: 'Pica the moth, asleep',
  carry: 'Pica the moth, carrying something',
  point: 'Pica the moth, pointing the way',
  peek: 'Pica the moth, peeking',
};

/**
 * Pica the moth.
 *
 * Blink is scheduled here rather than in CSS because a fixed-interval blink
 * reads robotic; the 3.5-7s jitter is what makes it read as alive.
 */
export function Pica({ state = 'idle', size = 120, replay, className }: PicaProps) {
  const [blinking, setBlinking] = useState(false);
  const rootRef = useRef<SVGSVGElement>(null);
  const small = size < 34;

  usePica(rootRef, state, replay);

  useEffect(() => {
    if (state === 'sleep' || small) return;
    let timer: number;
    const schedule = () => {
      timer = window.setTimeout(() => {
        setBlinking(true);
        window.setTimeout(() => setBlinking(false), 130);
        schedule();
      }, 3500 + Math.random() * 3500);
    };
    schedule();
    return () => window.clearTimeout(timer);
  }, [state, small]);

  // Pupils track the pointer. One throttled listener writing two CSS vars --
  // no React state, so this never re-renders the tree.
  useEffect(() => {
    if (small || state === 'sleep') return;
    let frame = 0;
    const onMove = (e: PointerEvent) => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        const el = rootRef.current;
        if (!el) return;
        const r = el.getBoundingClientRect();
        const dx = (e.clientX - (r.left + r.width / 2)) / Math.max(r.width, 1);
        const dy = (e.clientY - (r.top + r.height / 2)) / Math.max(r.height, 1);
        el.style.setProperty('--pupil-x', `${Math.max(-1, Math.min(1, dx)) * 2.5}px`);
        el.style.setProperty('--pupil-y', `${Math.max(-1, Math.min(1, dy)) * 2}px`);
      });
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [small, state]);

  return (
    <svg
      ref={rootRef}
      className={cx(s.root, s[state], blinking && s.blinking, className)}
      width={size}
      height={size}
      viewBox="0 0 120 120"
      role="img"
      aria-label={LABEL[state]}
    >
      {/* back wings -- the misregistered second plate is the signature detail */}
      <g className={s.misreg}>
        <path d="M58 58 C40 34 16 34 12 52 C8 70 30 84 58 74 Z" fill="var(--review)" />
        <path d="M62 58 C80 34 104 34 108 52 C112 70 90 84 62 74 Z" fill="var(--review)" />
      </g>
      {/* data-part marks every element carrying a one-shot animation, so
          usePica can restart them without depending on hashed module class
          names. */}
      <path
        data-part="wingBackL"
        className={cx(s.wing, s.wingBackL)}
        d="M58 58 C40 34 16 34 12 52 C8 70 30 84 58 74 Z"
        fill="var(--brand)"
      />
      <path
        data-part="wingBackR"
        className={cx(s.wing, s.wingBackR)}
        d="M62 58 C80 34 104 34 108 52 C112 70 90 84 62 74 Z"
        fill="var(--brand)"
      />

      {/* front wings, with halftone dots */}
      <g data-part="wingFrontL" className={cx(s.wing, s.wingFrontL)}>
        <path d="M58 66 C44 54 26 58 24 72 C22 84 40 92 58 82 Z" fill="var(--spark)" />
        <circle cx="38" cy="72" r="2" fill="var(--streak-deep)" />
        <circle cx="45" cy="78" r="2" fill="var(--streak-deep)" />
        <circle cx="32" cy="78" r="2" fill="var(--streak-deep)" />
      </g>
      <g data-part="wingFrontR" className={cx(s.wing, s.wingFrontR)}>
        <path d="M62 66 C76 54 94 58 96 72 C98 84 80 92 62 82 Z" fill="var(--spark)" />
        <circle cx="82" cy="72" r="2" fill="var(--streak-deep)" />
        <circle cx="75" cy="78" r="2" fill="var(--streak-deep)" />
        <circle cx="88" cy="78" r="2" fill="var(--streak-deep)" />
      </g>

      <g data-part="body" className={s.body}>
        {/* antennae */}
        <g data-part="antennaL" className={s.antennaL}>
          <path
            d="M55 48 C50 38 46 33 42 30"
            stroke="var(--ink-1)"
            strokeWidth="3"
            strokeLinecap="round"
            fill="none"
          />
          <circle cx="42" cy="30" r="2.6" fill="var(--ink-1)" />
        </g>
        <g data-part="antennaR" className={s.antennaR}>
          <path
            d="M65 48 C70 38 74 33 78 30"
            stroke="var(--ink-1)"
            strokeWidth="3"
            strokeLinecap="round"
            fill="none"
          />
          <circle cx="78" cy="30" r="2.6" fill="var(--ink-1)" />
        </g>

        {/* thorax + abdomen */}
        <rect x="52" y="62" width="16" height="34" rx="8" fill="var(--ink-1)" />
        <rect x="56" y="74" width="8" height="16" rx="4" fill="var(--ink-2)" />

        {/* head */}
        <circle cx="60" cy="58" r="13" fill="var(--ink-1)" />

        {!small && (
          <>
            <g className={s.eyes}>
              <circle cx="55" cy="57" r="5" fill="var(--paper)" />
              <circle cx="65" cy="57" r="5" fill="var(--paper)" />
            </g>
            <g className={s.pupils}>
              <circle cx="55" cy="57" r="2.6" fill="var(--ink-1)" />
              <circle cx="65" cy="57" r="2.6" fill="var(--ink-1)" />
            </g>
            <path className={s.mouth} d={MOUTH[state]} />
          </>
        )}
      </g>
    </svg>
  );
}
