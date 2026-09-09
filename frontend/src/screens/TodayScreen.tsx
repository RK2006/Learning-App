import { useLocation } from 'wouter';
import { Screen } from './Screen';
import { NextUp } from '../components/NextUp/NextUp';
import { Press } from '../components/Press/Press';
import { Card } from '../components/Card/Card';
import { Chip } from '../components/Chip/Chip';
import { Ring } from '../components/Ring/Ring';
import { StreakFlame } from '../components/StreakFlame/StreakFlame';
import { Pica } from '../components/Pica/Pica';
import { useAppState, useDispatch } from '../state/AppStateContext';
import { repairStreak } from '../state/actions';
import {
  selectActiveCourse,
  selectCourseProgress,
  selectDueCount,
  selectForecastLine,
  selectGoalMet,
  selectLevel,
  selectNextAction,
  selectOverdueCount,
  selectQueue,
  selectRecordConcept,
  selectStreak,
  selectStreakRepair,
  selectToday,
  selectXpToday,
} from '../state/selectors';
import { effectiveMastery } from '../domain/mastery';
import { describeDue, formatDayLong } from '../domain/time';
import { ROUTES } from '../router/routes';
import { reviewHref, sessionHref } from '../router/session';
import s from './TodayScreen.module.css';

export function TodayScreen() {
  const app = useAppState();
  const dispatch = useDispatch();
  const [, navigate] = useLocation();
  const course = selectActiveCourse(app);

  if (!course) {
    return (
      <Screen eyebrow={formatDayLong(selectToday(app))} title="Today">
        <Card className={s.empty}>
          <Pica size={120} state="idle" />
          <h3>Nothing to learn yet</h3>
          <p className={s.emptyNote}>Pick a subject and we will build a path for it.</p>
          <Press size="lg" onClick={() => navigate(ROUTES.onboarding)}>
            Pick your first subject
          </Press>
        </Card>
      </Screen>
    );
  }

  const next = selectNextAction(app);
  const xpToday = selectXpToday(app);
  const goalMet = selectGoalMet(app);
  const streak = selectStreak(app);
  const level = selectLevel(app);
  const due = selectDueCount(app);
  const overdue = selectOverdueCount(app);
  const queue = selectQueue(app, 14).slice(0, 3);
  const progress = selectCourseProgress(course);
  const repair = selectStreakRepair(app);
  const forecastLine = selectForecastLine(app);

  function start() {
    if (next.kind === 'setup') return navigate(ROUTES.onboarding);
    // Straight into the run rather than via the Review screen. The hero button
    // is the app's single recommendation -- making it open a list you then have
    // to act on again is the "one unambiguous next action" promise with an
    // extra click taped to it.
    if (next.kind === 'review' || next.kind === 'reviewUrgent') {
      return navigate(reviewHref(selectQueue(app).map((e) => e.concept.id)));
    }
    if (next.conceptId) {
      navigate(sessionHref(next.conceptId, next.kind === 'practice' ? 'practice' : 'lesson'));
    }
  }

  return (
    <Screen
      eyebrow={formatDayLong(selectToday(app))}
      title={goalMet ? 'Goal complete' : 'Today'}
      subtitle={
        goalMet
          ? `You've hit ${xpToday} of ${app.settings.dailyGoalXp} XP. Anything more today is a bonus.`
          : undefined
      }
    >
      <div className={s.vitals}>
        <Card tight className={s.vital}>
          <Ring value={xpToday / Math.max(1, app.settings.dailyGoalXp)} size={52} thickness={7} tone="go" />
          <div>
            <div className={s.vitalValue}>
              {xpToday}
              <span className={s.vitalOf}>/{app.settings.dailyGoalXp}</span>
            </div>
            <div className={s.vitalLabel}>XP today</div>
          </div>
        </Card>

        <Card tight className={s.vital}>
          <StreakFlame size={40} cold={streak === 0} />
          <div>
            <div className={s.vitalValue}>{streak}</div>
            <div className={s.vitalLabel}>{streak === 1 ? 'day streak' : 'day streak'}</div>
          </div>
        </Card>

        <Card tight className={s.vital}>
          <Ring value={level.progress} size={52} thickness={7} tone="xp">
            {level.level}
          </Ring>
          <div>
            <div className={s.vitalValue}>{level.title}</div>
            <div className={s.vitalLabel}>
              {level.intoLevel}/{level.forNextLevel} to next
            </div>
          </div>
        </Card>

        <Card tight className={s.vital}>
          <Ring value={progress} size={52} thickness={7} tone="brand" />
          <div>
            <div className={s.vitalValue}>{Math.round(progress * 100)}%</div>
            <div className={s.vitalLabel}>{course.topic}</div>
          </div>
        </Card>
      </div>

      {repair.available && (
        <Card className={s.repair}>
          <div>
            <div className="eyebrow">Streak lost</div>
            <h3 className={s.repairTitle}>Your {repair.lostStreak}-day streak broke</h3>
            <p className={s.repairNote}>
              Finish {repair.required} sessions today and we&rsquo;ll bridge the gap. {repair.done} of{' '}
              {repair.required} done — offered once a month.
            </p>
          </div>
          {/* No `streak` variant exists on purpose: --streak is fill-only and
              paper text on it fails contrast. The flame carries the colour. */}
          <Press
            disabled={repair.done < repair.required}
            onClick={() => dispatch(repairStreak(app))}
          >
            {repair.done < repair.required ? `${repair.required - repair.done} to go` : 'Restore streak'}
          </Press>
        </Card>
      )}

      <Card className={s.hero}>
        <div className={s.heroCopy}>
          <div className="eyebrow">
            {overdue > 0 ? `${overdue} overdue` : due > 0 ? `${due} due today` : 'Next up'}
          </div>
          <h2 className={s.heroTitle}>{next.label}</h2>
          <p className={s.heroNote}>
            {next.kind === 'reviewUrgent'
              ? 'Several concepts have slipped below where they should be. Clearing them first keeps the ground under the next one solid.'
              : next.kind === 'review'
                ? 'A short review now is cheaper than relearning these next week.'
                : next.kind === 'lessonBonus'
                  ? "You've already hit your goal today, so this one is free."
                  : 'One concept, a few questions, then we work out what to do next.'}
          </p>
          <div className={s.heroActions}>
            <Press size="lg" onClick={start}>
              {next.kind === 'setup' ? 'Pick a subject' : 'Start'}
            </Press>
            <Press variant="ghost" onClick={() => navigate(ROUTES.path)}>
              Something else
            </Press>
          </div>
        </div>
        <Pica size={132} state={goalMet ? 'cheer' : 'idle'} className={s.heroPica} />
      </Card>

      <div className={s.cols}>
        <Card title="Review queue">
          {/* The forecast is the difference between showing progress and
              modelling forgetting. Stated as a conditional because it is
              avoidable -- that is the whole point of showing it. */}
          {forecastLine && <p className={s.forecast}>{forecastLine}</p>}
          {queue.length === 0 ? (
            <p className={s.muted}>
              Nothing due. Reviews appear here once you have finished a concept.
            </p>
          ) : (
            <ul className={s.queue}>
              {queue.map(({ concept }) => (
                <li key={concept.id}>
                  <button
                    type="button"
                    className={s.queueRow}
                    onClick={() => navigate(sessionHref(concept.id, 'review'))}
                  >
                    <span className={s.queueName}>{concept.name}</span>
                    <span className={s.queueMeta}>
                      <Chip tone={concept.status === 'needsReview' ? 'review' : 'neutral'}>
                        {Math.round(effectiveMastery(concept))}%
                      </Chip>
                      <span className={s.muted}>{describeDue(concept.review.dueOn)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Recent sessions">
          {app.sessions.length === 0 ? (
            <p className={s.muted}>Your finished sessions will show up here.</p>
          ) : (
            <ul className={s.queue}>
              {app.sessions
                .slice(-3)
                .reverse()
                .map((rec) => (
                  <li key={rec.id}>
                    <div className={s.queueRow}>
                      <span className={s.queueName}>
                        {selectRecordConcept(app, rec)?.name ?? 'Session'}
                      </span>
                      <span className={s.queueMeta}>
                        <Chip tone={rec.score >= 70 ? 'go' : 'stop'}>{rec.score}%</Chip>
                        <span className={s.muted}>+{rec.xpAwarded} XP</span>
                      </span>
                    </div>
                  </li>
                ))}
            </ul>
          )}
        </Card>

        {/* `recommendNext` had no endpoint and no caller. It has both now, and
            the pairing was deliberate: an endpoint with no screen ships nothing
            and drifts from its contract unobserved. */}
        <NextUp />
      </div>
    </Screen>
  );
}
