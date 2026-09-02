import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from '../../lib/cx';
import s from './Chip.module.css';

export type ChipTone = 'neutral' | 'brand' | 'go' | 'stop' | 'review' | 'streak' | 'spark' | 'locked';

export interface ChipProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: ChipTone;
  /** Uppercase micro type. Only legal at this size. */
  caps?: boolean;
  icon?: ReactNode;
}

const toneClass: Record<ChipTone, string | undefined> = {
  neutral: undefined,
  brand: s.brand,
  go: s.go,
  stop: s.stop,
  review: s.review,
  streak: s.streak,
  spark: s.spark,
  locked: s.locked,
};

export function Chip({ tone = 'neutral', caps, icon, className, children, ...rest }: ChipProps) {
  return (
    <span className={cx(s.chip, toneClass[tone], caps && s.caps, className)} {...rest}>
      {icon}
      {children}
    </span>
  );
}
