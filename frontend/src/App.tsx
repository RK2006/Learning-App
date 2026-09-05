import { Redirect, Route, Switch, useLocation, useSearch } from 'wouter';
import { IconContext } from '@phosphor-icons/react';
import { AppShell } from './layout/AppShell';
import { Toasts } from './components/Toasts/Toasts';
import { ErrorBoundary } from './components/ErrorBoundary/ErrorBoundary';
import { Shortcuts } from './components/Shortcuts/Shortcuts';
import type { TopBarStats } from './layout/TopBar';
import { ROUTES, isTakeover } from './router/routes';
import { AppStateProvider, useAppState } from './state/AppStateContext';
import { selectActiveCourse, selectLevel, selectStreak, selectXpToday } from './state/selectors';
import { TodayScreen } from './screens/TodayScreen';
import { PathScreen } from './screens/PathScreen';
import { OnboardingScreen } from './screens/OnboardingScreen';
import { SessionScreen } from './screens/SessionScreen';
import {
  NotFoundScreen,
  ProfileScreen,
  ProgressScreen,
  ReviewScreen,
  ScheduleScreen,
  SettingsScreen,
} from './screens';

function useTopBarStats(): TopBarStats {
  const app = useAppState();
  const course = selectActiveCourse(app);
  const level = selectLevel(app);
  return {
    courseName: course?.topic ?? 'No course yet',
    streak: selectStreak(app),
    xpToday: selectXpToday(app),
    dailyGoalXp: app.settings.dailyGoalXp,
    totalXp: app.profile.totalXp,
    level: level.level,
    initials: app.profile.displayName.slice(0, 2).toUpperCase() || 'YOU',
  };
}

function Shell() {
  const stats = useTopBarStats();
  return (
    <AppShell stats={stats}>
      <Switch>
        <Route path="/" component={() => <Redirect to={ROUTES.today} />} />
        <Route path={ROUTES.today} component={TodayScreen} />
        <Route path={ROUTES.path} component={PathScreen} />
        <Route path={ROUTES.review} component={ReviewScreen} />
        <Route path={ROUTES.progress} component={ProgressScreen} />
        <Route path={ROUTES.schedule} component={ScheduleScreen} />
        {/* settings before profile: wouter matches in order */}
        <Route path={ROUTES.settings} component={SettingsScreen} />
        <Route path={ROUTES.profile} component={ProfileScreen} />
        <Route component={NotFoundScreen} />
      </Switch>
    </AppShell>
  );
}

function Routed() {
  const [location] = useLocation();
  const search = useSearch();
  const app = useAppState();

  // First run goes to onboarding. Dropping someone on an empty Today screen and
  // making them hunt for the setup flow is how the previous build opened.
  if (!app.onboarded && !location.startsWith('/onboarding')) {
    return <Redirect to={ROUTES.onboarding} />;
  }

  // Takeovers suspend the shell entirely -- the lesson player owns the viewport
  // so nothing competes with the question.
  if (isTakeover(location)) {
    const takeover = (
      <Switch>
        <Route path={ROUTES.onboarding} component={OnboardingScreen} />
        {/*
          Keyed by the WHOLE session identity -- concept plus query -- so every
          distinct run remounts the player.

          Keying on the concept alone was not enough. "Try this again" navigates
          to the same concept with `?mode=practice`: same pathname, same key, no
          remount, so the session reducer AND the one-shot `committed` flag
          carried over. `committed` is never reset, so the retry reached
          `evaluating`, the commit effect returned at its guard, and the
          "Checking answers…" spinner ran forever with no way out but Escape.
          Answers, combo and hearts leaked across the boundary too.
        */}
        <Route path={ROUTES.session}>
          {(params) => <SessionScreen key={`${params.conceptId}?${search}`} />}
        </Route>
        <Route component={NotFoundScreen} />
      </Switch>
    );

    // Keyed on the full session identity, same as the player itself: a crash in
    // one run must not persist into the next one the learner starts.
    return (
      <ErrorBoundary resetKey={`${location}?${search}`}>{takeover}</ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary resetKey={location}>
      <Shell />
    </ErrorBoundary>
  );
}

export default function App() {
  return (
    /**
     * Every Phosphor icon in this app is DECORATIVE.
     *
     * Each one sits inside a control that already has a name -- a rail link
     * with visible text, a button with a label, an aria-label where the text is
     * hidden at narrow widths. Without aria-hidden a screen reader announces
     * the icon as a second, nameless graphic next to the thing it decorates,
     * which the audit found nine of on the Today screen alone.
     *
     * Set once through the icon library's own context rather than on thirty
     * call sites, so a newly added icon is correct by default. An icon that
     * ever needs to carry meaning on its own can still pass its own aria-label,
     * which wins over the context value.
     */
    <IconContext.Provider value={{ 'aria-hidden': true }}>
    <AppStateProvider>
      <Routed />
      {/* Outside Routed: a storage failure during a lesson is exactly when the
          user most needs to hear about it, and takeovers replace the shell. */}
      <Toasts />
      {/* Also outside: the shortcut listener is global, and the help sheet has
          to be able to open over a takeover even though the jumps do not fire
          there. */}
      <Shortcuts />
    </AppStateProvider>
    </IconContext.Provider>
  );
}
