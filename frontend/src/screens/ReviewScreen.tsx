import { useState } from 'react';
import { useLocation } from 'wouter';
import { Screen } from './Screen';
import { Press } from '../components/Press/Press';
import { Card } from '../components/Card/Card';
import { Chip } from '../components/Chip/Chip';
import { Ring } from '../components/Ring/Ring';
import { Pica } from '../components/Pica/Pica';
import { useAppState, useDispatch } from '../state/AppStateContext';
import { snoozeConcept } from '../state/actions';
import { selectForecast, selectQueue, selectToday } from '../state/selectors';
import { MAX_SNOOZES, canSnooze, isLapsed } from '../domain/srs';
import type { QueueEntry } from '../domain/srs';
import { effectiveMastery } from '../domain/mastery';
import { describeDue, describeInDays, formatDayShort } from '../domain/time';
import { ROUTES } from '../router/routes';
import { reviewHref } from '../router/session';
import s from './ReviewScreen.module.css';

/**
 * Filters double as session builders.
 *
 * The plan called for filter chips *and* a separate "Custom session" dropdown,
 * which on inspection are the same control twice: both answer "which subset?".
 * One set of chips that filters the list and retargets the primary button is
 * fewer controls for the same power, and it means the button always starts
 * exactly what you are looking at -- there is no way for the list and the
 * button to disagree.
 */
const FILTERS = [
  { id: 'due', label: 'Due now' },
  { id: 'overdue', label: 'Overdue' },
  { id: 'weak', label: 'Under 60%' },
  { id: 'soon', label: 'Next 7 days' },
] as const;

type FilterId = (typeof FILTERS)[number]['id'];

const SNOOZE_OPTIONS = [
  { days: 1, label: 'Tomorrow' },
  { days: 3, label: '3 days' },
  { days: 7, label: 'Next week' },
];

function applyFilter(entries: QueueEntry[], filter: FilterId): QueueEntry[] {
  switch (filter) {
    case 'overdue':
      return entries.filter((e) => e.overdueDays > 0);
    case 'weak':
      return entries.filter((e) => e.effective < 60);
    case 'soon':
      return entries;
    case 'due':
    default:
      return entries.filter((e) => e.overdueDays >= 0);
  }
}

function SnoozeMenu({ entry, onPick }: { entry: QueueEntry; onPick: (days: number) => void }) {
  const [open, setOpen] = useState(false);
  const allowed = canSnooze(entry.concept.review);

  if (!allowed) {
    return (
      // Not hidden and not silently ignored: say why. Three postponements is
      // the app noticing a pattern, and naming it is more use than a control
      // that quietly stops working.
      <span className={s.snoozeSpent} title={`Snoozed ${MAX_SNOOZES} times already`}>
        Snoozed {MAX_SNOOZES}× — just do it
      </span>
    );
  }

  return (
    <span className={s.snoozeWrap}>
      <Press size="sm" variant="ghost" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        Snooze
      </Press>
      {open && (
        <span className={s.snoozeMenu} role="menu">
          {SNOOZE_OPTIONS.map((o) => (
            <button
              key={o.days}
              type="button"
              role="menuitem"
              className={s.snoozeItem}
              onClick={() => {
                onPick(o.days);
                setOpen(false);
              }}
            >
              {o.label}
            </button>
          ))}
        </span>
      )}
    </span>
  );
}

export function ReviewScreen() {
  const app = useAppState();
  const dispatch = useDispatch();
  const [, navigate] = useLocation();
  const [filter, setFilter] = useState<FilterId>('due');

  const today = selectToday(app);
  // One query at the widest horizon, then narrowed in memory. Asking the engine
  // four different questions would let the counts on the chips disagree with
  // the list they filter.
  const all = selectQueue(app, 7);
  const shown = applyFilter(all, filter);
  const forecast = selectForecast(app, 21).filter((f) => f.days > 0);

  const dueNow = all.filter((e) => e.overdueDays >= 0);
  const overdue = all.filter((e) => e.overdueDays > 0);

  function startSession(entries: QueueEntry[]) {
    if (entries.length === 0) return;
    navigate(reviewHref(entries.map((e) => e.concept.id)));
  }

  if (all.length === 0) {
    return (
      <Screen
        eyebrow="Spaced repetition"
        title="Review"
        subtitle="What is decaying, what is overdue, and what to do about it."
      >
        <Card className={s.empty}>
          <Pica size={110} state="sleep" />
          <h3 className={s.emptyTitle}>Nothing due</h3>
          <p className={s.emptyNote}>
            {app.courses.length === 0
              ? 'Reviews appear here once you have finished a concept.'
              : 'Everything you have studied is still fresh. Concepts come back here as they decay — the forecast below says when.'}
          </p>
          {forecast.length > 0 && (
            <ul className={s.forecastList}>
              {forecast.slice(0, 4).map((f) => (
                <li key={f.concept.id}>
                  <span className={s.fcName}>{f.concept.name}</span>
                  <span className={s.fcWhen}>
                    drops below 60% {describeInDays(f.days)} · {formatDayShort(f.on)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <Press variant="ghost" onClick={() => navigate(ROUTES.path)}>
            Back to your path
          </Press>
        </Card>
      </Screen>
    );
  }

  return (
    <Screen
      eyebrow="Spaced repetition"
      title="Review"
      subtitle={
        overdue.length > 0
          ? `${dueNow.length} due, ${overdue.length} of them overdue. Longest-overdue first.`
          : `${dueNow.length} due today.`
      }
      actions={
        <Press
          variant="review"
          size="lg"
          disabled={shown.length === 0}
          onClick={() => startSession(shown)}
        >
          {shown.length === 0
            ? 'Nothing in this filter'
            : `Start review session (${shown.length})`}
        </Press>
      }
    >
      <div className={s.filters} role="group" aria-label="Filter the queue">
        {FILTERS.map((f) => {
          const count = applyFilter(all, f.id).length;
          return (
            <button
              key={f.id}
              type="button"
              className={s.filter}
              data-on={filter === f.id}
              aria-pressed={filter === f.id}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
              <span className={s.filterCount}>{count}</span>
            </button>
          );
        })}
      </div>

      <Card flush>
        <ul className={s.rows}>
          {shown.map((e) => {
            const c = e.concept;
            const eff = Math.round(e.effective);
            const decayed = Math.round(c.mastery - e.effective);
            const lapsed = isLapsed(c);
            return (
              <li key={c.id} className={s.row}>
                <Ring
                  value={eff / 100}
                  size={44}
                  thickness={6}
                  tone={eff >= 60 ? 'review' : 'stop'}
                  label={`${eff}% mastery`}
                >
                  {eff}
                </Ring>

                <span className={s.rowMain}>
                  <span className={s.rowName}>{c.name}</span>
                  <span className={s.rowMeta}>
                    {describeDue(c.review.dueOn, today)}
                    {decayed >= 2 && ` · ▼${decayed} since you studied it`}
                    {c.review.snoozes > 0 && ` · snoozed ${c.review.snoozes}×`}
                  </span>
                </span>

                {/* Lapsed items sort to the top; the badge says why they are
                    there, so the ordering is legible instead of mysterious. */}
                {lapsed && <Chip tone="stop">Lapsed</Chip>}

                <span className={s.rowActions}>
                  <SnoozeMenu
                    entry={e}
                    onPick={(days) => dispatch(snoozeConcept(app, e.courseId, c.id, days))}
                  />
                  <Press size="sm" variant="review" onClick={() => startSession([e])}>
                    Review
                  </Press>
                </span>
              </li>
            );
          })}
        </ul>
      </Card>

      {forecast.length > 0 && (
        <Card title="Coming up" className={s.forecastCard}>
          <p className={s.forecastNote}>
            Not due yet. These cross below 60% on the dates shown if nothing is reviewed — the
            decay curve, not a guess about you.
          </p>
          <ul className={s.forecastList}>
            {forecast.slice(0, 6).map((f) => (
              <li key={f.concept.id}>
                <span className={s.fcName}>{f.concept.name}</span>
                <span className={s.fcBar} aria-hidden="true">
                  <span
                    className={s.fcBarFill}
                    style={{ width: `${Math.max(4, Math.min(100, (f.days / 21) * 100))}%` }}
                  />
                </span>
                <span className={s.fcWhen}>
                  {Math.round(effectiveMastery(f.concept))}% now · {describeInDays(f.days)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </Screen>
  );
}
