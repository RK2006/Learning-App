import type { ReactNode } from 'react';
import s from './Screen.module.css';

export interface ScreenProps {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children?: ReactNode;
}

/**
 * Shared screen scaffold.
 *
 * The h1 carries tabIndex={-1} and data-screen-title so AppShell can move focus
 * to it on navigation -- without that the app is unusable by keyboard.
 */
export function Screen({ eyebrow, title, subtitle, actions, children }: ScreenProps) {
  return (
    <div className={s.screen}>
      <div className={s.head}>
        <div className={s.titleWrap}>
          {eyebrow && <div className="eyebrow">{eyebrow}</div>}
          <h1 className={s.title} tabIndex={-1} data-screen-title>
            {title}
          </h1>
          <span className={s.swash} aria-hidden="true" />
          {subtitle && <p className={s.subtitle}>{subtitle}</p>}
        </div>
        {actions && <div className={s.actions}>{actions}</div>}
      </div>
      <div className={s.body}>{children}</div>
    </div>
  );
}

