import { Pica } from '../Pica/Pica';
import { cx } from '../../lib/cx';
import s from './PressLoader.module.css';

export interface PressLoaderProps {
  /** What is being made. A verb phrase, present tense, and TRUE. */
  label: string;
  /** Optional second line for the part that is genuinely slow. */
  note?: string;
  className?: string;
}

/**
 * Loading, told as something happening rather than measured.
 *
 * There is no progress bar here and there never will be, because we do not know
 * the progress. A language model streams tokens for somewhere between two and
 * twelve seconds with no meaningful completion signal in between, so any
 * percentage on this screen would be an animation of a number nobody computed.
 * That is the exact species of dishonesty this overhaul exists to remove -- it
 * is the same lie as `streak: 6`, just moving.
 *
 * What the user actually needs to know is: something is happening, it is the
 * thing I asked for, and it has not hung. A press turning and sheets coming out
 * answers all three, and it degrades honestly -- if it takes twelve seconds the
 * press just turns twelve seconds' worth, with no promise broken.
 *
 * Reduced motion keeps the scene and stops the machine; the label is the part
 * carrying the information, and it does not move either way.
 */
export function PressLoader({ label, note, className }: PressLoaderProps) {
  return (
    <div className={cx(s.wrap, className)}>
      <div className={s.scene} role="img" aria-label={label}>
        <svg className={s.press} viewBox="0 0 168 120" aria-hidden="true">
          {/* sheets, leaving the press one at a time */}
          <g className={s.sheets}>
            {[0, 1, 2].map((i) => (
              <rect
                key={i}
                className={s.sheet}
                style={{ '--i': i } as React.CSSProperties}
                x="96"
                y="62"
                width="34"
                height="24"
                rx="3"
                fill="var(--paper)"
                stroke="var(--edge-strong)"
                strokeWidth="2"
              />
            ))}
          </g>

          {/* bed and frame -- flat fills, one misregistered plate behind */}
          <rect className={s.plate} x="26" y="30" width="74" height="56" rx="7" fill="var(--brand)" />
          <rect x="24" y="28" width="74" height="56" rx="7" fill="var(--paper)" stroke="var(--ink-1)" strokeWidth="3" />
          <rect x="34" y="38" width="54" height="10" rx="3" fill="var(--ink-2)" />
          <rect x="34" y="54" width="40" height="6" rx="3" fill="var(--edge-strong)" />
          <rect x="34" y="66" width="48" height="6" rx="3" fill="var(--edge-strong)" />
          <rect x="18" y="86" width="88" height="12" rx="4" fill="var(--ink-1)" />

          {/* the crank: axle, arm, handle */}
          <g className={s.crank}>
            <line x1="0" y1="0" x2="22" y2="0" stroke="var(--ink-1)" strokeWidth="5" strokeLinecap="round" />
            <circle cx="22" cy="0" r="6" fill="var(--streak)" stroke="var(--ink-1)" strokeWidth="3" />
          </g>
          <circle cx="20" cy="58" r="7" fill="var(--ink-1)" />
        </svg>

        <Pica state="carry" size={92} className={s.pica} />
      </div>

      <p className={s.label} aria-live="polite">
        {label}
      </p>
      {note && <p className={s.note}>{note}</p>}
    </div>
  );
}
