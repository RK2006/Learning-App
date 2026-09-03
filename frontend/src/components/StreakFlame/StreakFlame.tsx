import { cx } from '../../lib/cx';
import s from './StreakFlame.module.css';

export interface StreakFlameProps {
  size?: number;
  /** A streak of 0 renders cold: no flicker, no embers, desaturated. */
  cold?: boolean;
  className?: string;
}

export function StreakFlame({ size = 24, cold, className }: StreakFlameProps) {
  return (
    <svg
      className={cx(s.flame, cold && s.cold, className)}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      {!cold && (
        <>
          <circle className={cx(s.ember)} cx="7" cy="9" r="1.1" fill="var(--spark)" />
          <circle className={cx(s.ember, s.ember2)} cx="17" cy="11" r="0.9" fill="var(--streak)" />
        </>
      )}
      <path
        className={s.outer}
        d="M12 1.8c3.4 3.2 6.6 6 6.6 10.4A6.6 6.6 0 0 1 12 22.2a6.6 6.6 0 0 1-6.6-10c0-4.4 3.2-7.2 6.6-10.4Z"
        fill="var(--streak-deep)"
      />
      <path
        className={s.mid}
        d="M12 5.4c2.3 2.4 4.4 4.4 4.4 7.4A4.4 4.4 0 0 1 12 21a4.4 4.4 0 0 1-4.4-8.2c0-3 2.1-5 4.4-7.4Z"
        fill="var(--streak)"
      />
      <path
        className={s.inner}
        d="M12 10.2c1.2 1.4 2.3 2.4 2.3 4a2.3 2.3 0 0 1-4.6 0c0-1.6 1.1-2.6 2.3-4Z"
        fill="var(--spark)"
      />
    </svg>
  );
}
