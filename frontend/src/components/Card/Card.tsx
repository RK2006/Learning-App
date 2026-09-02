import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from '../../lib/cx';
import s from './Card.module.css';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Recessed well styling -- inputs, progress tracks, read-only panels. */
  sunk?: boolean;
  /** Remove padding, clip children. For cards whose content bleeds to the edge. */
  flush?: boolean;
  /** Smaller padding. */
  tight?: boolean;
  title?: string;
  /** Rendered at the top-right of the header row. */
  action?: ReactNode;
}

export function Card({ sunk, flush, tight, title, action, className, children, ...rest }: CardProps) {
  return (
    <div className={cx(s.card, sunk && s.sunk, flush && s.flush, tight && s.tight, className)} {...rest}>
      {(title || action) && (
        <div className={s.head}>
          {title && <h3 className={s.title}>{title}</h3>}
          {action}
        </div>
      )}
      {children}
    </div>
  );
}
