import { forwardRef } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cx } from '../../lib/cx';
import s from './Press.module.css';

export type PressVariant = 'brand' | 'go' | 'stop' | 'review' | 'xp' | 'ghost' | 'danger';
export type PressSize = 'sm' | 'md' | 'lg';

export interface PressProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: PressVariant;
  size?: PressSize;
  /** Stretch to the full width of the container. */
  block?: boolean;
  /** Rendered before the label. */
  icon?: ReactNode;
}

const variantClass: Record<PressVariant, string | undefined> = {
  brand: undefined,
  go: s.go,
  stop: s.stop,
  review: s.review,
  xp: s.xp,
  ghost: s.ghost,
  danger: s.danger,
};

const sizeClass: Record<PressSize, string | undefined> = {
  sm: s.sm,
  md: undefined,
  lg: s.lg,
};

/**
 * The app's one button. Every clickable control in the product is this
 * component or a documented exception (concept nodes, option tiles, day cells).
 */
export const Press = forwardRef<HTMLButtonElement, PressProps>(function Press(
  { variant = 'brand', size = 'md', block, icon, className, children, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx(s.press, variantClass[variant], sizeClass[size], block && s.block, className)}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
});
