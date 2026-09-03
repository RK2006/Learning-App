import type { Icon } from '@phosphor-icons/react';
import {
  House,
  MapTrifold,
  ArrowsClockwise,
  ChartLineUp,
  CalendarBlank,
  UserCircle,
} from '@phosphor-icons/react';

export const ROUTES = {
  today: '/today',
  path: '/path',
  review: '/review',
  progress: '/progress',
  schedule: '/schedule',
  profile: '/profile',
  settings: '/profile/settings',
  onboarding: '/onboarding',
  // Keyed by concept, not by a synthetic session id: the session's identity IS
  // which concept you are studying, and it makes the URL shareable and
  // resumable without persisting a session record first.
  session: '/session/:conceptId',
} as const;

export interface NavItem {
  href: string;
  label: string;
  icon: Icon;
}

/**
 * The six real destinations.
 *
 * This replaces six sidebar buttons that had no onClick at all, two of which
 * ("Learning Path", "Daily Lesson") named the two halves of a single split panel
 * on the same screen -- there was nowhere for them to navigate to even in
 * principle.
 */
export const NAV: NavItem[] = [
  { href: ROUTES.today, label: 'Today', icon: House },
  { href: ROUTES.path, label: 'Path', icon: MapTrifold },
  { href: ROUTES.review, label: 'Review', icon: ArrowsClockwise },
  { href: ROUTES.progress, label: 'Progress', icon: ChartLineUp },
  { href: ROUTES.schedule, label: 'Schedule', icon: CalendarBlank },
  { href: ROUTES.profile, label: 'Profile', icon: UserCircle },
];

/** Routes that take over the whole viewport and hide the shell chrome. */
export const TAKEOVER_PREFIXES = ['/session', '/onboarding'];

export function isTakeover(location: string): boolean {
  return TAKEOVER_PREFIXES.some((p) => location.startsWith(p));
}
