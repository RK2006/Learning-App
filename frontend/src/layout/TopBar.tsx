import { Link } from 'wouter';
import { CaretDown, Lightning } from '@phosphor-icons/react';
import { Ring } from '../components/Ring/Ring';
import { StreakFlame } from '../components/StreakFlame/StreakFlame';
import { ROUTES } from '../router/routes';
import s from './TopBar.module.css';

export interface TopBarStats {
  courseName: string;
  streak: number;
  xpToday: number;
  dailyGoalXp: number;
  totalXp: number;
  level: number;
  initials: string;
}

export interface TopBarProps {
  stats: TopBarStats;
}

/**
 * Every control here navigates somewhere.
 *
 * The build this replaces had six sidebar buttons with no onClick and a "tag"
 * that looked like a control but was a div. The rule going forward: nothing in
 * the chrome looks interactive unless it is.
 */
export function TopBar({ stats }: TopBarProps) {
  const { courseName, streak, xpToday, dailyGoalXp, totalXp, level, initials } = stats;
  const goalPct = dailyGoalXp > 0 ? xpToday / dailyGoalXp : 0;

  return (
    <header className={s.bar}>
      <Link href={ROUTES.path} className={s.course}>
        <span className={s.courseName}>{courseName}</span>
        <CaretDown size={14} weight="bold" />
      </Link>

      <div className={s.spacer} />

      <div className={s.stats}>
        <Link
          href={ROUTES.schedule}
          className={`${s.stat} ${s.statStreak}`}
          title={streak > 0 ? `${streak}-day streak` : 'No active streak'}
        >
          <StreakFlame size={22} cold={streak === 0} />
          {streak}
        </Link>

        <Link href={ROUTES.today} className={s.stat} title={`${xpToday} of ${dailyGoalXp} XP today`}>
          <Ring value={goalPct} size={26} thickness={4} tone="go" />
        </Link>

        {/* .xpLabel is hidden under 900px, so on a phone this link had no
            accessible name at all. The two links either side survived only
            because they already carried `title`. */}
        <Link
          href={ROUTES.progress}
          className={`${s.stat} ${s.statXp}`}
          aria-label={`${totalXp.toLocaleString()} XP, level ${level} — see your progress`}
          title={`${totalXp.toLocaleString()} XP · Level ${level}`}
        >
          <Lightning size={18} weight="fill" />
          <span className={s.xpLabel}>{totalXp.toLocaleString()}</span>
          <span className={s.level}>Lv {level}</span>
        </Link>

        <Link href={ROUTES.profile} className={s.avatar} aria-label="Profile">
          {initials}
        </Link>
      </div>
    </header>
  );
}
