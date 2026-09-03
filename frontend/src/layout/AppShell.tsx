import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useLocation } from 'wouter';
import { Rail } from './Rail';
import { TopBar } from './TopBar';
import type { TopBarStats } from './TopBar';
import { useAppState, useDispatch } from '../state/AppStateContext';
import { resetClock } from '../state/actions';
import { DAY_MS, formatDayLong, dayKey, now } from '../domain/time';
import s from './AppShell.module.css';

export interface AppShellProps {
  stats: TopBarStats;
  children: ReactNode;
}

/**
 * A shifted clock must never be invisible.
 *
 * Time travel makes every derived number in the app change at once. Without a
 * persistent marker, a demo that forgets to reset leaves someone staring at a
 * broken streak and decayed mastery with no explanation -- and the escape hatch
 * has to be here rather than buried in Settings, because that is where the
 * confusion happens.
 */
function ClockBanner() {
  const app = useAppState();
  const dispatch = useDispatch();
  if (app.settings.clockOffsetMs === 0) return null;

  const days = Math.round(app.settings.clockOffsetMs / DAY_MS);
  return (
    <div className={s.clockBanner} role="status">
      <span>
        Time travel: <strong>{days > 0 ? `+${days}` : days} days</strong> — the app thinks today is{' '}
        {formatDayLong(dayKey(now()))}.
      </span>
      <button type="button" className={s.clockReset} onClick={() => dispatch(resetClock(app))}>
        Reset clock
      </button>
    </div>
  );
}

export function AppShell({ stats, children }: AppShellProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [location] = useLocation();
  const mainRef = useRef<HTMLElement>(null);
  const lastLocation = useRef(location);

  /**
   * Scroll and focus management on route change.
   *
   * These are the parts people forget when they wire up a router, and without
   * the focus move the app is unusable by keyboard: after navigating, focus is
   * still on the rail link, so the screen's content is unreachable without
   * tabbing through the whole nav again. The screen heading is rendered with
   * tabIndex={-1} precisely so it can receive this.
   *
   * The guard compares the LOCATION rather than counting renders.
   *
   * It used to be `const firstRender = useRef(true)`, flipped to false on the
   * way out of the first effect -- which StrictMode defeats exactly. StrictMode
   * mounts, runs the effect, unmounts, and mounts again; the ref survives that,
   * so pass one consumed the flag and pass two did the focus. The app therefore
   * focused its own heading on every fresh load, and once the heading had a
   * visible focus ring again, a cold load painted a box around the word "Today".
   *
   * That stray box is what the ring in Screen.module.css had originally been
   * deleted to hide, so the two bugs were covering for each other: the focus
   * move was firing when it should not, and the indicator it fired was
   * suppressed so nobody saw it -- including the keyboard users it exists for.
   *
   * Comparing locations is immune to how many times the effect runs, because it
   * asks the question that actually matters: did we navigate?
   */
  useEffect(() => {
    if (lastLocation.current === location) return;
    lastLocation.current = location;
    window.scrollTo({ top: 0, behavior: 'auto' });
    const heading = mainRef.current?.querySelector<HTMLElement>('[data-screen-title]');
    heading?.focus({ preventScroll: true });
  }, [location]);

  return (
    <div className={s.shell} data-collapsed={collapsed}>
      {/*
        The first thing Tab reaches, on every screen.
        Without it a keyboard user pays fourteen Tab presses to get past the
        rail and the top bar -- on every single navigation, since focus is moved
        back to the heading each time. Hidden until focused, which is why it is
        the one element allowed to be visually absent while still in the tab
        order.
      */}
      <a href="#main" className={s.skip}>
        Skip to content
      </a>
      <Rail collapsed={collapsed} onToggle={() => setCollapsed((c) => !c)} />
      <div className={s.main}>
        <TopBar stats={stats} />
        <ClockBanner />
        <main ref={mainRef} className={s.content} id="main" tabIndex={-1}>
          {/*
            Keyed on the PATHNAME so the entrance replays per destination.

            wouter's useLocation() excludes the query string, which is exactly
            the behaviour wanted here: /path?concept=c4 opens the concept drawer
            without remounting the screen underneath it. The quirk that cost
            three phases in the session player pays for itself once.
          */}
          <div key={location} className={s.route}>
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
