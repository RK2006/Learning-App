import { Link } from 'wouter';
import { Screen } from './Screen';
import { Press } from '../components/Press/Press';
import { ROUTES } from '../router/routes';

/**
 * The route barrel.
 *
 * Every screen behind these names is now real. The Phase 1 `Stub` component
 * that stood in for them has been deleted rather than left lying around -- a
 * placeholder nothing renders is just a comment that compiles.
 */

export { ReviewScreen } from './ReviewScreen';
export { ProgressScreen } from './ProgressScreen';

export { ScheduleScreen } from './ScheduleScreen';

export { ProfileScreen } from './ProfileScreen';

export { SettingsScreen } from './SettingsScreen';

export function NotFoundScreen() {
  return (
    <Screen
      eyebrow="404"
      title="No such page"
      subtitle="That route does not exist."
      actions={
        <Link href={ROUTES.today}>
          <Press>Back to Today</Press>
        </Link>
      }
    />
  );
}
