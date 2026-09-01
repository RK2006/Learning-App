export type ThemePref = 'light' | 'dark' | 'system';
export type MotionPref = 'full' | 'reduced' | 'system';

const THEME_KEY = 'learnable.theme';
const MOTION_KEY = 'learnable.motion';

/**
 * Read a preference without letting a blocked-cookies environment throw.
 *
 * The `window.localStorage` property access itself has to be inside the try:
 * with site data blocked it throws SecurityError before any method is called.
 */
function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* private mode or quota -- the preference just won't persist */
  }
}

function prefersDark(): boolean {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
}

function prefersReduced(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

export function applyTheme(pref: ThemePref): void {
  const resolved = pref === 'system' ? (prefersDark() ? 'dark' : 'light') : pref;
  document.documentElement.dataset.theme = resolved;
  write(THEME_KEY, pref);
}

/**
 * Mirrors the motion preference onto the root element.
 *
 * base.css reads `[data-motion='reduced']` so declarative CSS responds without
 * any component subscribing. Imperative animation (GSAP, WAAPI) must call
 * shouldAnimate() instead -- a CSS media query cannot stop a running timeline,
 * which is the single most common reduced-motion bug in hand-rolled animation.
 */
export function applyMotion(pref: MotionPref): void {
  const resolved = pref === 'system' ? (prefersReduced() ? 'reduced' : 'full') : pref;
  document.documentElement.dataset.motion = resolved;
  write(MOTION_KEY, pref);
}

export function getThemePref(): ThemePref {
  const v = read(THEME_KEY);
  return v === 'light' || v === 'dark' || v === 'system' ? v : 'system';
}

export function getMotionPref(): MotionPref {
  const v = read(MOTION_KEY);
  return v === 'full' || v === 'reduced' || v === 'system' ? v : 'system';
}

/*
 * The matching READ side is shouldAnimate() in lib/motion.ts, not here.
 *
 * This module resolves the preference and stamps [data-motion]; motion.ts is
 * where everything imperative asks about it. Keeping the question in the module
 * that owns GSAP means there is one import to grep for when auditing whether a
 * new animation respects the setting.
 */

/**
 * Call once, before first render, so there is no flash of the wrong theme.
 * Returns a cleanup that stops following the OS.
 */
export function initTheme(): () => void {
  applyTheme(getThemePref());
  applyMotion(getMotionPref());

  const darkQuery = window.matchMedia?.('(prefers-color-scheme: dark)');
  const motionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)');

  const onDark = () => {
    if (getThemePref() === 'system') applyTheme('system');
  };
  const onMotion = () => {
    if (getMotionPref() === 'system') applyMotion('system');
  };

  darkQuery?.addEventListener('change', onDark);
  motionQuery?.addEventListener('change', onMotion);

  return () => {
    darkQuery?.removeEventListener('change', onDark);
    motionQuery?.removeEventListener('change', onMotion);
  };
}
