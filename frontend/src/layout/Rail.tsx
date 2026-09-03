import { Link, useLocation } from 'wouter';
import { SidebarSimple } from '@phosphor-icons/react';
import { NAV, ROUTES } from '../router/routes';
import { Pica } from '../components/Pica/Pica';
import { cx } from '../lib/cx';
import s from './Rail.module.css';

export interface RailProps {
  collapsed: boolean;
  onToggle: () => void;
}

export function Rail({ collapsed, onToggle }: RailProps) {
  const [location] = useLocation();

  return (
    <nav className={s.rail} data-collapsed={collapsed} aria-label="Main">
      {/* aria-label on the link itself: collapsing the rail hides .brandText
          with display:none, which removes it from the accessibility tree as
          well as the screen -- leaving Pica's own SVG title as the only name,
          so the home link announced as "Pica the moth, idle". */}
      <Link href={ROUTES.today} className={s.brand} aria-label="Learnable — go to Today">
        <Pica size={30} className={s.brandMark} aria-hidden />
        <span className={s.brandText}>Learnable</span>
      </Link>

      <div className={s.nav}>
        {NAV.map(({ href, label, icon: Icon }) => {
          // /profile must not stay lit while on /profile/settings' sibling routes,
          // but /profile/settings should keep Profile marked as current.
          const active = location === href || (href !== '/' && location.startsWith(`${href}/`));
          return (
            <div key={href} className={s.itemWrap}>
              {active && <span className={s.marker} aria-hidden="true" />}
              {/* The visible label is display:none when collapsed, so it cannot
                  be the accessible name. aria-label always names the link;
                  title gives sighted mouse users the same thing on hover. */}
              <Link
                href={href}
                className={cx(s.item)}
                aria-label={label}
                title={label}
                aria-current={active ? 'page' : undefined}
              >
                <Icon size={22} weight={active ? 'fill' : 'regular'} className={s.icon} />
                <span className={s.label}>{label}</span>
              </Link>
            </div>
          );
        })}
      </div>

      <button
        type="button"
        className={s.collapse}
        onClick={onToggle}
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        <SidebarSimple size={20} />
      </button>
    </nav>
  );
}
