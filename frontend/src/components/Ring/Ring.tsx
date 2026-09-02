import { useEffect, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { cx } from '../../lib/cx';
import s from './Ring.module.css';

export type RingTone = 'brand' | 'go' | 'stop' | 'review' | 'streak' | 'spark' | 'xp';

export interface RingProps {
  /** 0..1. Values outside the range are clamped. */
  value: number;
  size?: number;
  thickness?: number;
  tone?: RingTone;
  /** Centered content -- a number, an icon, nothing. */
  children?: ReactNode;
  className?: string;
  /** Accessible description. Omit only when an adjacent label already says it. */
  label?: string;
  /**
   * Fill from empty on first paint instead of arriving full.
   *
   * For a ring that is REPORTING something the user just did -- a score, a goal
   * being crossed, a level -- watching it fill is the reward. For a ring that
   * is ambient chrome, growing it on every mount would mean the top bar
   * re-animated on every navigation, so this is opt-in.
   */
  grow?: boolean;
}

export function Ring({
  value,
  size = 48,
  thickness = 6,
  tone = 'brand',
  children,
  className,
  label,
  grow = false,
}: RingProps) {
  const target = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  const r = (size - thickness) / 2;
  const circumference = 2 * Math.PI * r;

  /**
   * The transition on stroke-dashoffset can only run if the property CHANGES,
   * and a ring rendered at its final value on first paint never changes. So a
   * growing ring paints empty and is moved to its value one committed frame
   * later -- the double rAF is what guarantees the browser has actually taken
   * the first value before the second arrives, rather than coalescing the two
   * and skipping the animation entirely.
   */
  const [p, setP] = useState(grow ? 0 : target);

  useEffect(() => {
    if (!grow) {
      setP(target);
      return;
    }
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setP(target));
    });
    return () => {
      cancelAnimationFrame(first);
      if (second) cancelAnimationFrame(second);
    };
  }, [target, grow]);

  const style = {
    '--p': p,
    '--circumference': circumference,
    '--tone': `var(--${tone})`,
  } as CSSProperties;

  return (
    <span className={cx(s.wrap, className)} style={style}>
      <svg className={s.ring} width={size} height={size} aria-hidden={label ? undefined : true}>
        {label && <title>{label}</title>}
        <circle className={s.track} cx={size / 2} cy={size / 2} r={r} strokeWidth={thickness} />
        <circle className={s.value} cx={size / 2} cy={size / 2} r={r} strokeWidth={thickness} />
      </svg>
      {children != null && (
        <span className={s.label} style={{ fontSize: Math.round(size * 0.3) }}>
          {children}
        </span>
      )}
    </span>
  );
}
